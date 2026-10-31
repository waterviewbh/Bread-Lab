// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Stage 1 nu-4: loadAll Account-Switch Race & Invariants", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("Test A — Account switch during remote fetch does not contaminate workspace B", async () => {
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

    await loadPromise;

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    const dataB = await AsyncStorage.getItem(keyB);
    expect(dataB).toBeNull();
  });

  it("Test B — Account switch before/during remote fetch prevents stale persistence and publication", async () => {
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

    const result = await loadPromise;

    expect(result.recipes.length).toBe(0);

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it("Test C — Identity read failure fails closed", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockRejectedValue(new Error("Disk read error"));

    await expect(loadAll()).rejects.toThrow(/Owner resolution failed closed due to credential read error/);
  });

  it("Test D — Explicit signed-out/offline behavior permits anonymous workflow", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockResolvedValue(null);

    const newRecipe = {
      id: "anon-offline",
      userId: "anonymous",
      name: "Offline Loaf",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    };

    const updated = await appendRecipeLocal(newRecipe);
    expect(updated.length).toBe(1);
    expect(updated[0].userId).toBe("anonymous");
  });

  it("Test E — Foreign-owner input is rejected by write path", async () => {
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
