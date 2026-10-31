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

describe("Issue #24: Owner-Scoped Migration Reads & Active-Bake Persistence Tests (A-C)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key, val) => {
      mockStorage[key] = val;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => Promise.resolve(mockStorage[key] ?? null));
  });

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
});
