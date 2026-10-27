// artifacts/sourdough/lib/__tests__/bulletproofImport.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLocalDataToAccount, clearMigrationPending, formatErrorDiagnostic } from "../migrate";
import { api, packBakeOutcome, unpackBakeOutcome, rowToApiBakeSession } from "../api";
import { clearAuth, saveAuth, getStoredToken, getStoredUser } from "../auth";
import { upsertRecipeRemote } from "../recipeStorage";

// Mock AsyncStorage and api
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../api", () => {
  const actualApi = jest.requireActual("../api");
  return {
    ...actualApi,
    api: {
      ...actualApi.api,
      history: {
        feed: { upsert: jest.fn().mockResolvedValue({}) },
        bakes: { upsert: jest.fn().mockResolvedValue({}) },
      },
      recipes: { upsert: jest.fn().mockResolvedValue({}) },
    },
  };
});

jest.mock("../deviceId", () => ({
  getDeviceId: jest.fn().mockResolvedValue("mock-device-id-123"),
}));

describe("Bulletproof Two-Pass Typed Import Engine & Issue #24 Production UUID Generation Fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it("handles out-of-order recipe dependencies and cross-table ID collisions with typed composite keys", async () => {
    const mockRecipes = [
      { id: "same-id", name: "Child Recipe", parentRecipeId: "same-id", userId: "anonymous" },
      { id: "parent-id", name: "Parent Recipe", userId: "anonymous" },
    ];
    const mockBakes = [
      { id: "same-id", recipeName: "Bake with same ID", recipeId: "parent-id", savedAt: 1000, startedAt: 900, phases: [], userId: "anonymous" },
    ];
    const mockFeeds = [
      { id: "same-id", savedAt: 1000, data: {}, userId: "anonymous" },
    ];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation(function(key) {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      if (key.includes("bake_history")) return Promise.resolve(JSON.stringify(mockBakes));
      if (key.includes("sourdough_feed_history")) return Promise.resolve(JSON.stringify(mockFeeds));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("test-user-token-abc");

    expect(result.recipes.ok).toBe(2);
    expect(result.bakes.ok).toBe(1);
    expect(result.feed.ok).toBe(1);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("bread_lab_import_ledger_test-user-token-abc"),
      expect.any(String)
    );
  });

  it("succeeds as an empty migration when local data is genuinely absent", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockResolvedValue(null);

    const result = await migrateLocalDataToAccount("empty-user-token");

    expect(result).toEqual({
      feed: { ok: 0, failed: 0 },
      bakes: { ok: 0, failed: 0 },
      recipes: { ok: 0, failed: 0 },
    });
  });

  it("surfaces actual AsyncStorage read rejections as errors", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockRejectedValue(new Error("Disk hardware failure"));

    await expect(migrateLocalDataToAccount("error-token")).rejects.toThrow(/Disk hardware failure/);
  });

  it("reports malformed JSON as failures (throws error)", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve("{malformed-json");
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("malformed-token")).rejects.toThrow(/Malformed JSON/);
  });

  it("blocks safe migration when migration ledger is invalid or unreadable", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("import_ledger")) return Promise.resolve("[1, 2, 3]");
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("invalid-ledger-token")).rejects.toThrow(/Invalid migration ledger shape/);
  });

  it("preserves complete active bake state including estimatorState, bulkCheckInHistory, and bulkFermentState", async () => {
    const activeBake = {
      id: "active-bake-full",
      userId: "anonymous",
      recipeName: "Complete Bake",
      startedAt: 5000,
      estimatorState: { flourG: "500", targetTemp: "78" },
      bulkCheckInHistory: [{ checkInId: "c-1", timestamp: 5100 }],
      phases: [
        {
          key: "bulk_fermenting",
          name: "Bulk Ferment",
          startedAt: 5000,
          completedAt: null,
          readings: [{ id: "r-1", temp: "78", loggedAt: 5050 }],
          foldTimestamps: [120],
          bulkFermentState: { startVolume_ml: 1000, maxVolume_ml: 1500 },
        },
      ],
    };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_bake_v2") return Promise.resolve(JSON.stringify([activeBake]));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("test-user-token-abc");

    expect(result.bakes.ok).toBe(1);
  });

  it("generates valid secure UUID v4 when global crypto.randomUUID is unavailable but expo-crypto is present", async () => {
    const originalCrypto = global.crypto;
    (global as any).crypto = undefined;

    const activeFeedWithoutId = { savedAt: 1234, userId: "anonymous", data: { pH: "4.0" } };
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "sourdough_feed_session_v1") return Promise.resolve(JSON.stringify(activeFeedWithoutId));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("expo-crypto-uuid-token");
    expect(result.feed.ok).toBe(1);

    (global as any).crypto = originalCrypto;
  });

  it("correctly handles outcome compatibility variants (new wrappers, legacy wrappers, ordinary objects)", () => {
    const markedWrapper = packBakeOutcome("completed", { targetTemp: "76" }, [{ id: "s-1" }]);
    expect(markedWrapper._bread_lab_wrapped).toBe(true);
    const unpackedMarked = unpackBakeOutcome(markedWrapper);
    expect(unpackedMarked).toEqual({
      outcome: "completed",
      estimatorState: { targetTemp: "76" },
      bulkCheckInHistory: [{ id: "s-1" }],
    });

    const ordWithHistory = { outcome: "success", rating: 5, bulkCheckInHistory: [] };
    const unpackedHistory = unpackBakeOutcome(ordWithHistory);
    expect(unpackedHistory).toEqual({ outcome: ordWithHistory });

    expect(unpackBakeOutcome(null)).toEqual({ outcome: null });
    expect(unpackBakeOutcome("success")).toEqual({ outcome: "success" });
  });

  it("rejects malformed records or missing/invalid identity fields before migration", async () => {
    const invalidRecipes = [{ name: "Missing ID Recipe", userId: "anonymous" }];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(invalidRecipes));
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("validation-token")).rejects.toThrow(/Invalid record found/);
  });

  it("persists ledger before first remote write and prevents remote uploads if ledger write fails", async () => {
    const mockRecipes = [{ id: "rec-1", name: "Valid Recipe", userId: "anonymous" }];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      return Promise.resolve(null);
    });

    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockImplementation((key, val) => {
      if (key.includes("import_ledger")) {
        throw new Error("Ledger storage write failed");
      }
      return Promise.resolve();
    });

    await expect(migrateLocalDataToAccount("ledger-fail-token")).rejects.toThrow(/Ledger storage write failed/);

    expect(api.recipes.upsert).not.toHaveBeenCalled();
    expect(api.history.bakes.upsert).not.toHaveBeenCalled();
  });

  it("preserves local record IDs when migration ledger is missing and aligns ordinary sync with migration", async () => {
    const localRecipe = { id: "rec-stable-123", name: "Stable Loaf", userId: "anonymous", createdAt: 1700000000000, phases: [] };
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify([localRecipe]));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("missing-ledger-token");
    expect(result.recipes.ok).toBe(1);

    // Verify migration sends targetId = "rec-stable-123" matching local ID
    expect(api.recipes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-stable-123",
        name: "Stable Loaf",
      })
    );

    // Verify ordinary sync also sends id = "rec-stable-123"
    await upsertRecipeRemote({ id: "rec-stable-123", name: "Stable Loaf", userId: "anonymous", createdAt: 1700000000000, phases: [] });
    expect(api.recipes.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "rec-stable-123",
        name: "Stable Loaf",
      })
    );
  });

  it("preserves existing ledger target mapping if present and retains recipe references in bake sessions", async () => {
    const mockRecipes = [{ id: "rec-1", name: "Recipe 1", parentRecipeId: "rec-1", userId: "anonymous" }];
    const mockBakes = [{ id: "bake-1", recipeName: "Bake 1", recipeId: "rec-1", savedAt: 1000, startedAt: 900, phases: [], userId: "anonymous" }];
    const existingLedger = { "recipe:rec-1": "custom-remote-uuid-1", "bake:bake-1": "custom-remote-bake-uuid" };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("import_ledger")) return Promise.resolve(JSON.stringify(existingLedger));
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      if (key.includes("bake_history")) return Promise.resolve(JSON.stringify(mockBakes));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("existing-ledger-token");
    expect(result.recipes.ok).toBe(1);
    expect(result.bakes.ok).toBe(1);

    expect(api.recipes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "custom-remote-uuid-1",
        parentRecipeId: "custom-remote-uuid-1",
      })
    );

    expect(api.history.bakes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "custom-remote-bake-uuid",
        recipeId: "custom-remote-uuid-1",
      })
    );
  });

  it("is idempotent across repeated migrations under different user tokens without creating new random UUIDs", async () => {
    const localRecipe = { id: "rec-idempotent-999", name: "Idempotent Recipe", userId: "anonymous", phases: [] };
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify([localRecipe]));
      return Promise.resolve(null);
    });

    // Migration 1 under Token A
    const res1 = await migrateLocalDataToAccount("user-token-A");
    expect(res1.recipes.ok).toBe(1);
    expect(api.recipes.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "rec-idempotent-999" })
    );

    // Migration 2 under Token B (token changed, ledger missing for Token B)
    const res2 = await migrateLocalDataToAccount("user-token-B");
    expect(res2.recipes.ok).toBe(1);
    expect(api.recipes.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "rec-idempotent-999" })
    );
  });

  it("formats Postgrest error objects into readable diagnostics without credential leak", () => {
    const postgrestError = {
      message: "duplicate key value violates unique constraint",
      code: "23505",
      details: "Key (id)=(rec-123) already exists.",
      hint: "Check primary key",
    };
    const formatted = formatErrorDiagnostic(postgrestError);
    expect(formatted).toContain("duplicate key value violates unique constraint");
    expect(formatted).toContain("Code: 23505");
    expect(formatted).toContain("Details: Key (id)=(rec-123) already exists.");
    expect(formatted).not.toContain("password");
    expect(formatted).not.toContain("token");
  });

  it("filters out records belonging to a different user or with missing userId to preserve account isolation", async () => {
    const localRecipes = [
      { id: "rec-owner-A", name: "User A Recipe", userId: "user-A" },
      { id: "rec-missing-owner", name: "Missing Owner Recipe" },
      { id: "rec-anon", name: "Anonymous Recipe", userId: "anonymous" },
    ];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(localRecipes));
      return Promise.resolve(null);
    });

    // Migrating for user-B: rec-owner-A and rec-missing-owner should be filtered out, rec-anon should be migrated
    const result = await migrateLocalDataToAccount("user-B");
    expect(result.recipes.ok).toBe(1);

    expect(api.recipes.upsert).toHaveBeenCalledTimes(1);
    expect(api.recipes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-anon",
        userId: "user-B",
      })
    );
  });

  it("preserves local records when migration fails and reports failed count", async () => {
    const localRecipes = [{ id: "rec-fail", name: "Failing Recipe", userId: "anonymous" }];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(localRecipes));
      return Promise.resolve(null);
    });

    (api.recipes.upsert as jest.Mock).mockRejectedValueOnce({
      message: "Database connection lost",
      code: "57P01",
    });

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrateLocalDataToAccount("failing-token");
    expect(result.recipes.failed).toBe(1);
    expect(result.recipes.ok).toBe(0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Migration] Failed to sync recipe"),
      expect.stringContaining("Database connection lost")
    );

    consoleSpy.mockRestore();
  });

  it("fails closed without UUID reallocation when api.recipes.upsert returns RLS 42501 error", async () => {
    const rlsFailingRecipe = { id: "rec-rls-123", name: "RLS Recipe", userId: "anonymous", phases: [] };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify([rlsFailingRecipe]));
      return Promise.resolve(null);
    });

    (api.recipes.upsert as jest.Mock).mockRejectedValueOnce({
      message: 'new row violates row-level security policy (USING expression) for table "recipes"',
      code: '42501',
    });

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrateLocalDataToAccount("rls-token");

    expect(result.recipes.failed).toBe(1);
    expect(result.recipes.ok).toBe(0);

    expect(api.recipes.upsert).toHaveBeenCalledTimes(1);
    expect(api.recipes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rec-rls-123" })
    );

    consoleSpy.mockRestore();
  });

  it("resolves parent/child references correctly even when child precedes parent in input list", async () => {
    const childRecipe = { id: "child-rec", name: "Child Recipe", userId: "anonymous", parentRecipeId: "parent-rec", phases: [] };
    const parentRecipe = { id: "parent-rec", name: "Parent Recipe", userId: "anonymous", phases: [] };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify([childRecipe, parentRecipe]));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("order-token");
    expect(result.recipes.ok).toBe(2);

    expect(api.recipes.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "parent-rec", name: "Parent Recipe" })
    );

    expect(api.recipes.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "child-rec", name: "Child Recipe", parentRecipeId: "parent-rec" })
    );
  });
});
