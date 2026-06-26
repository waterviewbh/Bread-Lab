import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { getDeviceId } from "./deviceId";

const HISTORY_KEY = "sourdough_feed_history_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const RECIPES_KEY = "bread_lab_recipes_v1";

export const MIGRATION_PENDING_KEY = "bread_lab_migration_pending_v1";

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
  phases: {
    key: string;
    name: string;
    startedAt?: number | null;
    completedAt?: number | null;
  }[];
}

interface LocalRecipe {
  id: string;
  name: string;
  phases: {
    key: string;
    name: string;
    ingredients?: string;
    instructions?: string;
  }[];
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

async function upsertBatch<T>(
  items: T[],
  upsertFn: (item: T) => Promise<unknown>
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await upsertFn(item);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
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

export async function migrateLocalDataToAccount(): Promise<MigrationResult> {
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

  const [feed, bakes, recipesResult] = await Promise.all([
    upsertBatch(feedSessions, (s) =>
      api.history.feed.upsert({
        id: s.id,
        deviceId,
        userId,
        savedAt: s.savedAt,
        startedAt: null,
        data: s as Record<string, unknown>,
      })
    ),
    upsertBatch(bakeSessions, (b) =>
      api.history.bakes.upsert({
        id: b.id,
        deviceId,
        userId,
        recipeId: b.recipeId ?? null,
        recipeName: b.recipeName,
        savedAt: b.savedAt,
        startedAt: b.startedAt,
        phases: b.phases.map((p) => ({
          key: p.key,
          name: p.name,
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
        })),
      })
    ),
    upsertBatch(recipes, (r) =>
      api.recipes.upsert({
        id: r.id,
        deviceId,
        userId,
        name: r.name,
        phases: r.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
        })),
      })
    ),
  ]);

  const result: MigrationResult = { feed, bakes, recipes: recipesResult };

  const totalFailed = feed.failed + bakes.failed + recipesResult.failed;
  if (totalFailed === 0) {
    await clearMigrationPending();
  }

  return result;
}
