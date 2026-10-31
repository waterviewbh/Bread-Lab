// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Issue #24: loadAll Lifecycle Safety & Invariants (Tests A-E)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
    delete (global as any).__pausePrePersist;
  });

  it("Test A — Switch during remote fetch fails closed and prevents workspace contamination", async () => {
    const authModule = require("../auth");
    const authMock = jest.spyOn(authModule, "getStoredToken");

    authMock.mockResolvedValue("user-A");

    let resolveRemote: (recipes: any[]) => void = () => {};
    const remotePromise = new Promise<any[]>((r) => {
      resolveRemote = r;
    });

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockReturnValue(remotePromise);

    const loadPromise = loadAll();

    // Switch active identity to user-B while remote fetch is pending
    authMock.mockResolvedValue("user-B");

    resolveRemote([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await expect(loadPromise).rejects.toThrow(/Workspace identity changed|aborting stale/);

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it("Test B — Switch after successful validation but before persistence prevents stale write", async () => {
    const authModule = require("../auth");
    const authMock = jest.spyOn(authModule, "getStoredToken");

    authMock.mockResolvedValue("user-A");

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockResolvedValue([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    // Use test seam to pause after successful validation but before persistence
    let resumePause: () => void = () => {};
    const pausePromise = new Promise<void>((r) => {
      resumePause = r;
    });

    (global as any).__pausePrePersist = async () => {
      // Switch identity to user-B during the deterministic pause
      authMock.mockResolvedValue("user-B");
      await pausePromise;
    };

    const loadPromise = loadAll();
    resumePause();

    await expect(loadPromise).rejects.toThrow(/Workspace identity changed/);

    // Verify nothing written to user-B namespace
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it("Test C — Later identity-validation failure fails closed", async () => {
    const authModule = require("../auth");
    const authMock = jest.spyOn(authModule, "getStoredToken");

    authMock.mockResolvedValue("user-A");

    let resolveRemote: (recipes: any[]) => void = () => {};
    const remotePromise = new Promise<any[]>((r) => {
      resolveRemote = r;
    });

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockReturnValue(remotePromise);

    const loadPromise = loadAll();

    // Cause credential read to reject during subsequent check
    authMock.mockRejectedValue(new Error("Disk read error"));

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
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue("user-A");

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
