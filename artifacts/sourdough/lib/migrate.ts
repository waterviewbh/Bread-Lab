// artifacts/sourdough/lib/migrate.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { getDeviceId } from "./deviceId";

const HISTORY_KEY = "sourdough_feed_history_v1";
const ACTIVE_FEED_KEY = "sourdough_feed_session_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const ACTIVE_BAKE_KEY = "bread_lab_bake_v2";
const RECIPES_KEY = "bread_lab_recipes_v1";

export const MIGRATION_PENDING_KEY = "bread_lab_migration_pending_v1";
const LEDGER_KEY = (userId: string) => `bread_lab_import_ledger_${userId}`;

export interface MigrationResult {
  feed: { ok: number; failed: number };
  bakes: { ok: number; failed: number };
  recipes: { ok: number; failed: number };
}

interface LocalFeedSession {
  id: string;
  savedAt: number;
  [key: string]: unknown;
}

interface LocalBakeSession {
  id: string;
  recipeId?: string | null;
  recipeName: string;
  savedAt: number;
  startedAt: number;
  yieldValue?: string;
  notes?: string;
  phases: any[];
  [key: string]: unknown;
}

interface LocalRecipe {
  id: string;
  name: string;
  overview?: string;
  yieldValue?: string;
  parentRecipeId?: string | null;
  parent_recipe_id?: string | null;
  phases: any[];
  [key: string]: unknown;
}

async function readLocalArrayOrThrow<T>(key: string): Promise<T[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    throw new Error(`Storage read error for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid top-level data shape for key ${key}: expected array, got ${typeof parsed}`);
  }
  return parsed as T[];
}

async function readActiveBakesOrThrow(key: string): Promise<LocalBakeSession[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    throw new Error(`Storage read error for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (Array.isArray(parsed)) {
    return parsed as LocalBakeSession[];
  } else if (parsed !== null && typeof parsed === "object") {
    return [parsed as LocalBakeSession];
  } else {
    throw new Error(`Invalid top-level data shape for key ${key}: expected array or object`);
  }
}

async function readLocalObjectOrThrow<T>(key: string): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    throw new Error(`Storage read error for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON for key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid top-level data shape for key ${key}: expected object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
  }
  return parsed as T;
}

function generateSecureUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for runtimes without crypto.randomUUID
  throw new Error("Secure crypto.randomUUID() is required for robust ID generation.");
}

export async function setMigrationPending(): Promise<void> {
  await AsyncStorage.setItem(MIGRATION_PENDING_KEY, "1");
}

export async function clearMigrationPending(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_PENDING_KEY);
}

export async function hasPendingMigration(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(MIGRATION_PENDING_KEY);
    return val === "1";
  } catch {
    return false;
  }
}

/**
 * migrateLocalDataToAccount
 * Bulletproof Two-Pass Typed Import Engine with Durable Ledger & Relationship Remapping.
 */
export async function migrateLocalDataToAccount(token: string): Promise<MigrationResult> {
  const empty = { ok: 0, failed: 0 };
  let deviceId: string;
  try {
    deviceId = await getDeviceId();
    if (!deviceId || typeof deviceId !== "string") {
      throw new Error("Invalid device ID retrieved");
    }
  } catch (error) {
    throw new Error(`Failed to retrieve device ID: ${error instanceof Error ? error.message : String(error)}`);
  }

  const [recipes, bakeHistory, activeBakes, feedHistory, activeFeed] = await Promise.all([
    readLocalArrayOrThrow<LocalRecipe>(RECIPES_KEY),
    readLocalArrayOrThrow<LocalBakeSession>(BAKE_HISTORY_KEY),
    readActiveBakesOrThrow(ACTIVE_BAKE_KEY),
    readLocalArrayOrThrow<LocalFeedSession>(HISTORY_KEY),
    readLocalObjectOrThrow<LocalFeedSession>(ACTIVE_FEED_KEY),
  ]);

  const ledgerKey = LEDGER_KEY(token);
  let ledgerRaw: string | null;
  try {
    ledgerRaw = await AsyncStorage.getItem(ledgerKey);
  } catch (error) {
    throw new Error(`Storage read error for migration ledger: ${error instanceof Error ? error.message : String(error)}`);
  }

  let ledger: Record<string, string> = {};
  if (ledgerRaw !== null && ledgerRaw !== undefined) {
    let parsedLedger: unknown;
    try {
      parsedLedger = JSON.parse(ledgerRaw);
    } catch (error) {
      throw new Error(`Malformed JSON for migration ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (parsedLedger === null || typeof parsedLedger !== "object" || Array.isArray(parsedLedger)) {
      throw new Error(`Invalid migration ledger shape: expected object, got ${Array.isArray(parsedLedger) ? 'array' : typeof parsedLedger}`);
    }
    ledger = parsedLedger as Record<string, string>;
  }

  // -------------------------------------------------------------
  // PASS 1: Allocate & Persist Target UUIDs for ALL Records (Typed Keys)
  // -------------------------------------------------------------
  const typeMapping = new Map<string, string>(); // "type:localId" -> targetUuid

  for (const recipe of recipes) {
    const key = `recipe:${recipe.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  for (const bake of bakeHistory) {
    const key = `bake:${bake.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  for (const bake of activeBakes) {
    if (!bake.id) bake.id = generateSecureUUID();
    const key = `bake:${bake.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  for (const feed of feedHistory) {
    const key = `feed:${feed.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  if (activeFeed) {
    if (!activeFeed.id) activeFeed.id = generateSecureUUID();
    const key = `feed:${activeFeed.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  // Durably persist Pass 1 ledger state before uploading
  try {
    await AsyncStorage.setItem(ledgerKey, JSON.stringify(ledger));
  } catch (error) {
    throw new Error(`Failed to persist migration ledger: ${error instanceof Error ? error.message : String(error)}`);
  }

  // -------------------------------------------------------------
  // PASS 2: Remap Relationships & Upload in Dependency Order
  // -------------------------------------------------------------

  // 1. Upload Recipes (Dependency Root)
  let recipesOk = 0;
  let recipesFailed = 0;
  for (const r of recipes) {
    const key = `recipe:${r.id}`;
    const targetId = ledger[key];

    try {
      const parsedYield = parseInt(r.yieldValue || "0", 10);
      const safeYield = isNaN(parsedYield) ? 0 : parsedYield;

      const rawParent = r.parentRecipeId ?? r.parent_recipe_id ?? null;
      const remappedParent = rawParent ? typeMapping.get(`recipe:${rawParent}`) ?? rawParent : null;

      await api.recipes.upsert({
        id: targetId,
        deviceId,
        userId: token,
        name: r.name,
        overview: r.overview,
        yield_value: safeYield,
        parentRecipeId: remappedParent,
        phases: (r.phases || []).map((p: any) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
        })),
      });
      recipesOk++;
    } catch {
      recipesFailed++;
    }
  }

  // 2. Upload Bake Sessions (History & Active)
  let bakesOk = 0;
  let bakesFailed = 0;
  const allBakes = [
    ...bakeHistory.map(b => ({ ...b, inProgress: false })),
    ...activeBakes.map(b => ({ ...b, inProgress: true }))
  ];

  for (const b of allBakes) {
    const key = `bake:${b.id}`;
    const targetId = ledger[key];

    try {
      const parsedYield = parseInt(b.yieldValue || "0", 10);
      const safeYield = isNaN(parsedYield) ? 0 : parsedYield;

      const rawRecipeId = b.recipeId ?? (b as any).recipe_id ?? null;
      const remappedRecipeId = rawRecipeId ? typeMapping.get(`recipe:${rawRecipeId}`) ?? rawRecipeId : null;

      await api.history.bakes.upsert({
        id: targetId,
        deviceId,
        userId: token,
        recipeId: remappedRecipeId,
        recipeName: b.recipeName || "Bake",
        yield_value: safeYield,
        savedAt: b.savedAt || Date.now(),
        startedAt: b.startedAt || Date.now(),
        completedAt: (b as any).completedAt || null,
        status: (b as any).status || null,
        outcome: b.outcome || null,
        notes: b.notes || null,
        inProgress: b.inProgress,
        phases: (b.phases || []).map((p: any) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
          readings: p.readings,
          startVolume: p.startVolume,
          foldCount: p.foldCount,
          foldTimestamps: p.foldTimestamps,
        })),
      });
      bakesOk++;
    } catch {
      bakesFailed++;
    }
  }

  // 3. Upload Feed Sessions (History & Active)
  let feedOk = 0;
  let feedFailed = 0;

  for (const s of feedHistory) {
    const key = `feed:${s.id}`;
    const targetId = ledger[key];

    try {
      const { inProgress: _, ...feedData } = s as any;
      await api.history.feed.upsert({
        id: targetId,
        deviceId,
        userId: token,
        savedAt: s.savedAt || Date.now(),
        startedAt: (s as any).startedAt ?? null,
        updatedAt: (s as any).updatedAt ?? null,
        inProgress: false,
        data: feedData,
      });
      feedOk++;
    } catch {
      feedFailed++;
    }
  }

  if (activeFeed) {
    const key = `feed:${activeFeed.id}`;
    const targetId = ledger[key];

    try {
      const { inProgress: _, ...feedData } = activeFeed as any;
      await api.history.feed.upsert({
        id: targetId,
        deviceId,
        userId: token,
        savedAt: activeFeed.savedAt || Date.now(),
        startedAt: (activeFeed as any).startedAt ?? null,
        updatedAt: (activeFeed as any).updatedAt ?? null,
        inProgress: true,
        data: feedData,
      });
      feedOk++;
    } catch {
      feedFailed++;
    }
  }

  const result: MigrationResult = {
    feed: { ok: feedOk, failed: feedFailed },
    bakes: { ok: bakesOk, failed: bakesFailed },
    recipes: { ok: recipesOk, failed: recipesFailed },
  };

  const totalFailed = feedFailed + bakesFailed + recipesFailed;
  if (totalFailed === 0) {
    await clearMigrationPending();
  }

  return result;
}
