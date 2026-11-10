// artifacts/sourdough/lib/udl.ts
// Unified Data Lifecycle (UDL) Contract implementation
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  APP_STORAGE_KEYS,
  validateOperationalData,
  quarantineOperationalData,
  restoreOperationalData,
  safeParse,
} from "./storageUtils";

export namespace UDL {
  export function validateOwnership(record: any, expectedOwnerId: string): boolean {
    if (!record || typeof record !== "object") return false;
    const owner = record.userId ?? record.user_id;
    if (!owner || String(owner).trim() === "") {
      return false; // Reject ownerless / unknown records
    }
    const cleanOwner = String(owner).trim();
    const cleanExpected = expectedOwnerId.trim();
    return cleanOwner === cleanExpected || (cleanExpected === "anonymous" && cleanOwner === "anonymous");
  }

  export async function inspectPendingItems(): Promise<{ hasPending: boolean; details: string[] }> {
    const details: string[] = [];
    try {
      const migrationPending = await AsyncStorage.getItem(APP_STORAGE_KEYS.MIGRATION_PENDING);
      if (migrationPending === "1") {
        details.push("Migration pending marker is present.");
      }
    } catch (e: any) {
      details.push(f`Failed to inspect pending items: ${e?.message ?? String(e)}`);
    }
    return {
      hasPending: details.length > 0,
      details,
    };
  }

  export async function verifyReadiness(ownerId: string, options: { discardActiveBake?: boolean } = {}): Promise<void> {
    await validateOperationalData(ownerId, { discardActiveFeed: true, discardActiveBake: options.discardActiveBake });
    const pending = await inspectPendingItems();
    if (pending.hasPending) {
      throw new Error(`UDL readiness verification failed: pending items detected (${pending.details.join(", ")}).`);
    }
  }

  export async function quarantineData(departingOwnerId?: string | null): Promise<void> {
    await quarantineOperationalData(departingOwnerId);
  }

  export async function restoreData(incomingOwnerId: string): Promise<void> {
    await restoreOperationalData(incomingOwnerId);
  }
}
