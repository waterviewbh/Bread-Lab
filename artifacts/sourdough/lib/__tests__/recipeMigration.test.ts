// artifacts/sourdough/lib/__tests__/recipeMigration.test.ts
import { migrateLocalDataToAccount } from "../migrate";
import { getOwnerStorageKey, APP_STORAGE_KEYS } from "../storageUtils";
import AsyncStorage from "@react-native-async-storage/async-storage";

let mockStorage: Record<string, string> = {};

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

describe("Issue #24: Owner-Scoped Migration Reads & Compatibility Tests (A-F)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key, val) => {
      mockStorage[key] = val;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => Promise.resolve(mockStorage[key] ?? null));
  });

  it("Test A — Owner-scoped recipes are correctly read and migrated", async () => {
    const token = "user-123";
    const scopedRecipesKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, token);
    mockStorage[scopedRecipesKey] = JSON.stringify([
      { id: "rec-scoped-1", userId: token, name: "Scoped Recipe 1", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.recipes.ok).toBe(1);
  });

  it("Test B — Owner-scoped active bake is correctly read and migrated", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);
    mockStorage[scopedActiveBakeKey] = JSON.stringify([
      { id: "bake-scoped-1", userId: token, recipeName: "Scoped Bake", phases: [] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);
  });

  it("Test C — Owner-scoped bake history is correctly read and migrated", async () => {
    const token = "user-123";
    const scopedHistoryKey = getOwnerStorageKey(APP_STORAGE_KEYS.BAKE_HISTORY, token);
    mockStorage[scopedHistoryKey] = JSON.stringify([
      { id: "history-scoped-1", userId: token, recipeName: "History Bake", phases: [], savedAt: Date.now() }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);
  });

  it("Test D — Foreign-account isolation during migration", async () => {
    const tokenA = "user-A";
    const tokenB = "user-B";
    const recipesKeyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, tokenA);
    const recipesKeyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, tokenB);

    mockStorage[recipesKeyA] = JSON.stringify([
      { id: "rec-A", userId: tokenA, name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);
    mockStorage[recipesKeyB] = JSON.stringify([
      { id: "rec-B", userId: tokenB, name: "Recipe B", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(tokenA);
    expect(result.recipes.ok).toBe(1);
  });

  it("Test E — Retry and stable identity (idempotency)", async () => {
    const token = "user-123";
    const scopedRecipesKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, token);
    mockStorage[scopedRecipesKey] = JSON.stringify([
      { id: "rec-stable-1", userId: token, name: "Stable Recipe", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const res1 = await migrateLocalDataToAccount(token);
    const res2 = await migrateLocalDataToAccount(token);

    expect(res1.recipes.ok).toBe(1);
    expect(res2.recipes.ok).toBe(1);
  });

  it("Test F — Legacy compatibility via fallback flat keys", async () => {
    const token = "user-123";
    mockStorage[APP_STORAGE_KEYS.RECIPES] = JSON.stringify([
      { id: "rec-legacy-1", userId: token, name: "Legacy Recipe", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.recipes.ok).toBe(1);
  });
});
