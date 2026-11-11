// artifacts/sourdough/lib/nlaImport.ts
//
// "Import and Proceed": move the baker's offline (NLA) workspace into their account, VERIFY it, and only
// then hand back a purge plan. Nothing here deletes anything; the purge happens later, under the transition
// lock, and only for ids this module has verified.
//
//   plan -> upload -> read-back -> exact id-set reconciliation + ownership + critical fields
//        -> candidate drafts re-homed (local, never uploaded, never promoted) -> verified purge plan
//
// On ANY failure: report.ok === false, purgePlan === null, and the baker stays in NLA with all original data
// intact. Retrying is idempotent (the import ledger keeps destination ids stable; candidate re-homing treats
// identical drafts as already imported).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, packBakeOutcome } from "./api";
import {
  migrateLocalDataToAccount,
  setMigrationPending,
  clearMigrationPending,
  generateSecureUUID,
  type UploadRecord,
  type MigrationResult,
} from "./migrate";
import {
  inventoryNlaWorkspace,
  resumePendingNlaPurge,
  buildPurgePlan,
  stableStringify,
  type NlaInventory,
  type PurgePlan,
  type EligibleRecord,
  type UnresolvedItem,
  type VerifiedImportIds,
} from "./nlaWorkspace";
import { storageMutex } from "./storageUtils";

export type ImportStage = "plan" | "upload" | "verify" | "candidates";

export interface ImportFailure {
  stage: ImportStage;
  kind?: "recipe" | "bake" | "feed" | "draft";
  /** Destination id for upload/verify problems, source id for plan problems. */
  id?: string;
  reason: string;
}

export interface ImportReport {
  ok: boolean;
  planned: { recipes: number; bakes: number; feeds: number; drafts: number };
  uploaded: { recipes: number; bakes: number; feeds: number };
  verified: { recipes: number; bakes: number; feeds: number; drafts: number };
  /** Eligible-by-ownership records that cannot be imported (kept on the device, reported). */
  cannotImport: Array<{ type: string; id: string; reason: string }>;
  /** Conflicts / foreign / malformed / unreadable items left exactly where they are. */
  unresolved: UnresolvedItem[];
  draftsAlreadyImported: number;
  draftsRenamed: Array<{ oldId: string; newId: string }>;
  failures: ImportFailure[];
}

export interface ImportOutcome {
  report: ImportReport;
  inventory: NlaInventory;
  /** Present only when the whole import verified; pass it to the transition. */
  purgePlan: PurgePlan | null;
}

const emptyReport = (): ImportReport => ({
  ok: false,
  planned: { recipes: 0, bakes: 0, feeds: 0, drafts: 0 },
  uploaded: { recipes: 0, bakes: 0, feeds: 0 },
  verified: { recipes: 0, bakes: 0, feeds: 0, drafts: 0 },
  cannotImport: [],
  unresolved: [],
  draftsAlreadyImported: 0,
  draftsRenamed: [],
  failures: [],
});

// ───────────────────────── read-back reconciliation ─────────────────────────

const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const sameJson = (a: unknown, b: unknown) => stableStringify(norm(a)) === stableStringify(norm(b));
const sameNum = (a: unknown, b: unknown) => {
  const x = a === null || a === undefined ? null : Number(a);
  const y = b === null || b === undefined ? null : Number(b);
  return x === y;
};
const sameVal = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Critical persisted fields that must match what was sent. Returns the names of any that differ. */
export function compareCriticalFields(kind: "recipe" | "bake" | "feed", payload: any, row: Record<string, any>, ownerId: string): string[] {
  const bad: string[] = [];
  const check = (name: string, ok: boolean) => { if (!ok) bad.push(name); };

  check("user_id", row.user_id === ownerId);

  if (kind === "recipe") {
    check("name", sameVal(row.name, payload.name));
    check("overview", sameVal(row.overview, payload.overview));
    check("yield_value", sameNum(row.yield_value, payload.yield_value));
    check("parent_recipe_id", sameVal(row.parent_recipe_id, payload.parentRecipeId));
    check("recipe_data", sameJson(row.recipe_data, payload));
  } else if (kind === "bake") {
    check("recipe_name", sameVal(row.recipe_name, payload.recipeName));
    check("recipe_id", sameVal(row.recipe_id, payload.recipeId));
    check("saved_at", sameNum(row.saved_at, payload.savedAt));
    check("started_at", sameNum(row.started_at, payload.startedAt));
    check("completed_at", sameNum(row.completed_at, payload.completedAt));
    check("status", sameVal(row.status, payload.status));
    check("notes", sameVal(row.notes, payload.notes));
    check("in_progress", (row.in_progress ?? false) === (payload.inProgress ?? true));
    check("outcome", sameJson(row.outcome, packBakeOutcome(payload.outcome, payload.estimatorState, payload.bulkCheckInHistory)));
    const sent: any[] = Array.isArray(payload.phases) ? payload.phases : [];
    const stored: any[] = Array.isArray(row.phases) ? row.phases : [];
    let phasesOk = sent.length === stored.length;
    for (let i = 0; phasesOk && i < sent.length; i++) {
      phasesOk =
        sameVal(stored[i]?.key, sent[i]?.key) &&
        sameNum(stored[i]?.startedAt, sent[i]?.startedAt) &&
        sameNum(stored[i]?.completedAt, sent[i]?.completedAt) &&
        (stored[i]?.readings ?? []).length === (sent[i]?.readings ?? []).length;
    }
    check("phases", phasesOk);
  } else {
    check("saved_at", sameNum(row.saved_at, payload.savedAt));
    check("started_at", sameNum(row.started_at, payload.startedAt));
    if (payload.updatedAt !== null && payload.updatedAt !== undefined) check("updated_at", sameNum(row.updated_at, payload.updatedAt));
    check("in_progress", (row.in_progress ?? false) === false);
    check("data", sameJson(row.data, payload.data));
  }
  return bad;
}

/**
 * Exact reconciliation of what was sent against what is persisted:
 *  - every expected destination id is present (no missing),
 *  - no id appears twice (no duplicates),
 *  - no row that was not requested (no extras),
 *  - every row is owned by the destination account (no foreign-owned),
 *  - every critical field matches.
 */
export function reconcileRows(
  kind: "recipe" | "bake" | "feed",
  expected: UploadRecord[],
  rows: Array<Record<string, any>>,
  ownerId: string
): ImportFailure[] {
  const failures: ImportFailure[] = [];
  const expectedById = new Map(expected.map((u) => [u.destinationId, u]));
  const seen = new Map<string, Array<Record<string, any>>>();
  for (const row of rows) {
    const list = seen.get(row.id) ?? [];
    list.push(row);
    seen.set(row.id, list);
  }
  for (const [id] of expectedById) {
    if (!seen.has(id)) failures.push({ stage: "verify", kind, id, reason: "missing after upload" });
  }
  for (const [id, list] of seen.entries()) {
    if (!expectedById.has(id)) {
      failures.push({ stage: "verify", kind, id, reason: "unexpected record returned" });
      continue;
    }
    if (list.length > 1) {
      failures.push({ stage: "verify", kind, id, reason: "duplicate rows returned" });
      continue;
    }
    const row = list[0];
    if (row.user_id !== ownerId) {
      failures.push({ stage: "verify", kind, id, reason: row.user_id ? "owned by a different account" : "stored without an owner" });
      continue;
    }
    const bad = compareCriticalFields(kind, expectedById.get(id)!.payload, row, ownerId);
    if (bad.length) failures.push({ stage: "verify", kind, id, reason: `stored values differ: ${bad.join(", ")}` });
  }
  return failures;
}

// ───────────────────────── candidate drafts (interim preservation; lifecycle belongs to CLI-5) ─────────────────────────

export const candidatesKeyFor = (ownerId: string) => `bread_lab_candidates_v1_${ownerId}`;

export interface RehomeResult {
  ok: boolean;
  alreadyImported: number;
  copied: number;
  renamed: Array<{ oldId: string; newId: string }>;
  failures: string[];
  /** Source (NLA) ids whose destination copy was read back and matches exactly. */
  verifiedSourceIds: string[];
}

/**
 * Copies NLA candidate drafts into the destination account's candidate key. They are NOT promoted to recipes and
 * NOT uploaded. Identical id+content => already imported; same id with different content => a new id plus an explicit
 * conflict report. The destination is read back and must equal (existing drafts + this import's drafts) exactly.
 */
export async function rehomeCandidates(ownerId: string, candidates: EligibleRecord[]): Promise<RehomeResult> {
  const result: RehomeResult = { ok: false, alreadyImported: 0, copied: 0, renamed: [], failures: [], verifiedSourceIds: [] };
  if (candidates.length === 0) return { ...result, ok: true };
  const key = candidatesKeyFor(ownerId);

  return storageMutex.run(async () => {
    let existing: any[] = [];
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw !== null && raw !== undefined) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("destination drafts are not a list");
        existing = parsed;
      }
    } catch (e) {
      result.failures.push(`Cannot read the account's existing drafts: ${e instanceof Error ? e.message : String(e)}`);
      return result;
    }

    const existingById = new Map<string, any>(existing.map((c) => [c?.id, c]));
    const additions: any[] = [];
    const expectedBySource = new Map<string, any>(); // source id -> the record that must exist at the destination
    for (const src of candidates) {
      const rec = src.record;
      const clash = existingById.get(rec.id);
      if (clash && stableStringify(clash) === stableStringify(rec)) {
        result.alreadyImported++;
        expectedBySource.set(src.id, clash);
      } else if (clash) {
        const newId = generateSecureUUID();
        const copy = { ...rec, id: newId };
        additions.push(copy);
        expectedBySource.set(src.id, copy);
        result.renamed.push({ oldId: rec.id, newId });
      } else {
        additions.push(rec);
        expectedBySource.set(src.id, rec);
        result.copied++;
      }
    }

    try {
      if (additions.length) await AsyncStorage.setItem(key, JSON.stringify([...existing, ...additions]));
      const rawBack = await AsyncStorage.getItem(key);
      const back = rawBack ? JSON.parse(rawBack) : [];
      if (!Array.isArray(back)) throw new Error("read-back is not a list");
      const backById = new Map<string, any>(back.map((c: any) => [c?.id, c]));
      // Exact id-set equality: existing + additions, nothing more, nothing less.
      const expectedIds = new Set([...existing.map((c) => c?.id), ...additions.map((c) => c.id)]);
      if (back.length !== expectedIds.size || [...expectedIds].some((i) => !backById.has(i))) {
        result.failures.push("Draft read-back did not match the expected set of drafts.");
        return result;
      }
      for (const [sourceId, expectedRec] of expectedBySource.entries()) {
        const got = backById.get(expectedRec.id);
        if (got && stableStringify(got) === stableStringify(expectedRec)) result.verifiedSourceIds.push(sourceId);
        else result.failures.push(`Draft ${sourceId} did not read back identically.`);
      }
    } catch (e) {
      result.failures.push(`Could not save drafts to the account: ${e instanceof Error ? e.message : String(e)}`);
      return result;
    }
    result.ok = result.failures.length === 0;
    return result;
  });
}

// ───────────────────────── orchestration ─────────────────────────

const recipeImportable = (r: any) => typeof r?.name === "string" && r.name.trim() !== "";

export async function importNlaWorkspace(token: string): Promise<ImportOutcome> {
  const report = emptyReport();

  // An interrupted earlier cleanup is finished first so this import sees a consistent device.
  try {
    await resumePendingNlaPurge();
  } catch (e) {
    report.failures.push({ stage: "plan", reason: `An earlier cleanup could not be finished: ${e instanceof Error ? e.message : String(e)}` });
    return { report, inventory: await inventoryNlaWorkspace(), purgePlan: null };
  }

  const inventory = await inventoryNlaWorkspace();
  report.unresolved = inventory.unresolved;
  if (!inventory.readable) {
    report.failures.push({ stage: "plan", reason: "Some data on this device could not be read, so nothing was imported." });
    return { report, inventory, purgePlan: null };
  }

  // Plan: what can be imported, and what cannot (kept and reported, never silently skipped).
  const recipes = inventory.eligible.recipes.filter((r) => {
    if (recipeImportable(r.record)) return true;
    report.cannotImport.push({ type: "recipe", id: r.id, reason: "has no name" });
    return false;
  });
  const bakes = inventory.eligible.bakeHistory;
  const feeds = inventory.eligible.feedHistory;
  report.planned = { recipes: recipes.length, bakes: bakes.length, feeds: feeds.length, drafts: inventory.eligible.candidates.length };

  let migrationOk = false;
  try {
    await setMigrationPending();
    let result;
    try {
      result = await migrateLocalDataToAccount(token, {
        explicitNlaImport: {
          recipes: recipes.map((r) => r.record),
          bakeHistory: bakes.map((b) => b.record),
          feedHistory: feeds.map((f) => f.record),
        },
      });
    } catch (e) {
      report.failures.push({ stage: "upload", reason: e instanceof Error ? e.message : String(e) });
      return { report, inventory, purgePlan: null };
    }

    const uploads: UploadRecord[] = result.uploads ?? [];
    report.uploaded = {
      recipes: uploads.filter((u) => u.kind === "recipe" && u.ok).length,
      bakes: uploads.filter((u) => u.kind === "bake" && u.ok).length,
      feeds: uploads.filter((u) => u.kind === "feed" && u.ok).length,
    };
    for (const u of uploads.filter((x) => !x.ok)) {
      report.failures.push({ stage: "upload", kind: u.kind === "recipe" ? "recipe" : u.kind, id: u.destinationId, reason: u.error ?? "upload failed" });
    }
    // Counts must agree exactly: nothing silently skipped, nothing unaccounted for.
    const expectedUploads = recipes.length + bakes.length + feeds.length;
    if (uploads.length !== expectedUploads) {
      report.failures.push({ stage: "upload", reason: `Expected ${expectedUploads} uploads but the engine reported ${uploads.length}.` });
    }
    if (result.recipes.unresolved + result.bakes.unresolved + result.feed.unresolved > 0) {
      report.failures.push({ stage: "upload", reason: "Some records were neither saved nor reported as failed." });
    }
    if (report.failures.length) return { report, inventory, purgePlan: null };

    // Read-back + exact reconciliation, by kind. A failed batch throws and fails the import (no partial result).
    const verifiedLocal = { recipes: [] as string[], bakeHistory: [] as string[], feedHistory: [] as string[] };
    try {
      for (const [kind, apiKind, bucket] of [
        ["recipe", "recipes", "recipes"],
        ["bake", "bakes", "bakeHistory"],
        ["feed", "feed", "feedHistory"],
      ] as const) {
        const sent = uploads.filter((u) => u.kind === kind && u.ok);
        if (sent.length === 0) continue;
        const { rows } = await api.fetchRowsByIds(apiKind, sent.map((u) => u.destinationId), token);
        const failures = reconcileRows(kind, sent, rows, token);
        const failedIds = new Set(failures.map((f) => f.id));
        report.failures.push(...failures);
        for (const u of sent) {
          if (!failedIds.has(u.destinationId)) {
            verifiedLocal[bucket].push(u.localId);
            report.verified[bucket === "recipes" ? "recipes" : bucket === "bakeHistory" ? "bakes" : "feeds"]++;
          }
        }
      }
    } catch (e) {
      report.failures.push({ stage: "verify", reason: `Could not read your records back to confirm them: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (report.failures.length) return { report, inventory, purgePlan: null };

    // Candidate drafts: preserved as drafts under the destination account (local only).
    const rehome = await rehomeCandidates(token, inventory.eligible.candidates);
    report.draftsAlreadyImported = rehome.alreadyImported;
    report.draftsRenamed = rehome.renamed;
    report.verified.drafts = rehome.verifiedSourceIds.length;
    for (const reason of rehome.failures) report.failures.push({ stage: "candidates", kind: "draft", reason });
    if (!rehome.ok || rehome.verifiedSourceIds.length !== inventory.eligible.candidates.length) {
      if (!report.failures.length) report.failures.push({ stage: "candidates", kind: "draft", reason: "Not every draft could be confirmed." });
      return { report, inventory, purgePlan: null };
    }

    const verified: VerifiedImportIds = {
      recipes: verifiedLocal.recipes,
      bakeHistory: verifiedLocal.bakeHistory,
      feedHistory: verifiedLocal.feedHistory,
      candidates: rehome.verifiedSourceIds,
    };
    migrationOk = true;
    report.ok = true;
    return { report, inventory, purgePlan: buildPurgePlan(inventory, "import", verified) };
  } finally {
    // A failed attempt must not leave the "import in progress" marker behind: the baker is still in NLA and
    // may retry (idempotent) or choose Proceed Without Importing.
    if (!migrationOk) await clearMigrationPending().catch(() => {});
  }
}

/** Thrown by callers when an import did not fully verify; the message is the neutral report text. */
export class ImportNotVerifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportNotVerifiedError";
  }
}

/** Adapts a report to the shape the existing migration toast understands. */
export function reportToMigrationResult(report: ImportReport): MigrationResult {
  const failed = (kind: "recipe" | "bake" | "feed") => report.failures.filter((f) => f.kind === kind).length;
  return {
    recipes: { ok: report.verified.recipes, failed: failed("recipe"), unresolved: 0 },
    bakes: { ok: report.verified.bakes, failed: failed("bake"), unresolved: 0 },
    feed: { ok: report.verified.feeds, failed: failed("feed"), unresolved: 0 },
  };
}

// ───────────────────────── wording ─────────────────────────

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Neutral, factual description of an import result. */
/** Said when an import fails and recovery closed the account session; the UI omits it when that is not confirmed. */
export const IMPORT_STILL_OFFLINE_SENTENCE = "You are still in your offline workspace and can try again.";

export function describeImportReport(report: ImportReport): string {
  const parts: string[] = [];
  if (report.ok) {
    const v = report.verified;
    const done = [
      v.recipes ? n(v.recipes, "recipe", "recipes") : "",
      v.bakes ? n(v.bakes, "bake", "bakes") : "",
      v.feeds ? n(v.feeds, "feed", "feeds") : "",
      v.drafts ? n(v.drafts, "recipe draft", "recipe drafts") : "",
    ].filter(Boolean);
    parts.push(done.length ? `Imported and confirmed: ${done.join(", ")}.` : "There was nothing to import.");
  } else {
    const planned = report.planned.recipes + report.planned.bakes + report.planned.feeds;
    const verified = report.verified.recipes + report.verified.bakes + report.verified.feeds;
    parts.push(`Nothing on this device was changed. ${IMPORT_STILL_OFFLINE_SENTENCE}`);
    parts.push(`${verified} of ${planned} records were confirmed in your account${report.planned.drafts ? `; ${n(report.planned.drafts, "recipe draft", "recipe drafts")} not yet moved` : ""}.`);
    const counts = new Map<string, number>();
    for (const f of report.failures) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
    const lines = [...counts.entries()].slice(0, 4).map(([reason, count]) => (count > 1 ? `${count} × ${reason}` : reason));
    if (lines.length) parts.push(`What happened: ${lines.join("; ")}.`);
  }
  if (report.cannotImport.length) parts.push(`${n(report.cannotImport.length, "record", "records")} could not be imported and will stay on this device.`);
  const conflicts = report.unresolved.filter((u) => u.reason === "conflict").length;
  const other = report.unresolved.length - conflicts;
  if (conflicts) parts.push(`${n(conflicts, "record has", "records have")} two different copies and will stay on this device.`);
  if (other) parts.push(`${n(other, "item", "items")} could not be processed automatically and will stay on this device.`);
  if (report.draftsRenamed.length) parts.push(`${n(report.draftsRenamed.length, "recipe draft was", "recipe drafts were")} saved under a new id because a different draft already used the old one.`);
  return parts.join(" ");
}
