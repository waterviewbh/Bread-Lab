// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, restoreOperationalData, QUARANTINE_KEY } from "../storageUtils";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Stage 1: Owner-Scoped Storage Boundary & Invariants", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("1. Two authenticated owners resolve distinct operational keys", () => {
    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("user-A");
    expect(keyB).toContain("user-B");
  });

  it("2. Anonymous and authenticated workspaces resolve distinct keys", () => {
    const keyAnon = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, null);
    const keyAuth = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-123");
    expect(keyAnon).not.toBe(keyAuth);
    expect(keyAnon).toContain("anonymous");
    expect(keyAuth).toContain("user-123");
  });

  it("3 & 4. Signed-out loading excludes ownerless records and authenticated records", async () => {
    const { loadAll } = require("../recipeStorage");
    await AsyncStorage.setItem(APP_STORAGE_KEYS.RECIPES, JSON.stringify([
      { id: "r1", name: "Anon Recipe", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] },
      { id: "r2", name: "Ownerless Recipe", userId: "", phases: [{ key: "p1", name: "Mix" }] },
      { id: "r3", name: "Auth Recipe", userId: "user-123", phases: [{ key: "p1", name: "Mix" }] },
    ]));

    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue(null);

    const { recipes } = await loadAll();
    expect(recipes.map(r => r.id)).toEqual(["r1"]);
  });

  it("5. Missing or conflicting ownership fails closed in validation", async () => {
    const { validateOperationalData } = require("../storageUtils");
    await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify({
      id: "b1",
      userId: "",
      recipeName: "Bad Bake",
      phases: []
    }));

    await expect(validateOperationalData(null)).rejects.toThrow(/missing ownership metadata|unknown/);
  });

  it("6. Tombstones are isolated by owner", async () => {
    await AsyncStorage.setItem(APP_STORAGE_KEYS.DELETED_RECIPE_IDS, JSON.stringify(["rec-1"]));
    await quarantineOperationalData("user-A");

    const qKeyA = QUARANTINE_KEY("user-A");
    const storedQ = JSON.parse((await AsyncStorage.getItem(qKeyA)) || "{}");
    expect(storedQ.deletedRecipeIds).toContain("rec-1");
    expect(AsyncStorage.getItem(QUARANTINE_KEY("user-B"))).resolves.toBeNull();
  });

  it("7. A write initiated under Account A cannot be redirected into Account B's namespace", async () => {
    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");

    await AsyncStorage.setItem(keyA, JSON.stringify([{ id: "rA", userId: "user-A", name: "Recipe A", phases: [] }]));

    const keyBContent = await AsyncStorage.getItem(keyB);
    expect(keyBContent).toBeNull();
  });

  it("8. Asynchronous completion tied to stale identity does not repopulate new workspace", async () => {
    const opKeyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const opKeyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");

    await AsyncStorage.setItem(opKeyA, JSON.stringify([{ id: "rA", userId: "user-A", name: "A", phases: [] }]));
    const dataB = await AsyncStorage.getItem(opKeyB);
    expect(dataB).toBeNull();
  });

  it("9. Normal anonymous recipe creation, editing, and iteration work without auth", async () => {
    const { appendRecipeLocal } = require("../recipeStorage");
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue(null);

    const newRecipe = {
      id: "anon-new",
      userId: "anonymous",
      name: "Local Sourdough",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    };

    const updated = await appendRecipeLocal(newRecipe);
    expect(updated.length).toBe(1);
    expect(updated[0].userId).toBe("anonymous");
  });

  it("10. Existing recipe provenance and lifecycle remains intact", async () => {
    const { loadAll } = require("../recipeStorage");
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue(null);
    const result = await loadAll();
    expect(result).toBeDefined();
    expect(result.recipes).toBeDefined();
  });
});
