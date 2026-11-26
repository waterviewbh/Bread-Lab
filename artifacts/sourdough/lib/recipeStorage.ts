// lib/recipeStorage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import {
  type SavedRecipe,
  type ActiveBake,
  type BakeHistoryItem,
  type BakeOutcome,
  RECIPES_KEY,
  BAKE_KEY,
  BAKE_HISTORY_KEY,
  DELETED_RECIPE_IDS_KEY,
  DELETED_BAKE_IDS_KEY,
  DELETED_FEED_IDS_KEY,
} from "@/lib/recipeTypes";
import { textToCheckableLines, resolveRootMasterId, parseIngredientsForMetrics, detectYeastType, sortRecipePhases } from "@/lib/recipeUtils";
import { safeParse, storageMutex, getOwnerStorageKey, getWorkspaceGeneration, WorkspaceIdentityError, StaleWorkspaceError } from "@/lib/storageUtils";
import { isNlaOwner } from "@/lib/nlaBoundary";

async function resolveOwner(): Promise<string> {
  let token: string | null = null;
  try {
    token = await getStoredToken();
  } catch (e: any) {
    throw new WorkspaceIdentityError(`Owner resolution failed closed due to credential read error: ${e?.message ?? String(e)}`);
  }
  if (token === null) {
    return "anonymous"; // the ONLY path to NLA: getStoredToken() reports both credentials absent
  }
  if (typeof token !== "string" || token.trim() === "") {
    throw new WorkspaceIdentityError("Owner resolution failed closed: stored token is malformed or empty.");
  }
  return token.trim();
}

export interface WorkspaceOperationContext {
  owner: string;
  generation: number;
}

/**
 * The workspace (owner + generation) in effect right now, captured as ONE consistent pair. Screens and storage
 * operations that hold device-local state capture this when they begin, then verify it
 * (assertWorkspaceOperationCurrent) before writing.
 *
 * The generation is read before and after the owner lookup (and the owner is read twice). If either changed while
 * the identity was being captured, the pair would describe no single workspace, so this REJECTS (StaleWorkspaceError)
 * instead of returning a mixed context. An uncertain identity rejects with WorkspaceIdentityError; it never becomes
 * "anonymous".
 */
export async function getWorkspaceIdentity(): Promise<WorkspaceOperationContext> {
  const generationBefore = getWorkspaceGeneration();
  const owner = await resolveOwner();
  const ownerAgain = await resolveOwner();
  const generationAfter = getWorkspaceGeneration();
  if (generationBefore !== generationAfter) {
    throw new StaleWorkspaceError("Workspace generation changed while the workspace identity was being captured.");
  }
  if (owner !== ownerAgain) {
    throw new StaleWorkspaceError("Workspace owner changed while the workspace identity was being captured.");
  }
  return { owner, generation: generationBefore };
}

/**
 * Verifies that a captured context still describes the current workspace: same generation AND same owner. An
 * A -> B -> A sequence fails the generation check even though the owner matches again. Throws StaleWorkspaceError
 * when it does not, or WorkspaceIdentityError when the current identity cannot be established.
 */
export async function assertWorkspaceOperationCurrent(context: WorkspaceOperationContext): Promise<void> {
  const generationBefore = getWorkspaceGeneration();
  const curOwner = await resolveOwner();
  const generationAfter = getWorkspaceGeneration();
  if (context.generation !== generationBefore || generationBefore !== generationAfter) {
    throw new StaleWorkspaceError("Workspace generation changed; aborting stale operation.");
  }
  if (curOwner !== context.owner) {
    throw new StaleWorkspaceError("Workspace owner changed; aborting stale operation.");
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

async function reconcileDeletedRecipeLocked(id: string, owner: string): Promise<void> {
  const keys = [RECIPES_KEY, getOwnerStorageKey(RECIPES_KEY, owner)];
  const updates = await Promise.all(keys.map(async key => {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const recipes: unknown = JSON.parse(raw);
    if (!Array.isArray(recipes)) throw new Error(`Invalid Recipe storage at ${key}.`);

    let changed = false;
    const remaining = recipes.flatMap(recipe => {
      const referencesDeletedRecipe = recipe?.parentRecipeId === id || recipe?.parent_recipe_id === id;
      if (recipe?.id !== id && !referencesDeletedRecipe) return [recipe];
      const recordOwner = recipe.userId ?? recipe.user_id;
      if (typeof recordOwner !== "string" || !recordOwner.trim() ||
          (recipe.userId != null && recipe.user_id != null && recipe.userId !== recipe.user_id)) {
        throw new Error(`Cannot confirm Recipe ownership at ${key}.`);
      }
      if (recordOwner !== owner) return [recipe];

      changed = true;
      if (recipe.id === id) return [];
      // Match the database's ON DELETE SET NULL while preserving the iteration.
      const { parent_recipe_id: _legacyParent, ...iteration } = recipe;
      return [{ ...iteration, parentRecipeId: null }];
    });
    return changed ? { key, data: JSON.stringify(remaining) } : null;
  }));
  for (const update of updates) {
    if (!update) continue;
    await AsyncStorage.setItem(update.key, update.data);
    if (await AsyncStorage.getItem(update.key) !== update.data) {
      throw new Error(`Could not verify Recipe deletion cleanup at ${update.key}.`);
    }
  }
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
    if (set.includes(id) && !isNlaOwner(owner)) {
      await reconcileDeletedRecipeLocked(id, owner);
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

/** The same Bake can be present in the History cache and the account's archive. */
async function removeCompletedBakeCopiesLocked(id: string, owner: string): Promise<void> {
  const keys = [BAKE_HISTORY_KEY, getOwnerStorageKey(BAKE_HISTORY_KEY, owner)];
  const updates = await Promise.all(keys.map(async key => {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error(`Invalid Bake History at ${key}.`);
    const remaining = records.filter(record => {
      if (record?.id !== id) return true;
      const { userId, user_id: legacyOwner } = record;
      const recordOwner = userId ?? legacyOwner;
      if (typeof recordOwner !== "string" || !recordOwner.trim() ||
          (userId != null && legacyOwner != null && userId !== legacyOwner)) {
        throw new Error(`Cannot confirm ownership of Bake ${id} at ${key}.`);
      }
      return recordOwner !== owner;
    });
    return remaining.length === records.length ? null : { key, data: JSON.stringify(remaining) };
  }));
  for (const update of updates) {
    if (!update) continue;
    await AsyncStorage.setItem(update.key, update.data);
    if (await AsyncStorage.getItem(update.key) !== update.data) {
      throw new Error(`Could not verify Bake History deletion at ${update.key}.`);
    }
  }
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
    if (set.includes(id) && !isNlaOwner(owner)) {
      await removeCompletedBakeCopiesLocked(id, owner);
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

export async function reconcileLegacyFlatTombstones(): Promise<void> {
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

    if (existingRaw === "") {
      throw new Error("Destination unresolved legacy store is malformed (empty string).");
    }

    const existingIntents = existingRaw ? JSON.parse(existingRaw) : [];
    if (!Array.isArray(existingIntents)) {
      throw new Error("Destination unresolved legacy store schema corruption: expected array.");
    }

    for (const item of existingIntents) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        item.id.trim() === "" ||
        !["recipe", "bake", "feed"].includes(item.recordType) ||
        item.owner !== "unknown" ||
        item.disposition !== "unresolved" ||
        typeof item.sourceKey !== "string" ||
        item.sourceKey.trim() === ""
      ) {
        throw new Error("Destination unresolved legacy store contains invalid or corrupted pre-existing entry.");
      }
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

/**
 * Retires the NLA workspace's pending deletion intents without any network call. Safe to call while the
 * NLA workspace is active (or under the transition lock). Account-owned tombstones are never touched.
 */
export async function retireNlaTombstones(context?: WorkspaceOperationContext): Promise<void> {
  const ctx = context ?? { owner: await resolveOwner(), generation: getWorkspaceGeneration() };
  if (!isNlaOwner(ctx.owner)) return;
  for (const id of await getRecipeTombstone()) {
    await assertWorkspaceOperationCurrent(ctx);
    await removeFromRecipeTombstone(id, ctx);
  }
  for (const id of await getBakeTombstone()) {
    await assertWorkspaceOperationCurrent(ctx);
    await removeFromBakeTombstone(id, ctx);
  }
  for (const id of await getFeedTombstone()) {
    await assertWorkspaceOperationCurrent(ctx);
    await removeFromFeedTombstone(id, ctx);
  }
}

let isProcessingDeletions = false;

export async function processPendingDeletions(): Promise<void> {
  if (isProcessingDeletions) {
    return;
  }
  isProcessingDeletions = true;
  try {
    await reconcileLegacyFlatTombstones();

    const owner = await resolveOwner();
    const generation = getWorkspaceGeneration();
    const context: WorkspaceOperationContext = { owner, generation };

    // NLA knows nothing about Supabase: it never calls delete/verify. Its pending deletions are retired
    // locally (the record was already removed from the device when the baker deleted it).
    // Authenticated accounts continue below, unchanged.
    if (isNlaOwner(owner)) {
      await assertWorkspaceOperationCurrent(context);
      await retireNlaTombstones(context);
      return;
    }

    const deviceId = await getDeviceId();
    const token = owner === "anonymous" ? null : owner;

    await assertWorkspaceOperationCurrent(context);

    const recipeTombstones = await getRecipeTombstone();
    for (const id of recipeTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        await api.recipes.delete(id, deviceId, token ?? undefined);
        await assertWorkspaceOperationCurrent(context);
        if (await verifyRemoteAbsence('recipe', id, deviceId, token ?? undefined)) {
          await removeFromRecipeTombstone(id, context);
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Recipe deletion retry failed for id ${id}:`, e);
      }
    }

    const bakeTombstones = await getBakeTombstone();
    for (const id of bakeTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        await api.history.bakes.delete(id, deviceId, token ?? undefined);
        await assertWorkspaceOperationCurrent(context);
        if (await verifyRemoteAbsence('bake', id, deviceId, token ?? undefined)) {
          await removeFromBakeTombstone(id, context);
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Bake deletion retry failed for id ${id}:`, e);
      }
    }

    const feedTombstones = await getFeedTombstone();
    for (const id of feedTombstones) {
      await assertWorkspaceOperationCurrent(context);
      try {
        await api.history.feed.delete(id, deviceId, token ?? undefined);
        await assertWorkspaceOperationCurrent(context);
        if (await verifyRemoteAbsence('feed', id, deviceId, token ?? undefined)) {
          await removeFromFeedTombstone(id, context);
        }
      } catch (e: any) {
        console.warn(`[recipeStorage] Feed deletion retry failed for id ${id}:`, e);
      }
    }
  } catch (e) {
    console.error("[recipeStorage] processPendingDeletions failed", e);
  } finally {
    isProcessingDeletions = false;
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
          parentRecipeId: r.parent_recipe_id === undefined ? existingLocal?.parentRecipeId : r.parent_recipe_id,
          versionLabel: r.version_label ?? existingLocal?.versionLabel,
          isArchived: r.isArchived ?? existingLocal?.isArchived,
          diagnosticHypothesis: r.diagnosticHypothesis ?? existingLocal?.diagnosticHypothesis,
          isUneditedIteration: r.isUneditedIteration ?? existingLocal?.isUneditedIteration,
          clonedFromBakeName: r.clonedFromBakeName ?? existingLocal?.clonedFromBakeName,
          provenance: r.provenance ?? existingLocal?.provenance,
        };
      });

    await assertWorkspaceOperationCurrent(context);

    if (typeof (global as any).__pausePrePersist === "function") {
      await (global as any).__pausePrePersist();
    }

    await assertWorkspaceOperationCurrent(context);

    if (token || (apiRecipes && apiRecipes.length > 0)) {
      await storageMutex.run(async () => {
        await assertWorkspaceOperationCurrent(context);
        // A promoted Theory may have been committed while the remote request was in flight,
        // or its remote upsert may still be pending. Preserve that exact local source until
        // a remote row with matching owner and Candidate lineage is observed.
        const currentRaw = await AsyncStorage.getItem(recipesKey);
        const current: unknown = currentRaw === null ? [] : JSON.parse(currentRaw);
        if (!Array.isArray(current)) throw new Error(`Recipe store ${recipesKey} is not a list.`);
        const merged = [...mapped];
        for (const local of current as SavedRecipe[]) {
          const candidateId = local?.provenance?.sourceCandidateId;
          if (!candidateId || local.userId !== owner || deletedRecipeIds.includes(local.id)) continue;
          const remote = (apiRecipes || []).find(r => r.id === local.id);
          if (remote && (remote.userId !== owner || remote.provenance?.sourceCandidateId !== candidateId)) {
            throw new Error(`Promoted Theory ${local.id} has conflicting remote ownership or lineage.`);
          }
          if (!remote) merged.push(local);
        }
        await AsyncStorage.setItem(recipesKey, JSON.stringify(merged));
        recipes = merged;
      });
    }

    await assertWorkspaceOperationCurrent(context);

    // A legacy remote row created when the runner was merely opened is not active work.
    // Only restore a phase-started bake whose remote owner matches this account.
    if (!localBakesFound && activeBake && typeof token === "string" && activeBake.userId === token &&
        activeBake.deviceId === deviceId && Array.isArray(activeBake.phases) &&
        activeBake.phases.some((p) => !!p.startedAt)) {
      const apiBake: ActiveBake = {
        id: activeBake.id,
        userId: token,
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
    // Promotion must never replace unreadable or unclassified Recipe data on retry.
    const parsed = stampedRecipe.provenance?.sourceCandidateId && raw !== null ? JSON.parse(raw) : safeParse<SavedRecipe[]>(raw, [], Array.isArray);
    if (!Array.isArray(parsed)) throw new Error(`Recipe store ${recipesKey} is not a list.`);
    const existing: SavedRecipe[] = stampedRecipe.provenance?.sourceCandidateId ? parsed : parsed.filter(
      (r: SavedRecipe) => r && ((typeof r.name === "string" && r.name.trim() !== "") || (Array.isArray(r.phases) && r.phases.length > 0))
    );
    const prior = existing.find(r => r.id === stampedRecipe.id);
    if (prior) {
      if (!stampedRecipe.provenance?.sourceCandidateId ||
          prior.userId !== owner ||
          prior.provenance?.sourceCandidateId !== stampedRecipe.provenance.sourceCandidateId) {
        throw new Error(`Recipe ${stampedRecipe.id} already exists with different lineage.`);
      }
      return existing;
    }
    if (stampedRecipe.provenance?.sourceCandidateId && existing.some(
      r => r.provenance?.sourceCandidateId === stampedRecipe.provenance?.sourceCandidateId
    )) {
      throw new Error(`Candidate ${stampedRecipe.provenance.sourceCandidateId} already has a different Theory.`);
    }
    const updated = [stampedRecipe, ...existing];
    await AsyncStorage.setItem(recipesKey, JSON.stringify(updated));
    const back = await AsyncStorage.getItem(recipesKey);
    if (!back || !JSON.parse(back).some((r: SavedRecipe) =>
      r.id === stampedRecipe.id && r.userId === owner &&
      r.provenance?.sourceCandidateId === stampedRecipe.provenance?.sourceCandidateId
    )) throw new Error(`Recipe ${stampedRecipe.id} did not read back after save.`);
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
  console.log("[BAKE_NOTES_TRACE]", {
    stage: "ACTIVE_WRITE",
    bakeId: stampedBake.id,
    owner,
    storageKey: bakeKey,
    notesPresent: typeof stampedBake.notes === "string" && stampedBake.notes.length > 0,
    notesLength: stampedBake.notes?.length ?? 0,
    status: stampedBake.status,
  });
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
    const stamped = {
      ...b,
      userId: owner
    };
    console.log("[BAKE_NOTES_TRACE]", {
      stage: "ACTIVE_BATCH_WRITE",
      bakeId: stamped.id,
      owner,
      storageKey: bakeKey,
      notesPresent: typeof stamped.notes === "string" && stamped.notes.length > 0,
      notesLength: stamped.notes?.length ?? 0,
      status: stamped.status,
    });
    return stamped;
  });
  return storageMutex.run(() => AsyncStorage.setItem(bakeKey, JSON.stringify(stampedBakes)));
}

export function upsertBakeRemote(bake: ActiveBake): Promise<void> {
  // Opening the runner does not start a bake. Keep that preparation local until a phase starts.
  if (!bake.phases.some((phase) => !!phase.startedAt)) return Promise.resolve();
  return storageMutex.run(async () => {
    const context = await getWorkspaceIdentity();
    if (context.owner === "anonymous") return; // unfinished NLA work never enters an account
    if (bake.userId !== context.owner) {
      throw new StaleWorkspaceError("Active Bake owner changed before remote persistence");
    }
    const deviceId = await getDeviceId();
    await assertWorkspaceOperationCurrent(context);
    console.log("[BAKE_NOTES_TRACE]", {
      stage: "REMOTE_UPSERT",
      bakeId: bake.id,
      owner: context.owner,
      notesPresent: typeof bake.notes === "string" && bake.notes.length > 0,
      notesLength: bake.notes?.length ?? 0,
      status: bake.status,
      completedAt: bake.completedAt ?? null,
      inProgress: true,
    });
    await api.history.bakes.upsert({
      id: bake.id,
      deviceId,
      userId: context.owner,
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
    });
    await assertWorkspaceOperationCurrent(context);
  });
}

export function upsertRecipeRemote(recipe: SavedRecipe): Promise<void> {
  // null = NLA. An uncertain identity rejects (callers handle failure); it is never sent as a device-id-only write.
  return Promise.all([getDeviceId(), getStoredToken()])
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
        provenance: recipe.provenance,
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
  const context = await getWorkspaceIdentity();
  const owner = context.owner;
  if (bake.userId != null && bake.userId !== owner) {
    throw new Error("Bake owner does not match the current workspace.");
  }
  if (!bake.phases.length || !bake.phases.every(p => !!p.completedAt) || !bake.completedAt) {
    throw new Error("Only a completed bake can be archived.");
  }
  const bakeHistoryKey = getOwnerStorageKey(BAKE_HISTORY_KEY, owner);
  const bakeKey = getOwnerStorageKey(BAKE_KEY, owner);
  let historyItem: BakeHistoryItem;

  await storageMutex.run(async () => {
    await assertWorkspaceOperationCurrent(context);
    const stored = await AsyncStorage.getItem(bakeHistoryKey);
    const existing = safeParse<BakeHistoryItem[]>(stored, [], Array.isArray);
    const prior = existing.find(item => item.id === bake.id);
    if (prior && prior.userId !== owner) throw new Error("History bake owner does not match the current workspace.");
    historyItem = prior ?? {
      ...bake,
      userId: owner,
      savedAt: Date.now(),
      status: 'completed',
    };
    if (!prior) {
      await AsyncStorage.setItem(bakeHistoryKey, JSON.stringify([historyItem, ...existing].slice(0, 500)));
    }
    const activeRaw = await AsyncStorage.getItem(bakeKey);
    const active = safeParse<ActiveBake[]>(activeRaw, [], Array.isArray);
    if (active.some(item => item.id === bake.id)) {
      await AsyncStorage.setItem(bakeKey, JSON.stringify(active.filter(item => item.id !== bake.id)));
    }
  });

  callbacks.reportSyncStart();
  try {
    const deviceId = await getDeviceId();
    await assertWorkspaceOperationCurrent(context);
    await api.history.bakes.upsert({
      id: historyItem!.id,
      deviceId,
      userId: owner,
      recipeId: historyItem!.recipeId,
      recipeName: historyItem!.recipeName,
      yield_value: historyItem!.yieldValue ? parseInt(historyItem!.yieldValue, 10) : 0,
      savedAt: historyItem!.savedAt!,
      startedAt: historyItem!.startedAt,
      completedAt: historyItem!.completedAt,
      status: historyItem!.status,
      outcome: historyItem!.outcome,
      notes: historyItem!.notes,
      estimatorState: historyItem!.estimatorState,
      phases: historyItem!.phases as any,
      inProgress: false,
    });
    callbacks.reportSyncSuccess();
  } catch (error) {
    callbacks.reportSyncFailure();
  }
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
      // The remote archive follows the workspace the local archive just wrote to (not a second, separate identity read).
      const token = isNlaOwner(owner) ? null : owner;

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
            const flatHistoryKey = BAKE_HISTORY_KEY;
            const [storedHistory, storedFlatHistory, storedActive] = await Promise.all([
                AsyncStorage.getItem(bakeHistoryKey),
                AsyncStorage.getItem(flatHistoryKey),
                AsyncStorage.getItem(bakeKey),
            ]);
            const history = safeParse<ActiveBake[]>(storedHistory, [], Array.isArray);
            const flatHistory = safeParse<ActiveBake[]>(storedFlatHistory, [], Array.isArray);
            const activeBakes = safeParse<ActiveBake[]>(storedActive, [], Array.isArray);

            console.log("[BAKE_NOTES_TRACE]", {
                stage: "STORAGE_READ",
                source: "owner_history",
                storageKey: bakeHistoryKey,
                bakeIds: history.map(h => h.id),
                notesDetails: history.map(h => ({ id: h.id, notesPresent: typeof h.notes === "string" && h.notes.length > 0, notesLength: h.notes?.length ?? 0 })),
                owner,
            });
            console.log("[BAKE_NOTES_TRACE]", {
                stage: "STORAGE_READ",
                source: "flat_history",
                storageKey: flatHistoryKey,
                bakeIds: flatHistory.map(h => h.id),
                notesDetails: flatHistory.map(h => ({ id: h.id, notesPresent: typeof h.notes === "string" && h.notes.length > 0, notesLength: h.notes?.length ?? 0 })),
                owner,
            });
            console.log("[BAKE_NOTES_TRACE]", {
                stage: "STORAGE_READ",
                source: "owner_active",
                storageKey: bakeKey,
                bakeIds: activeBakes.map(b => b.id),
                notesDetails: activeBakes.map(b => ({ id: b.id, notesPresent: typeof b.notes === "string" && b.notes.length > 0, notesLength: b.notes?.length ?? 0 })),
                owner,
            });

            const index = history.findIndex(h => h.id === bakeId);
            const flatIndex = flatHistory.findIndex(h => h.id === bakeId);
            const activeIndex = activeBakes.findIndex(b => b.id === bakeId);
            const candidate = index !== -1 ? history[index] : flatIndex !== -1 ? flatHistory[flatIndex] : null;

            console.log("[BAKE_NOTES_TRACE]", {
                stage: "STORAGE_MERGE",
                bakeId,
                ownerHistoryFound: index !== -1,
                ownerHistoryNotesPresent: typeof history[index]?.notes === "string" && history[index].notes.length > 0,
                ownerHistoryNotesLength: typeof history[index]?.notes === "string" ? history[index].notes.length : 0,
                flatHistoryFound: flatIndex !== -1,
                flatHistoryNotesPresent: typeof flatHistory[flatIndex]?.notes === "string" && flatHistory[flatIndex].notes.length > 0,
                flatHistoryNotesLength: typeof flatHistory[flatIndex]?.notes === "string" ? flatHistory[flatIndex].notes.length : 0,
                activeBakeFound: activeIndex !== -1,
                activeNotesPresent: typeof activeBakes[activeIndex]?.notes === "string" && activeBakes[activeIndex].notes.length > 0,
                activeNotesLength: typeof activeBakes[activeIndex]?.notes === "string" ? activeBakes[activeIndex].notes.length : 0,
                duplicateAcrossSources: [index, flatIndex, activeIndex].filter(i => i !== -1).length > 1,
                selectedSource: index !== -1 ? "owner_history" : flatIndex !== -1 ? "flat_history" : activeIndex !== -1 ? "owner_active" : "none",
                selectedNotesPresent: typeof candidate?.notes === "string" && candidate.notes.length > 0,
                selectedNotesLength: typeof candidate?.notes === "string" ? candidate.notes.length : 0,
            });
            if (!candidate) throw new Error(`Bake ${bakeId} was not found in archived history.`);
            if (candidate.userId !== owner) throw new Error("Bake owner does not match the current workspace.");
            if (flatIndex !== -1 && flatHistory[flatIndex].userId !== owner) {
                throw new Error("Flat bake owner does not match the current workspace.");
            }
            if (activeIndex !== -1 && activeBakes[activeIndex].userId !== owner) {
                throw new Error("Active bake owner does not match the current workspace.");
            }

            const updatedBake: ActiveBake = { ...candidate, outcome };
            const deviceId = await getDeviceId();
            if (owner !== "anonymous") {
                const remote = (await api.history.bakes.list(deviceId, owner)).find(b => b.id === bakeId);
                if (!remote || remote.userId !== owner) {
                    throw new Error("Bake is not available for review in the current account.");
                }
                const saved = await api.history.bakes.upsert({
                    ...remote,
                    outcome,
                    deviceId: remote.deviceId,
                    userId: owner,
                    yield_value: remote.yield_value,
                    savedAt: remote.savedAt,
                    completedAt: remote.completedAt,
                    inProgress: false,
                } as any);
                if (saved.id !== bakeId || saved.savedAt !== remote.savedAt ||
                    saved.completedAt !== remote.completedAt || !saved.outcome ||
                    (["crumbScore", "crustScore", "flavorScore", "overallScore", "defects", "reflectionNotes"] as const)
                        .some(key => JSON.stringify((saved.outcome as any)[key]) !== JSON.stringify((outcome as any)[key]))) {
                    throw new Error("Review outcome was not verified after cloud save.");
                }
            }

            if (index !== -1) history[index] = updatedBake;
            if (index !== -1) {
                await AsyncStorage.setItem(bakeHistoryKey, JSON.stringify(history));
            }
            if (flatIndex !== -1) {
                flatHistory[flatIndex] = updatedBake;
                await AsyncStorage.setItem(flatHistoryKey, JSON.stringify(flatHistory));
            }
        } catch (e) {
            console.error("[recipeStorage] updateBakeOutcomeInHistory failed", e);
            throw e;
        }
    });
}
