// artifacts/sourdough/lib/migrate.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { getDeviceId } from "./deviceId";

const HISTORY_KEY = "sourdough_feed_history_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
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

async function readLocalArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
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
  } catch {
    return { feed: empty, bakes: empty, recipes: empty };
  }

  const [feedSessions, bakeSessions, recipes] = await Promise.all([
    readLocalArray<LocalFeedSession>(HISTORY_KEY),
    readLocalArray<LocalBakeSession>(BAKE_HISTORY_KEY),
    readLocalArray<LocalRecipe>(RECIPES_KEY),
  ]);

  const ledgerKey = LEDGER_KEY(token);
  const ledgerRaw = await AsyncStorage.getItem(ledgerKey);
  const ledger: Record<string, string> = ledgerRaw ? JSON.parse(ledgerRaw) : {};

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

  for (const bake of bakeSessions) {
    const key = `bake:${bake.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  for (const feed of feedSessions) {
    const key = `feed:${feed.id}`;
    if (!ledger[key]) {
      ledger[key] = generateSecureUUID();
    }
    typeMapping.set(key, ledger[key]);
  }

  // Durably persist Pass 1 ledger state before uploading
  await AsyncStorage.setItem(ledgerKey, JSON.stringify(ledger));

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

  // 2. Upload Bake Sessions
  let bakesOk = 0;
  let bakesFailed = 0;
  for (const b of bakeSessions) {
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
        recipeName: b.recipeName,
        yield_value: safeYield,
        savedAt: b.savedAt,
        startedAt: b.startedAt,
        completedAt: (b as any).completedAt || null,
        status: (b as any).status || null,
        outcome: b.outcome || null,
        notes: b.notes || null,
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

  // 3. Upload Feed Sessions
  let feedOk = 0;
  let feedFailed = 0;
  for (const s of feedSessions) {
    const key = `feed:${s.id}`;
    const targetId = ledger[key];

    try {
      await api.history.feed.upsert({
        id: targetId,
        deviceId,
        userId: token,
        savedAt: s.savedAt,
        startedAt: null,
        data: s as Record<string, unknown>,
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
