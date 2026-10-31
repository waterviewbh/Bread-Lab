// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Issue #24: loadAll Identity Safety & Invariants (Tests A-E)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("Test A — Identity changes during remote fetch fails closed and does not contaminate workspace B", async () => {
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

    authMock.mockResolvedValue("user-B");

    resolveRemote([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await expect(loadPromise).rejects.toThrow(/Workspace identity changed|aborting stale/);

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it("Test B — Identity changes after validation but before persistence prevents stale write", async () => {
    const authModule = require("../auth");
    const authMock = jest.spyOn(authModule, "getStoredToken");

    authMock.mockResolvedValue("user-A");

    const apiModule = require("../api");
    jest.spyOn(apiModule.api.recipes, "list").mockImplementation(async () => {
      // Switch identity to user-B right after remote fetch before persistence check
      authMock.mockResolvedValue("user-B");
      return [
        { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
      ];
    });

    await expect(loadAll()).rejects.toThrow(/Workspace identity changed|aborting stale/);
  });

  it("Test C — Later identity check / credential read failure fails closed", async () => {
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

    authMock.mockRejectedValue(new Error("Disk read error"));

    resolveRemote([
      { id: "rec-A", userId: "user-A", name: "Recipe A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }] }
    ]);

    await expect(loadPromise).rejects.toThrow(/Owner resolution failed closed|Disk read error/);
  });

  it("Test D — Explicit signed-out workflow permits anonymous local records while missing owner is excluded", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockResolvedValue(null);

    const anonKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "anonymous");
    await AsyncStorage.setItem(anonKey, JSON.stringify([
      { id: "r-anon", name: "Explicit Anon", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] },
      { id: "r-ownerless", name: "Ownerless", userId: "", phases: [{ key: "p1", name: "Mix" }] }
    ]));

    const { recipes } = await loadAll();
    expect(recipes.map(r => r.id)).toEqual(["r-anon"]);
  });

  it("Test E — Foreign-owner writes are rejected", async () => {
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
