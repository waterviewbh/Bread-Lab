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

function validateArrayStorageKey(raw: string | null, keyLabel: string): void {
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Operational wipe pre-validation failed: ${keyLabel} storage has invalid shape (expected array).`);
    }
  } catch (e: any) {
    if (e.message?.includes("Operational wipe pre-validation failed")) throw e;
    throw new Error(`Operational wipe pre-validation failed: ${keyLabel} storage contains malformed JSON and cannot be verified.`);
  }
}

/**
 * Genuinely non-mutating operation that validates relevant operational storage reads,
 * JSON shapes, migration pending markers, and ownership conditions without modifying or removing any storage keys.
 */
export async function validateOperationalData(currentUserId?: string | null): Promise<void> {
  console.log(`[BL-DIAG] [StorageUtils] validateOperationalData starting for currentUserId: ${currentUserId}`);
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
    console.log(`[BL-DIAG] [StorageUtils] validateOperationalData storage read error:`, error);
    throw new Error(`Operational wipe pre-validation failed due to storage read error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (migPendingCheck !== null) {
    console.log(`[BL-DIAG] [StorageUtils] validateOperationalData failed: migration pending marker present.`);
    throw new Error("Operational wipe verification failed: migration pending marker remains present.");
  }

  validateArrayStorageKey(recipeRaw, "recipe record");
  validateArrayStorageKey(bakeHistRaw, "bake history");
  validateArrayStorageKey(feedHistRaw, "feed history");
  validateArrayStorageKey(delRecipeRaw, "deleted recipe IDs");
  validateArrayStorageKey(delBakeRaw, "deleted bake IDs");
  validateArrayStorageKey(delFeedRaw, "deleted feed IDs");

  if (activeBakeCheck !== null) {
    try {
      const parsed = JSON.parse(activeBakeCheck);
      const bakesList = Array.isArray(parsed) ? parsed : [parsed];
      for (const b of bakesList) {
        if (!b) continue;
        const owner = b.userId ?? b.user_id;
        if (!owner || String(owner).trim() === "") {
          console.log(`[BL-DIAG] [StorageUtils] validateOperationalData failed: active bake missing owner.`);
          throw new Error("Operational wipe verification failed: active bake record has unknown or missing ownership metadata.");
        }
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe verification failed")) throw e;
      console.log(`[BL-DIAG] [StorageUtils] validateOperationalData failed: active bake malformed.`);
      throw new Error(`Operational wipe verification failed: active bake record is malformed and cannot be verified.`);
    }
  }

  if (activeFeedCheck !== null) {
    try {
      const parsed = JSON.parse(activeFeedCheck);
      const owner = parsed?.userId ?? parsed?.user_id;
      if (!owner || String(owner).trim() === "") {
        console.log(`[BL-DIAG] [StorageUtils] validateOperationalData failed: active feed missing owner.`);
        throw new Error("Operational wipe verification failed: active feed record has unknown or missing ownership metadata.");
      }
    } catch (e: any) {
      if (e.message?.includes("Operational wipe verification failed")) throw e;
      console.log(`[BL-DIAG] [StorageUtils] validateOperationalData failed: active feed malformed.`);
      throw new Error(`Operational wipe verification failed: active feed record is malformed and cannot be verified.`);
    }
  }
  console.log(`[BL-DIAG] [StorageUtils] validateOperationalData passed successfully.`);
}

/**
 * Clear local operational data without removing authentication credential keys.
 * Preserves records belonging to other authenticated users while purging anonymous operational records.
 * Note on Atomicity: Pre-validation guarantees that validation errors occur 0% into mutation.
 * However, because AsyncStorage operations are sequential independent calls rather than a multi-key ACID transaction,
 * a failure during the mutation sequence may leave partial changes applied.
 */
export async function clearOperationalData(currentUserId?: string | null): Promise<void> {
  console.log(`[BL-DIAG] [StorageUtils] clearOperationalData starting for currentUserId: ${currentUserId}`);
  await validateOperationalData(currentUserId);

  let recipeRaw: string | null = null;
  let bakeHistRaw: string | null = null;
  let feedHistRaw: string | null = null;
  let activeBakeCheck: string | null = null;
  let activeFeedCheck: string | null = null;

  try {
    [recipeRaw, bakeHistRaw, feedHistRaw, activeBakeCheck, activeFeedCheck] = await Promise.all([
      AsyncStorage.getItem(APP_STORAGE_KEYS.RECIPES),
      AsyncStorage.getItem(APP_STORAGE_KEYS.BAKE_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.FEED_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_BAKE),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED),
    ]);
  } catch (error: any) {
    throw new Error(`Failed to read local operational data during cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    console.log("[StorageUtils] Purging anonymous operational data while preserving other users' and unknown ownership records...");

    if (recipeRaw) {
      const recipes = safeParse<any[]>(recipeRaw, [], Array.isArray);
      const purged = recipes.filter(r => r && ((r.userId ?? r.user_id) === "anonymous" || (r.userId ?? r.user_id) === currentUserId));
      const retained = recipes.filter(r => {
        if (!r) return false;
        const owner = r.userId ?? r.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      console.log(`[BL-DIAG-ASYNC] [Storage] PURGE RECIPES: Total before=${recipes.length}, Purged=${purged.length}, Retained=${retained.length}`);
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.RECIPES, JSON.stringify(retained));
        console.log(`[BL-DIAG-ASYNC] [Storage] WRITE KEY=${APP_STORAGE_KEYS.RECIPES}, count=${retained.length}`);
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.RECIPES);
        console.log(`[BL-DIAG-ASYNC] [Storage] REMOVE KEY=${APP_STORAGE_KEYS.RECIPES}`);
      }
    }

    if (bakeHistRaw) {
      const bakes = safeParse<any[]>(bakeHistRaw, [], Array.isArray);
      const purged = bakes.filter(b => b && ((b.userId ?? b.user_id) === "anonymous" || (b.userId ?? b.user_id) === currentUserId));
      const retained = bakes.filter(b => {
        if (!b) return false;
        const owner = b.userId ?? b.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      console.log(`[BL-DIAG-ASYNC] [Storage] PURGE BAKE_HISTORY: Total before=${bakes.length}, Purged=${purged.length}, Retained=${retained.length}`);
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.BAKE_HISTORY, JSON.stringify(retained));
        console.log(`[BL-DIAG-ASYNC] [Storage] WRITE KEY=${APP_STORAGE_KEYS.BAKE_HISTORY}, count=${retained.length}`);
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.BAKE_HISTORY);
        console.log(`[BL-DIAG-ASYNC] [Storage] REMOVE KEY=${APP_STORAGE_KEYS.BAKE_HISTORY}`);
      }
    }

    if (feedHistRaw) {
      const feeds = safeParse<any[]>(feedHistRaw, [], Array.isArray);
      const purged = feeds.filter(f => f && ((f.userId ?? f.user_id) === "anonymous" || (f.userId ?? f.user_id) === currentUserId));
      const retained = feeds.filter(f => {
        if (!f) return false;
        const owner = f.userId ?? f.user_id;
        const isOtherUser = owner && owner !== "anonymous" && owner !== currentUserId;
        const isUnknown = !owner || String(owner).trim() === "";
        return isOtherUser || isUnknown;
      });
      console.log(`[BL-DIAG-ASYNC] [Storage] PURGE FEED_HISTORY: Total before=${feeds.length}, Purged=${purged.length}, Retained=${retained.length}`);
      if (retained.length > 0) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.FEED_HISTORY, JSON.stringify(retained));
        console.log(`[BL-DIAG-ASYNC] [Storage] WRITE KEY=${APP_STORAGE_KEYS.FEED_HISTORY}, count=${retained.length}`);
      } else {
        await AsyncStorage.removeItem(APP_STORAGE_KEYS.FEED_HISTORY);
        console.log(`[BL-DIAG-ASYNC] [Storage] REMOVE KEY=${APP_STORAGE_KEYS.FEED_HISTORY}`);
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
        console.log(`[BL-DIAG-ASYNC] [Storage] PURGE ACTIVE_BAKE: Total before=${bakesList.length}, Retained=${retainedBakes.length}`);
        if (retainedBakes.length > 0) {
          await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify(Array.isArray(parsed) ? retainedBakes : retainedBakes[0]));
          console.log(`[BL-DIAG-ASYNC] [Storage] WRITE KEY=${APP_STORAGE_KEYS.ACTIVE_BAKE}`);
        } else {
          await AsyncStorage.removeItem(APP_STORAGE_KEYS.ACTIVE_BAKE);
          console.log(`[BL-DIAG-ASYNC] [Storage] REMOVE KEY=${APP_STORAGE_KEYS.ACTIVE_BAKE}`);
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
          console.log(`[BL-DIAG-ASYNC] [Storage] REMOVE KEY=${APP_STORAGE_KEYS.ACTIVE_FEED}`);
        } else {
          console.log(`[BL-DIAG-ASYNC] [Storage] RETAIN KEY=${APP_STORAGE_KEYS.ACTIVE_FEED} (foreign/unknown owner)`);
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

export const QUARANTINE_KEY = (ownerId: string) => `bread_lab_quarantine_${ownerId}`;
export const UNKNOWN_QUARANTINE_KEY = "bread_lab_quarantine_unknown";

interface QuarantinedStore {
  recipes?: any[];
  bakeHistory?: any[];
  feedHistory?: any[];
  activeBakes?: any[];
  activeFeed?: any;
  deletedRecipeIds?: string[];
  deletedBakeIds?: string[];
  deletedFeedIds?: string[];
}

export async function quarantineOperationalData(departingUserId?: string | null): Promise<void> {
  console.log(`[BL-DIAG] [Quarantine] ownership-aware quarantineOperationalData starting for departingUserId: ${departingUserId}`);
  let recipeRaw: string | null = null;
  let bakeHistRaw: string | null = null;
  let feedHistRaw: string | null = null;
  let activeBakeCheck: string | null = null;
  let activeFeedCheck: string | null = null;
  let delRecipeRaw: string | null = null;
  let delBakeRaw: string | null = null;
  let delFeedRaw: string | null = null;

  try {
    [recipeRaw, bakeHistRaw, feedHistRaw, activeBakeCheck, activeFeedCheck, delRecipeRaw, delBakeRaw, delFeedRaw] = await Promise.all([
      AsyncStorage.getItem(APP_STORAGE_KEYS.RECIPES),
      AsyncStorage.getItem(APP_STORAGE_KEYS.BAKE_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.FEED_HISTORY),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_BAKE),
      AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_RECIPE_IDS),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_BAKE_IDS),
      AsyncStorage.getItem(APP_STORAGE_KEYS.DELETED_FEED_IDS),
    ]);
  } catch (error: any) {
    throw new Error(`Failed to read operational data for quarantine: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parseOrThrow = (raw: string | null, label: string): any[] => {
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`Quarantine failed: ${label} storage is malformed (expected array).`);
      }
      return parsed;
    } catch (e: any) {
      if (e.message?.includes("Quarantine failed")) throw e;
      throw new Error(`Quarantine failed: ${label} storage contains malformed JSON and cannot be parsed: ${e.message}`);
    }
  };

  const parseActiveBakeOrThrow = (raw: string | null): any[] => {
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("Active bake record must be a non-null object.");
        }
      }
      return list;
    } catch (e: any) {
      if (e.message?.includes("Active bake")) throw e;
      throw new Error(`Quarantine failed: active bake storage contains malformed JSON or invalid shape: ${e.message}`);
    }
  };

  const parseActiveFeedOrThrow = (raw: string | null): any => {
    if (raw === null || raw === undefined) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
        throw new Error("Active feed record must be a non-null object.");
      }
      return parsed;
    } catch (e: any) {
      if (e.message?.includes("Active feed")) throw e;
      throw new Error(`Quarantine failed: active feed storage contains malformed JSON or invalid shape: ${e.message}`);
    }
  };

  function validateQuarantinedStore(store: unknown, qKey: string): QuarantinedStore {
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      throw new Error(`Quarantine validation failed: bucket ${qKey} has invalid root shape (expected object).`);
    }
    const s = store as Record<string, unknown>;
    const arrayFields = ['recipes', 'bakeHistory', 'feedHistory', 'activeBakes', 'deletedRecipeIds', 'deletedBakeIds', 'deletedFeedIds'];
    for (const field of arrayFields) {
      if (s[field] !== undefined && s[field] !== null && !Array.isArray(s[field])) {
        throw new Error(`Quarantine validation failed: bucket ${qKey} field '${field}' is malformed (expected array).`);
      }
    }
    if (s.activeFeed !== undefined && s.activeFeed !== null && (typeof s.activeFeed !== "object" || Array.isArray(s.activeFeed))) {
      throw new Error(`Quarantine validation failed: bucket ${qKey} field 'activeFeed' is malformed (expected object).`);
    }
    return store as QuarantinedStore;
  }

  const recipes = parseOrThrow(recipeRaw, "recipe record");
  const bakes = parseOrThrow(bakeHistRaw, "bake history");
  const feeds = parseOrThrow(feedHistRaw, "feed history");
  const activeBakes = parseActiveBakeOrThrow(activeBakeCheck);
  const activeFeed = parseActiveFeedOrThrow(activeFeedCheck);
  const delRecipes = parseOrThrow(delRecipeRaw, "deleted recipe IDs");
  const delBakes = parseOrThrow(delBakeRaw, "deleted bake IDs");
  const delFeeds = parseOrThrow(delFeedRaw, "deleted feed IDs");

  const getOwnerKey = (item: any): string => {
    if (!item || typeof item !== "object") return "unknown";
    const owner = item.userId ?? item.user_id;
    if (!owner || String(owner).trim() === "") return "unknown";
    return String(owner).trim();
  };

  const ownerBuckets = new Map<string, QuarantinedStore>();

  const addToBucket = (owner: string, category: keyof QuarantinedStore, val: any) => {
    if (!ownerBuckets.has(owner)) ownerBuckets.set(owner, {});
    const store = ownerBuckets.get(owner)!;
    if (Array.isArray(val)) {
      const listKey = category as keyof QuarantinedStore;
      (store[listKey] as any[]) = [...((store[listKey] as any[]) || []), ...val];
    } else {
      (store as any)[category] = val;
    }
  };

  for (const r of recipes) {
    addToBucket(getOwnerKey(r), "recipes", [r]);
  }
  for (const b of bakes) {
    addToBucket(getOwnerKey(b), "bakeHistory", [b]);
  }
  for (const f of feeds) {
    addToBucket(getOwnerKey(f), "feedHistory", [f]);
  }
  for (const ab of activeBakes) {
    addToBucket(getOwnerKey(ab), "activeBakes", [ab]);
  }
  if (activeFeed) {
    addToBucket(getOwnerKey(activeFeed), "activeFeed", activeFeed);
  }

  // Tombstone ownership association (nu-1: flat tombstones lack per-entry ownership; route to unknown/inert quarantine)
  const tombstoneOwner = "unknown";
  if (delRecipes.length > 0) addToBucket(tombstoneOwner, "deletedRecipeIds", delRecipes);
  if (delBakes.length > 0) addToBucket(tombstoneOwner, "deletedBakeIds", delBakes);
  if (delFeeds.length > 0) addToBucket(tombstoneOwner, "deletedFeedIds", delFeeds);

  for (const [ownerKey, bucketStore] of ownerBuckets.entries()) {
    const qKey = ownerKey === "unknown" ? UNKNOWN_QUARANTINE_KEY : QUARANTINE_KEY(ownerKey);
    let existing: QuarantinedStore = {};
    try {
      const rawQ = await AsyncStorage.getItem(qKey);
      if (rawQ) {
        try {
          const parsedQ = JSON.parse(rawQ);
          existing = validateQuarantinedStore(parsedQ, qKey);
        } catch (parseErr: any) {
          throw new Error(`Quarantine failed: existing quarantine bucket ${qKey} is malformed or invalid: ${parseErr.message}`);
        }
      }
    } catch (readErr: any) {
      if (readErr.message?.includes("Quarantine failed")) throw readErr;
      throw new Error(`Quarantine failed: could not read existing quarantine bucket ${qKey}: ${readErr.message}`);
    }

    const mergeList = (existingList: any[] = [], newList: any[] = []) => {
      const ids = new Set(existingList.map((x: any) => typeof x === "string" ? x : x?.id).filter(Boolean));
      const added = newList.filter(x => {
        const id = typeof x === "string" ? x : x?.id;
        return !id || !ids.has(id);
      });
      return [...existingList, ...added];
    };

    const mergedQ: QuarantinedStore = {
      recipes: mergeList(existing.recipes, bucketStore.recipes),
      bakeHistory: mergeList(existing.bakeHistory, bucketStore.bakeHistory),
      feedHistory: mergeList(existing.feedHistory, bucketStore.feedHistory),
      activeBakes: mergeList(existing.activeBakes, bucketStore.activeBakes),
      activeFeed: bucketStore.activeFeed ?? existing.activeFeed,
      deletedRecipeIds: mergeList(existing.deletedRecipeIds, bucketStore.deletedRecipeIds),
      deletedBakeIds: mergeList(existing.deletedBakeIds, bucketStore.deletedBakeIds),
      deletedFeedIds: mergeList(existing.deletedFeedIds, bucketStore.deletedFeedIds),
    };

    const serializedQ = JSON.stringify(mergedQ);
    await AsyncStorage.setItem(qKey, serializedQ);

    // Issue 4.5: Robust payload round-trip verification
    let verifyParsed: any = null;
    try {
      const verifyQ = await AsyncStorage.getItem(qKey);
      if (!verifyQ) {
        throw new Error(`Quarantine verification failed: bucket ${qKey} was not persisted.`);
      }
      verifyParsed = JSON.parse(verifyQ);
    } catch (verifyErr: any) {
      throw new Error(`Quarantine verification failed for bucket ${qKey}: ${verifyErr.message}`);
    }

    if (JSON.stringify(verifyParsed) !== serializedQ) {
      throw new Error(`Quarantine verification failed: persisted payload for bucket ${qKey} does not match intended payload.`);
    }

    console.log(`[BL-DIAG] [Quarantine] Safely partitioned, quarantined, and verified records for owner=${ownerKey} under key=${qKey}`);
  }

  await AsyncStorage.multiRemove([
    APP_STORAGE_KEYS.RECIPES,
    APP_STORAGE_KEYS.BAKE_HISTORY,
    APP_STORAGE_KEYS.FEED_HISTORY,
    APP_STORAGE_KEYS.ACTIVE_BAKE,
    APP_STORAGE_KEYS.ACTIVE_FEED,
    APP_STORAGE_KEYS.DELETED_RECIPE_IDS,
    APP_STORAGE_KEYS.DELETED_BAKE_IDS,
    APP_STORAGE_KEYS.DELETED_FEED_IDS,
  ]);

  console.log(`[BL-DIAG] [Quarantine] ownership-aware quarantineOperationalData completed successfully.`);
}

export async function restoreOperationalData(incomingUserId: string): Promise<void> {
  const qKey = QUARANTINE_KEY(incomingUserId);
  console.log(`[BL-DIAG] [Quarantine] restoreOperationalData starting for incomingUserId: ${incomingUserId}`);
  try {
    const rawQ = await AsyncStorage.getItem(qKey);
    if (!rawQ) return;
    const storedQ: QuarantinedStore = JSON.parse(rawQ);

    const restoreListKey = async (storageKey: string, storedList?: any[]) => {
      if (!storedList || storedList.length === 0) return;
      const existingRaw = await AsyncStorage.getItem(storageKey);
      const existing = safeParse<any[]>(existingRaw, [], Array.isArray);
      const existingIds = new Set(existing.map((x: any) => typeof x === "string" ? x : x?.id).filter(Boolean));
      const toRestore = storedList.filter(x => {
        const id = typeof x === "string" ? x : x?.id;
        return !id || !existingIds.has(id);
      });
      if (toRestore.length > 0) {
        const merged = [...existing, ...toRestore];
        await AsyncStorage.setItem(storageKey, JSON.stringify(merged));
      }
    };

    await restoreListKey(APP_STORAGE_KEYS.RECIPES, storedQ.recipes);
    await restoreListKey(APP_STORAGE_KEYS.BAKE_HISTORY, storedQ.bakeHistory);
    await restoreListKey(APP_STORAGE_KEYS.FEED_HISTORY, storedQ.feedHistory);
    await restoreListKey(APP_STORAGE_KEYS.ACTIVE_BAKE, storedQ.activeBakes);
    await restoreListKey(APP_STORAGE_KEYS.DELETED_RECIPE_IDS, storedQ.deletedRecipeIds);
    await restoreListKey(APP_STORAGE_KEYS.DELETED_BAKE_IDS, storedQ.deletedBakeIds);
    await restoreListKey(APP_STORAGE_KEYS.DELETED_FEED_IDS, storedQ.deletedFeedIds);

    if (storedQ.activeFeed) {
      const activeFeedRaw = await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED);
      if (!activeFeedRaw) {
        await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_FEED, JSON.stringify(storedQ.activeFeed));
      }
    }

    console.log(`[BL-DIAG] [Quarantine] restoreOperationalData completed for incomingUserId: ${incomingUserId}`);
  } catch (err) {
    console.error(`[BL-DIAG] [Quarantine] restoreOperationalData failed:`, err);
    throw err;
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

/**
 * Resolves an owner-scoped storage key based on base key and owner ID.
 * Fails closed on missing or invalid owner ID (anonymous must be explicitly passed as "anonymous").
 */
export function getOwnerStorageKey(baseKey: string, ownerId?: string | null): string {
  if (!ownerId || typeof ownerId !== "string" || ownerId.trim() === "") {
    throw new Error(`Owner-scoped storage resolution failed: missing or invalid owner ID for base key ${baseKey}.`);
  }
  const cleanOwner = ownerId.trim();
  if (cleanOwner.includes("..") || cleanOwner.includes("/") || cleanOwner.includes("\\")) {
    throw new Error(`Owner-scoped storage resolution failed: owner ID contains invalid characters: ${cleanOwner}`);
  }
  if (baseKey.endsWith(`_${cleanOwner}`)) return baseKey;
  return `${baseKey}_${cleanOwner}`;
}
