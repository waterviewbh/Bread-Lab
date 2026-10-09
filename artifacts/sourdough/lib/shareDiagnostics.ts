import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { safeParse } from '@/lib/storageUtils';

export const SHARE_DIAG_LOGS_KEY = 'bread_lab_share_diag_logs_v1';
const MAX_DIAG_LOG_ENTRIES = 100;

export interface ShareDiagnosticEntry {
  timestamp: string;
  stage:
    | 'native_intent_receipt'
    | 'js_ingestion_start'
    | 'url_classification'
    | 'url_fetch_outcome'
    | 'extraction_result'
    | 'candidate_persistence_decision';
  details: {
    source?: 'native_staging' | 'transient_intent' | 'manual';
    action?: string;
    hasExtraText?: boolean;
    extraTextLength?: number;
    hasSubject?: boolean;
    subjectLength?: number;
    stagedId?: string;
    isUrlDetected?: boolean;
    detectedDomain?: string;
    httpStatus?: number;
    contentType?: string;
    payloadSizeBytes?: number;
    fetchError?: string;
    extractionStatus?: string;
    candidateCount?: number;
    rejectionReason?: string;
    persistedRecordId?: string;
    persistenceDecision?: 'saved' | 'rejected_no_candidate' | 'error';
    [key: string]: unknown;
  };
}

/**
 * Records a persistent development-only acquisition diagnostic entry in AsyncStorage.
 * GUARANTEE: Does NOT persist raw share content; prefers lengths, domains, status codes, and reasons.
 */
export async function recordShareDiagnosticLog(
  stage: ShareDiagnosticEntry['stage'],
  details: ShareDiagnosticEntry['details'],
  clockOverride?: string
): Promise<void> {
  try {
    const timestamp = clockOverride || new Date().toISOString();
    const entry: ShareDiagnosticEntry = {
      timestamp,
      stage,
      details,
    };

    const raw = await AsyncStorage.getItem(SHARE_DIAG_LOGS_KEY).catch(() => null);
    const existing = safeParse<ShareDiagnosticEntry[]>(raw, [], Array.isArray);

    existing.unshift(entry);
    while (existing.length > MAX_DIAG_LOG_ENTRIES) {
      existing.pop();
    }

    await AsyncStorage.setItem(SHARE_DIAG_LOGS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error('[shareDiagnostics] recordShareDiagnosticLog failed', e);
  }
}

/**
 * Reads all recorded share diagnostic logs from AsyncStorage.
 */
export async function loadShareDiagnosticLogs(): Promise<ShareDiagnosticEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SHARE_DIAG_LOGS_KEY);
    return safeParse<ShareDiagnosticEntry[]>(raw, [], Array.isArray);
  } catch (e) {
    console.error('[shareDiagnostics] loadShareDiagnosticLogs failed', e);
    return [];
  }
}

/**
 * Clears all share diagnostic logs from AsyncStorage.
 */
export async function clearShareDiagnosticLogs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SHARE_DIAG_LOGS_KEY);
  } catch (e) {
    console.error('[shareDiagnostics] clearShareDiagnosticLogs failed', e);
  }
}

/**
 * Flushes pending native Android diagnostic logs from SharedPreferences into AsyncStorage.
 */
export async function flushNativeDiagnosticLogs(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const { StagedShareBridgeModule } = NativeModules;
  if (!StagedShareBridgeModule || typeof StagedShareBridgeModule.getAndClearNativeDiagLogs !== 'function') {
    return;
  }

  try {
    const jsonStr: string = await StagedShareBridgeModule.getAndClearNativeDiagLogs();
    if (!jsonStr || !jsonStr.trim()) return;

    const parsedArray = JSON.parse(jsonStr);
    if (!Array.isArray(parsedArray)) return;

    for (const nativeLog of parsedArray) {
      if (!nativeLog || typeof nativeLog !== 'object') continue;
      await recordShareDiagnosticLog(
        'native_intent_receipt',
        {
          source: 'native_staging',
          action: nativeLog.action,
          hasExtraText: nativeLog.hasExtraText,
          extraTextLength: nativeLog.extraTextLength,
          hasSubject: nativeLog.hasSubject,
          subjectLength: nativeLog.subjectLength,
          stagedId: nativeLog.stagedId,
        },
        nativeLog.timestamp
      );
    }
  } catch (e) {
    console.error('[shareDiagnostics] flushNativeDiagnosticLogs failed', e);
  }
}
