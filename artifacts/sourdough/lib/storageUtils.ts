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
 * Preserves records belonging to other authenticated users while purging anonymous operational records.
 */
export async function clearOperationalData(currentUserId?: string | null): Promise<void> {
  // Pre-mutation verification pass (Fail-closed reads & Dry-Run Safety Check):
  // Ensure all required operational keys can be read successfully and parsed safely
  // before performing any mutations to local storage, guaranteeing fail-closed error handling and atomicity.
  let recipeRaw: string | null = null;
  let bakeHistRaw: string | null = null;
  let feedHistRaw: string | null = null;
  let delRecipeRaw: string | null = null;
  let delBakeRaw: string | null = null;
  let delFeedRaw: string | null = null;
  let activeBakeCheck: string | null = null;
  let activeFeedCheck: string | null = null;
  let migPendingCheck: string | null = null;

  try {
    [recipeRaw, bakeHistRaw, feedHistRaw, delRecipeRaw, delBakeRaw, delFeedRaw, activeBakeCheck, activeFeedCheck, migPendingCheck] = await Promise.all([
      AsyncStorage.getItem(APP_STORAGE_KEYS.RECIPES),
      AsyncStorage.getItem(APP_STORAGE_KEYS.BAKE_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.FEED_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_RECIPE_IDS),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_BAKE_IDS),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_FEED_IDS),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_BAKE),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED),
      AsyncStorage.getItem(APP_STORAGE_KEYS.MIGRATION_PENDING),
    ]);
  } catch (error: any) {
    throw new Error(`Operational wipe pre-validation failed due to storage read error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (migPendingCheck !== null) {
    throw new Error("Operational wipe verification failed: migration pending marker remains present.");
  }

  // Validate expected data shapes (must be arrays when present) before mutation (Requirement 1 & 2)
  if (recipeRaw !== null) {
    try {
      const parsed = JSON.parse(recipeRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: recipe record storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: recipe record storage is malformed and cannot be verified.`);
    }
  }

  if (bakeHistRaw !== null) {
    try {
      const parsed = JSON.parse(bakeHistRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: bake history storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: bake history storage is malformed and cannot be verified.`);
    }
  }

  if (feedHistRaw !== null) {
    try {
      const parsed = JSON.parse(feedHistRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: feed history storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: feed history storage is malformed and cannot be verified.`);
    }
  }

  if (delRecipeRaw !== null) {
    try {
      const parsed = JSON.parse(delRecipeRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: deleted recipe IDs storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: deleted recipe IDs storage is malformed and cannot be verified.`);
    }
  }

  if (delBakeRaw !== null) {
    try {
      const parsed = JSON.parse(delBakeRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: deleted bake IDs storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: deleted bake IDs storage is malformed and cannot be verified.`);
    }
  }

  if (delFeedRaw !== null) {
    try {
      const parsed = JSON.parse(delFeedRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("Operational wipe pre-validation failed: deleted feed IDs storage has invalid shape (expected array).");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
      throw new Error(`Operational wipe pre-validation failed: deleted feed IDs storage is malformed and cannot be verified.`);
    }
  }

  if (activeBakeCheck !== null) {
    try {
      const parsed = JSON.parse(activeBakeCheck);
      const bakesList = Array.isArray(parsed) ? parsed : [parsed];
      for (const b of bakesList) {
        if (!b) continue;
        const owner = b.userId ?? b.user_id;
        if (!owner || String(owner).trim() === "") {
          throw new Error("Operational wipe verification failed: active bake record has unknown or missing ownership metadata.");
        }
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe verification failed")) throw e;
      throw new Error(`Operational wipe verification failed: active bake record is malformed and cannot be verified.`);
    }
  }

  if (activeFeedCheck !== null) {
    try {
      const parsed = JSON.parse(activeFeedCheck);
      const owner = parsed?.userId ?? parsed?.user_id;
      if (!owner || String(owner).trim() === "") {
        throw new Error("Operational wipe verification failed: active feed record has unknown or missing ownership metadata.");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe verification failed")) throw e;
      throw new Error(`Operational wipe verification failed: active feed record is malformed and cannot be verified.`);
    }
  }

  try {
    console.log("[StorageUtils] Purging anonymous operational data while preserving other users' and unknown ownership records...");

    if (recipeRaw) {
      const recipes = safeParse<any[]>(recipeRaw, [], Array.isArray);
      const retained = recipes.filter(r => {
        if (!r) return false;
        const owner = r.userId ?? r.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.RECIPES, JSON.stringify(retained));
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.RECIPES);
      }
    }

    if (bakeHistRaw) {
      const bakes = safeParse<any[]>(bakeHistRaw, [], Array.isArray);
      const retained = bakes.filter(b => {
        if (!b) return false;
        const owner = b.userId ?? b.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.BAKE_HISTORY, JSON.stringify(retained));
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.BAKE_HISTORY);
      }
    }

    if (feedHistRaw) {
      const feeds = safeParse<any[]>(feedHistRaw, [], Array.isArray);
      const retained = feeds.filter(f => {
        if (!f) return false;
        const owner = f.userId ?? f.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.FEED_HISTORY, JSON.stringify(retained));
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.FEED_HISTORY);
      }
    }

    if (activeBakeCheck) {
      try {
        const parsed = JSON.parse(activeBakeCheck);
        const bakesList = Array.isArray(parsed) ? parsed : [parsed];
        const retainedBakes = bakesList.filter(b => {
          if (!b) return false;
          const owner = b.userId ?? b.user_id;
          const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
          const isUnknown = !owner || String(owner).trim() === "";
          return isOtherUser || isUnknown;
        });
        if (retainedBakes.length > 0) {
          await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify(Array.isArray(parsed) ? retainedBakes : retainedBakes[0]));
        } else {
          await AsyncStorage.removeItem(APP_STORAGE_KEYS.ACTIVE_BAKE);
        }
      } catch {
        // Preserve unparseable active bake state safely
      }
    }

    if (activeFeedCheck) {
      try {
        const parsed = JSON.parse(activeFeedCheck);
        const owner = parsed?.userId ?? parsed?.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        if (!isOtherUser && !isUnknown) {
          await AsyncStorage.removeItem(APP_STORAGE_KEYS.ACTIVE_FEED);
        }
      } catch {
        // Preserve unparseable active feed state safely
      }
    }

    await AsyncStorage.multiRemove([
      APP_STORAGE_KEYS.DELETED_RECIPE_IDS,
      APP_STORAGE_KEYS.DELETED_BAKE_IDS,
      APP_STORAGE_KEYS.DELETED_FEED_IDS,
      APP_STORAGE_KEYS.MIGRATION_PENDING,
    ]);
  } catch (error) {
    console.error("[StorageUtils] Failed to clear operational data", error);
    throw new Error(`Failed to clear local operational data: ${error instanceof Error ? error.message : String(error)}`);
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
