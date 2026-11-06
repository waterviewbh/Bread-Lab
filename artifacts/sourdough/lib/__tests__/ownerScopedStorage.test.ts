import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
    jest.spyOn(apiModule.api.recipes, "list").mockReturnValue(remotePromise);

    const loadPromise = loadAll();

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
});
