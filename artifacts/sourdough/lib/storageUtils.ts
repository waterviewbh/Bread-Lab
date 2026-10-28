import AsyncStorage from "@react-native-async-storage/async-storage";


export const APP_STORAGE_KEYS = {
  // Auth
  AUTH_TOKEN: "bread_lab_auth_token_v1",
  AUTH_USER: "bread_lab_auth_user_v1",

  // Recipes
  RECIPES: "bread_lab_recipes_v1",
  DELETED_RECIPE_IDS: "bread_lab_deleted_recipe_ids_v1",

  // Bakes
  ACTIVE_BAKE: "bread_lab_bake_v2",
  BAKE_HISTORY: "bread_lab_bake_history_v1",
  DELETED_BAKE_IDS: "bread_lab_deleted_bake_ids_v1",

  // Feed / Starters
  ACTIVE_FEED: "sourdough_feed_session_v1",
  FEED_HISTORY: "sourdough_feed_history_v1",
  DELETED_FEED_IDS: "bread_lab_deleted_feed_ids_v1",
  FEED_FILTER: "bread_lab_feed_filter_v1",

  // UI / Metadata
  NAME_NUDGE: "bread_lab_name_nudge_shown_v1",
  MIGRATION_PENDING: "bread_lab_migration_pending_v1",
  FONT_SIZE_LARGE: "font_size_large_v1",
  TOUR_SEEN_V1: "bread_lab_tour_seen_v1",
  TOUR_SEEN_V2: "bread_lab_tour_seen_v2",

  // Preferences
  TEMP_UNIT: "bread_lab_temp_unit_v1",
  WEIGHT_UNIT: "bread_lab_weight_unit_v1",
  TIME_FORMAT: "bread_lab_time_format_v1",

  // Tutorial
  TUTORIAL_ACTIVE: "bread_lab_starter_tutorial_active_v1",
  TUTORIAL_DAY: "bread_lab_starter_tutorial_day_v1",
  TUTORIAL_BASELINE: "bread_lab_tutorial_baseline_volume_v1",
  TUTORIAL_METADATA: "bread_lab_tutorial_metadata_v1",

  // Schema Version
  SCHEMA_VERSION: "bread_lab_schema_version_v1",
};

export const OPERATIONAL_KEYS = [
  APP_STORAGE_KEYS.RECIPES,
  APP_STORAGE_KEYS.DELETED_RECIPE_IDS,
  APP_STORAGE_KEYS.ACTIVE_BAKE,
  APP_STORAGE_KEYS.BAKE_HISTORY,
  APP_STORAGE_KEYS.DELETED_BAKE_IDS,
  APP_STORAGE_KEYS.ACTIVE_FEED,
  APP_STORAGE_KEYS.FEED_HISTORY,
  APP_STORAGE_KEYS.DELETED_FEED_IDS,
  APP_STORAGE_KEYS.MIGRATION_PENDING,
];

/**
 * Clear local operational data without removing authentication credential keys.
 */
export async function clearOperationalData(): Promise<void> {
  try {
    console.log("[StorageUtils] Clearing local operational keys...");
    await AsyncStorage.multiRemove(OPERATIONAL_KEYS);
  } catch (error) {
    console.error("[StorageUtils] Failed to clear operational data", error);
    throw new Error(`Failed to clear local operational data: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Verification pass
  for (const key of OPERATIONAL_KEYS) {
    const val = await AsyncStorage.getItem(key);
    if (val !== null && val !== undefined) {
      throw new Error(`Operational wipe verification failed: key ${key} remains present.`);
    }
  }
}

/**
 * Perform an exhaustive wipe of all local app data including auth keys.
 */
export async function clearAllAppData(): Promise<void> {
  const allKeys = Object.values(APP_STORAGE_KEYS);
  try {
    console.log("[StorageUtils] Performing exhaustive local data wipe...");
    await AsyncStorage.multiRemove(allKeys);
  } catch (error) {
    console.error("[StorageUtils] Failed to clear all app data", error);
    throw new Error(`Failed to clear local app data: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const key of OPERATIONAL_KEYS) {
    const val = await AsyncStorage.getItem(key);
    if (val !== null && val !== undefined) {
      throw new Error(`Storage wipe verification failed: key ${key} remains present after clearing.`);
    }
  }
}



/**
 * Defensive JSON parsing with type validation and shallow merging for objects.
 */
export function safeParse<T>(
  json: string | null,
  defaultValue: T,
  validate?: (parsed: unknown) => boolean
): T {
  try {
    if (!json) return defaultValue;
    const parsed = JSON.parse(json);

    if (validate && !validate(parsed)) {
      console.warn("[StorageUtils] Validation failed for parsed data, using default.");
      return defaultValue;
    }

    if (
      typeof defaultValue === "object" &&
      defaultValue !== null &&
      !Array.isArray(defaultValue) &&
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return { ...defaultValue, ...parsed } as T;
    }

    return parsed as T;
  } catch (e) {
    console.error("[StorageUtils] Failed to parse JSON", e);
    return defaultValue;
  }
}

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    let unlock: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    const currentTail = this.tail;
    this.tail = next;

    await currentTail;
    try {
      return await task();
    } finally {
      unlock();
    }
  }
}

export const storageMutex = new AsyncMutex();
