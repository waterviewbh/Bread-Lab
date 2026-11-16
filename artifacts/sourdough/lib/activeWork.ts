// artifacts/sourdough/lib/activeWork.ts
//
// Unfinished Feed and Bake work stays in its source workspace until a transition
// is verified. These helpers warn the baker before it is discarded.
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_STORAGE_KEYS, QUARANTINE_KEY, getOwnerStorageKey } from "./storageUtils";
import { NLA_SCOPE } from "./nlaWorkspace";
import { api } from "./api";
import { getDeviceId } from "./deviceId";

export const ACTIVE_FEED_TRANSITION_TITLE = "Active work in progress";
export const ACTIVE_FEED_TRANSITION_MESSAGE =
  "You have an unfinished Feed or Bake. Finish it before changing accounts if you want to keep the record. " +
  "If you continue, the unfinished work will not carry into the next workspace.";

export const ACTIVE_WORK_REMINDER_TITLE = "A note about work in progress";
export const ACTIVE_WORK_REMINDER_BODY = "You have an unfinished Bake or Feed on this device. Finish it first if you want a saved record. After a successful sign-in, unfinished work will not carry into the account.";

/** True if an active Feed session is stored on this device for the current workspace. */
export async function hasActiveFeed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED);
    return raw !== null && raw !== undefined && raw !== "";
  } catch {
    return false;
  }
}

/** Panel shown ONLY on NLA -> account transitions when active Feed or Bake work exists (agreed wording). */
export const NLA_LOCAL_WORK_TITLE = ACTIVE_WORK_REMINDER_TITLE;
export const NLA_LOCAL_WORK_PARAGRAPHS = [
  ACTIVE_WORK_REMINDER_BODY,
  "Your saved recipes, bake history, feed history, and other eligible records will be handled according to your choice below.",
] as const;

export function describeActiveNlaWork(inventory: { counts: { activeFeed: number; activeBakes: number } }): string[] {
  const { activeFeed, activeBakes } = inventory.counts;
  const kinds = [activeBakes > 0 ? (activeBakes === 1 ? "an active Bake" : `${activeBakes} active Bakes`) : null,
    activeFeed > 0 ? (activeFeed === 1 ? "an active Feed" : `${activeFeed} active Feeds`) : null].filter(Boolean);
  const subject = kinds.join(" and ");
  return [
    `You have ${subject} on this device. Finish ${activeBakes + activeFeed === 1 ? "it" : "them"} first if you want a saved record. After a successful sign-in, unfinished work will not carry into the account.`,
    NLA_LOCAL_WORK_PARAGRAPHS[1],
  ];
}

const hasStoredWork = (raw: string | null | undefined): boolean => {
  if (raw === null || raw === undefined || raw === "") return false;
  try {
    const v = JSON.parse(raw);
    if (v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  } catch {
    return true;
  }
};

/** True if the NLA workspace holds an active Feed or Bake session (either storage cabinet). */
export async function hasActiveNlaWork(): Promise<boolean> {
  try {
    const keys = [...NLA_SCOPE.activeFeed, ...NLA_SCOPE.activeBakes];
    for (const key of keys) {
      if (hasStoredWork(await AsyncStorage.getItem(key))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True if the authenticated workspace has an unfinished Feed or Bake in either storage cabinet. */
export async function hasActiveAccountWork(ownerId: string): Promise<boolean> {
  const keys = [
    APP_STORAGE_KEYS.ACTIVE_FEED,
    APP_STORAGE_KEYS.ACTIVE_BAKE,
    getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, ownerId),
  ];
  for (const key of keys) {
    if (hasStoredWork(await AsyncStorage.getItem(key))) return true;
  }
  return false;
}

/**
 * Remove only unfinished rows created on this device for the departing account.
 * Each delete is read back while the account session is still available.
 */
export async function reconcileActiveBakesForDeparture(ownerId: string): Promise<void> {
  const deviceId = await getDeviceId();
  if (!deviceId || !ownerId) throw new Error("Cannot reconcile active Bake without device and account owner");
  const seen = new Set<string>();
  while (true) {
    const row = await api.history.bakes.activeForDevice(deviceId, ownerId);
    if (!row) return;
    if (!row.inProgress || row.userId !== ownerId || row.deviceId !== deviceId || seen.has(row.id)) {
      throw new Error("Active Bake reconciliation returned an unverified or repeated row");
    }
    seen.add(row.id);
    await api.history.bakes.delete(row.id, deviceId, ownerId);
    if (!(await api.history.bakes.verifyAbsent(row.id, deviceId, ownerId))) {
      throw new Error(`Active Bake ${row.id} could not be confirmed absent after deletion`);
    }
  }
}

/**
 * Called only after remote sign-out has been independently verified. The departing
 * account's active work is then stale; foreign/unknown quarantine buckets stay intact.
 */
export async function discardVerifiedDepartingActiveWork(ownerId: string): Promise<void> {
  const bucketKey = QUARANTINE_KEY(ownerId);
  const raw = await AsyncStorage.getItem(bucketKey);
  if (raw !== null) {
    const bucket = JSON.parse(raw);
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
      throw new Error("Cannot discard active work from malformed account quarantine");
    }
    if (bucket.activeBakes !== undefined) {
      if (!Array.isArray(bucket.activeBakes)) throw new Error("Malformed active Bake quarantine");
      delete bucket.activeBakes;
      const serialized = JSON.stringify(bucket);
      await AsyncStorage.setItem(bucketKey, serialized);
      if (await AsyncStorage.getItem(bucketKey) !== serialized) {
        throw new Error("Active Bake quarantine cleanup could not be verified");
      }
    }
  }
  const scopedBakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, ownerId);
  await AsyncStorage.removeItem(scopedBakeKey);
  if (await AsyncStorage.getItem(scopedBakeKey) !== null) {
    throw new Error("Departing account's active Bake could not be confirmed removed");
  }
  for (const key of [APP_STORAGE_KEYS.ACTIVE_BAKE, APP_STORAGE_KEYS.ACTIVE_FEED]) {
    if (await AsyncStorage.getItem(key) !== null) {
      throw new Error(`Departing active work remains at ${key}`);
    }
  }
}

/** Resolves true if the baker chooses to continue, false if they go back. */
export function confirmDiscardActiveFeed(): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm(`${ACTIVE_FEED_TRANSITION_TITLE}\n\n${ACTIVE_FEED_TRANSITION_MESSAGE}`));
      return;
    }
    Alert.alert(
      ACTIVE_FEED_TRANSITION_TITLE,
      ACTIVE_FEED_TRANSITION_MESSAGE,
      [
        { text: "Go back", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

/**
 * Gate for a workspace transition: true if there is nothing to lose, or the baker has
 * chosen to continue anyway.
 */
export async function confirmActiveFeedTransition(ownerId?: string): Promise<boolean> {
  if (!(ownerId ? await hasActiveAccountWork(ownerId) : await hasActiveFeed())) return true;
  return confirmDiscardActiveFeed();
}
