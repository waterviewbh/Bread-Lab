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
  type BakeOutcome,
  RECIPES_KEY,
  BAKE_KEY,
  BAKE_HISTORY_KEY,
  DELETED_RECIPE_IDS_KEY,
} from "@/lib/recipeTypes";
import { textToCheckableLines } from "@/lib/recipeUtils" // this was my first manual import, not done by the agent

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
    ]);
    const mapped: SavedRecipe[] = apiRecipes
      .filter((r) => !deletedRecipeIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        overview: r.overview ?? undefined,
        createdAt: new Date(r.createdAt).getTime(),
        updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.createdAt).getTime(),
        // yieldValue lives on the recipe root, not per-phase
        yieldValue: (r.yield_value && r.yield_value > 0) ? r.yield_value.toString() : "",
        phases: r.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || "", 'ing'),
          instructions: Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || "", 'ins'),
        })),
        parentRecipeId: r.parent_recipe_id,
        versionLabel: r.version_label,
      }));
    if (token || apiRecipes.length > 0) {
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
          ingredients: Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || "", 'ing'),
          instructions: Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || "", 'ins'),
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
          ingredients: p.ingredients ?? [],
          instructions: p.instructions ?? [],
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
        overview: recipe.overview,
        yield_value: recipe.yieldValue ? parseInt(recipe.yieldValue, 10) : 0,
        phases: recipe.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
        })),
        parentRecipeId: recipe.parentRecipeId,
        versionLabel: recipe.versionLabel,
      })
    )
    .then(() => undefined);
}

// ─── archiveBakeWithDiagnostics ─────────────────────────────────────────────
export async function archiveBakeWithDiagnostics(
  bake: ActiveBake,
  callbacks: {
    reportSyncStart: () => void;
    reportSyncSuccess: () => void;
    reportSyncFailure: () => void;
  }
): Promise<void> {
  const savedAt = Date.now();

  // ── Local history append ───────────────────────────────────────────────────
  try {
    const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
    const existing = stored ? JSON.parse(stored) : [];

    const historyItem = {
      ...bake,
      savedAt,
      status: bake.status === 'post_mortem' ? 'post_mortem' : 'completed',
    };

    existing.unshift(historyItem);
    await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(existing.slice(0, 500)));
  } catch (e) {
    console.error("[recipeStorage] Archive failed local", e);
  }

  // ── Remote upsert ──────────────────────────────────────────────────────────
  callbacks.reportSyncStart();
  const deviceId = await getDeviceId();
  const token = await getStoredToken().catch(() => null);

  api.history.bakes.upsert({
    id: bake.id,
    deviceId,
    userId: token ?? undefined,
    recipeId: bake.recipeId,
    recipeName: bake.recipeName,
    yield_value: bake.yieldValue ? parseInt(bake.yieldValue, 10) : 0,
    savedAt,
    startedAt: bake.startedAt,
    completedAt: bake.completedAt,
    status: bake.status,
    outcome: bake.outcome,
    phases: bake.phases,
    inProgress: false,
  })
  .then(() => callbacks.reportSyncSuccess())
  .catch(() => callbacks.reportSyncFailure());
}

// ─── archiveIntermediateIterations ──────────────────────────────────────────
// Enforces the "Stack of 3" rule: keep Master + 2 most recent iterations.
// Archives (marks isArchived: true) instead of deleting intermediate versions.
export async function archiveIntermediateIterations(masterId: string): Promise<void> {
  try {
    const recipeStr = await AsyncStorage.getItem(RECIPES_KEY);
    if (!recipeStr) return;

    let allRecipes: SavedRecipe[] = JSON.parse(recipeStr);

    // 1. Find the master
    const master = allRecipes.find(r => r.id === masterId);
    if (!master) return;

    // 2. Find all iterations belonging to this master lineage
    const iterations = allRecipes.filter(r => r.parentRecipeId === masterId)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    if (iterations.length <= 2) return; // Nothing to archive

    // 3. Keep the 2 most recent, archive the rest
    const toKeepIds = new Set([master.id, iterations[0].id, iterations[1].id]);

    const updatedRecipes = allRecipes.map(r => {
      if (r.parentRecipeId === masterId && !toKeepIds.has(r.id)) {
        return { ...r, isArchived: true };
      }
      return r;
    });

    // 4. Update local storage
    await writeRecipesLocal(updatedRecipes);

    // 5. Update remote (isArchived property will be synced on next upsert)
    const deviceId = await getDeviceId();
    const token = await getStoredToken().catch(() => null);

    const toArchive = iterations.slice(2);
    for (const r of toArchive) {
        api.recipes.upsert({
            ...r,
            id: r.id,
            deviceId,
            userId: token ?? undefined,
            name: r.name,
            is_archived: true // Assuming API supports this now
        } as any).catch(() => {});
    }
  } catch (e) {
    console.error("[recipeStorage] Archive failed", e);
  }
}

/**
 * Updates the outcome of a bake already in history.
 * Used for "Log & Finish" flow where no iteration is created.
 */
export async function updateBakeOutcomeInHistory(
    bakeId: string,
    outcome: BakeOutcome
): Promise<void> {
    try {
        const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
        if (!stored) return;

        let history: ActiveBake[] = JSON.parse(stored);
        const index = history.findIndex(h => h.id === bakeId);

        if (index !== -1) {
            const updatedBake = {
                ...history[index],
                outcome: outcome
            };
            history[index] = updatedBake;
            await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(history));

            // FIRE-AND-FORGET REMOTE SYNC:
            // We do NOT await this, so that slow device metadata fetching or API
            // latency doesn't hang the critical local save path.
            (async () => {
                try {
                    const deviceId = await getDeviceId();
                    const token = await getStoredToken().catch(() => null);

                    await api.history.bakes.upsert({
                        id: bakeId,
                        deviceId,
                        userId: token ?? undefined,
                        outcome: outcome,
                        inProgress: false
                    } as any);
                } catch (remoteError) {
                    console.warn("[recipeStorage] Remote sync failed, but local save succeeded", remoteError);
                }
            })();
        }
    } catch (e) {
        console.error("[recipeStorage] updateBakeOutcomeInHistory failed", e);
        throw e;
    }
}
