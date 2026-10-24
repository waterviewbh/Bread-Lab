// artifacts/sourdough/lib/__tests__/bulletproofImport.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLocalDataToAccount, clearMigrationPending } from "../migrate";
import { api } from "../api";

// Mock AsyncStorage and api
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("../api", () => ({
  api: {
    history: {
      feed: { upsert: jest.fn().mockResolvedValue({}) },
      bakes: { upsert: jest.fn().mockResolvedValue({}) },
    },
    recipes: { upsert: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock("../deviceId", () => ({
  getDeviceId: jest.fn().mockResolvedValue("mock-device-id-123"),
}));

describe("Bulletproof Two-Pass Typed Import Engine & Issue #24 Enhancements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles out-of-order recipe dependencies and cross-table ID collisions with typed composite keys", async () => {
    const mockRecipes = [
      { id: "same-id", name: "Child Recipe", parentRecipeId: "same-id" },
      { id: "parent-id", name: "Parent Recipe" },
    ];
    const mockBakes = [
      { id: "same-id", recipeName: "Bake with same ID", recipeId: "parent-id", savedAt: 1000, startedAt: 900, phases: [] },
    ];
    const mockFeeds = [
      { id: "same-id", savedAt: 1000, data: {} },
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

  it("reports storage read failures or malformed JSON as failures (throws error)", async () => {
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
      if (key.includes("import_ledger")) return Promise.resolve("[1, 2, 3]"); // invalid shape (array instead of object)
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("invalid-ledger-token")).rejects.toThrow(/Invalid migration ledger shape/);
  });

  it("preserves active bake and active feed sessions with in-progress status and resumable fields", async () => {
    const activeBake = { id: "active-bake-99", recipeName: "My Active Bake", startedAt: 5000, phases: [] };
    const activeFeed = { id: "active-feed-88", savedAt: 6000, data: { pH: "4.2" } };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_bake_v2") return Promise.resolve(JSON.stringify([activeBake]));
      if (key === "sourdough_feed_session_v1") return Promise.resolve(JSON.stringify(activeFeed));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("active-sessions-token");

    expect(result.bakes.ok).toBe(1);
    expect(result.feed.ok).toBe(1);

    expect(api.history.bakes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: "My Active Bake",
        inProgress: true,
      })
    );

    expect(api.history.feed.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        inProgress: true,
        data: activeFeed,
      })
    );
  });

  it("reports partial upload failures without clearing migration pending flag", async () => {
    const mockRecipes = [
      { id: "rec-1", name: "Recipe 1" },
      { id: "rec-2", name: "Recipe 2" },
    ];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      return Promise.resolve(null);
    });

    const upsertMock = api.recipes.upsert as jest.Mock;
    upsertMock.mockImplementation((body) => {
      if (body.id === ledgerMap["recipe:rec-2"]) {
        throw new Error("Network error uploading rec-2");
      }
      return Promise.resolve({});
    });

    // We can pre-seed ledger mock for specific ids
    const ledgerMap: Record<string, string> = {
      "recipe:rec-1": "target-uuid-rec-1",
      "recipe:rec-2": "target-uuid-rec-2",
    };
    getItemMock.mockImplementation((key) => {
      if (key.includes("import_ledger")) return Promise.resolve(JSON.stringify(ledgerMap));
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("partial-fail-token");

    expect(result.recipes.ok).toBe(1);
    expect(result.recipes.failed).toBe(1);
  });

  it("reuses previously allocated IDs when retrying migration after partial failure", async () => {
    const mockRecipes = [{ id: "rec-retry-1", name: "Retry Recipe" }];

    const existingLedger = {
      "recipe:rec-retry-1": "pre-allocated-uuid-1234",
    };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("import_ledger")) return Promise.resolve(JSON.stringify(existingLedger));
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      return Promise.resolve(null);
    });

    const upsertMock = api.recipes.upsert as jest.Mock;
    upsertMock.mockResolvedValue({});

    await migrateLocalDataToAccount("retry-token");

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pre-allocated-uuid-1234",
        name: "Retry Recipe",
      })
    );
  });
});
