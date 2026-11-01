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

describe("Issue #24: Owner-Scoped Migration Reads, Restored Coverage & Ownership-Safe Active-Bake Persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key, val) => {
      mockStorage[key] = val;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => Promise.resolve(mockStorage[key] ?? null));
  });

  // 1. Restored Tests
  it("Restored Test — Owner-scoped recipe migration with API upsert payload inspection", async () => {
    const token = "user-123";
    const scopedRecipesKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, token);
    mockStorage[scopedRecipesKey] = JSON.stringify([
      { id: "rec-scoped-1", userId: token, name: "Scoped Recipe Payload", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.recipes.ok).toBe(1);

    const upsertMock = api.recipes.upsert as jest.Mock;
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-scoped-1",
        userId: token,
        name: "Scoped Recipe Payload",
      })
    );
  });

  it("Restored Test — Owner-scoped bake-history migration with API upsert payload inspection", async () => {
    const token = "user-123";
    const scopedHistoryKey = getOwnerStorageKey(APP_STORAGE_KEYS.BAKE_HISTORY, token);
    mockStorage[scopedHistoryKey] = JSON.stringify([
      { id: "history-scoped-1", userId: token, recipeName: "History Bake Payload", phases: [], savedAt: 123456789 }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    const bakesUpsertMock = api.history.bakes.upsert as jest.Mock;
    expect(bakesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "history-scoped-1",
        userId: token,
        recipeName: "History Bake Payload",
      })
    );
  });

  it("Restored Test — Foreign-account isolation proving foreign records are excluded from migration", async () => {
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

  it("Restored Test — Retry behavior and stable recipe identity (idempotency)", async () => {
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
    expect(upsertMock.mock.calls[0][0].id).toBe(upsertMock.mock.calls[1][0].id);
  });

  it("Restored Test — Legacy flat-key recipe migration compatibility", async () => {
    const token = "user-123";
    mockStorage[APP_STORAGE_KEYS.RECIPES] = JSON.stringify([
      { id: "rec-legacy-1", userId: token, name: "Legacy Recipe", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.recipes.ok).toBe(1);
  });

  // 2. Active-Bake Persistence & Ownership Safety Tests
  it("Active Bake Test A — Scoped-only record without ID gets assigned ID, persisted to scoped key, legacy key untouched", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);
    const legacyActiveBakeKey = APP_STORAGE_KEYS.ACTIVE_BAKE;

    mockStorage[scopedActiveBakeKey] = JSON.stringify({
      id: "",
      userId: token,
      recipeName: "Scoped Bake Only",
      phases: []
    });

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    const storedScoped = JSON.parse(mockStorage[scopedActiveBakeKey]);
    expect(storedScoped.id).toBeTruthy();
    expect(storedScoped.recipeName).toBe("Scoped Bake Only");

    expect(mockStorage[legacyActiveBakeKey]).toBeUndefined();
  });

  it("Active Bake Test B — Legacy-only record without ID gets assigned ID, persisted to legacy key, scoped key untouched", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);
    const legacyActiveBakeKey = APP_STORAGE_KEYS.ACTIVE_BAKE;

    mockStorage[legacyActiveBakeKey] = JSON.stringify({
      id: "",
      userId: token,
      recipeName: "Legacy Bake Only",
      phases: []
    });

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    const storedLegacy = JSON.parse(mockStorage[legacyActiveBakeKey]);
    expect(storedLegacy.id).toBeTruthy();
    expect(storedLegacy.recipeName).toBe("Legacy Bake Only");

    expect(mockStorage[scopedActiveBakeKey]).toBeUndefined();
  });

  it("Active Bake Test C — Mixed scoped and legacy records persist assigned IDs to correct source keys with precedence", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);
    const legacyActiveBakeKey = APP_STORAGE_KEYS.ACTIVE_BAKE;

    mockStorage[scopedActiveBakeKey] = JSON.stringify({
      id: "bake-scoped-shared",
      userId: token,
      recipeName: "Scoped Version",
      phases: []
    });

    mockStorage[legacyActiveBakeKey] = JSON.stringify([
      {
        id: "bake-scoped-shared",
        userId: token,
        recipeName: "Legacy Version (Should be overridden)",
        phases: []
      },
      {
        id: "",
        userId: token,
        recipeName: "Legacy ID-less Bake",
        phases: []
      }
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(2);

    const storedScoped = JSON.parse(mockStorage[scopedActiveBakeKey]);
    expect(storedScoped.recipeName).toBe("Scoped Version");

    const storedLegacy = JSON.parse(mockStorage[legacyActiveBakeKey]);
    expect(Array.isArray(storedLegacy)).toBe(true);
    expect(storedLegacy.length).toBe(1);
    expect(storedLegacy[0].recipeName).toBe("Legacy ID-less Bake");
    expect(storedLegacy[0].id).toBeTruthy();
  });

  it("Active Bake Test D — Ownership-safe active-bake persistence verifies rejected/foreign records are not rewritten or normalized", async () => {
    const token = "user-123";
    const scopedActiveBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, token);

    const foreignOriginal = {
      id: "",
      userId: "user-FOREIGN",
      recipeName: "Foreign Unassigned Bake",
      phases: [],
      marker: "pristine-foreign-marker"
    };

    const eligibleOriginal = {
      id: "",
      userId: token,
      recipeName: "Eligible User Bake",
      phases: []
    };

    mockStorage[scopedActiveBakeKey] = JSON.stringify([
      eligibleOriginal,
      foreignOriginal
    ]);

    const result = await migrateLocalDataToAccount(token);
    expect(result.bakes.ok).toBe(1);

    const storedBakes = JSON.parse(mockStorage[scopedActiveBakeKey]);
    const eligible = storedBakes.find((b: any) => b.userId === token);
    const foreign = storedBakes.find((b: any) => b.userId === "user-FOREIGN");

    // Eligible record is normalized (assigned a non-empty ID)
    expect(eligible.id).toBeTruthy();
    expect(eligible.id).not.toBe("");

    // Rejected/foreign record must not be normalized, assigned an ID, or mutated in any way
    expect(foreign.id).toBe("");
    expect(foreign.marker).toBe("pristine-foreign-marker");
  });
});
