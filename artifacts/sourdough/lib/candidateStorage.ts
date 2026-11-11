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
import { storageMutex, AsyncMutex } from "@/lib/storageUtils";
import {
  getWorkspaceIdentity,
  assertWorkspaceOperationCurrent,
  type WorkspaceOperationContext,
} from "@/lib/recipeStorage";
import { isNlaOwner } from "@/lib/nlaBoundary";

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
 * Candidate storage failed (stored data unreadable, a verification mismatch, ...). Distinct from
 * WorkspaceIdentityError (identity uncertain) and StaleWorkspaceError (workspace changed) so the three are never
 * conflated, and never reported as "no Candidates".
 */
export class CandidateStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateStorageError";
  }
}

/** The destination of an explicit legacy adoption did not read back exactly as written; the legacy source was kept. */
export class LegacyCandidateVerificationError extends CandidateStorageError {
  constructor(message: string) {
    super(message);
    this.name = "LegacyCandidateVerificationError";
  }
}

/**
 * The Candidate namespace of a workspace owner. The owner comes from a captured, validated WorkspaceOperationContext
 * (auth.ts stays authoritative); "anonymous" is the NLA owner (both credentials absent), never a fallback.
 */
export function candidatesKeyForOwner(owner: string): string {
  return isNlaOwner(owner) ? ANONYMOUS_CANDIDATES_KEY : `bread_lab_candidates_v1_${owner}`;
}

/**
 * Resolves the AsyncStorage key for the current workspace's Candidates (a convenience for callers that only need the
 * key; Candidate operations themselves capture a context and derive the key from it). An uncertain identity rejects.
 */
export async function getCandidatesKey(): Promise<string> {
  const { owner } = await getWorkspaceIdentity();
  return candidatesKeyForOwner(owner);
}

/** Every operation captures ONE workspace context up front (or is handed one) and keeps it for its whole lifecycle. */
const capture = (context?: WorkspaceOperationContext): Promise<WorkspaceOperationContext> =>
  context ? Promise.resolve(context) : getWorkspaceIdentity();

/**
 * The single serialized, ownership-checked storage boundary. Takes the existing storageMutex, verifies the captured
 * context (generation AND owner) while holding it, then runs the read/write against the key derived from that
 * context. A stale context rejects; it is never retried against another workspace. The mutex is never held across
 * extraction or network work: callers do that before calling this.
 */
async function withWorkspaceLock<T>(
  context: WorkspaceOperationContext,
  fn: (key: string) => Promise<T>
): Promise<T> {
  return storageMutex.run(async () => {
    await assertWorkspaceOperationCurrent(context);
    return fn(candidatesKeyForOwner(context.owner));
  });
}

/** Strict read: absent is empty; unreadable stored data is an ERROR (never an empty list that a write could replace). */
function parseCandidates(raw: string | null, key: string): CandidateRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CandidateStorageError(`Stored Candidates under ${key} are unreadable (invalid JSON); nothing was changed.`);
  }
  if (!Array.isArray(parsed)) {
    throw new CandidateStorageError(`Stored Candidates under ${key} are not a list; nothing was changed.`);
  }
  return parsed as CandidateRecord[];
}

export interface LegacyCandidateReport {
  present: boolean;
  /** Number of records, or null when the stored value cannot be read as a list. */
  count: number | null;
  readable: boolean;
}

/**
 * Reports the old global Candidate key WITHOUT touching it. Its records carry no owner, so nothing assigns them to
 * NLA or to an account automatically; they stay where they are until a baker-approved disposition
 * (adoptLegacyCandidates) is wired to a UI. (The NLA transition inventory also counts this key.)
 */
export async function inspectLegacyCandidates(context?: WorkspaceOperationContext): Promise<LegacyCandidateReport> {
  const ctx = await capture(context);
  return withWorkspaceLock(ctx, async () => {
    const raw = await AsyncStorage.getItem(LEGACY_GLOBAL_CANDIDATES_KEY);
    if (!raw) return { present: false, count: 0, readable: true };
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? { present: true, count: parsed.length, readable: true } : { present: true, count: null, readable: false };
    } catch {
      return { present: true, count: null, readable: false };
    }
  });
}

/**
 * EXPLICIT disposition of the legacy global Candidates into the CURRENT workspace's namespace. Never called
 * automatically. Serialized and ownership-checked like every other mutation; the legacy source is removed only after
 * the destination has been written AND read back to contain every legacy record exactly. Any failure leaves the
 * legacy source untouched and throws (storage error, unreadable data, conflicting id, or verification mismatch).
 */
export async function adoptLegacyCandidates(
  context?: WorkspaceOperationContext
): Promise<{ moved: number; alreadyPresent: number }> {
  const ctx = await capture(context);
  return withWorkspaceLock(ctx, async (destKey) => {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_GLOBAL_CANDIDATES_KEY);
    if (!legacyRaw) return { moved: 0, alreadyPresent: 0 };
    const legacy = parseCandidates(legacyRaw, LEGACY_GLOBAL_CANDIDATES_KEY);
    const existing = parseCandidates(await AsyncStorage.getItem(destKey), destKey);

    const byId = new Map(existing.map((c) => [c.id, c]));
    const toAdd: CandidateRecord[] = [];
    let alreadyPresent = 0;
    for (const c of legacy) {
      const have = byId.get(c.id);
      if (!have) {
        toAdd.push(c);
      } else if (JSON.stringify(have) === JSON.stringify(c)) {
        alreadyPresent++;
      } else {
        throw new CandidateStorageError(`Legacy Candidate ${c.id} conflicts with a different Candidate that has the same id; nothing was changed.`);
      }
    }

    if (toAdd.length > 0) {
      await AsyncStorage.setItem(destKey, JSON.stringify([...existing, ...toAdd]));
      const back = parseCandidates(await AsyncStorage.getItem(destKey), destKey);
      const backById = new Map(back.map((c) => [c.id, c]));
      for (const c of legacy) {
        const got = backById.get(c.id);
        if (!got || JSON.stringify(got) !== JSON.stringify(c)) {
          throw new LegacyCandidateVerificationError(`Legacy Candidate ${c.id} did not read back from ${destKey}; the legacy source was kept.`);
        }
      }
    }

    await AsyncStorage.removeItem(LEGACY_GLOBAL_CANDIDATES_KEY);
    if ((await AsyncStorage.getItem(LEGACY_GLOBAL_CANDIDATES_KEY)) !== null) {
      throw new LegacyCandidateVerificationError("The legacy Candidate key could not be removed after a verified copy.");
    }
    return { moved: toAdd.length, alreadyPresent };
  });
}

/**
 * Ingests any pending native staged shares into the captured workspace.
 *
 * KNOWN LIMIT (native contract, deliberately not worked around here): the native bridge only offers the destructive
 * getAndClearStagedShares(). Once it returns, the staged items exist only in memory, so a crash, or a workspace change
 * during the (possibly networked) extraction below, cannot put them back. What this function guarantees is the part JS
 * controls: identity is captured and verified IMMEDIATELY BEFORE staging is consumed (an uncertain identity or stale
 * context leaves staging untouched), extraction runs without any lock, and every write re-verifies the captured
 * context under storageMutex, so a share is never saved to a different workspace. If the workspace changes after
 * consumption the remaining shares are reported lost, loudly, not misfiled. Closing this needs a native
 * peek/acknowledge contract: peek returns the items without clearing them, and an explicit acknowledge(ids) clears
 * only what was durably saved.
 */
export async function ingestStagedNativeShares(context?: WorkspaceOperationContext): Promise<void> {
  return ingestionMutex.run(async () => {
    if (AppState.currentState !== "active") {
      return;
    }

    const ctx = await capture(context);
    // Verify right before the destructive read: identity uncertain / workspace changed => staging stays untouched.
    await assertWorkspaceOperationCurrent(ctx);
    await flushNativeDiagnosticLogs();

    const stagedItems = await getAndClearStagedShares();
    if (!stagedItems || stagedItems.length === 0) return;

    await recordShareDiagnosticLog("js_ingestion_start", {
      source: "native_staging",
      candidateCount: stagedItems.length,
    });

    let saved = 0;
    try {
      for (const item of stagedItems) {
        if (!item.rawContent || !item.rawContent.trim()) continue;

        const trimmedInput = item.rawContent.trim();
        const isUrl = /^(https?:\/\/[^\s]+)/i.test(trimmedInput);

        // Slow extraction / network work: no lock is held here.
        let result: ExtractionResult;
        try {
          result = isUrl
            ? await fetchAndExtractRecipeFromUrl(trimmedInput)
            : extractRecipeFromText(trimmedInput);
        } catch (e: any) {
          console.error("[candidateStorage] ingestStagedNativeShares extraction failed", e);
          return;
        }

        if (
          result.status === "single_candidate" ||
          result.status === "multiple_candidates"
        ) {
          await saveCandidate(result, item.sharedAt, 'share', ctx);
          saved++;
        }
      }
    } catch (e) {
      // Identity / stale-workspace / storage failures are NOT swallowed: they propagate, and the loss is reported.
      console.error(
        `[candidateStorage] ${stagedItems.length} staged share(s) were consumed but only ${saved} could be saved; the rest are lost (native staging has no acknowledge step).`,
        e
      );
      throw e;
    }
  });
}

/**
 * Reads all Candidate records for the captured workspace. Any failure (identity, stale workspace, unreadable stored
 * data, storage error) rejects; none is turned into an empty list.
 */
export async function loadCandidates(context?: WorkspaceOperationContext): Promise<CandidateRecord[]> {
  const ctx = await capture(context);
  await ingestStagedNativeShares(ctx);

  return withWorkspaceLock(ctx, async (key) => {
    const candidates = parseCandidates(await AsyncStorage.getItem(key), key);
    return candidates.sort((a, b) => {
      const timeA = new Date(a.sharedAt).getTime();
      const timeB = new Date(b.sharedAt).getTime();
      return timeB - timeA;
    });
  });
}

/**
 * Saves a new Candidate record locally for the captured workspace.
 */
export async function saveCandidate(
  extractionResult: ExtractionResult,
  clockOverride?: string | number,
  acquisitionSource: 'share' | 'paste' = 'paste',
  context?: WorkspaceOperationContext
): Promise<CandidateRecord> {
  const ctx = await capture(context);
  const sharedAt = clockOverride
    ? new Date(clockOverride).toISOString()
    : new Date().toISOString();

  const record: CandidateRecord = {
    id: generateUuid(),
    sharedAt,
    extractionResult,
    acquisitionSource,
  };

  return withWorkspaceLock(ctx, async (key) => {
    const existing = parseCandidates(await AsyncStorage.getItem(key), key);
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
  newExtractionResult: ExtractionResult,
  context?: WorkspaceOperationContext
): Promise<void> {
  const ctx = await capture(context);
  return withWorkspaceLock(ctx, async (key) => {
    const existing = parseCandidates(await AsyncStorage.getItem(key), key);
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
export async function removeCandidate(id: string, context?: WorkspaceOperationContext): Promise<void> {
  const ctx = await capture(context);
  return withWorkspaceLock(ctx, async (key) => {
    const existing = parseCandidates(await AsyncStorage.getItem(key), key);
    if (!existing.some((c) => c.id === id)) return;
    await AsyncStorage.setItem(key, JSON.stringify(existing.filter((c) => c.id !== id)));
  });
}

/**
 * Clears all Candidate records for the captured workspace.
 */
export async function clearCandidates(context?: WorkspaceOperationContext): Promise<void> {
  const ctx = await capture(context);
  return withWorkspaceLock(ctx, async (key) => {
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
