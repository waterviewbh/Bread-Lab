// artifacts/sourdough/lib/activeWork.ts
//
// Active Feed work is device-local and is not carried across a workspace transition
// (sign-in / sign-out / account switch). These helpers warn the baker before that happens.
// The warning never blocks: the baker can always continue and accept losing the active session.
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_STORAGE_KEYS } from "./storageUtils";

export const ACTIVE_FEED_TRANSITION_TITLE = "Active Feed in progress";
export const ACTIVE_FEED_TRANSITION_MESSAGE =
  "You have an active Feed session. We recommend finishing it before signing in or out. " +
  "If you continue, this active session will be discarded and cannot be recovered.";

/** True if an active Feed session is stored on this device for the current workspace. */
export async function hasActiveFeed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED);
    return raw !== null && raw !== undefined && raw !== "";
  } catch {
    // The transition itself reads this key and fails closed on a read error.
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
