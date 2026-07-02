// lib/recipeStorage.ts
// ─── AsyncStorage + API persistence helpers ───────────────────────────────────
// No React, no hooks, no JSX. All functions are async-pure: they read/write
// storage and call the API, but never touch component state directly.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import {
  type SavedRecipe,
  type ActiveBake,
  RECIPES_KEY,
  BAKE_KEY,
  BAKE_HISTORY_KEY,
  DELETED_RECIPE_IDS_KEY,
} from "@/lib/recipeTypes";

// ─── Tombstone helpers ────────────────────────────────────────────────────────
// A tombstone prevents a locally-deleted recipe from being re-hydrated on the
// next API sync before the server deletion has propagated.
export async function addToRecipeTombstone(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  const set: string[] = raw ? JSON.parse(raw) : [];
  if (!set.includes(id)) {
    set.push(id);
    await AsyncStorage.setItem(DELETED_RECIPE_IDS_KEY, JSON.stringify(set));
  }
}

export async function removeFromRecipeTombstone(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  if (!raw) return;
  await AsyncStorage.setItem(
    DELETED_RECIPE_IDS_KEY,
    JSON.stringify((JSON.parse(raw) as string[]).filter((x) => x !== id))
  );
}

export async function getRecipeTombstone(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  return raw ? JSON.parse(raw) : [];
}

// ─── loadAll ──────────────────────────────────────────────────────────────────
// Initial hydration: reads local storage first, then merges server data.
// Returns the resolved recipes and bake so the component can call its own
// setRecipes / setBake — this module never touches React state.
export async function loadAll(): Promise<{
  recipes: SavedRecipe[];
  bake: ActiveBake | null;
}> {
  let recipes: SavedRecipe[] = [];
  let bake: ActiveBake | null = null;
  let localBakeFound = false;
  // ── Local read first (fast, offline-safe) ──────────────────────────────────
  try {
    const [recipeStr, bakeStr] = await Promise.all([
      AsyncStorage.getItem(RECIPES_KEY),
      AsyncStorage.getItem(BAKE_KEY),
    ]);
    if (recipeStr) recipes = JSON.parse(recipeStr);
    if (bakeStr) {
      bake = JSON.parse(bakeStr);
      localBakeFound = true;
    }
  } catch {}  // ── API merge (may be skipped if offline) ──────────────────────────────────
  try {
    const deviceId = await getDeviceId();
    const token = await getStoredToken().catch(() => null);
    const [apiRecipes, activeBake, deletedRecipeIds] = await Promise.all([
      api.recipes.list(deviceId, token ?? undefined),
      localBakeFound ? Promise.resolve(null) : api.history.bakes.active(deviceId),
      getRecipeTombstone(),
    ]);    const mapped: SavedRecipe[] = apiRecipes
      .filter((r) => !deletedRecipeIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: new Date(r.createdAt).getTime(),
        phases: r.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients ?? "",
          instructions: p.instructions ?? "",
          // yieldValue lives on the recipe root, not per-phase — kept for
          // backward-compat with older stored shapes that had it here.
          yieldValue: (r.yield_value && r.yield_value > 0) ? r.yield_value.toString() : "",
        })),
      }));    if (token || apiRecipes.length > 0) {
      recipes = mapped;
      await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(mapped));
    }    if (!localBakeFound && activeBake) {
      bake = {
        id: activeBake.id,
        recipeId: activeBake.recipeId ?? "",
        recipeName: activeBake.recipeName,
        startedAt: activeBake.startedAt,
        yieldValue: (activeBake.yield_value && activeBake.yield_value > 0)
          ? activeBake.yield_value.toString()
          : "",
        phases: activeBake.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients ?? "",
          instructions: p.instructions ?? "",
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
          readings: p.readings ?? [],
          startVolume: p.startVolume,
        })),
      };
      await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(bake));
    }
  } catch {}  return { recipes, bake };
}

// ─── writeRecipesLocal ────────────────────────────────────────────────────────
// Writes a recipe list to local storage only. The component handles setState
// and API sync separately (via upsertRecipeRemote below).
export async function writeRecipesLocal(recipes: SavedRecipe[]): Promise<void> {
  await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
}

// ─── writeBakeLocal ───────────────────────────────────────────────────────────
// Writes the active bake to local storage only.
export async function writeBakeLocal(bake: ActiveBake): Promise<void> {
  await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(bake));
}

// ─── upsertBakeRemote ─────────────────────────────────────────────────────────
// Fire-and-forget API upsert for an in-progress bake. Intentionally does not
// throw — the component's .catch(() => {}) pattern is preserved.
export function upsertBakeRemote(bake: ActiveBake): Promise<void> {
  return Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
    .then(([deviceId, userId]) =>
      api.history.bakes.upsert({
        id: bake.id,
        deviceId,
        userId: userId ?? undefined,
        recipeId: bake.recipeId,
        recipeName: bake.recipeName,
        yield_value: bake.yieldValue ? parseInt(bake.yieldValue, 10) : 0,
        savedAt: Date.now(),
        startedAt: bake.startedAt,
        phases: bake.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
          startedAt: p.startedAt,
          completedAt: p.completedAt,
          readings: p.readings,
          startVolume: p.startVolume,
          foldCount: p.foldCount,
        })),
        inProgress: true,
      })
    )
    .then(() => undefined);
}

// ─── upsertRecipeRemote ───────────────────────────────────────────────────────
export function upsertRecipeRemote(recipe: SavedRecipe): Promise<void> {
  return Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
    .then(([deviceId, userId]) =>
      api.recipes.upsert({
        id: recipe.id,
        deviceId,
        userId: userId ?? undefined,
        name: recipe.name,
        phases: recipe.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
        })),
      })
    )
    .then(() => undefined);
}

// ─── saveBakeToHistory ────────────────────────────────────────────────────────
// Appends a completed bake to local history and upserts it to the API.
// The sync callbacks (reportSyncStart etc.) are passed in explicitly so this
// module never imports a hook or context.
export async function saveBakeToHistory(
  bake: ActiveBake,
  callbacks: {
    reportSyncStart: () => void;
    reportSyncSuccess: () => void;
    reportSyncFailure: () => void;
  }
): Promise<void> {
  const savedAt = Date.now();
  // Store full phase data so Calendar detail modal can display readings
  // without a separate API round-trip.
  const phases = bake.phases.map((p) => ({
    key: p.key,
    name: p.name,
    ingredients: p.ingredients,
    instructions: p.instructions,
    yield_value: bake.yieldValue ? parseInt(bake.yieldValue, 10) : 0,
    startedAt: p.startedAt,
    completedAt: p.completedAt,
    readings: p.readings,
    startVolume: p.startVolume,
    foldCount: p.foldCount,
  }));
  // ── Local history append ───────────────────────────────────────────────────
  try {
    const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
    const existing = stored ? JSON.parse(stored) : [];
    existing.unshift({
      id: bake.id,
      recipeId: bake.recipeId,
      recipeName: bake.recipeName,
      savedAt,
      startedAt: bake.startedAt,
      notes: bake.notes,
      phases,
    });
    await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(existing.slice(0, 200)));
  } catch {}
  // ── Remote upsert (completed, inProgress: false) ───────────────────────────
  callbacks.reportSyncStart();
  Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
    .then(([deviceId, userId]) =>
      api.history.bakes.upsert({
        id: bake.id,
        deviceId,
        userId: userId ?? undefined,
        recipeId: bake.recipeId,
        recipeName: bake.recipeName,
        yield_value: bake.yieldValue ? parseInt(bake.yieldValue, 10) : 0,
        savedAt,
        startedAt: bake.startedAt,
        phases,
        inProgress: false,
      })
    )
    .then(() => callbacks.reportSyncSuccess())
    .catch(() => callbacks.reportSyncFailure());
}