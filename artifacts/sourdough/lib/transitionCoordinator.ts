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
import { hasActiveAccountWork, hasActiveNlaWork, reconcileActiveBakesForDeparture, discardVerifiedDepartingActiveWork } from "./activeWork";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isNlaOwner } from "./nlaBoundary";
import { clearMigrationPending } from "./migrate";
import { hasStagedShares } from "./stagedShareBridge";
import { candidatesKeyForOwner } from "./candidateStorage";
import { RECIPES_KEY, type SavedRecipe } from "./recipeTypes";
import { getOwnerStorageKey } from "./storageUtils";
import {
  nlaSnapshotChanged,
  applyNlaPurgeLocked,
  resumePendingNlaPurgeLocked,
  NLA_PURGE_JOURNAL_KEY,
  inventoryNlaWorkspace,
  NLA_SCOPE,
  snapshotProtectedKeys,
  verifyNlaCleanliness,
  retireNlaTombstonesLocked,
  NlaPurgeVerificationError,
  validatePurgePlan,
  isAuthorizedNlaTransitionIntent,
  type PurgePlan,
  type NlaTransitionIntent,
} from "./nlaWorkspace";

export type CoordinatorState = "IDLE" | "TRANSITIONING" | "RECOVERY_REQUIRED";

let currentState: CoordinatorState = "IDLE";

const SIGNOUT_MARKER_KEY = "bread_lab_pending_account_signout_v1";
const NLA_ACTIVE_SNAPSHOT_KEY = "bread_lab_pending_nla_active_snapshot_v1";

async function stageNlaActiveSnapshot(): Promise<boolean> {
  const snapshot: Record<string, string> = {};
  for (const key of [...NLA_SCOPE.activeBakes, ...NLA_SCOPE.activeFeed]) {
    const raw = await AsyncStorage.getItem(key);
    if (raw !== null) snapshot[key] = raw;
  }
  if (Object.keys(snapshot).length === 0) return false;
  const serialized = JSON.stringify(snapshot);
  await AsyncStorage.setItem(NLA_ACTIVE_SNAPSHOT_KEY, serialized);
  if (await AsyncStorage.getItem(NLA_ACTIVE_SNAPSHOT_KEY) !== serialized) {
    throw new Error("Offline active-work snapshot could not be verified");
  }
  return true;
}

async function restoreNlaActiveSnapshot(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(NLA_ACTIVE_SNAPSHOT_KEY);
  if (raw === null) return false;
  const snapshot = JSON.parse(raw);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Offline active-work snapshot is malformed");
  }
  const allowed = new Set<string>([...NLA_SCOPE.activeBakes, ...NLA_SCOPE.activeFeed]);
  for (const [key, value] of Object.entries(snapshot)) {
    if (!allowed.has(key) || typeof value !== "string") {
      throw new Error("Offline active-work snapshot has an invalid key or value");
    }
    await AsyncStorage.setItem(key, value);
    if (await AsyncStorage.getItem(key) !== value) {
      throw new Error(`Offline active work at ${key} could not be restored`);
    }
  }
  return true;
}

async function clearNlaActiveSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(NLA_ACTIVE_SNAPSHOT_KEY);
  if (await AsyncStorage.getItem(NLA_ACTIVE_SNAPSHOT_KEY) !== null) {
    throw new Error("Offline active-work snapshot could not be cleared");
  }
}
type SignoutPhase = "prepared" | "reconciled" | "signedOut";
type SignoutMarker = { ownerId: string; phase: SignoutPhase };

async function readSignoutMarker(): Promise<SignoutMarker | null> {
  const raw = await AsyncStorage.getItem(SIGNOUT_MARKER_KEY);
  if (raw === null) return null;
  const marker = JSON.parse(raw);
  if (!marker || typeof marker.ownerId !== "string" || !marker.ownerId.trim() ||
      !["prepared", "reconciled", "signedOut"].includes(marker.phase)) {
    throw new Error("Pending account sign-out marker is malformed");
  }
  return marker;
}

async function writeSignoutMarker(marker: SignoutMarker): Promise<void> {
  const raw = JSON.stringify(marker);
  await AsyncStorage.setItem(SIGNOUT_MARKER_KEY, raw);
  if (await AsyncStorage.getItem(SIGNOUT_MARKER_KEY) !== raw) {
    throw new Error("Pending account sign-out marker could not be verified");
  }
}

async function clearSignoutMarker(): Promise<void> {
  await AsyncStorage.removeItem(SIGNOUT_MARKER_KEY);
  if (await AsyncStorage.getItem(SIGNOUT_MARKER_KEY) !== null) {
    throw new Error("Pending account sign-out marker could not be cleared");
  }
}

export function getCoordinatorState(): CoordinatorState {
  return currentState;
}

export async function hasPendingSignoutRecovery(): Promise<boolean> {
  return (await readSignoutMarker()) !== null;
}

export async function hasPendingNlaActiveRecovery(): Promise<boolean> {
  return (await AsyncStorage.getItem(NLA_ACTIVE_SNAPSHOT_KEY)) !== null;
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
    super("Workspace transition refused: active Feed or Bake work would be discarded and the baker has not been warned.");
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

export interface PreparedIncomingWorkspace {
  ownerId: string;
  token: string;
  user: any;
  nlaDisposition: NlaDisposition;
}

export interface WorkspaceTransitionOptions {
  /** True once the baker has been shown the warning about active work and chose to continue. */
  activeFeedAcknowledged?: boolean;
  /** NLA departures only: the verified purge (import) or full purge (discard) to run instead of setting data aside. */
  nlaDisposition?: NlaDisposition;
  /** Explicit NLA choice captured before authentication; allows preflight before the destination identity exists. */
  nlaTransitionIntent?: NlaTransitionIntent;
  /** NLA -> Auth only: run authentication/import after preflight while the coordinator owns the transition lock. */
  prepareIncoming?: () => Promise<PreparedIncomingWorkspace>;
  /** Outgoing sync after readiness passes, while the transition mutex is held, but before local identity mutation. */
  beforeTransition?: () => Promise<void>;
  /** Sign-out transitions only: close and independently verify the remote session before returning to IDLE. */
  closeRemoteSession?: boolean;
}

/** Request remote sign-out, then require an independent, explicit no-session result. */
async function closeAndVerifyRemoteSession(): Promise<void> {
  try {
    await api.auth.signout();
  } catch (error) {
    // The request result is not authoritative; a fresh session lookup decides whether closure completed.
    console.warn(`[TransitionCoordinator] Remote sign-out request failed; verifying session independently:`, error);
  }

  const sessionRes = await api.auth.getSession();
  const data = sessionRes?.data;
  if (!data || typeof data !== "object" || !Object.prototype.hasOwnProperty.call(data, "session")) {
    throw new Error("Remote session lookup returned no verifiable session state.");
  }
  if (sessionRes?.error) {
    throw new Error(`Remote session lookup returned an error: ${sessionRes.error.message ?? String(sessionRes.error)}`);
  }
  if (data.session !== null) {
    throw new Error("Remote session could not be confirmed closed.");
  }
}

/**
 * @param outgoingOwnerId  the departing workspace (null or "anonymous" = signed-out / NLA)
 * @param incomingOwnerId  the destination workspace; null = signed out, unless prepareIncoming is
 *                         supplied for a coordinator-owned NLA -> Auth transition
 */
export async function executeWorkspaceTransition(
  outgoingOwnerId: string | null,
  incomingOwnerId: string | null,
  incomingToken?: string | null,
  incomingUser?: any | null,
  options: WorkspaceTransitionOptions = {}
): Promise<void> {
  return storageMutex.run(async () => {
    if (currentState === "RECOVERY_REQUIRED" || await readSignoutMarker() ||
        await AsyncStorage.getItem(NLA_ACTIVE_SNAPSHOT_KEY) !== null) {
      setCoordinatorState("RECOVERY_REQUIRED");
      throw new Error("Transition refused: recovery required due to an incomplete previous transition. Please reconcile session first.");
    }

    const outgoingIsNla = outgoingOwnerId === null || isNlaOwner(outgoingOwnerId);
    if (!outgoingIsNla && incomingOwnerId !== null) {
      throw new Error("Workspace transition refused: sign out to the offline workspace before entering another account.");
    }
    const deferredNlaLogin = outgoingIsNla && incomingOwnerId === null && !!options.prepareIncoming;
    const intent = options.nlaTransitionIntent;
    let disposition = outgoingIsNla ? options.nlaDisposition : undefined;

    if (options.prepareIncoming && !deferredNlaLogin) {
      throw new Error("Workspace transition refused: deferred authentication is only valid for NLA -> Auth.");
    }
    if (deferredNlaLogin && (!intent || !isAuthorizedNlaTransitionIntent(intent))) {
      throw new Error("Workspace transition refused: an explicit, valid NLA Import or Discard choice is required.");
    }
    if (intent && (!deferredNlaLogin || !isAuthorizedNlaTransitionIntent(intent))) {
      throw new Error("Workspace transition refused: invalid NLA transition authorization.");
    }

    const hasIncomingAuth = incomingOwnerId !== null || deferredNlaLogin;
    if (outgoingIsNla && hasIncomingAuth && !disposition && !intent) {
      throw new Error("Workspace transition refused: an explicit Import or Discard choice is required for the offline workspace.");
    }
    if (disposition) {
      validatePurgePlan(disposition.plan, disposition.mode);
    }

    const snapshotRaw = disposition?.snapshotRaw ?? intent?.snapshotRaw;
    // Refuse before anything changes (state stays IDLE) unless the complete offline inventory still matches the baker's choice.
    if (snapshotRaw && await nlaSnapshotChanged(snapshotRaw)) {
      throw new NlaWorkspaceChangedError();
    }

    // Refuse before anything changes if the baker has not been warned about active work that would be discarded.
    if (!options.activeFeedAcknowledged) {
      const hasWork = outgoingIsNla ? await hasActiveNlaWork() : await hasActiveAccountWork(outgoingOwnerId!);
      if (hasWork) throw new ActiveFeedNotAcknowledgedError();
    }

    if (outgoingOwnerId && !outgoingIsNla) {
      // The coordinator already holds storageMutex. Read the two canonical stores
      // directly so another promotion cannot commit between this check and sign-out.
      const [candidateRaw, recipeRaw] = await Promise.all([
        AsyncStorage.getItem(candidatesKeyForOwner(outgoingOwnerId)),
        AsyncStorage.getItem(getOwnerStorageKey(RECIPES_KEY, outgoingOwnerId)),
      ]);
      const candidates: unknown = JSON.parse(candidateRaw ?? "[]");
      const recipes: unknown = JSON.parse(recipeRaw ?? "[]");
      if (!Array.isArray(candidates) || !Array.isArray(recipes)) {
        throw new Error("Couldn’t check for unfinished promotions. You’re still signed in.");
      }
      const candidateIds = new Set(candidates.map(candidate => candidate?.id));
      const pending = (recipes as SavedRecipe[]).find(recipe =>
        recipe?.userId === outgoingOwnerId &&
        recipe.provenance?.sourceCandidateId &&
        candidateIds.has(recipe.provenance.sourceCandidateId)
      );
      if (pending) {
        throw new Error(`Open Candidates and retry promoting “${pending.name}”. Once promotion succeeds, you can sign out.`);
      }
    }

    // This is the authoritative gate. For deferred NLA login it runs before api.auth.identify,
    // import, purge, or any credential change, while this coordinator owns the storage mutex.
    await UDL.verifyReadiness(outgoingOwnerId ?? "anonymous", {
      discardActiveBake: !!disposition || deferredNlaLogin,
      nlaDisposition: disposition,
      nlaTransitionIntent: intent,
    });

    // Native staging is outside AsyncStorage. Never cross an identity boundary with an unconsumed share.
    if (await hasStagedShares(outgoingOwnerId ?? "anonymous")) {
      throw new Error("Workspace transition refused: a shared recipe is still pending. Open Candidates to save it, then try again.");
    }

    // Outgoing synchronization can write remotely and locally, so run it only after preflight and under this
    // same mutex. If it fails, identity and workspace state have not yet changed and the caller can retry.
    await options.beforeTransition?.();
    // Outgoing sync may take time; a newly staged share still belongs to this workspace.
    if (await hasStagedShares(outgoingOwnerId ?? "anonymous")) {
      throw new Error("Workspace transition refused: a shared recipe is still pending. Open Candidates to save it, then try again.");
    }

    const verifiedAccountSignout = !outgoingIsNla && incomingOwnerId === null && !!options.closeRemoteSession;
    if (verifiedAccountSignout) {
      // Establish retry ownership before changing session or workspace state.
      await writeSignoutMarker({ ownerId: outgoingOwnerId!, phase: "prepared" });
    }

    setCoordinatorState("TRANSITIONING");
    advanceWorkspaceGeneration();
    let stagedNlaActive = false;

    try {
      if (deferredNlaLogin) {
        const prepared = await options.prepareIncoming!();
        if (!prepared.ownerId || prepared.token !== prepared.ownerId || prepared.user?.id !== prepared.ownerId) {
          throw new Error("NLA transition refused: destination token, profile, and workspace owner do not agree.");
        }
        if (!prepared.nlaDisposition || prepared.nlaDisposition.mode !== intent!.mode) {
          throw new Error("NLA transition refused: the prepared operation does not match the baker's explicit choice.");
        }
        const sameSnapshot = (a: Record<string, string | null>, b: Record<string, string | null>) => {
          const keysA = Object.keys(a).sort();
          const keysB = Object.keys(b).sort();
          return keysA.length === keysB.length && keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
        };
        if (!sameSnapshot(prepared.nlaDisposition.snapshotRaw, intent!.snapshotRaw)
          || await nlaSnapshotChanged(intent!.snapshotRaw)) {
          throw new NlaWorkspaceChangedError();
        }

        incomingOwnerId = prepared.ownerId;
        incomingToken = prepared.token;
        incomingUser = prepared.user;
        disposition = prepared.nlaDisposition;
        validatePurgePlan(disposition.plan, disposition.mode);

        // Import sets a pending marker while it writes. Re-run readiness with the now verified plan
        // before source cleanup or local credential activation.
        await UDL.verifyReadiness("anonymous", {
          discardActiveBake: true,
          nlaDisposition: disposition,
        });
      }

      // A share may arrive while destination authentication or import is in progress.
      if (await hasStagedShares(outgoingOwnerId ?? "anonymous")) {
        // A verified import may have set this marker, but source cleanup has not begun. Retain the
        // NLA records and allow another idempotent import after session recovery and ingestion.
        if (deferredNlaLogin && disposition?.mode === "import") await clearMigrationPending();
        throw new Error("Workspace transition refused: a shared recipe is still pending. Open Candidates to save it, then try again.");
      }

      if (disposition) stagedNlaActive = await stageNlaActiveSnapshot();

      if (disposition) {
        // The baker's explicit choice supersedes an "import in progress" marker, and NLA has no remote
        // copies, so its pending-deletion queues are simply retired (no network).
        await clearMigrationPending();
        await retireNlaTombstonesLocked();
      }

      if (verifiedAccountSignout) {
        const ownerId = outgoingOwnerId!;
        await reconcileActiveBakesForDeparture(ownerId);
        await writeSignoutMarker({ ownerId, phase: "reconciled" });
        await closeAndVerifyRemoteSession();
        await writeSignoutMarker({ ownerId, phase: "signedOut" });
      }

      // Leave the outgoing workspace.
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
        // Set the outgoing workspace's finished data aside after remote departure is verified.
        await UDL.quarantineData(outgoingOwnerId);
        if (verifiedAccountSignout) {
          await discardVerifiedDepartingActiveWork(outgoingOwnerId!);
        }
      }

      // Bring the incoming workspace's data in, then pivot credentials.
      if (incomingOwnerId !== null && incomingToken && incomingUser) {
        await UDL.restoreData(incomingOwnerId);
        await saveAuth(incomingToken, incomingUser);
      } else {
        await clearAuth();
      }

      // The marker is removed last; an interrupted cleanup can be retried after process restart.
      if (verifiedAccountSignout) await clearSignoutMarker();
      if (stagedNlaActive) await clearNlaActiveSnapshot();

      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Transition to owner=${incomingOwnerId} completed successfully.`);
    } catch (error: any) {
      if (stagedNlaActive) {
        try {
          await restoreNlaActiveSnapshot();
          await clearAuth();
          // An interrupted purge journal would delete the restored active work on restart.
          // Keep the snapshot until recovery finishes the journal, then restore once more.
          if (await AsyncStorage.getItem(NLA_PURGE_JOURNAL_KEY) === null) {
            await clearNlaActiveSnapshot();
          }
        } catch (restoreError) {
          console.error("[TransitionCoordinator] Offline active-work rollback remains pending:", restoreError);
        }
      }
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

export interface TransitionRecoveryResult {
  /** True only after getSession independently confirms that the remote session is absent. */
  remoteSignout: boolean;
  /** True only after clearAuth verifies both local credential keys are absent. */
  localClear: boolean;
}

export async function recoverTransition(): Promise<TransitionRecoveryResult> {
  return storageMutex.run(async () => {
    setCoordinatorState("RECOVERY_REQUIRED");
    console.log(`[TransitionCoordinator] Executing recovery protocol...`);
    let remoteSignout = false;
    let localClear = false;
    const pending = await readSignoutMarker();

    if (pending) {
      try {
        let phase = pending.phase;
        const sessionRes = await api.auth.getSession();
        if (sessionRes?.error || !sessionRes?.data ||
            !Object.prototype.hasOwnProperty.call(sessionRes.data, "session")) {
          throw new Error("Recovery session state could not be verified");
        }
        const session = sessionRes.data.session;
        if (session?.user?.id && session.user.id !== pending.ownerId) {
          throw new Error("Recovery session owner differs from the departing account");
        }
        if (phase === "signedOut" && session !== null) {
          throw new Error("Recovered sign-out marker conflicts with an active remote session");
        }
        if (phase !== "signedOut") {
          if (phase === "prepared") {
            if (!session || session.user?.id !== pending.ownerId) {
              throw new Error("Cannot reconcile unfinished remote Bakes without the departing account session");
            }
            await reconcileActiveBakesForDeparture(pending.ownerId);
            await writeSignoutMarker({ ...pending, phase: "reconciled" });
            phase = "reconciled";
          }
          if (phase === "reconciled") {
            await closeAndVerifyRemoteSession();
            await writeSignoutMarker({ ...pending, phase: "signedOut" });
          }
        }
        remoteSignout = true;
        await UDL.quarantineData(pending.ownerId);
        await discardVerifiedDepartingActiveWork(pending.ownerId);
        await clearAuth();
        await clearSignoutMarker();
        localClear = true;
      } catch (error) {
        console.error(`[TransitionCoordinator] Account sign-out recovery remains incomplete:`, error);
      }
    } else if (await hasPendingNlaActiveRecovery()) {
      try {
        await closeAndVerifyRemoteSession();
        remoteSignout = true;
        // Finish the already authorized, journaled finished-record purge, then restore
        // the original unfinished work into NLA before clearing credentials.
        await resumePendingNlaPurgeLocked();
        await restoreNlaActiveSnapshot();
        await clearAuth();
        await clearNlaActiveSnapshot();
        localClear = true;
      } catch (error) {
        console.error("[TransitionCoordinator] Offline active-work recovery remains incomplete:", error);
      }
    } else {
      try {
        await closeAndVerifyRemoteSession();
        remoteSignout = true;
      } catch (error) {
        console.error(`[TransitionCoordinator] Recovery could not confirm remote session closure:`, error);
      }
      try {
        await clearAuth();
        localClear = true;
      } catch (error) {
        console.error(`[TransitionCoordinator] Recovery could not verify local credential removal:`, error);
      }
    }

    if (remoteSignout && localClear && !(await readSignoutMarker()) &&
        !(await hasPendingNlaActiveRecovery())) {
      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Recovery verified local and remote cleanup; state reset to IDLE.`);
    } else {
      setCoordinatorState("RECOVERY_REQUIRED");
      console.warn(`[TransitionCoordinator] Recovery remains required (remoteSignout=${remoteSignout}, localClear=${localClear}).`);
    }

    return { remoteSignout, localClear };
  });
}
