// artifacts/sourdough/lib/__tests__/bulletproofImport.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLocalDataToAccount, clearMigrationPending, formatErrorDiagnostic, isAnonymousOrOwned } from "../migrate";
import { api, packBakeOutcome, unpackBakeOutcome, rowToApiBakeSession } from "../api";
import { clearAuth, saveAuth, getStoredToken, getStoredUser } from "../auth";
import { upsertRecipeRemote } from "../recipeStorage";

let mockStorage: Record<string, string> = {};

// Mock AsyncStorage with working in-memory store
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn((key) => Promise.resolve(mockStorage[key] ?? null)),
  setItem: jest.fn((key, val) => {
    mockStorage[key] = val;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys) => {
    keys.forEach((k: string) => delete mockStorage[k]);
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys) => Promise.resolve(keys.map((k: string) => [k, mockStorage[k] ?? null]))),
  multiSet: jest.fn((entries) => {
    entries.forEach(([k, v]: [string, string]) => { mockStorage[k] = v; });
    return Promise.resolve();
  }),
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

describe("Bulletproof Two-Pass Typed Import Engine & Collision Safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key, val) => {
      mockStorage[key] = val;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => Promise.resolve(mockStorage[key] ?? null));
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

    mockStorage["bread_lab_recipes_v1"] = JSON.stringify(mockRecipes);
    mockStorage["bread_lab_bake_history_v1"] = JSON.stringify(mockBakes);
    mockStorage["sourdough_feed_history_v1"] = JSON.stringify(mockFeeds);

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
    const result = await migrateLocalDataToAccount("empty-user-token");

    expect(result).toEqual({
      feed: { ok: 0, failed: 0, unresolved: 0 },
      bakes: { ok: 0, failed: 0, unresolved: 0 },
      recipes: { ok: 0, failed: 0, unresolved: 0 },
    });
  });

  it("surfaces actual AsyncStorage read rejections as errors", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockRejectedValueOnce(new Error("Disk hardware failure"));

    await expect(migrateLocalDataToAccount("error-token")).rejects.toThrow(/Disk hardware failure/);
  });

  it("reports malformed JSON as failures (throws error)", async () => {
    mockStorage["bread_lab_recipes_v1"] = "{malformed-json";

    await expect(migrateLocalDataToAccount("malformed-token")).rejects.toThrow(/Malformed JSON/);
  });

  it("blocks safe migration when migration ledger is invalid or unreadable", async () => {
    mockStorage["bread_lab_import_ledger_invalid-ledger-token"] = "[1, 2, 3]";

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

    mockStorage["bread_lab_bake_v2"] = JSON.stringify([activeBake]);

    const result = await migrateLocalDataToAccount("test-user-token-abc");

    expect(result.bakes.ok).toBe(1);
  });

  it("generates valid secure UUID v4 when global crypto.randomUUID is unavailable but expo-crypto is present", async () => {
    const originalCrypto = global.crypto;
    (global as any).crypto = undefined;

    const activeFeedWithoutId = { savedAt: 1234, userId: "anonymous", data: { pH: "4.0" } };
    mockStorage["sourdough_feed_session_v1"] = JSON.stringify(activeFeedWithoutId);

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
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify(invalidRecipes);

    await expect(migrateLocalDataToAccount("validation-token")).rejects.toThrow(/Invalid record found/);
  });

  it("persists ledger before first remote write and prevents remote uploads if ledger write fails", async () => {
    const mockRecipes = [{ id: "rec-1", name: "Valid Recipe", userId: "anonymous" }];
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify(mockRecipes);

    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockImplementation((key, val) => {
      if (key.includes("import_ledger")) {
        throw new Error("Ledger storage write failed");
      }
      mockStorage[key] = val;
      return Promise.resolve();
    });

    await expect(migrateLocalDataToAccount("ledger-fail-token")).rejects.toThrow(/Ledger storage write failed/);

    expect(api.recipes.upsert).not.toHaveBeenCalled();
    expect(api.history.bakes.upsert).not.toHaveBeenCalled();
  });

  it("ensures anonymous recipes receive stable destination IDs and reuse them on retry", async () => {
    const anonRecipe = { id: "anon-src-1", name: "Anon Recipe", userId: "anonymous", phases: [] };
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify([anonRecipe]);

    const res1 = await migrateLocalDataToAccount("token-user-1");
    expect(res1.recipes.ok).toBe(1);

    const firstUpsertCall = (api.recipes.upsert as jest.Mock).mock.calls.find(
      (call) => call[0].name === "Anon Recipe"
    );
    const assignedDestId = firstUpsertCall[0].id;
    expect(assignedDestId).toBeDefined();

    const res2 = await migrateLocalDataToAccount("token-user-1");
    expect(res2.recipes.ok).toBe(1);

    const secondUpsertCall = (api.recipes.upsert as jest.Mock).mock.calls.filter(
      (call) => call[0].name === "Anon Recipe"
    )[1];
    expect(secondUpsertCall[0].id).toBe(assignedDestId);
  });

  it("ensures different accounts use account-scoped ledgers and do not share destination mappings", async () => {
    const anonRecipe = { id: "anon-src-shared", name: "Shared Source", userId: "anonymous", phases: [] };
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify([anonRecipe]);

    await migrateLocalDataToAccount("user-account-A");
    const callA = (api.recipes.upsert as jest.Mock).mock.calls.find(
      (call) => call[0].name === "Shared Source" && call[0].userId === "user-account-A"
    );
    const destIdA = callA[0].id;

    await migrateLocalDataToAccount("user-account-B");
    const callB = (api.recipes.upsert as jest.Mock).mock.calls.find(
      (call) => call[0].name === "Shared Source" && call[0].userId === "user-account-B"
    );
    const destIdB = callB[0].id;

    expect(destIdA).toBeDefined();
    expect(destIdB).toBeDefined();
    expect(destIdA).not.toBe(destIdB);
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
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify(localRecipes);

    const result = await migrateLocalDataToAccount("user-B");
    expect(result.recipes.ok).toBe(1);

    expect(api.recipes.upsert).toHaveBeenCalledTimes(1);
    expect(api.recipes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Anonymous Recipe",
        userId: "user-B",
      })
    );
  });

  it("preserves local records when migration fails and reports failed count", async () => {
    const localRecipes = [{ id: "rec-fail", name: "Failing Recipe", userId: "anonymous" }];
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify(localRecipes);

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
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify([rlsFailingRecipe]);

    (api.recipes.upsert as jest.Mock).mockRejectedValueOnce({
      message: 'new row violates row-level security policy (USING expression) for table "recipes"',
      code: '42501',
    });

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrateLocalDataToAccount("rls-token");

    expect(result.recipes.failed).toBe(1);
    expect(result.recipes.ok).toBe(0);

    expect(api.recipes.upsert).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it("resolves parent/child references correctly even when child precedes parent in input list", async () => {
    const childRecipe = { id: "child-rec", name: "Child Recipe", userId: "anonymous", parentRecipeId: "parent-rec", phases: [] };
    const parentRecipe = { id: "parent-rec", name: "Parent Recipe", userId: "anonymous", phases: [] };
    mockStorage["bread_lab_recipes_v1"] = JSON.stringify([childRecipe, parentRecipe]);

    const result = await migrateLocalDataToAccount("order-token");
    expect(result.recipes.ok).toBe(2);

    const calls = (api.recipes.upsert as jest.Mock).mock.calls;
    const parentCall = calls.find((c) => c[0].name === "Parent Recipe");
    const childCall = calls.find((c) => c[0].name === "Child Recipe");

    expect(parentCall).toBeDefined();
    expect(childCall).toBeDefined();
    expect(childCall[0].parentRecipeId).toBe(parentCall[0].id);
  });

  it("tests production isAnonymousOrOwned predicate across all 5 required cases", () => {
    const token = "destination-token-123";

    // 1. Explicitly anonymous record -> eligible
    expect(isAnonymousOrOwned({ userId: "anonymous" }, token)).toBe(true);
    expect(isAnonymousOrOwned({ user_id: "anonymous" }, token)).toBe(true);

    // 2. Record owned by the destination account -> eligible
    expect(isAnonymousOrOwned({ userId: token }, token)).toBe(true);

    // 3. Record owned by another account -> ineligible
    expect(isAnonymousOrOwned({ userId: "other-user-uuid" }, token)).toBe(false);

    // 4. Record with missing ownership metadata -> ineligible
    expect(isAnonymousOrOwned({}, token)).toBe(false);

    // 5. Record with an empty or otherwise invalid owner value -> ineligible
    expect(isAnonymousOrOwned({ userId: "" }, token)).toBe(false);
    expect(isAnonymousOrOwned({ userId: null }, token)).toBe(false);
    expect(isAnonymousOrOwned({ userId: "   " }, token)).toBe(false);
  });

  it("clears operational data for current user / anonymous while retaining foreign and unknown ownership records without failing verification", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = JSON.stringify({
      id: "foreign-active-bake",
      userId: "foreign-user",
      recipeName: "Foreign Bake",
    });

    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBeDefined();

    mockStorage["bread_lab_bake_v2"] = JSON.stringify({
      id: "my-active-bake",
      userId: "user-clearing",
      recipeName: "My Bake",
    });

    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBeUndefined();
  });

  it("retains active bakes with unknown/missing ownership without failing verification", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = JSON.stringify({
      id: "unknown-owner-bake",
      recipeName: "Unknown Owner Bake",
    });

    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBeDefined();
  });

  it("handles active feed ownership: removes anonymous feed, retains foreign and unknown feed data", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["sourdough_feed_session_v1"] = JSON.stringify({
      id: "foreign-feed",
      userId: "other-user",
    });
    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["sourdough_feed_session_v1"]).toBeDefined();

    mockStorage["sourdough_feed_session_v1"] = JSON.stringify({
      id: "anon-feed",
      userId: "anonymous",
    });
    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["sourdough_feed_session_v1"]).toBeUndefined();
  });

  it("rejects cleanup verification when migration-pending marker remains present", async () => {
    const { clearOperationalData } = require("../storageUtils");

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_migration_pending_v1") return Promise.resolve("1");
      return Promise.resolve(mockStorage[key] ?? null);
    });

    await expect(clearOperationalData("user-clearing")).rejects.toThrow(
      /migration pending marker remains present/
    );
  });

  it("preserves malformed active bake and feed JSON safely without crashing", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = "{malformed-active-bake";
    mockStorage["sourdough_feed_session_v1"] = "{malformed-active-feed";

    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBe("{malformed-active-bake");
    expect(mockStorage["sourdough_feed_session_v1"]).toBe("{malformed-active-feed");
  });

  it("explicitly removes anonymous-owned active bakes", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = JSON.stringify({
      id: "anon-bake",
      userId: "anonymous",
      recipeName: "Anon Bake",
    });

    await expect(clearOperationalData("user-clearing")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBeUndefined();
  });

  it("demonstrates clearOperationalData resolves successfully and retains malformed active bake and feed JSON", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = "{malformed-bake";
    mockStorage["sourdough_feed_session_v1"] = "{malformed-feed";

    await expect(clearOperationalData("incoming-user")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBe("{malformed-bake");
    expect(mockStorage["sourdough_feed_session_v1"]).toBe("{malformed-feed");
  });

  it("demonstrates clearOperationalData resolves successfully and retains active bake and feed records with unknown or missing ownership", async () => {
    const { clearOperationalData } = require("../storageUtils");

    mockStorage["bread_lab_bake_v2"] = JSON.stringify({
      id: "unknown-owner-bake",
      recipeName: "Unknown Owner Bake",
    });
    mockStorage["sourdough_feed_session_v1"] = JSON.stringify({
      id: "unknown-owner-feed",
      starterName: "Unknown Owner Feed",
    });

    await expect(clearOperationalData("incoming-user")).resolves.toBeUndefined();
    expect(mockStorage["bread_lab_bake_v2"]).toBeDefined();
    expect(mockStorage["sourdough_feed_session_v1"]).toBeDefined();
  });
});
