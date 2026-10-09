import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { extractRecipeFromText, ExtractionResult } from "@/lib/recipeExtractor";
import { fetchAndExtractRecipeFromUrl } from "@/lib/webAcquisition";
import { getAndClearStagedShares } from "@/lib/stagedShareBridge";
import {
  recordShareDiagnosticLog,
  flushNativeDiagnosticLogs,
} from "@/lib/shareDiagnostics";
import { generateUuid } from "@/lib/recipeImport";
import { safeParse, storageMutex, AsyncMutex } from "@/lib/storageUtils";
import { getStoredUser } from "@/lib/auth";

export const LEGACY_GLOBAL_CANDIDATES_KEY = "bread_lab_candidates_v1";
export const ANONYMOUS_CANDIDATES_KEY = "bread_lab_candidates_v1_anonymous";

export interface CandidateRecord {
  id: string;
  sharedAt: string; // ISO 8601 string
  extractionResult: ExtractionResult;
  acquisitionSource?: 'share' | 'paste';
}

export const ingestionMutex = new AsyncMutex();

/**
 * Resolves the appropriate AsyncStorage key for candidate records based on active user identity.
 * Authenticated users use bread_lab_candidates_v1_<user-id>.
 * Unauthenticated / local sessions use bread_lab_candidates_v1_anonymous.
 */
export async function getCandidatesKey(): Promise<string> {
  try {
    const user = await getStoredUser();
    if (user && user.id) {
      return `bread_lab_candidates_v1_${user.id}`;
    }
  } catch (_e) {}
  return ANONYMOUS_CANDIDATES_KEY;
}

/**
 * Performs a one-time conservative migration of legacy global candidates into the isolated anonymous/local bucket.
 * This ensures pre-existing device-local candidates never cause cross-account leaks for authenticated users.
 */
async function migrateLegacyCandidatesIfNeeded(): Promise<void> {
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_GLOBAL_CANDIDATES_KEY).catch(() => null);
    if (!legacyRaw) return;

    const legacyCandidates = safeParse<CandidateRecord[]>(legacyRaw, [], Array.isArray);
    if (legacyCandidates.length > 0) {
      const anonRaw = await AsyncStorage.getItem(ANONYMOUS_CANDIDATES_KEY).catch(() => null);
      const anonCandidates = safeParse<CandidateRecord[]>(anonRaw, [], Array.isArray);

      const existingIds = new Set(anonCandidates.map((c) => c.id));
      const merged = [...anonCandidates];
      for (const c of legacyCandidates) {
        if (!existingIds.has(c.id)) {
          merged.push(c);
        }
      }

      await AsyncStorage.setItem(ANONYMOUS_CANDIDATES_KEY, JSON.stringify(merged));
    }

    await AsyncStorage.removeItem(LEGACY_GLOBAL_CANDIDATES_KEY);
  } catch (e) {
    console.error("[candidateStorage] legacy migration failed", e);
  }
}

/**
 * Ingests any pending native staged shares from SharedPreferences,
 * running them through the recipe extraction pipeline into AsyncStorage.
 */
export async function ingestStagedNativeShares(): Promise<void> {
  return ingestionMutex.run(async () => {
    if (AppState.currentState !== "active") {
      return;
    }

    try {
      await migrateLegacyCandidatesIfNeeded();
      await flushNativeDiagnosticLogs();

      const stagedItems = await getAndClearStagedShares();
      if (!stagedItems || stagedItems.length === 0) return;

      await recordShareDiagnosticLog("js_ingestion_start", {
        source: "native_staging",
        candidateCount: stagedItems.length,
      });

      for (const item of stagedItems) {
        if (!item.rawContent || !item.rawContent.trim()) continue;

        const trimmedInput = item.rawContent.trim();
        const isUrl = /^(https?:\/\/[^\s]+)/i.test(trimmedInput);

        let detectedDomain: string | undefined;
        if (isUrl) {
          try {
            detectedDomain = new URL(trimmedInput).hostname;
          } catch (_e) {}
        }

        let result: ExtractionResult;
        if (isUrl) {
          result = await fetchAndExtractRecipeFromUrl(trimmedInput);
        } else {
          result = extractRecipeFromText(trimmedInput);
        }

        if (
          result.status === "single_candidate" ||
          result.status === "multiple_candidates"
        ) {
          await saveCandidate(result, item.sharedAt, 'share');
        }
      }
    } catch (e: any) {
      console.error("[candidateStorage] ingestStagedNativeShares failed", e);
    }
  });
}

/**
 * Reads all Candidate records from local storage for the active account.
 */
export async function loadCandidates(): Promise<CandidateRecord[]> {
  try {
    await migrateLegacyCandidatesIfNeeded();
    await ingestStagedNativeShares();

    const key = await getCandidatesKey();
    const raw = await AsyncStorage.getItem(key);
    const candidates = safeParse<CandidateRecord[]>(raw, [], Array.isArray);

    return candidates.sort((a, b) => {
      const timeA = new Date(a.sharedAt).getTime();
      const timeB = new Date(b.sharedAt).getTime();
      return timeB - timeA;
    });
  } catch (e) {
    console.error("[candidateStorage] loadCandidates failed", e);
    return [];
  }
}

/**
 * Saves a new Candidate record locally in AsyncStorage for the active account.
 */
export async function saveCandidate(
  extractionResult: ExtractionResult,
  clockOverride?: string | number,
  acquisitionSource: 'share' | 'paste' = 'paste'
): Promise<CandidateRecord> {
  await migrateLegacyCandidatesIfNeeded();
  const sharedAt = clockOverride
    ? new Date(clockOverride).toISOString()
    : new Date().toISOString();

  const record: CandidateRecord = {
    id: generateUuid(),
    sharedAt,
    extractionResult,
    acquisitionSource,
  };

  const key = await getCandidatesKey();
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    const existing = safeParse<CandidateRecord[]>(raw, [], Array.isArray);

    existing.unshift(record);
    await AsyncStorage.setItem(key, JSON.stringify(existing));
    return record;
  });
}

/**
 * Updates an existing Candidate record's extraction result (for draft edits in review workbench).
 */
export async function updateCandidateExtraction(
  id: string,
  newExtractionResult: ExtractionResult
): Promise<void> {
  await migrateLegacyCandidatesIfNeeded();
  const key = await getCandidatesKey();
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    if (!raw) return;
    const existing = safeParse<CandidateRecord[]>(raw, [], Array.isArray);
    const target = existing.find((c) => c.id === id);
    if (target) {
      target.extractionResult = newExtractionResult;
      await AsyncStorage.setItem(key, JSON.stringify(existing));
    }
  });
}

/**
 * Removes a Candidate record from local storage by ID.
 */
export async function removeCandidate(id: string): Promise<void> {
  await migrateLegacyCandidatesIfNeeded();
  const key = await getCandidatesKey();
  return storageMutex.run(async () => {
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    if (!raw) return;
    const existing = safeParse<CandidateRecord[]>(raw, [], Array.isArray);
    const filtered = existing.filter((c) => c.id !== id);
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
  });
}

/**
 * Clears all Candidate records from local storage for the active account.
 */
export async function clearCandidates(): Promise<void> {
  const key = await getCandidatesKey();
  return storageMutex.run(async () => {
    await AsyncStorage.removeItem(key);
  });
}

/**
 * Formats a sharedAt timestamp or CandidateRecord for UI cards.
 * Distinguishes shared vs pasted based on authoritative acquisitionSource.
 */
export function formatCandidateSharedAt(
  recordOrIso: CandidateRecord | string,
  nowClock?: Date
): string {
  let sharedAtIso = "";
  let acquisitionSource: 'share' | 'paste' | undefined = undefined;

  if (typeof recordOrIso === "string") {
    sharedAtIso = recordOrIso;
  } else if (recordOrIso && typeof recordOrIso === "object") {
    sharedAtIso = recordOrIso.sharedAt;
    acquisitionSource = recordOrIso.acquisitionSource;
    if (!acquisitionSource && recordOrIso.extractionResult) {
      const res = recordOrIso.extractionResult;
      if ('sourceUrl' in res && res.sourceUrl) {
        acquisitionSource = 'share';
      } else {
        acquisitionSource = 'paste';
      }
    }
  }

  if (!sharedAtIso) return "";
  const date = new Date(sharedAtIso);
  if (isNaN(date.getTime())) return "";

  const now = nowClock || new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const prefix = acquisitionSource === 'share' ? "Shared" : "Pasted";

  if (isToday) {
    return `${prefix} ${timeStr}`;
  }

  const monthStr = date.toLocaleDateString("en-US", { month: "short" });
  const dayNum = date.getDate();

  return `${prefix} ${monthStr} ${dayNum}, ${timeStr}`;
}
