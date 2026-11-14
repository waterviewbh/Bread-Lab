import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY, validateOperationalData } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone, upsertBakeRemote } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rowToApiBakeSession } from "../api";

describe("Issue #24: Deterministic Workspace Transition & Lifecycle Safety", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
    delete (global as any).__pausePrePersist;
  });

  it("Test A — Switch during remote fetch fails closed and prevents workspace contamination", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));

    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });

    let resolveRemote: (recipes: any[]) => void = () => {};
    const remotePromise = new Promise<any[]>((r) => {
      resolveRemote = r;
    });

    const apiModule = require("../api");
    let signalFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { signalFetch = resolve; });
    jest.spyOn(apiModule.api.recipes, "list").mockImplementation(() => {
      signalFetch();
      return remotePromise;
    });

    const loadPromise = loadAll();
    await fetchStarted;

    await authModule.saveAuth("user-B", { id: "user-B", firstName: "User B", starterName: "Starter B" });

    resolveRemote([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await expect(loadPromise).rejects.toThrow(/Workspace owner changed|Workspace generation changed/);

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it("Test B — Real workspace transition via saveAuth invalidates in-flight operation before persistence and preserves both workspaces", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));

    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });

    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");

    const sentinelA = JSON.stringify([
      { id: "sentinel-A", userId: "user-A", name: "Sentinel A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);
    const sentinelB = JSON.stringify([
      { id: "sentinel-B", userId: "user-B", name: "Sentinel B", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await AsyncStorage.setItem(keyA, sentinelA);
    await AsyncStorage.setItem(keyB, sentinelB);

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockResolvedValue([
      { id: "rec-A", userId: "user-A", name: "Stale Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    let signalReachedBoundary!: () => void;
    let resumeOperation!: () => void;

    const reachedBoundary = new Promise<void>((resolve) => {
      signalReachedBoundary = resolve;
    });

    const resume = new Promise<void>((resolve) => {
      resumeOperation = resolve;
    });

    (global as any).__pausePrePersist = async () => {
      signalReachedBoundary();
      await resume;
    };

    const loadPromise = loadAll();

    // Do not proceed until loadAll has actually reached the boundary
    await reachedBoundary;

    // Perform real production transition while loadAll is suspended
    await authModule.saveAuth("user-B", {
      id: "user-B",
      firstName: "User B",
      starterName: "Starter B",
    });

    // Resume stale operation only after transition completes
    resumeOperation();

    await expect(loadPromise).rejects.toThrow(/Workspace generation changed|Workspace owner changed/i);

    // Verify both workspaces' existing data survives unchanged
    expect(await AsyncStorage.getItem(keyA)).toBe(sentinelA);
    expect(await AsyncStorage.getItem(keyB)).toBe(sentinelB);
  });

  it("Test C — Later identity-validation failure fails closed", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));

    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });

    let resolveRemote: (recipes: any[]) => void = () => {};
    const remotePromise = new Promise<any[]>((r) => {
      resolveRemote = r;
    });

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockReturnValue(remotePromise);

    const loadPromise = loadAll();

    jest.spyOn(authModule, "getStoredToken").mockRejectedValue(new Error("Disk read error"));

    resolveRemote([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await expect(loadPromise).rejects.toThrow(/Owner resolution failed closed|Disk read error/);
  });

  it("Test D — Explicit anonymous workspace loads explicit anonymous records and excludes missing metadata", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockResolvedValue(null);

    const anonKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "anonymous");
    await AsyncStorage.setItem(anonKey, JSON.stringify([
      { id: "r-anon", name: "Explicit Anon", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] },
      { id: "r-missing", name: "Missing Owner", userId: "", phases: [{ key: "p1", name: "Mix" }] }
    ]));

    const { recipes } = await loadAll();
    expect(recipes.map(r => r.id)).toEqual(["r-anon"]);
  });

  it("Test E — Foreign-owner writes are rejected by guarded write path", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));
    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });

    const foreignRecipe = {
      id: "rec-foreign",
      userId: "user-B",
      name: "Foreign Recipe",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    };

    await expect(appendRecipeLocal(foreignRecipe)).rejects.toThrow(/Write ownership validation failed/);
  });

  it("BT-007 — remote bake mapping preserves the owner and timestamps used by restoration", () => {
    const row: any = {
      id: "started", device_id: "device-1", user_id: "user-A", recipe_id: "recipe-1",
      recipe_name: "Loaf", saved_at: 100, started_at: 200, phases: [], in_progress: true,
      created_at: "2026-11-14", yield_value: 1, completed_at: null, status: "active", outcome: null, notes: null,
    };
    expect(rowToApiBakeSession(row)).toEqual(expect.objectContaining({
      userId: "user-A", savedAt: 100, startedAt: 200,
    }));
  });

  it("BT-007 — opening a bake cannot upload an unstarted remote row", async () => {
    const authModule = require("../auth");
    const apiModule = require("../api");
    jest.spyOn(authModule, "getStoredToken").mockResolvedValue("user-A");
    const upsert = jest.spyOn(apiModule.api.history.bakes, "upsert").mockResolvedValue({} as any);
    const unstarted: any = {
      id: "unstarted", userId: "user-A", recipeId: "recipe-1", recipeName: "Loaf",
      startedAt: Date.now(), status: "active",
      phases: [{ key: "mix", name: "Mix", startedAt: null, completedAt: null, ingredients: [], instructions: [], readings: [] }],
    };

    await upsertBakeRemote(unstarted);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("BT-007 — loadAll does not resurrect an unstarted remote bake after reset", async () => {
    const authModule = require("../auth");
    const apiModule = require("../api");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));
    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });
    jest.spyOn(apiModule.api.recipes, "list").mockResolvedValue([]);
    jest.spyOn(apiModule.api.history.bakes, "active").mockResolvedValue({
      id: "unstarted", userId: "user-A", recipeId: "recipe-1", recipeName: "Loaf",
      startedAt: Date.now(), status: "active",
      phases: [{ key: "mix", name: "Mix", startedAt: null, completedAt: null, ingredients: [], instructions: [], readings: [] }],
    } as any);

    const { bakes } = await loadAll();
    expect(bakes).toEqual([]);
    expect(await AsyncStorage.getItem(getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, "user-A"))).toBeNull();
  });

  it("BT-007 — a phase-started remote bake restores only for its owner and retains ownership", async () => {
    const authModule = require("../auth");
    const apiModule = require("../api");
    jest.spyOn(authModule, "getStoredToken").mockImplementation(() => AsyncStorage.getItem("bread_lab_auth_token_v1"));
    await authModule.saveAuth("user-A", { id: "user-A", firstName: "User A", starterName: "Starter A" });
    jest.spyOn(apiModule.api.recipes, "list").mockResolvedValue([]);
    const active = jest.spyOn(apiModule.api.history.bakes, "active");
    const started: any = {
      id: "started", userId: "user-A", recipeId: "recipe-1", recipeName: "Loaf",
      startedAt: Date.now(), status: "active",
      phases: [{ key: "mix", name: "Mix", startedAt: Date.now(), completedAt: null, ingredients: [], instructions: [], readings: [] }],
    };
    active.mockResolvedValue(started);

    const { bakes } = await loadAll();
    expect(bakes).toHaveLength(1);
    expect(bakes[0].userId).toBe("user-A");
    const key = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, "user-A");
    expect(JSON.parse((await AsyncStorage.getItem(key)) || "[]")[0].userId).toBe("user-A");
    await expect(validateOperationalData("user-A")).resolves.toBeUndefined();

    await AsyncStorage.removeItem(key);
    active.mockResolvedValue({ ...started, userId: "user-B" });
    expect((await loadAll()).bakes).toEqual([]);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });
});
