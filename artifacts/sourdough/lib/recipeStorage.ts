// lib/recipeStorage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
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
  DELETED_BAKE_IDS_KEY,
  DELETED_FEED_IDS_KEY,
} from "@/lib/recipeTypes";
import { textToCheckableLines, resolveRootMasterId, parseIngredientsForMetrics, detectYeastType, sortRecipePhases } from "@/lib/recipeUtils";
import { safeParse, storageMutex, getOwnerStorageKey, getWorkspaceGeneration } from "@/lib/storageUtils";

async function resolveOwner(): Promise<string> {
  let token: string | null = null;
  try {
    token = await getStoredToken();
  } catch (e: any) {
    throw new Error(`Owner resolution failed closed due to credential read error: ${e?.message ?? String(e)}`);
  }
  if (token === null) {
    return "anonymous";
  }
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("Owner resolution failed closed: stored token is malformed or empty.");
  }
  return token.trim();
}

export interface WorkspaceOperationContext {
  owner: string;
  generation: number;
}

async function assertWorkspaceOperationCurrent(context: WorkspaceOperationContext): Promise<void> {
  const gen = getWorkspaceGeneration();
  const curOwner = await resolveOwner();
  console.log(`[Debug] assertWorkspaceOperationCurrent: context.gen=${context.generation}, globalGen=${gen}, context.owner=${context.owner}, curOwner=${curOwner}`);
  if (context.generation !== gen) {
    throw new Error("Workspace generation changed during loadAll(); aborting stale operation.");
  }
  if (curOwner !== context.owner) {
    throw new Error("Workspace owner changed during loadAll(); aborting stale operation.");
  }
}

// ─── Tombstone helpers (Fail-Closed) ──────────────────────────────────────────
export async function addToRecipeTombstone(id: string): Promise<void> {
  return storageMutex.run(async () => {
    const owner = await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_RECIPE_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    const set = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for recipe tombstones.");
    }
    if (!set.includes(id)) {
      set.push(id);
      await AsyncStorage.setItem(tombstoneKey, JSON.stringify(set));
    }
  });
}

export async function removeFromRecipeTombstone(id: string, context?: WorkspaceOperationContext): Promise<void> {
  return storageMutex.run(async () => {
    if (context) await assertWorkspaceOperationCurrent(context);
    const owner = context ? context.owner : await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_RECIPE_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    if (!raw) return;
    const set = JSON.parse(raw);
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for recipe tombstones.");
    }
    await AsyncStorage.setItem(
      tombstoneKey,
      JSON.stringify(set.filter((x: string) => x !== id))
    );
  });
}

export async function getRecipeTombstone(): Promise<string[]> {
  const owner = await resolveOwner();
  const tombstoneKey = getOwnerStorageKey(DELETED_RECIPE_IDS_KEY, owner);
  const raw = await AsyncStorage.getItem(tombstoneKey);
  if (raw === null || raw === undefined) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Tombstone corruption: recipe tombstone data is not an array.");
  }
  return parsed;
}

export async function addToBakeTombstone(id: string): Promise<void> {
  return storageMutex.run(async () => {
    const owner = await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_BAKE_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    const set = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for bake tombstones.");
    }
    if (!set.includes(id)) {
      set.push(id);
      await AsyncStorage.setItem(tombstoneKey, JSON.stringify(set));
    }
  });
}

export async function removeFromBakeTombstone(id: string, context?: WorkspaceOperationContext): Promise<void> {
  return storageMutex.run(async () => {
    if (context) await assertWorkspaceOperationCurrent(context);
    const owner = context ? context.owner : await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_BAKE_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    if (!raw) return;
    const set = JSON.parse(raw);
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for bake tombstones.");
    }
    await AsyncStorage.setItem(tombstoneKey, JSON.stringify(set.filter((x: string) => x !== id)));
  });
}

export async function getBakeTombstone(): Promise<string[]> {
  const owner = await resolveOwner();
  const tombstoneKey = getOwnerStorageKey(DELETED_BAKE_IDS_KEY, owner);
  const raw = await AsyncStorage.getItem(tombstoneKey);
  if (raw === null || raw === undefined) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Tombstone corruption: bake tombstone data is not an array.");
  }
  return parsed;
}

export async function addToFeedTombstone(id: string): Promise<void> {
  return storageMutex.run(async () => {
    const owner = await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_FEED_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    const set = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for feed tombstones.");
    }
    if (!set.includes(id)) {
      set.push(id);
      await AsyncStorage.setItem(tombstoneKey, JSON.stringify(set));
    }
  });
}

export async function removeFromFeedTombstone(id: string, context?: WorkspaceOperationContext): Promise<void> {
  return storageMutex.run(async () => {
    if (context) await assertWorkspaceOperationCurrent(context);
    const owner = context ? context.owner : await resolveOwner();
    const tombstoneKey = getOwnerStorageKey(DELETED_FEED_IDS_KEY, owner);
    const raw = await AsyncStorage.getItem(tombstoneKey);
    if (!raw) return;
    const set = JSON.parse(raw);
    if (!Array.isArray(set)) {
      throw new Error("Tombstone schema corruption: expected array for feed tombstones.");
    }
    await AsyncStorage.setItem(tombstoneKey, JSON.stringify(set.filter((x: string) => x !== id)));
  });
}

export async function getFeedTombstone(): Promise<string[]> {
  const owner = await resolveOwner();
  const tombstoneKey = getOwnerStorageKey(DELETED_FEED_IDS_KEY, owner);
  const raw = await AsyncStorage.getItem(tombstoneKey);
  if (raw === null || raw === undefined) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Tombstone corruption: feed tombstone data is not an array.");
  }
  return parsed;
}

export const UNRESOLVED_LEGACY_TOMBSTONES_KEY = "bread_lab_unresolved_legacy_tombstones_v1";

export interface LegacyDeletionIntent {
  id: string;
  recordType: "recipe" | "bake" | "feed";
  owner: "unknown";
  sourceKey: string;
  disposition: "unresolved";
}

async function reconcileLegacyFlatTombstones(): Promise<void> {
  const legacyKeys = [
    { key: "bread_lab_deleted_recipe_ids_v1", type: "recipe" as const },
    { key: "bread_lab_deleted_bake_ids_v1", type: "bake" as const },
    { key: "bread_lab_deleted_feed_ids_v1", type: "feed" as const },
  ];

  for (const { key, type } of legacyKeys) {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(key);
    } catch (err) {
      throw new Error(`Legacy tombstone read failure for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (raw === null || raw === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Legacy tombstone parse failure for ${key}: malformed JSON.`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Legacy tombstone validation failure for ${key}: expected array.`);
    }

    if (parsed.length === 0) {
      await AsyncStorage.removeItem(key);
      continue;
    }

    for (const item of parsed) {
      if (typeof item !== "string" || item.trim() === "") {
        throw new Error(`Legacy tombstone validation failure for ${key}: contains non-string or empty element.`);
      }
    }

    const ids = parsed as string[];
    const intents: LegacyDeletionIntent[] = ids.map((id) => ({
      id,
      recordType: type,
      owner: "unknown",
      sourceKey: key,
      disposition: "unresolved",
    }));

    let existingRaw: string | null = null;
    try {
      existingRaw = await AsyncStorage.getItem(UNRESOLVED_LEGACY_TOMBSTONES_KEY);
    } catch (err) {
      throw new Error(`Failed to read destination unresolved legacy store: ${err instanceof Error ? err.message : String(err)}`);
    }

    const existingIntents = existingRaw ? JSON.parse(existingRaw) : [];
    if (!Array.isArray(existingIntents)) {
      throw new Error("Destination unresolved legacy store schema corruption: expected array.");
    }

    const seenIds = new Set(existingIntents.map((item: any) => `${item.recordType}:${item.id}`));
    const newIntents = intents.filter((intent) => !seenIds.has(`${intent.recordType}:${intent.id}`));
    const mergedIntents = [...existingIntents, ...newIntents];

    try {
      await AsyncStorage.setItem(UNRESOLVED_LEGACY_TOMBSTONES_KEY, JSON.stringify(mergedIntents));
    } catch (err) {
      throw new Error(`Failed to persist destination unresolved legacy store: ${err instanceof Error ? err.message : String(err)}`);
    }

    let verifyRaw: string | null = null;
    try {
      verifyRaw = await AsyncStorage.getItem(UNRESOLVED_LEGACY_TOMBSTONES_KEY);
    } catch (err) {
      throw new Error(`Verification read failure for unresolved legacy store: ${err instanceof Error ? err.message : String(err)}`);
    }

    const verifiedParsed = verifyRaw ? JSON.parse(verifyRaw) : null;
    if (!Array.isArray(verifiedParsed)) {
      throw new Error("Legacy tombstone migration verification failed: destination is not an array.");
    }

    for (const expected of intents) {
      const found = verifiedParsed.find(
        (item: any) =>
          item &&
          typeof item === "object" &&
          item.recordType === expected.recordType &&
          item.id === expected.id &&
          item.owner === "unknown" &&
          item.disposition === "unresolved"
      );
      if (!found) {
        throw new Error(`Legacy tombstone migration verification failed: missing expected intent for ${expected.recordType}:${expected.id}`);
      }
    }

    await AsyncStorage.removeItem(key);
  }
}

async function verifyRemoteAbsence(type: 'recipe' | 'bake' | 'feed', id: string, deviceId: string, token?: string): Promise<boolean> {
  try {
    if (type === 'recipe') {
      return await api.recipes.verifyAbsent(id, deviceId, token);
    } else if (type === 'bake') {
      return await api.history.bakes.verifyAbsent(id, deviceId, token);
    } else if (type === 'feed') {
      return await api.history.feed.verifyAbsent(id, deviceId, token);
    }
  } catch {
    return false;
  }
  return false;
}

export async function processPendingDeletions(): Promise<void> {
  try {
    await reconcileLegacyFlatTombstones();

    const owner = await resolveOwner();
    const generation = getWorkspaceGeneration();
    const context: WorkspaceOperationContext = { owner, generation };
    const deviceId = await getDeviceId();
    const token = owner === "anonymous" ? null : owner;

    await assertWorkspaceOperationCurrent(context);

    const recipeTombstones = await getRecipeTombstone();
    for (const id of recipeTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        const deleted = await api.recipes.delete(id, deviceId, token ?? undefined);
        if (deleted) {
          await removeFromRecipeTombstone(id, context);
        } else {
          const absent = await verifyRemoteAbsence('recipe', id, deviceId, token ?? undefined);
          if (absent) {
            await removeFromRecipeTombstone(id, context);
          }
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Recipe deletion retry failed for id ${id}:`, e);
      }
    }

    const bakeTombstones = await getBakeTombstone();
    for (const id of bakeTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        const deleted = await api.history.bakes.delete(id, deviceId, token ?? undefined);
        if (deleted) {
          await removeFromBakeTombstone(id, context);
        } else {
          const absent = await verifyRemoteAbsence('bake', id, deviceId, token ?? undefined);
          if (absent) {
            await removeFromBakeTombstone(id, context);
          }
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Bake deletion retry failed for id ${id}:`, e);
      }
    }

    const feedTombstones = await getFeedTombstone();
    for (const id of feedTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        const deleted = await api.history.feed.delete(id, deviceId, token ?? undefined);
        if (deleted) {
          await removeFromFeedTombstone(id, context);
        } else {
          const absent = await verifyRemoteAbsence('feed', id, deviceId, token ?? undefined);
          if (absent) {
            await removeFromFeedTombstone(id, context);
          }
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Feed deletion retry failed for id ${id}:`, e);
      }
    }
  } catch (e) {
    console.error("[recipeStorage] processPendingDeletions failed", e);
  }
}

if (typeof AppState !== "undefined" && AppState.addEventListener) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      processPendingDeletions().catch(() => {});
    }
  });
}

// ─── loadAll ──────────────────────────────────────────────────────────────────
export async function loadAll(): Promise<{
  recipes: SavedRecipe[];
  bakes: ActiveBake[];
  bake: ActiveBake | null;
}> {
  try {
    await processPendingDeletions();
  } catch (e) {
    console.warn("[recipeStorage] loadAll background deletion sync failed (continuing offline):", e);
  }

  let recipes: SavedRecipe[] = [];
  let bakes: ActiveBake[] = [];
  let localBakesFound = false;

  const owner = await resolveOwner();
  const generation = getWorkspaceGeneration();
  const context: WorkspaceOperationContext = { owner, generation };

  const token = owner === "anonymous" ? null : owner;
  const recipesKey = getOwnerStorageKey(RECIPES_KEY, owner);
  const bakeKey = getOwnerStorageKey(BAKE_KEY, owner);
  const bakeHistoryKey = getOwnerStorageKey(BAKE_HISTORY_KEY, owner);

  await assertWorkspaceOperationCurrent(context);

  try {
    const [recipeStr, bakeStr] = await Promise.all([
      AsyncStorage.getItem(recipesKey),
      AsyncStorage.getItem(bakeKey),
    ]);

    await assertWorkspaceOperationCurrent(context);

    recipes = safeParse<SavedRecipe[]>(recipeStr, [], Array.isArray).filter(
      r => r && ((typeof r.name === "string" && r.name.trim() !== "") || (Array.isArray(r.phases) && r.phases.length > 0))
    ).filter(r => {
      const ownerVal = r.userId ?? (r as any).user_id;
      if (!token) return ownerVal === "anonymous";
      return ownerVal === token;
    });

    const parsedBakes = safeParse<any>(bakeStr, [], (v) => Array.isArray(v) || (v !== null && typeof v === 'object'));
    const rawBakes: ActiveBake[] = Array.isArray(parsedBakes) ? parsedBakes : (parsedBakes ? [parsedBakes] : []);

    const filteredBakes = rawBakes.filter(b => {
      if (!b) return false;
      const ownerVal = (b as any).userId ?? (b as any).user_id;
      if (!token) return ownerVal === "anonymous";
      return ownerVal === token;
    });

    // Unified migration and initialization
    bakes = filteredBakes.map(b => {
      // Ensure b is an object
      if (!b || typeof b !== 'object') return b;

      // 1. Ensure phases are objects and have checkable lines and readings
      b.phases = sortRecipePhases((b.phases || []).map(p => {
        const ingredients = Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || "", 'ing');
        const instructions = Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || "", 'ins');
        return {
          ...p,
          ingredients,
          instructions,
          readings: Array.isArray(p.readings) ? p.readings : [],
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
        };
      }));

      // 2. Initialize estimator if missing
      if (!b.estimatorState) {
        const { flour, water, starter, yeast, salt } = parseIngredientsForMetrics(b.phases);
        const yeastType = detectYeastType(b.phases);
        const bulkPhase = b.phases.find(p => p.key === 'bulk_fermenting');

        b.estimatorState = {
          flourG: flour.toString(),
          waterG: water.toString(),
          starterG: starter.toString(),
          yeastG: yeast.toString(),
          saltG: salt.toString(),
          yeastType,
          targetTemp: "76",
          startVolume_ml: bulkPhase?.startVolume || "",
        };
      }

      // 3. Ensure other top-level fields
      b.notes = b.notes ?? "";
      b.yieldValue = b.yieldValue ?? "1";
      b.status = b.status ?? 'active';

      return b;
    });

    localBakesFound = bakes.length > 0;
  } catch (e: any) {
    if (e?.message?.includes("Workspace") || e?.message?.includes("Owner resolution")) throw e;
    console.error("[recipeStorage] loadAll local failed", e);
  }

  await assertWorkspaceOperationCurrent(context);

  try {
    const deviceId = await getDeviceId();
    const [apiRecipes, activeBake, deletedRecipeIds] = await Promise.all([
      token ? api.recipes.list(deviceId, token) : Promise.resolve([]),
      (localBakesFound || !token) ? Promise.resolve(null) : api.history.bakes.active(deviceId, token),
      getRecipeTombstone(),
    ]);

    await assertWorkspaceOperationCurrent(context);

    const mapped: SavedRecipe[] = (apiRecipes || [])
      .filter((r) => !deletedRecipeIds.includes(r.id))
      .map((r) => {
        const existingLocal = recipes.find(loc => loc.id === r.id);
        return {
          id: r.id,
          userId: r.userId ?? (r as any).user_id ?? existingLocal?.userId ?? token ?? undefined,
          name: r.name,
          overview: r.overview ?? existingLocal?.overview ?? undefined,
          createdAt: new Date(r.createdAt).getTime(),
          updatedAt: (r as any).updatedAt ? new Date((r as any).updatedAt).getTime() : new Date(r.createdAt).getTime(),
          yieldValue: (r.yield_value && r.yield_value > 0) ? r.yield_value.toString() : (existingLocal?.yieldValue || ""),
          phases: sortRecipePhases(r.phases.map((p) => ({
            key: p.key,
            name: p.name,
            ingredients: Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || "", 'ing'),
            instructions: Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || "", 'ins'),
          }))),
          parentRecipeId: r.parent_recipe_id ?? existingLocal?.parentRecipeId,
          versionLabel: r.version_label ?? existingLocal?.versionLabel,
          isArchived: r.isArchived ?? existingLocal?.isArchived,
          diagnosticHypothesis: r.diagnosticHypothesis ?? existingLocal?.diagnosticHypothesis,
          isUneditedIteration: r.isUneditedIteration ?? existingLocal?.isUneditedIteration,
          clonedFromBakeName: r.clonedFromBakeName ?? existingLocal?.clonedFromBakeName,
        };
      });

    await assertWorkspaceOperationCurrent(context);

    if (typeof (global as any).__pausePrePersist === "function") {
      await (global as any).__pausePrePersist();
    }

    await assertWorkspaceOperationCurrent(context);

    if (token || (apiRecipes && apiRecipes.length > 0)) {
      recipes = mapped;
      await storageMutex.run(async () => {
        await assertWorkspaceOperationCurrent(context);
        await AsyncStorage.setItem(recipesKey, JSON.stringify(mapped));
      });
    }

    await assertWorkspaceOperationCurrent(context);

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
        phases: sortRecipePhases(activeBake.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || "", 'ing'),
          instructions: Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || "", 'ins'),
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
          readings: p.readings ?? [],
          startVolume: p.startVolume,
        }))),
        estimatorState: activeBake.estimatorState,
      };

      if (!apiBake.estimatorState) {
        const { flour, water, starter, yeast, salt } = parseIngredientsForMetrics(apiBake.phases);
        const yeastType = detectYeastType(apiBake.phases);
        const bulkPhase = apiBake.phases.find(p => p.key === 'bulk_fermenting');

        apiBake.estimatorState = {
          flourG: flour.toString(),
          waterG: water.toString(),
          starterG: starter.toString(),
          yeastG: yeast.toString(),
          saltG: salt.toString(),
          yeastType,
          targetTemp: "76",
          startVolume_ml: bulkPhase?.startVolume || "",
        };
      }

      bakes = [apiBake];
      await storageMutex.run(async () => {
        await assertWorkspaceOperationCurrent(context);
        await AsyncStorage.setItem(bakeKey, JSON.stringify(bakes));
      });
    }
  } catch (e: any) {
    if (e?.message?.includes("Workspace") || e?.message?.includes("Owner resolution")) throw e;
    console.error("[recipeStorage] loadAll remote failed", e);
  }

  await assertWorkspaceOperationCurrent(context);

  // Defensive self-healing: ensure bakes containing completed diagnostic outcomes or already existing in history are automatically cleaned from active lists
  try {
    const rawHistory = await AsyncStorage.getItem(bakeHistoryKey).catch(() => null);
    const historyList = safeParse<ActiveBake[]>(rawHistory, [], Array.isArray);
    const historyIds = new Set(historyList.map(h => h?.id).filter(Boolean));

    const activeBakesCleaned = bakes.filter(b => b && !b.outcome?.overallScore && !historyIds.has(b.id));
    if (activeBakesCleaned.length !== bakes.length) {
      bakes = activeBakesCleaned;
      await storageMutex.run(async () => {
        await assertWorkspaceOperationCurrent(context);
        await AsyncStorage.setItem(bakeKey, JSON.stringify(bakes));
      }).catch((err) => {
        if (err?.message?.includes("Workspace")) throw err;
      });
    }
  } catch (err: any) {
    if (err?.message?.includes("Workspace")) throw err;
    console.error("[recipeStorage] self-healing filtering failed", err);
  }

  await assertWorkspaceOperationCurrent(context);

  return { recipes, bakes, bake: bakes[0] || null };
}

export async function writeRecipesLocal(recipes: SavedRecipe[]): Promise<void> {
  const owner = await resolveOwner();
  const recipesKey = getOwnerStorageKey(RECIPES_KEY, owner);

  const validRecipes = recipes
    .filter(
      r => r && ((typeof r.name === "string" && r.name.trim() !== "") || (Array.isArray(r.phases) && r.phases.length > 0))
    )
    .filter(r => {
      const recordOwner = r.userId ?? owner;
      return recordOwner === owner; // Fail closed: reject foreign records
    })
    .map(r => ({
      ...r,
      userId: owner
    }));
  return storageMutex.run(() => AsyncStorage.setItem(recipesKey, JSON.stringify(validRecipes)));
}

export async function appendRecipeLocal(newRecipe: SavedRecipe): Promise<SavedRecipe[]> {
  const owner = await resolveOwner();
  const recipesKey = getOwnerStorageKey(RECIPES_KEY, owner);

  const recordOwner = newRecipe.userId ?? owner;
  if (recordOwner !== owner) {
    throw new Error(`Write ownership validation failed: record belongs to foreign owner ${recordOwner}, active workspace is ${owner}.`);
  }

  const stampedRecipe = {
    ...newRecipe,
    userId: owner
  };
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(recipesKey);
    const existing = safeParse<SavedRecipe[]>(raw, [], Array.isArray).filter(
      r => r && ((typeof r.name === "string" && r.name.trim() !== "") || (Array.isArray(r.phases) && r.phases.length > 0))
    );
    const updated = [stampedRecipe, ...existing];
    await AsyncStorage.setItem(recipesKey, JSON.stringify(updated));
    return updated;
  });
}

export async function writeBakeLocal(bake: ActiveBake): Promise<void> {
  const owner = await resolveOwner();
  const bakeKey = getOwnerStorageKey(BAKE_KEY, owner);

  const recordOwner = bake.userId ?? owner;
  if (recordOwner !== owner) {
    throw new Error(`Write ownership validation failed: bake belongs to foreign owner ${recordOwner}, active workspace is ${owner}.`);
  }

  const stampedBake = {
    ...bake,
    userId: owner
  };
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(bakeKey).catch(() => null);
    let bakes = safeParse<ActiveBake[]>(raw, [], Array.isArray);

    const idx = bakes.findIndex((b) => b.id === stampedBake.id);
    if (idx !== -1) {
      bakes[idx] = stampedBake;
    } else {
      if (bakes.length < 2) bakes.push(stampedBake);
      else bakes[0] = stampedBake;
    }
    await AsyncStorage.setItem(bakeKey, JSON.stringify(bakes));
  });
}

export async function writeBakesLocal(bakes: ActiveBake[]): Promise<void> {
  const owner = await resolveOwner();
  const bakeKey = getOwnerStorageKey(BAKE_KEY, owner);

  const stampedBakes = bakes.map(b => {
    const recordOwner = b.userId ?? owner;
    if (recordOwner !== owner) {
      throw new Error(`Write ownership validation failed: bake belongs to foreign owner ${recordOwner}, active workspace is ${owner}.`);
    }
    return {
      ...b,
      userId: owner
    };
  });
  return storageMutex.run(() => AsyncStorage.setItem(bakeKey, JSON.stringify(stampedBakes)));
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
        estimatorState: bake.estimatorState,
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
          foldTimestamps: p.foldTimestamps,
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
        createdAt: recipe.createdAt,
        yield_value: recipe.yieldValue ? parseInt(recipe.yieldValue, 10) : 0,
        phases: recipe.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
        })),
        parentRecipeId: recipe.parentRecipeId,
        versionLabel: recipe.versionLabel,
        isArchived: recipe.isArchived,
        diagnosticHypothesis: recipe.diagnosticHypothesis,
        isUneditedIteration: recipe.isUneditedIteration,
        clonedFromBakeName: recipe.clonedFromBakeName,
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
  const owner = await resolveOwner();
  const bakeHistoryKey = getOwnerStorageKey(BAKE_HISTORY_KEY, owner);

  await storageMutex.run(async () => {
    try {
      const stored = await AsyncStorage.getItem(bakeHistoryKey);
      const existing = safeParse<ActiveBake[]>(stored, [], Array.isArray);

      const historyItem = {
        ...bake,
        userId: bake.userId ?? owner,
        savedAt,
        status: (bake.status === 'post_mortem' ? 'post_mortem' : 'completed') as any,
      };

      existing.unshift(historyItem);
      await AsyncStorage.setItem(bakeHistoryKey, JSON.stringify(existing.slice(0, 500)));
    } catch (e) {
      console.error("[recipeStorage] Archive failed local", e);
    }
  });

  callbacks.reportSyncStart();
  const deviceId = await getDeviceId();

  api.history.bakes.upsert({
    id: bake.id,
    deviceId,
    userId: bake.userId ?? owner ?? undefined,
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
      const owner = await resolveOwner();
      const recipesKey = getOwnerStorageKey(RECIPES_KEY, owner);

      const recipeStr = await AsyncStorage.getItem(recipesKey);
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

      await AsyncStorage.setItem(recipesKey, JSON.stringify(updatedRecipes));

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
    const owner = await resolveOwner();
    const bakeHistoryKey = getOwnerStorageKey(BAKE_HISTORY_KEY, owner);
    const bakeKey = getOwnerStorageKey(BAKE_KEY, owner);

    return storageMutex.run(async () => {
        try {
            const storedHistory = await AsyncStorage.getItem(bakeHistoryKey);
            let history = safeParse<ActiveBake[]>(storedHistory, [], Array.isArray);
            const index = history.findIndex(h => h.id === bakeId);

            let updatedBake: ActiveBake | null = null;

            if (index !== -1) {
                updatedBake = {
                    ...history[index],
                    userId: history[index].userId ?? owner,
                    outcome: outcome
                };
                history[index] = updatedBake;
                await AsyncStorage.setItem(bakeHistoryKey, JSON.stringify(history));

                // Also defensively remove from active bakes if a zombie duplicate resides there
                const storedActive = await AsyncStorage.getItem(bakeKey).catch(() => null);
                if (storedActive) {
                    let activeBakes = safeParse<ActiveBake[]>(storedActive, [], Array.isArray);
                    const activeIndex = activeBakes.findIndex(b => b.id === bakeId);
                    if (activeIndex !== -1) {
                        activeBakes.splice(activeIndex, 1);
                        await AsyncStorage.setItem(bakeKey, JSON.stringify(activeBakes));
                    }
                }
            } else {
                const storedActive = await AsyncStorage.getItem(bakeKey);
                if (storedActive) {
                    let activeBakes = safeParse<ActiveBake[]>(storedActive, [], Array.isArray);
                    const activeIndex = activeBakes.findIndex(b => b.id === bakeId);
                    if (activeIndex !== -1) {
                        updatedBake = {
                            ...activeBakes[activeIndex],
                            userId: activeBakes[activeIndex].userId ?? owner,
                            outcome: outcome,
                            status: 'completed',
                            completedAt: activeBakes[activeIndex].completedAt || Date.now()
                        };
                        activeBakes.splice(activeIndex, 1);
                        await AsyncStorage.setItem(bakeKey, JSON.stringify(activeBakes));

                        history.unshift(updatedBake);
                        await AsyncStorage.setItem(bakeHistoryKey, JSON.stringify(history.slice(0, 500)));
                    }
                }
            }

            if (updatedBake) {
                (async () => {
                    try {
                        const deviceId = await getDeviceId();

                        await api.history.bakes.upsert({
                            ...updatedBake,
                            deviceId,
                            userId: updatedBake.userId ?? owner ?? undefined,
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
