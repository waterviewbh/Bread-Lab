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
import { hasActiveFeed, hasActiveNlaWork } from "./activeWork";
import { isNlaOwner } from "./nlaBoundary";
import { clearMigrationPending } from "./migrate";
import {
  nlaSnapshotChanged,
  applyNlaPurgeLocked,
  inventoryNlaWorkspace,
  snapshotProtectedKeys,
  verifyNlaCleanliness,
  retireNlaTombstonesLocked,
  NlaPurgeVerificationError,
  validatePurgePlan,
  type PurgePlan,
} from "./nlaWorkspace";

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

/** Thrown, before anything changes, when the offline workspace changed after the baker made their choice. */
export class NlaWorkspaceChangedError extends Error {
  constructor() {
    super("Your offline workspace changed while this was in progress, so nothing was changed. Please try again.");
    this.name = "NlaWorkspaceChangedError";
  }
}

/**
 * What to do with the NLA workspace when leaving it for an account. The plan was built from a snapshot; if the
 * workspace no longer matches that snapshot the transition refuses (nothing is deleted that was not seen).
 */
export interface NlaDisposition {
  mode: "import" | "discard";
  plan: PurgePlan;
  snapshotRaw: Record<string, string | null>;
}

export interface WorkspaceTransitionOptions {
  /** True once the baker has been shown the warning about active work and chose to continue. */
  activeFeedAcknowledged?: boolean;
  /** NLA departures only: the verified purge (import) or full purge (discard) to run instead of setting data aside. */
  nlaDisposition?: NlaDisposition;
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
    if (currentState === "RECOVERY_REQUIRED") {
      throw new Error("Transition refused: recovery required due to an incomplete previous transition. Please reconcile session first.");
    }

    const outgoingIsNla = outgoingOwnerId === null || isNlaOwner(outgoingOwnerId);
    const disposition = outgoingIsNla ? options.nlaDisposition : undefined;

    if (outgoingIsNla && incomingOwnerId !== null && !disposition) {
      throw new Error("Workspace transition refused: an explicit Import or Discard choice is required for the offline workspace.");
    }
    if (disposition) {
      validatePurgePlan(disposition.plan, disposition.mode);
    }

    // Refuse before anything changes (state stays IDLE) unless the complete offline inventory still matches the baker's choice.
    if (disposition && (await nlaSnapshotChanged(disposition.snapshotRaw))) {
      throw new NlaWorkspaceChangedError();
    }

    // Refuse before anything changes if the baker has not been warned about active work that would be discarded.
    if (!options.activeFeedAcknowledged) {
      const hasWork = outgoingIsNla ? await hasActiveNlaWork() : await hasActiveFeed();
      if (hasWork) throw new ActiveFeedNotAcknowledgedError();
    }

    // Mandatory preflight readiness check for all transitions (including NLA disposition) before any mutations.
    await UDL.verifyReadiness(outgoingOwnerId ?? "anonymous", { discardActiveBake: !!disposition, nlaDisposition: disposition });

    setCoordinatorState("TRANSITIONING");
    advanceWorkspaceGeneration();

    try {
      if (disposition) {
        // The baker's explicit choice supersedes an "import in progress" marker, and NLA has no remote
        // copies, so its pending-deletion queues are simply retired (no network).
        await clearMigrationPending();
        await retireNlaTombstonesLocked();
      }

      // 2. Leave the outgoing workspace.
      if (disposition) {
        // NLA is cleaned up, not parked: journaled, repeatable purge of exactly the planned records, then a
        // full verification that the NLA scope is clean and nothing outside it changed.
        const protectedBefore = await snapshotProtectedKeys();
        const before = await inventoryNlaWorkspace();
        await applyNlaPurgeLocked(disposition.plan);
        const problems = await verifyNlaCleanliness(before, disposition.plan, protectedBefore);
        if (problems.length) throw new NlaPurgeVerificationError(problems);
        // Leftovers (foreign-owned, conflicts, unreadable) deliberately stay where they are: they were reported,
        // and a generic set-aside here would park unresolved NLA records where a later purge could delete them.
      } else {
        // Set the outgoing workspace's data aside. Its active Feed is discarded, never parked.
        await UDL.quarantineData(outgoingOwnerId);
      }

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
      let sessionActive = false;
      try {
        const sessionRes = await api.auth.getSession();
        sessionActive = !!sessionRes?.data?.session;
      } catch {
        sessionActive = false;
      }
      if (sessionActive) {
        throw new Error("Recovery failed: remote session could not be confirmed closed.");
      }
      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Recovery protocol completed, state reset to IDLE.`);
    } catch (e) {
      console.error(`[TransitionCoordinator] Recovery protocol failed:`, e);
      setCoordinatorState("RECOVERY_REQUIRED");
      throw e;
    }
  });
}
