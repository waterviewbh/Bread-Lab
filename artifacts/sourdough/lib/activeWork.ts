// artifacts/sourdough/lib/activeWork.ts
//
// Active Feed work is device-local and is not carried across a workspace transition
// (sign-in / sign-out / account switch). These helpers warn the baker before that happens.
// The warning never blocks: the baker can always continue and accept losing the active session.
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_STORAGE_KEYS } from "./storageUtils";
import { NLA_SCOPE } from "./nlaWorkspace";

export const ACTIVE_FEED_TRANSITION_TITLE = "Active Feed in progress";
export const ACTIVE_FEED_TRANSITION_MESSAGE =
  "You have an active Feed session. We recommend finishing it before signing in or out. " +
  "If you continue, this active session will be discarded and cannot be recovered.";

export const ACTIVE_WORK_REMINDER_TITLE = "A note about work in progress";
export const ACTIVE_WORK_REMINDER_BODY = "You have an active Bake or Feed running on this device; you may want to finish it before continuing. Active work isn't included in the import and will be lost when you sign in to a remote account.";

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
        { text: "Continue", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

/**
 * Gate for a workspace transition: true if there is nothing to lose, or the baker has
 * chosen to continue anyway.
 */
export async function confirmActiveFeedTransition(): Promise<boolean> {
  if (!(await hasActiveFeed())) return true;
  return confirmDiscardActiveFeed();
}
