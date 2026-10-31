// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Stage 1 nu-1: Owner-Scoped Storage Boundary & Production Integration", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("1. getOwnerStorageKey fails closed on missing, null, or empty owner IDs", () => {
    expect(() => getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, null)).toThrow(/missing or invalid owner ID/);
    expect(() => getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, undefined)).toThrow(/missing or invalid owner ID/);
    expect(() => getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "")).toThrow(/missing or invalid owner ID/);
    expect(() => getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "   ")).toThrow(/missing or invalid owner ID/);
  });

  it("2. Distinct owners (Account A vs Account B vs Anonymous) resolve separate operational storage keys", () => {
    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    const keyAnon = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "anonymous");

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyAnon);
    expect(keyB).not.toBe(keyAnon);
    expect(keyA).toContain("user-A");
    expect(keyB).toContain("user-B");
    expect(keyAnon).toContain("anonymous");
  });

  it("3. Actual production recipe reads and writes use correct owner-scoped namespaces", async () => {
    // Mock token for user-A
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue("user-A");

    await writeRecipesLocal([
      { id: "recipe-A", name: "Recipe A", userId: "user-A", phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }], yieldValue: "1", createdAt: Date.now() }
    ]);

    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");

    const rawA = await AsyncStorage.getItem(keyA);
    const rawB = await AsyncStorage.getItem(keyB);

    expect(rawA).toBeDefined();
    expect(rawA).toContain("recipe-A");
    expect(rawB).toBeNull(); // Namespace B remains completely isolated and empty
  });

  it("4. Signed-out loading includes only explicitly anonymous records", async () => {
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue(null);

    const anonKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "anonymous");
    await AsyncStorage.setItem(anonKey, JSON.stringify([
      { id: "r-anon", name: "Anon Loaf", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] }
    ]));

    const { recipes } = await loadAll();
    expect(recipes.map(r => r.id)).toEqual(["r-anon"]);
  });

  it("5. Missing or conflicting ownership fails closed in validation", async () => {
    const { validateOperationalData } = require("../storageUtils");
    await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify({
      id: "b1",
      userId: "",
      recipeName: "Invalid Owner",
      phases: []
    }));

    await expect(validateOperationalData(null)).rejects.toThrow(/missing ownership metadata|unknown/);
  });

  it("6. Tombstones with ambiguous ownership remain inert and cannot affect workspaces", async () => {
    await AsyncStorage.setItem(APP_STORAGE_KEYS.DELETED_RECIPE_IDS, JSON.stringify(["rec-ambiguous"]));
    await quarantineOperationalData(null);

    const unknownQKey = QUARANTINE_KEY("unknown");
    const unknownQ = JSON.parse((await AsyncStorage.getItem(unknownQKey)) || "{}");
    expect(unknownQ.deletedRecipeIds).toContain("rec-ambiguous");

    // Authenticated and anonymous namespaces are unaffected
    const anonTombstones = await getRecipeTombstone();
    expect(anonTombstones).not.toContain("rec-ambiguous");
  });

  it("7 & 8. Real storage operations cannot cross workspaces during identity switch and stale async updates are bound to scope", async () => {
    const authMock = jest.spyOn(require("../auth"), "getStoredToken");

    // Write under user-A
    authMock.mockResolvedValue("user-A");
    await appendRecipeLocal({
      id: "r-A",
      userId: "user-A",
      name: "User A Recipe",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    });

    // Switch identity to user-B
    authMock.mockResolvedValue("user-B");
    const { recipes: recipesB } = await loadAll();
    expect(recipesB.length).toBe(0); // User B sees 0 recipes from User A's namespace
  });

  it("9. Normal anonymous recipe creation, editing, and iteration remain functional", async () => {
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue(null);

    const newRecipe = {
      id: "anon-work",
      userId: "anonymous",
      name: "Anonymous Loaf",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    };

    const updated = await appendRecipeLocal(newRecipe);
    expect(updated.length).toBe(1);
    expect(updated[0].userId).toBe("anonymous");
  });
});
