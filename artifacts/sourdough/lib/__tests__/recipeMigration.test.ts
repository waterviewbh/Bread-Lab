// artifacts/sourdough/lib/__tests__/recipeMigration.test.ts
import { migrateLocalDataToAccount } from "../migrate";
import { getOwnerStorageKey, APP_STORAGE_KEYS } from "../storageUtils";
import { api } from "../api";
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

describe("Issue #24: Owner-Scoped Migration Reads, Active-Bake Persistence & Strong Assertions (A-F)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key, val) => {
      mockStorage[key] = val;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => Promise.resolve(mockStorage[key] ?? null));
  });

  it("Test A — Owner-scoped recipes are correctly read, migrated, and payload verified", async () => {
    const token = "user-123";
    const scopedRecipesKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, token);
    mockStorage[scopedRecipesKey] = JSON.stringify([
      { id: "rec-scoped-1", userId: token, name: "Scoped Recipe 1", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.recipes.ok).toBe(1);

    const upsertMock = api.recipes.upsert as jest.Mock;
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-scoped-1",
        userId: token,
        name: "Scoped Recipe 1",
      })
    );
  });

  it("Test B — Owner-scoped active bake without ID assigns ID and persists back to scoped key", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);
    mockStorage[scopedActiveBakeKey] = JSON.stringify({
      id: "",
      userId: token,
      recipeName: "Scoped Bake Without ID",
      phases: [{ key: "mix", name: "Mix", ingredients: [], instructions: [] }]
    });

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    // Verify assigned ID persisted back to scoped key and legacy key untouched
    const storedScopedRaw = mockStorage[scopedActiveBakeKey];
    expect(storedScopedRaw).toBeDefined();
    const parsedScoped = JSON.parse(storedScopedRaw);
    expect(parsedScoped.id).toBeTruthy();
    expect(parsedScoped.recipeName).toBe("Scoped Bake Without ID");
    expect(parsedScoped.phases.length).toBe(1);

    expect(mockStorage[APP_STORAGE_KEYS.ACTIVE_BAKE]).toBeUndefined();
  });

  it("Test C — Owner-scoped bake history is correctly read and payload verified", async () => {
    const token = "user-123";
    const scopedHistoryKey = getOwnerStorageKey(APP_STORAGE_KEYS.BAKE_HISTORY, token);
    mockStorage[scopedHistoryKey] = JSON.stringify([
      { id: "history-scoped-1", userId: token, recipeName: "History Bake", phases: [], savedAt: 123456789 }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    const bakesUpsertMock = api.history.bakes.upsert as jest.Mock;
    expect(bakesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "history-scoped-1",
        userId: token,
        recipeName: "History Bake",
      })
    );
  });

  it("Test D — Foreign-account isolation verified via exact API payload inspection", async () => {
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

    const upsertMock = api.recipes.upsert as jest.Mock;
    const submittedPayloads = upsertMock.mock.calls.map(call => call[0]);
    expect(submittedPayloads.some(p => p.id === "rec-A")).toBe(true);
    expect(submittedPayloads.some(p => p.id === "rec-B")).toBe(false);
  });

  it("Test E — Retry and stable identity (idempotency) with ledger stability inspection", async () => {
    const token = "user-123";
    const scopedRecipesKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, token);
    mockStorage[scopedRecipesKey] = JSON.stringify([
      { id: "rec-stable-1", userId: token, name: "Stable Recipe", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const res1 = await migrateLocalDataToAccount(token);
    const res2 = await migrateLocalDataToAccount(token);

    expect(res1.recipes.ok).toBe(1);
    expect(res2.recipes.ok).toBe(1);

    const upsertMock = api.recipes.upsert as jest.Mock;
    expect(upsertMock).toHaveBeenCalledTimes(2);
    const firstCallId = upsertMock.mock.calls[0][0].id;
    const secondCallId = upsertMock.mock.calls[1][0].id;
    expect(firstCallId).toBe(secondCallId);
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
