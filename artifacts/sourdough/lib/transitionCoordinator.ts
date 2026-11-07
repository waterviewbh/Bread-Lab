// artifacts/sourdough/lib/transitionCoordinator.ts
import { storageMutex, advanceWorkspaceGeneration } from "./storageUtils";
import { UDL } from "./udl";
import { saveAuth, clearAuth } from "./auth";
import { api } from "./api";

export type CoordinatorState = "IDLE" | "TRANSITIONING" | "RECOVERY_REQUIRED";

let currentState: CoordinatorState = "IDLE";

export function getCoordinatorState(): CoordinatorState {
  return currentState;
}

export function setCoordinatorState(state: CoordinatorState): void {
  console.log(`[TransitionCoordinator] State transition: ${currentState} -> ${state}`);
  currentState = state;
}

export async function executeWorkspaceTransition(
  outgoingOwnerId: string | null,
  incomingOwnerId: string,
  incomingToken?: string | null,
  incomingUser?: any | null
): Promise<void> {
  return storageMutex.run(async () => {
    setCoordinatorState("TRANSITIONING");
    advanceWorkspaceGeneration();

    try {
      // 1. UDL Readiness & Pending-Item Inspection
      await UDL.verifyReadiness(incomingOwnerId);

      // 2. Quarantine Outgoing Workspace Data
      await UDL.quarantineData(outgoingOwnerId);

      // 3. Credential / Session Pivot
      if (incomingToken && incomingUser) {
        await saveAuth(incomingToken, incomingUser);
      } else {
        await clearAuth();
      }

      // 4. Restore Incoming Workspace Data
      await UDL.restoreData(incomingOwnerId);

      // 5. Post-Restore Integrity Verification & Activation
      await UDL.verifyReadiness(incomingOwnerId);

      setCoordinatorState("IDLE");
      console.log(`[TransitionCoordinator] Transition to owner=${incomingOwnerId} completed successfully.`);
    } catch (error: any) {
      console.error(`[TransitionCoordinator] Transition failed, entering RECOVERY_REQUIRED state:`, error);
      setCoordinatorState("RECOVERY_REQUIRED");
      throw error;
    }
  });
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
