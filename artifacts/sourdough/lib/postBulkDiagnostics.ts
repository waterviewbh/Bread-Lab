// lib/postBulkDiagnostics.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeParse } from "@/lib/storageUtils";

export const POST_BULK_DIAG_LOGS_KEY = "bread_lab_post_bulk_diag_logs_v1";
const MAX_DIAG_LOG_ENTRIES = 100;

export type PostBulkDiagnosticEventType =
  | 'TARGET_INITIALIZED'
  | 'PROOF_PLAN_CHANGED'
  | 'TARGET_RECALCULATED'
  | 'TARGET_BELOW_OBSERVED';

export interface PostBulkDiagnosticEvent {
  eventId: string;
  eventType: PostBulkDiagnosticEventType;
  timestamp: string; // ISO 8601
  bakeId?: string;
  trigger: 'initialization' | 'explicit_plan_change' | 'reading_entry' | 'settings_update';
  initialDoughTempF: number;
  latestObservedDoughTempF: number;
  estimatedShapingTempF: number;
  declaredProofMode: string;
  declaredProofTempF: number | null;
  baselineTargetRiseFraction: number;
  carryoverProgress: number;
  volumetricYieldMultiplier: number;
  recommendedTargetRiseFraction: number;
  previousLatchedTargetRiseFraction: number | null;
  newLatchedTargetRiseFraction: number;
  previousTargetVolumeMl: number | null;
  newTargetVolumeMl: number;
  currentObservedRiseFraction: number;
  projectedTargetAt: number | null;
  reasonCode: string;
}

/**
 * Records a development/diagnostic entry in AsyncStorage for post-bulk target calculations.
 * GUARANTEE: Wrapped in try/catch to ensure diagnostic storage failures can NEVER interrupt or crash a bake.
 */
export async function recordPostBulkDiagnosticLog(
  event: Omit<PostBulkDiagnosticEvent, 'eventId' | 'timestamp'> & { timestamp?: string }
): Promise<void> {
  try {
    const timestamp = event.timestamp || new Date().toISOString();
    const eventId = `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullEntry: PostBulkDiagnosticEvent = {
      ...event,
      eventId,
      timestamp,
    };

    const raw = await AsyncStorage.getItem(POST_BULK_DIAG_LOGS_KEY).catch(() => null);
    const existing = safeParse<PostBulkDiagnosticEvent[]>(raw, [], Array.isArray);

    // Duplicate event suppression: avoid recording identical state transitions within 500ms
    if (existing.length > 0) {
      const last = existing[0];
      const timeDiffMs = new Date(timestamp).getTime() - new Date(last.timestamp).getTime();
      if (
        timeDiffMs < 500 &&
        last.eventType === fullEntry.eventType &&
        last.reasonCode === fullEntry.reasonCode &&
        last.newLatchedTargetRiseFraction === fullEntry.newLatchedTargetRiseFraction &&
        last.declaredProofMode === fullEntry.declaredProofMode &&
        last.declaredProofTempF === fullEntry.declaredProofTempF
      ) {
        return; // Suppress duplicate render-driven event
      }
    }

    existing.unshift(fullEntry);
    while (existing.length > MAX_DIAG_LOG_ENTRIES) {
      existing.pop();
    }

    await AsyncStorage.setItem(POST_BULK_DIAG_LOGS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error("[postBulkDiagnostics] recordPostBulkDiagnosticLog failed silently", e);
  }
}

/**
 * Reads all recorded post-bulk diagnostic logs from AsyncStorage.
 */
export async function loadPostBulkDiagnosticLogs(): Promise<PostBulkDiagnosticEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(POST_BULK_DIAG_LOGS_KEY);
    return safeParse<PostBulkDiagnosticEvent[]>(raw, [], Array.isArray);
  } catch (e) {
    console.error("[postBulkDiagnostics] loadPostBulkDiagnosticLogs failed", e);
    return [];
  }
}

/**
 * Clears all post-bulk diagnostic logs from AsyncStorage.
 */
export async function clearPostBulkDiagnosticLogs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(POST_BULK_DIAG_LOGS_KEY);
  } catch (e) {
    console.error("[postBulkDiagnostics] clearPostBulkDiagnosticLogs failed", e);
  }
}
