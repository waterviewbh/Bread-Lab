import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { archiveBakeWithDiagnostics } from "@/lib/recipeStorage";
import { BAKE_HISTORY_KEY, BAKE_KEY, ActiveBake } from "@/lib/recipeTypes";
import { getOwnerStorageKey } from "@/lib/storageUtils";

let mockStore: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore[key] || null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  }),
}));

describe("Issue #69 — Bake Reset vs History Archival Suite", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockStore = {};
    await AsyncStorage.clear();
  });

  it("1. Completed bakes successfully archive to BAKE_HISTORY_KEY via archiveBakeWithDiagnostics", async () => {
    const mockBake: ActiveBake = {
      id: "bake-123",
      recipeId: "rec-1",
      recipeName: "Sourdough Bread",
      startedAt: Date.now() - 3600000,
      completedAt: Date.now(),
      status: "completed",
      phases: [{ key: "baking", name: "Baking", ingredients: [], instructions: [], startedAt: 1, completedAt: 2, readings: [] }],
      yieldValue: "1",
    };

    const callbacks = {
      reportSyncStart: jest.fn(),
      reportSyncSuccess: jest.fn(),
      reportSyncFailure: jest.fn(),
    };

    await AsyncStorage.setItem(getOwnerStorageKey(BAKE_KEY, "anonymous"), JSON.stringify([mockBake]));
    await archiveBakeWithDiagnostics(mockBake, callbacks);
    await archiveBakeWithDiagnostics(mockBake, callbacks);
    expect(JSON.parse((await AsyncStorage.getItem(getOwnerStorageKey(BAKE_KEY, "anonymous")))!)).toEqual([]);

    const raw = await AsyncStorage.getItem(getOwnerStorageKey(BAKE_HISTORY_KEY, "anonymous"));
    const parsed = JSON.parse(raw || "[]");
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe("bake-123");
    expect(parsed[0].status).toBe("completed");
  });

  it("retries a remote failure with the same History identity and timestamps", async () => {
    const bake: ActiveBake = {
      id: "retry-bake", recipeId: "recipe", recipeName: "Loaf", userId: "anonymous",
      startedAt: 1, completedAt: 2, status: "completed", yieldValue: "1",
      phases: [{ key: "baking", name: "Baking", ingredients: [], instructions: [], startedAt: 1, completedAt: 2, readings: [] }],
    };
    const upsert = jest.spyOn(api.history.bakes, "upsert")
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (body: any) => body);
    const callbacks = { reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn() };
    await archiveBakeWithDiagnostics(bake, callbacks);
    const historyKey = getOwnerStorageKey(BAKE_HISTORY_KEY, "anonymous");
    const first = JSON.parse((await AsyncStorage.getItem(historyKey))!)[0];
    await archiveBakeWithDiagnostics(bake, callbacks);
    const after = JSON.parse((await AsyncStorage.getItem(historyKey))!);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(first);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].savedAt).toBe(first.savedAt);
    expect(upsert.mock.calls[1][0].savedAt).toBe(first.savedAt);
    expect(upsert.mock.calls[0][0].completedAt).toBe(first.completedAt);
    expect(upsert.mock.calls[1][0].completedAt).toBe(first.completedAt);
    expect(callbacks.reportSyncFailure).toHaveBeenCalledTimes(1);
    expect(callbacks.reportSyncSuccess).toHaveBeenCalledTimes(1);
  });

  it("rejects a foreign bake without writing into the current account", async () => {
    jest.spyOn(require("@/lib/auth"), "getStoredToken").mockResolvedValue("account-a");
    const bake: ActiveBake = {
      id: "foreign-bake", userId: "account-b", recipeId: "recipe", recipeName: "Loaf",
      startedAt: 1, completedAt: 2, status: "completed",
      phases: [{ key: "baking", name: "Baking", ingredients: [], instructions: [], startedAt: 1, completedAt: 2, readings: [] }],
    };
    await expect(archiveBakeWithDiagnostics(bake, {
      reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn(),
    })).rejects.toThrow(/owner/);
    expect(await AsyncStorage.getItem(getOwnerStorageKey(BAKE_HISTORY_KEY, "account-a"))).toBeNull();
    expect(await AsyncStorage.getItem(getOwnerStorageKey(BAKE_HISTORY_KEY, "account-b"))).toBeNull();
  });

  it("does not remove an active bake when local history archival fails", async () => {
    const bake: ActiveBake = {
      id: "failed-archive", recipeId: "recipe", recipeName: "Loaf", userId: "anonymous",
      startedAt: 1, completedAt: 2, status: "completed", yieldValue: "1",
      phases: [{ key: "baking", name: "Baking", ingredients: [], instructions: [], startedAt: 1, completedAt: 2, readings: [] }],
    };
    const activeKey = getOwnerStorageKey(BAKE_KEY, "anonymous");
    const historyKey = getOwnerStorageKey(BAKE_HISTORY_KEY, "anonymous");
    await AsyncStorage.setItem(activeKey, JSON.stringify([bake]));
    jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (key, value) => {
      if (key === historyKey) throw new Error("disk failed");
      mockStore[key] = value;
    });
    await expect(archiveBakeWithDiagnostics(bake, {
      reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn(),
    })).rejects.toThrow("disk failed");
    expect(JSON.parse((await AsyncStorage.getItem(activeKey))!)).toEqual([bake]);
    expect(await AsyncStorage.getItem(historyKey)).toBeNull();
  });
});
