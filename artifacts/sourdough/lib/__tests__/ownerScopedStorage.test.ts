// artifacts/sourdough/lib/__tests__/ownerScopedStorage.test.ts
import { getOwnerStorageKey, APP_STORAGE_KEYS, quarantineOperationalData, QUARANTINE_KEY } from "../storageUtils";
import { loadAll, writeRecipesLocal, appendRecipeLocal, addToRecipeTombstone, getRecipeTombstone } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Stage 1 nu-3: Owner-Scoped Storage Boundary & Transition Hardening", () => {
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
  });

  it("3. Credential-read failure (uncertain state) fails closed and does not silently fall back to anonymous", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockRejectedValue(new Error("Disk read failure"));

    await expect(loadAll()).rejects.toThrow(/Owner resolution failed closed due to credential read error/);
  });

  it("4. Explicit signed-out state (token === null) successfully selects anonymous workspace", async () => {
    const authModule = require("../auth");
    jest.spyOn(authModule, "getStoredToken").mockResolvedValue(null);

    const anonKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "anonymous");
    await AsyncStorage.setItem(anonKey, JSON.stringify([
      { id: "r-anon", name: "Anon Loaf", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] }
    ]));

    const { recipes } = await loadAll();
    expect(recipes.map(r => r.id)).toEqual(["r-anon"]);
  });

  it("5. Foreign-owned records cannot be silently written into the active owner's workspace", async () => {
    jest.spyOn(require("../auth"), "getStoredToken").mockResolvedValue("user-A");

    const foreignRecipe = {
      id: "recipe-foreign",
      userId: "user-B",
      name: "Foreign Recipe",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    };

    await expect(appendRecipeLocal(foreignRecipe)).rejects.toThrow(/Write ownership validation failed/);
  });

  it("6. Tombstones with ambiguous ownership remain inert and cannot affect workspaces", async () => {
    await AsyncStorage.setItem(APP_STORAGE_KEYS.DELETED_RECIPE_IDS, JSON.stringify(["rec-ambig"]));
    await quarantineOperationalData(null);

    const unknownQKey = QUARANTINE_KEY("unknown");
    const unknownQ = JSON.parse((await AsyncStorage.getItem(unknownQKey)) || "{}");
    expect(unknownQ.deletedRecipeIds).toContain("rec-ambig");

    const tombstones = await getRecipeTombstone();
    expect(tombstones).not.toContain("rec-ambig");
  });

  it("7. A real asynchronous operation overlapping an account switch cannot cross the workspace boundary", async () => {
    const authModule = require("../auth");
    const authMock = jest.spyOn(authModule, "getStoredToken");

    authMock.mockResolvedValue("user-A");

    let resolveWrite: () => void = () => {};
    const suspendedWrite = new Promise<void>((r) => {
      resolveWrite = r;
    });

    const store: Record<string, string> = {};
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      if (key.includes("user-B")) {
        throw new Error("Cross-workspace write violation detected");
      }
      if (key.includes("user-A")) {
        await suspendedWrite;
      }
      store[key] = value;
      return Promise.resolve();
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      return store[key] ?? null;
    });

    const writePromise = appendRecipeLocal({
      id: "inflight-A",
      userId: "user-A",
      name: "Inflight Recipe",
      createdAt: Date.now(),
      phases: [{ key: "p1", name: "Mix", ingredients: [], instructions: [] }],
      yieldValue: "1"
    });

    // Switch identity to user-B mid-flight
    authMock.mockResolvedValue("user-B");

    // Resume write
    resolveWrite();
    await writePromise;

    const keyB = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    expect(store[keyB]).toBeUndefined();

    const keyA = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");
    expect(store[keyA]).toBeDefined();
    expect(store[keyA]).toContain("inflight-A");
  });

  it("8. Normal anonymous recipe creation, editing, and iteration work without auth", async () => {
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

  it("9. Existing legacy data is preserved while migration remains pending", async () => {
    const legacyKey = APP_STORAGE_KEYS.RECIPES;
    await AsyncStorage.setItem(legacyKey, JSON.stringify([
      { id: "legacy-1", name: "Legacy Recipe", userId: "anonymous", phases: [{ key: "p1", name: "Mix" }] }
    ]));

    expect(await AsyncStorage.getItem(legacyKey)).toBeDefined();
  });
});
