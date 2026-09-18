// lib/recipeStorage.ts
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
import { textToCheckableLines, resolveRootMasterId } from "@/lib/recipeUtils";
import { safeParse, storageMutex } from "@/lib/storageUtils";

// ─── Tombstone helpers ────────────────────────────────────────────────────────
export async function addToRecipeTombstone(id: string): Promise<void> {
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
    const set = safeParse<string[]>(raw, [], Array.isArray);
    if (!set.includes(id)) {
      set.push(id);
      await AsyncStorage.setItem(DELETED_RECIPE_IDS_KEY, JSON.stringify(set));
    }
  });
}

export async function removeFromRecipeTombstone(id: string): Promise<void> {
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
    if (!raw) return;
    const set = safeParse<string[]>(raw, [], Array.isArray);
    await AsyncStorage.setItem(
      DELETED_RECIPE_IDS_KEY,
      JSON.stringify(set.filter((x) => x !== id))
    );
  });
}

export async function getRecipeTombstone(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  return safeParse<string[]>(raw, [], Array.isArray);
}

// ─── loadAll ──────────────────────────────────────────────────────────────────
export async function loadAll(): Promise<{
  recipes: SavedRecipe[];
  bakes: ActiveBake[];
  bake: ActiveBake | null;
}> {
  let recipes: SavedRecipe[] = [];
  let bakes: ActiveBake[] = [];
  let localBakesFound = false;

  try {
    const [recipeStr, bakeStr] = await Promise.all([
      AsyncStorage.getItem(RECIPES_KEY),
      AsyncStorage.getItem(BAKE_KEY),
    ]);

    recipes = safeParse<SavedRecipe[]>(recipeStr, [], Array.isArray);

    const parsedBakes = safeParse<any>(bakeStr, [], (v) => Array.isArray(v) || (v !== null && typeof v === 'object'));
    bakes = Array.isArray(parsedBakes) ? parsedBakes : (parsedBakes ? [parsedBakes] : []);
    localBakesFound = bakes.length > 0;
  } catch (e) {
    console.error("[recipeStorage] loadAll local failed", e);
  }

  try {
    const deviceId = await getDeviceId();
    const token = await getStoredToken().catch(() => null);
    const [apiRecipes, activeBake, deletedRecipeIds] = await Promise.all([
      api.recipes.list(deviceId, token ?? undefined),
      localBakesFound ? Promise.resolve(null) : api.history.bakes.active(deviceId),
      getRecipeTombstone(),
    ]);

    const mapped: SavedRecipe[] = (apiRecipes || [])
      .filter((r) => !deletedRecipeIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        overview: r.overview ?? undefined,
        createdAt: new Date(r.createdAt).getTime(),
        updatedAt: (r as any).updatedAt ? new Date((r as any).updatedAt).getTime() : new Date(r.createdAt).getTime(),
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

    if (token || (apiRecipes && apiRecipes.length > 0)) {
      recipes = mapped;
      await storageMutex.run(() => AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(mapped)));
    }

    if (!localBakesFound && activeBake) {
      const apiBake: ActiveBake = {
        id: activeBake.id,
        recipeId: activeBake.recipeId ?? "",
        recipeName: activeBake.recipeName,
        startedAt: activeBake.startedAt,
        status: 'active',
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
      bakes = [apiBake];
      await storageMutex.run(() => AsyncStorage.setItem(BAKE_KEY, JSON.stringify(bakes)));
    }
  } catch (e) {
    console.error("[recipeStorage] loadAll remote failed", e);
  }
  return { recipes, bakes, bake: bakes[0] || null };
}

export async function writeRecipesLocal(recipes: SavedRecipe[]): Promise<void> {
  return storageMutex.run(() => AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(recipes)));
}

export async function writeBakeLocal(bake: ActiveBake): Promise<void> {
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(BAKE_KEY).catch(() => null);
    let bakes = safeParse<ActiveBake[]>(raw, [], Array.isArray);

    const idx = bakes.findIndex((b) => b.id === bake.id);
    if (idx !== -1) {
      bakes[idx] = bake;
    } else {
      if (bakes.length < 2) bakes.push(bake);
      else bakes[0] = bake;
    }
    await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(bakes));
  });
}

export async function writeBakesLocal(bakes: ActiveBake[]): Promise<void> {
  return storageMutex.run(() => AsyncStorage.setItem(BAKE_KEY, JSON.stringify(bakes)));
}

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
        completedAt: bake.completedAt,
        status: bake.status,
        outcome: bake.outcome,
        notes: bake.notes,
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

export async function archiveBakeWithDiagnostics(
  bake: ActiveBake,
  callbacks: {
    reportSyncStart: () => void;
    reportSyncSuccess: () => void;
    reportSyncFailure: () => void;
  }
): Promise<void> {
  const savedAt = Date.now();

  await storageMutex.run(async () => {
    try {
      const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
      const existing = safeParse<ActiveBake[]>(stored, [], Array.isArray);

      const historyItem = {
        ...bake,
        savedAt,
        status: (bake.status === 'post_mortem' ? 'post_mortem' : 'completed') as any,
      };

      existing.unshift(historyItem);
      await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(existing.slice(0, 500)));
    } catch (e) {
      console.error("[recipeStorage] Archive failed local", e);
    }
  });

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
    notes: bake.notes,
    phases: bake.phases as any,
    inProgress: false,
  })
  .then(() => callbacks.reportSyncSuccess())
  .catch(() => callbacks.reportSyncFailure());
}

export async function archiveIntermediateIterations(masterId: string): Promise<void> {
  return storageMutex.run(async () => {
    try {
      const recipeStr = await AsyncStorage.getItem(RECIPES_KEY);
      const allRecipes = safeParse<SavedRecipe[]>(recipeStr, [], Array.isArray);

      const master = allRecipes.find(r => r.id === masterId);
      if (!master) return;

      const iterations = allRecipes.filter(r => r.id !== master.id && resolveRootMasterId(r, allRecipes) === master.id)
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

      if (iterations.length <= 2) return;

      const toKeepIds = new Set([master.id, iterations[0].id, iterations[1].id]);

      const updatedRecipes = allRecipes.map(r => {
        if (resolveRootMasterId(r, allRecipes) === master.id && !toKeepIds.has(r.id)) {
          return { ...r, isArchived: true };
        }
        return r;
      });

      await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(updatedRecipes));

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
              is_archived: true
          } as any).catch(() => {});
      }
    } catch (e) {
      console.error("[recipeStorage] Archive failed", e);
    }
  });
}

export async function updateBakeOutcomeInHistory(
    bakeId: string,
    outcome: BakeOutcome
): Promise<void> {
    return storageMutex.run(async () => {
        try {
            const storedHistory = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
            let history = safeParse<ActiveBake[]>(storedHistory, [], Array.isArray);
            const index = history.findIndex(h => h.id === bakeId);

            let updatedBake: ActiveBake | null = null;

            if (index !== -1) {
                updatedBake = {
                    ...history[index],
                    outcome: outcome
                };
                history[index] = updatedBake;
                await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(history));
            } else {
                const storedActive = await AsyncStorage.getItem(BAKE_KEY);
                if (storedActive) {
                    let activeBakes = safeParse<ActiveBake[]>(storedActive, [], Array.isArray);
                    const activeIndex = activeBakes.findIndex(b => b.id === bakeId);
                    if (activeIndex !== -1) {
                        updatedBake = {
                            ...activeBakes[activeIndex],
                            outcome: outcome,
                            status: 'completed',
                            completedAt: activeBakes[activeIndex].completedAt || Date.now()
                        };
                        activeBakes.splice(activeIndex, 1);
                        await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(activeBakes));

                        history.unshift(updatedBake);
                        await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(history.slice(0, 500)));
                    }
                }
            }

            if (updatedBake) {
                (async () => {
                    try {
                        const deviceId = await getDeviceId();
                        const token = await getStoredToken().catch(() => null);

                        await api.history.bakes.upsert({
                            ...updatedBake,
                            deviceId,
                            userId: token ?? undefined,
                            yield_value: updatedBake.yieldValue ? parseInt(updatedBake.yieldValue, 10) : 0,
                            savedAt: Date.now(),
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
    });
}
