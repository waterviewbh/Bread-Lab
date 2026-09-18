import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_STORAGE_KEYS } from "./storageUtils";

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Orchestrates local AsyncStorage schema migrations.
 * Ensures legacy data shapes are transformed to current requirements
 * without data loss.
 */
export async function runSchemaMigrations(): Promise<void> {
  try {
    const storedVersionRaw = await AsyncStorage.getItem(APP_STORAGE_KEYS.SCHEMA_VERSION);
    const version = storedVersionRaw ? parseInt(storedVersionRaw, 10) : 1;

    if (version < 2) {
      await migrateToV2();
    }

    await AsyncStorage.setItem(APP_STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION.toString());
  } catch (error) {
    console.error("[Migration] Schema migration failed", error);
  }
}

/**
 * Migration from v1 -> v2
 * - Moves 'bread_lab_bake_v1' (single object) to 'bread_lab_bake_v2' (array).
 * - Ensures all bake history entries have a 'status' and 'savedAt' field.
 */
async function migrateToV2(): Promise<void> {
  console.log("[Migration] Migrating to Schema V2...");

  // 1. Migrate Active Bake (v1 was likely a single object)
  const legacyBakeRaw = await AsyncStorage.getItem("bread_lab_bake_v1");
  if (legacyBakeRaw) {
    try {
      const parsed = JSON.parse(legacyBakeRaw);
      const bakesArray = Array.isArray(parsed) ? parsed : [parsed];
      await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify(bakesArray));
      await AsyncStorage.removeItem("bread_lab_bake_v1");
    } catch (e) {
      console.warn("[Migration] Failed to migrate legacy active bake", e);
    }
  }

  // 2. Normalize History
  const historyRaw = await AsyncStorage.getItem(APP_STORAGE_KEYS.BAKE_HISTORY);
  if (historyRaw) {
    try {
      const history = JSON.parse(historyRaw);
      if (Array.isArray(history)) {
        const normalized = history.map(item => ({
          ...item,
          status: item.status || "completed",
          savedAt: item.savedAt || item.startedAt || Date.now(),
        }));
        await AsyncStorage.setItem(APP_STORAGE_KEYS.BAKE_HISTORY, JSON.stringify(normalized));
      }
    } catch (e) {
        console.warn("[Migration] Failed to normalize bake history", e);
    }
  }
}
