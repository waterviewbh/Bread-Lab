// artifacts/sourdough/lib/transitionCoordinator.ts
//
// The one place a workspace transition (sign-in, sign-out, account switch) happens locally.
// It holds storageMutex for the whole local switch, so anything that persists device-local state
// through the same mutex (for example the Feed screen) either completes before the switch starts
// or is refused after it: a stale write can never land between two steps of the switch.
//
// Gate: the DEPARTING workspace must be clean (no pending work); the incoming workspace's own
// leftovers are handled by ordinary operation once the baker is in it.
import { storageMutex, advanceWorkspaceGeneration } from "./storageUtils";
import { UDL } from "./udl";
import { saveAuth, clearAuth } from "./auth";
import { api } from "./api";
import { hasActiveFeed } from "./activeWork";

export type CoordinatorState = "IDLE" | "TRANSITIONING" | "RECOVERY_REQUIRED";

let currentState: CoordinatorState = "IDLE";

export function getCoordinatorState(): CoordinatorState {
  return currentState;
}

export function setCoordinatorState(state: CoordinatorState): void {
  console.log(`[TransitionCoordinator] State transition: ${currentState} -> ${state}`);
  currentState = state;
}

/**
 * Thrown, before anything changes, when a transition would discard an active Feed session and the
 * caller has not confirmed that the baker was warned. This makes "warn first" impossible to skip.
 */
export class ActiveFeedNotAcknowledgedError extends Error {
  constructor() {
    super("Workspace transition refused: an active Feed session would be discarded and the baker has not been warned.");
    this.name = "ActiveFeedNotAcknowledgedError";
  }
}

export interface WorkspaceTransitionOptions {
  /** True once the baker has been shown the "finish your Feed first" warning and chose to continue. */
  activeFeedAcknowledged?: boolean;
}

/**
 * @param outgoingOwnerId  the departing workspace (null or "anonymous" = signed-out / NLA)
 * @param incomingOwnerId  the destination workspace; null = signed out (credentials are cleared and
 *                         nothing is restored)
 */
export async function executeWorkspaceTransition(
  outgoingOwnerId: string | null,
  incomingOwnerId: string | null,
  incomingToken?: string | null,
  incomingUser?: any | null,
  options: WorkspaceTransitionOptions = {}
): Promise<void> {
  return storageMutex.run(async () => {
    // Refuse before anything changes (state stays IDLE) if the baker has not been warned.
    if (!options.activeFeedAcknowledged && (await hasActiveFeed())) {
      throw new ActiveFeedNotAcknowledgedError();
    }

    setCoordinatorState("TRANSITIONING");
    advanceWorkspaceGeneration();

    try {
      // 1. Gate on the DEPARTING workspace: pending deletions or an interrupted migration block.
      await UDL.verifyReadiness(outgoingOwnerId ?? "anonymous");

      // 2. Set the outgoing workspace's data aside. Its active Feed is discarded, never parked.
      await UDL.quarantineData(outgoingOwnerId);

      // 3. Bring the incoming workspace's data in, then pivot credentials.
      if (incomingOwnerId !== null && incomingToken && incomingUser) {
        await UDL.restoreData(incomingOwnerId);
        await saveAuth(incomingToken, incomingUser);
      } else {
        await clearAuth();
      }

      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Transition to owner=${incomingOwnerId} completed successfully.`);
    } catch (error: any) {
      console.error(`[TransitionCoordinator] Transition failed, entering RECOVERY_REQUIRED state:`, error);
      setCoordinatorState("RECOVERY_REQUIRED");
      throw error;
    }
  });
}

/**
 * Clears credentials while holding the same mutex, so nothing persisting under the old identity can
 * interleave with the change. Used by failure recovery, which must not change workspace unlocked.
 */
export async function clearCredentialsExclusive(): Promise<void> {
  return storageMutex.run(() => clearAuth());
}

export async function recoverTransition(): Promise<void> {
  return storageMutex.run(async () => {
    console.log(`[TransitionCoordinator] Executing recovery protocol...`);
    try {
      await api.auth.signout().catch(() => {});
      await clearAuth().catch(() => {});
      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Recovery protocol completed, state reset to IDLE.`);
    } catch (e) {
      console.error(`[TransitionCoordinator] Recovery protocol failed:`, e);
      throw e;
    }
  });
}
