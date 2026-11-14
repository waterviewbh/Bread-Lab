// artifacts/sourdough/lib/nlaWorkspace.ts
//
// The single, authoritative view of the NLA (Nameless Lab Assistant) workspace on this device.
//
// Data lives in TWO storage "cabinets":
//   A. fixed-name keys                 e.g. bread_lab_recipes_v1, sourdough_feed_history_v1
//   B. owner-named keys (NLA = anonymous) e.g. bread_lab_recipes_v1_anonymous
// The recipe/bake code writes cabinet B; the History, Log and Feed screens use cabinet A; the transition
// machinery only ever looked at A. This module reads BOTH and is the one place that decides what is
// "the NLA workspace" for detection, counts, import eligibility, purge, and failure accounting.
//
// SAFE CONFLICT RULE (cross-cabinet and within-key duplicates)
//   - Same id and identical content once the ownership stamp (userId / user_id) is ignored  => the same
//     record: de-duplicated.
//   - Same id and different content  => CONFLICT. Both copies stay exactly where they are, are excluded from
//     import and from purge, and are reported. We never pick one, overwrite one, or delete one.
//
// OWNERSHIP CLASSES
//   unstamped  no owner stamp. Inside the NLA workspace this is, by location, an NLA record. It is eligible
//              ONLY because the baker explicitly transfers/discards their offline workspace.
//   nla        stamped "anonymous".
//   foreign    stamped for another owner. NEVER imported, NEVER purged; reported.
//   conflicting-stamp / malformed / unreadable: never imported, never purged; reported.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { storageMutex, getOwnerStorageKey, APP_STORAGE_KEYS, QUARANTINE_KEY } from "./storageUtils";
import {
  RECIPES_KEY,
  BAKE_KEY,
  BAKE_HISTORY_KEY,
  DELETED_RECIPE_IDS_KEY,
  DELETED_BAKE_IDS_KEY,
  DELETED_FEED_IDS_KEY,
} from "./recipeTypes";
import { NLA_OWNER } from "./nlaBoundary";

// Same strings as lib/candidateStorage.ts (asserted equal by a test); defined here to avoid importing the
// share/extraction pipeline into the storage layer.
export const LEGACY_GLOBAL_CANDIDATES_KEY_NLA = "bread_lab_candidates_v1";
export const ANONYMOUS_CANDIDATES_KEY_NLA = "bread_lab_candidates_v1_anonymous";

export const NLA_PURGE_JOURNAL_KEY = "bread_lab_nla_purge_journal_v1";

const nlaKey = (base: string) => getOwnerStorageKey(base, NLA_OWNER);

export type RecordType = "recipes" | "bakeHistory" | "activeBakes" | "feedHistory" | "activeFeed" | "candidates";
const RECORD_TYPES: RecordType[] = ["recipes", "bakeHistory", "activeBakes", "feedHistory", "activeFeed", "candidates"];

/** Every key (both cabinets, plus tombstones and residue) that can hold NLA workspace data. */
export const NLA_SCOPE = {
  recipes: [RECIPES_KEY, nlaKey(RECIPES_KEY)],
  bakeHistory: [BAKE_HISTORY_KEY, nlaKey(BAKE_HISTORY_KEY)],
  activeBakes: [BAKE_KEY, nlaKey(BAKE_KEY)],
  feedHistory: [APP_STORAGE_KEYS.FEED_HISTORY],
  activeFeed: [APP_STORAGE_KEYS.ACTIVE_FEED],
  candidates: [LEGACY_GLOBAL_CANDIDATES_KEY_NLA, ANONYMOUS_CANDIDATES_KEY_NLA],
  tombstones: {
    recipe: nlaKey(DELETED_RECIPE_IDS_KEY),
    bake: nlaKey(DELETED_BAKE_IDS_KEY),
    feed: nlaKey(DELETED_FEED_IDS_KEY),
  },
  /** NLA data parked by earlier sign-ins (never restored by any flow). */
  residue: QUARANTINE_KEY(NLA_OWNER),
} as const;

export const NLA_TOMBSTONE_KEYS: string[] = [NLA_SCOPE.tombstones.recipe, NLA_SCOPE.tombstones.bake, NLA_SCOPE.tombstones.feed];

export const NLA_ALL_KEYS: string[] = [
  ...NLA_SCOPE.recipes,
  ...NLA_SCOPE.bakeHistory,
  ...NLA_SCOPE.activeBakes,
  ...NLA_SCOPE.feedHistory,
  ...NLA_SCOPE.activeFeed,
  ...NLA_SCOPE.candidates,
  ...NLA_TOMBSTONE_KEYS,
  NLA_SCOPE.residue,
];

export function isNlaScopeKey(key: string): boolean {
  return NLA_ALL_KEYS.includes(key) || key === NLA_PURGE_JOURNAL_KEY;
}

// ───────────────────────── helpers ─────────────────────────

export type OwnershipClass = "unstamped" | "nla" | "foreign" | "conflicting-stamp" | "malformed";

export function classifyOwnership(rec: any): OwnershipClass {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return "malformed";
  if (typeof rec.id !== "string" || rec.id.trim() === "") return "malformed";
  const a = rec.userId;
  const b = rec.user_id;
  const sa = a === undefined || a === null ? "" : String(a).trim();
  const sb = b === undefined || b === null ? "" : String(b).trim();
  if (sa !== "" && sb !== "" && sa !== sb) return "conflicting-stamp";
  const owner = sa !== "" ? sa : sb;
  if (owner === "") return "unstamped";
  return owner === NLA_OWNER ? "nla" : "foreign";
}

const isEligibleClass = (c: OwnershipClass) => c === "nla" || c === "unstamped";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function stripOwnershipStamp(rec: any): any {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return rec;
  const { userId: _u, user_id: _uu, ...rest } = rec;
  return rest;
}

const sameModuloStamp = (x: any, y: any) => stableStringify(stripOwnershipStamp(x)) === stableStringify(stripOwnershipStamp(y));

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ───────────────────────── inventory ─────────────────────────

export interface EligibleRecord {
  id: string;
  record: any;
  cls: "nla" | "unstamped";
  /** Every key holding a copy of this record (de-duplicated copies). */
  sources: string[];
}

export interface UnresolvedItem {
  type: RecordType | "tombstones" | "residue";
  reason: "conflict" | "foreign" | "conflicting-stamp" | "malformed" | "unreadable";
  id?: string;
  sources: string[];
  detail?: string;
}

export interface InventoryCounts {
  recipes: number;
  bakeHistory: number;
  activeBakes: number;
  feedHistory: number;
  activeFeed: number;
  candidates: number;
  tombstones: number;
  residue: number;
  unstamped: number;
  conflicts: number;
  foreign: number;
  unreadable: number;
  malformed: number;
  /** Everything above that is not itself unresolved: what Import/Proceed will handle. */
  eligibleTotal: number;
  unresolvedTotal: number;
}

export interface NlaInventory {
  /** Raw value of every inspected key at inspection time (for the change check). */
  raw: Record<string, string | null>;
  eligible: Record<RecordType, EligibleRecord[]>;
  tombstones: { recipe: string[]; bake: string[]; feed: string[] };
  residue: { present: boolean; nlaRecords: number; byType: Record<string, number> };
  unresolved: UnresolvedItem[];
  /** False when any key could not be read: Import/purge must not proceed. */
  readable: boolean;
  fingerprint: string;
  counts: InventoryCounts;
}

interface ParsedKey {
  key: string;
  items: any[];
  shape: "array" | "object" | "absent";
}

async function readRawKey(key: string): Promise<{ raw: string | null; error?: string }> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return { raw: raw === undefined ? null : raw };
  } catch (e) {
    return { raw: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseItems(key: string, raw: string | null, allowObject: boolean): { parsed?: ParsedKey; error?: string } {
  if (raw === null) return { parsed: { key, items: [], shape: "absent" } };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { error: `Malformed JSON in ${key}` };
  }
  if (Array.isArray(value)) return { parsed: { key, items: value, shape: "array" } };
  if (allowObject && value !== null && typeof value === "object") return { parsed: { key, items: [value], shape: "object" } };
  return { error: `Unexpected data shape in ${key}` };
}

export async function inventoryNlaWorkspace(): Promise<NlaInventory> {
  const raw: Record<string, string | null> = {};
  const unresolved: UnresolvedItem[] = [];
  let readable = true;

  const fetched = new Map<string, string | null>();
  for (const key of NLA_ALL_KEYS) {
    const r = await readRawKey(key);
    raw[key] = r.raw;
    fetched.set(key, r.raw);
    if (r.error) {
      readable = false;
      unresolved.push({ type: "recipes", reason: "unreadable", sources: [key], detail: r.error });
    }
  }

  const eligible = {} as Record<RecordType, EligibleRecord[]>;
  let unstamped = 0;

  for (const type of RECORD_TYPES) {
    eligible[type] = [];
    const keys = NLA_SCOPE[type] as readonly string[];
    const copiesById = new Map<string, Array<{ rec: any; source: string }>>();
    const order: string[] = [];

    for (const key of keys) {
      const rawValue = fetched.get(key) ?? null;
      const allowObject = type === "activeBakes" || type === "activeFeed";
      const { parsed, error } = parseItems(key, rawValue, allowObject);
      if (error || !parsed) {
        readable = false;
        unresolved.push({ type, reason: "unreadable", sources: [key], detail: error });
        continue;
      }
      for (const rec of parsed.items) {
        // Candidate drafts carry no owner stamp; their key location is their ownership.
        const cls: OwnershipClass =
          type === "candidates"
            ? rec && typeof rec === "object" && !Array.isArray(rec) && typeof rec.id === "string" && rec.id.trim() !== ""
              ? "nla"
              : "malformed"
            : classifyOwnership(rec);

        if (cls === "malformed") {
          unresolved.push({ type, reason: "malformed", id: rec && typeof rec === "object" ? rec.id : undefined, sources: [key] });
          continue;
        }
        if (cls === "foreign" || cls === "conflicting-stamp") {
          unresolved.push({ type, reason: cls === "foreign" ? "foreign" : "conflicting-stamp", id: rec.id, sources: [key] });
          continue;
        }
        const list = copiesById.get(rec.id) ?? [];
        if (list.length === 0) order.push(rec.id);
        list.push({ rec, source: key });
        copiesById.set(rec.id, list);
      }
    }

    for (const id of order) {
      const copies = copiesById.get(id)!;
      const allSame = copies.every((c) => sameModuloStamp(c.rec, copies[0].rec));
      const sources = Array.from(new Set(copies.map((c) => c.source)));
      if (!allSame) {
        unresolved.push({ type, reason: "conflict", id, sources, detail: "Two different copies share this id." });
        continue;
      }
      // Prefer a stamped copy as the representative; ownership stamps are not part of content.
      const rep = copies.find((c) => classifyOwnership(c.rec) === "nla") ?? copies[0];
      const cls = type === "candidates" ? "nla" : (classifyOwnership(rep.rec) as "nla" | "unstamped");
      if (cls === "unstamped") unstamped++;
      eligible[type].push({ id, record: rep.rec, cls, sources });
    }
  }

  // Tombstones: arrays of ids, owner-named keys only (NLA's own).
  const tombstones = { recipe: [] as string[], bake: [] as string[], feed: [] as string[] };
  (["recipe", "bake", "feed"] as const).forEach((kind) => {
    const key = NLA_SCOPE.tombstones[kind];
    const { parsed, error } = parseItems(key, fetched.get(key) ?? null, false);
    if (error || !parsed) {
      readable = false;
      unresolved.push({ type: "tombstones", reason: "unreadable", sources: [key], detail: error });
      return;
    }
    tombstones[kind] = Array.from(new Set(parsed.items.filter((x) => typeof x === "string" && x.trim() !== ""))) as string[];
  });

  // Residue: NLA data parked by earlier sign-ins.
  const residue = { present: false, nlaRecords: 0, byType: {} as Record<string, number> };
  const residueRaw = fetched.get(NLA_SCOPE.residue) ?? null;
  if (residueRaw !== null) {
    residue.present = true;
    let bucket: any = null;
    try {
      bucket = JSON.parse(residueRaw);
    } catch {
      bucket = null;
    }
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
      readable = false;
      unresolved.push({ type: "residue", reason: "unreadable", sources: [NLA_SCOPE.residue], detail: "Malformed set-aside bucket" });
    } else {
      for (const field of ["recipes", "bakeHistory", "feedHistory", "activeBakes"]) {
        const list = Array.isArray(bucket[field]) ? bucket[field] : [];
        for (const rec of list) {
          const cls = classifyOwnership(rec);
          if (cls === "nla") {
            residue.nlaRecords++;
            residue.byType[field] = (residue.byType[field] ?? 0) + 1;
          } else {
            unresolved.push({ type: "residue", reason: cls === "malformed" ? "malformed" : cls === "unstamped" ? "malformed" : "foreign", id: rec?.id, sources: [NLA_SCOPE.residue] });
          }
        }
      }
      if (bucket.activeFeed && typeof bucket.activeFeed === "object") {
        if (classifyOwnership(bucket.activeFeed) === "nla") {
          residue.nlaRecords++;
          residue.byType.activeFeed = 1;
        } else {
          unresolved.push({ type: "residue", reason: "foreign", id: bucket.activeFeed?.id, sources: [NLA_SCOPE.residue] });
        }
      }
      for (const field of ["deletedRecipeIds", "deletedBakeIds", "deletedFeedIds"]) {
        const list = Array.isArray(bucket[field]) ? bucket[field] : [];
        residue.nlaRecords += list.length;
        if (list.length) residue.byType[field] = list.length;
      }
    }
  }

  const sortedRaw = Object.keys(raw).sort().map((k) => `${k}=${raw[k] ?? "∅"}`);
  const fingerprint = fnv1a(sortedRaw.join("\n"));

  const conflicts = unresolved.filter((u) => u.reason === "conflict").length;
  const foreign = unresolved.filter((u) => u.reason === "foreign" || u.reason === "conflicting-stamp").length;
  const unreadable = unresolved.filter((u) => u.reason === "unreadable").length;
  const malformed = unresolved.filter((u) => u.reason === "malformed").length;
  const tombstoneCount = tombstones.recipe.length + tombstones.bake.length + tombstones.feed.length;

  const counts: InventoryCounts = {
    recipes: eligible.recipes.length,
    bakeHistory: eligible.bakeHistory.length,
    activeBakes: eligible.activeBakes.length,
    feedHistory: eligible.feedHistory.length,
    activeFeed: eligible.activeFeed.length,
    candidates: eligible.candidates.length,
    tombstones: tombstoneCount,
    residue: residue.nlaRecords,
    unstamped,
    conflicts,
    foreign,
    unreadable,
    malformed,
    eligibleTotal:
      eligible.recipes.length + eligible.bakeHistory.length + eligible.activeBakes.length + eligible.feedHistory.length +
      eligible.activeFeed.length + eligible.candidates.length,
    unresolvedTotal: unresolved.length,
  };

  return { raw, eligible, tombstones, residue, unresolved, readable, fingerprint, counts };
}

/** True when ANY inspected key differs from the inventory's snapshot (something changed while we worked). */
export async function nlaSnapshotChanged(snapshotRaw: Record<string, string | null>): Promise<boolean> {
  if (!snapshotRaw || typeof snapshotRaw !== "object" || Array.isArray(snapshotRaw)) return true;
  for (const key of NLA_ALL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshotRaw, key)) return true;
    const r = await readRawKey(key);
    if (r.error) return true;
    if ((r.raw ?? null) !== (snapshotRaw[key] ?? null)) return true;
  }
  return false;
}

/** True when the NLA workspace holds nothing eligible, parked or unresolved. */
export function inventoryIsEmpty(inv: NlaInventory): boolean {
  const c = inv.counts;
  return c.eligibleTotal === 0 && c.tombstones === 0 && c.residue === 0 && c.unresolvedTotal === 0;
}

// ───────────────────────── purge ─────────────────────────

export type PurgeOp =
  | { kind: "removeKey"; key: string }
  | { kind: "filterIds"; key: string; ids: string[]; candidates?: boolean }
  | { kind: "residue"; key: string };

export interface PurgePlan {
  mode: "import" | "discard";
  createdAt: number;
  ops: PurgeOp[];
}

export interface NlaDisposition {
  mode: "import" | "discard";
  plan: PurgePlan;
  snapshotRaw: Record<string, string | null>;
}

/** Explicit NLA choice captured before destination authentication or workspace mutation. */
export interface NlaTransitionIntent {
  mode: "import" | "discard";
  snapshotRaw: Record<string, string | null>;
}

const authorizedNlaTransitionIntents = new WeakSet<NlaTransitionIntent>();

/** Create an intent only in the handler for the baker's explicit Import or Discard action. */
export function authorizeNlaTransitionIntent(
  mode: "import" | "discard",
  snapshotRaw: Record<string, string | null>
): NlaTransitionIntent {
  const intent = Object.freeze({
    mode,
    snapshotRaw: Object.freeze({ ...snapshotRaw }),
  }) as NlaTransitionIntent;
  authorizedNlaTransitionIntents.add(intent);
  return intent;
}

export function isAuthorizedNlaTransitionIntent(intent: unknown): intent is NlaTransitionIntent {
  return !!intent && typeof intent === "object" && authorizedNlaTransitionIntents.has(intent as NlaTransitionIntent);
}

export interface VerifiedImportIds {
  recipes: string[];
  bakeHistory: string[];
  feedHistory: string[];
  candidates: string[];
}

export class NlaPurgeVerificationError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`NLA workspace cleanup could not be verified: ${problems.join("; ")}`);
    this.name = "NlaPurgeVerificationError";
    this.problems = problems;
  }
}

const verifiedImportPlans = new WeakSet<PurgePlan>();
const authorizedDiscardPlans = new WeakSet<PurgePlan>();

export function authorizeImportPlan(plan: PurgePlan): PurgePlan {
  if (!plan || plan.mode !== "import") throw new Error("Cannot authorize non-import purge plan.");
  verifiedImportPlans.add(plan);
  return plan;
}

/** Marks a discard plan only after the user explicitly selects Proceed Without Importing. */
export function authorizeDiscardPlan(plan: PurgePlan): PurgePlan {
  if (!plan || plan.mode !== "discard") throw new Error("Cannot authorize non-discard purge plan.");
  authorizedDiscardPlans.add(plan);
  return plan;
}

export function isVerifiedImportPlan(plan: PurgePlan): boolean {
  return plan !== null && typeof plan === "object" && verifiedImportPlans.has(plan);
}

export function isAuthorizedDiscardPlan(plan: PurgePlan): boolean {
  return plan !== null && typeof plan === "object" && authorizedDiscardPlans.has(plan);
}

export function validatePurgePlan(
  plan: unknown,
  expectedMode?: "import" | "discard",
  isRecovery: boolean = false,
  recoveryDiscardAuthorization?: unknown
): asserts plan is PurgePlan {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("Invalid purge plan: root must be a non-null object.");
  }
  const p = plan as PurgePlan;
  if (p.mode !== "import" && p.mode !== "discard") {
    throw new Error(`Invalid purge plan: unsupported mode '${p.mode}'.`);
  }
  if (expectedMode && p.mode !== expectedMode) {
    throw new Error(`Purge plan mode mismatch: expected '${expectedMode}', got '${p.mode}'.`);
  }
  if (typeof p.createdAt !== "number" || Number.isNaN(p.createdAt)) {
    throw new Error("Invalid purge plan: missing or invalid createdAt timestamp.");
  }
  if (!Array.isArray(p.ops)) {
    throw new Error("Invalid purge plan: ops must be an array.");
  }

  if (!isRecovery && p.mode === "import" && !isVerifiedImportPlan(p)) {
    throw new Error("Purge plan authorization rejection: import plan lacks valid verified import provenance.");
  }
  const recoveryDiscardAuthorized = isRecovery && isDurableDiscardAuthorization(p, recoveryDiscardAuthorization);
  if (p.mode === "discard" && !isAuthorizedDiscardPlan(p) && !recoveryDiscardAuthorized) {
    throw new Error("Purge plan authorization rejection: discard plan lacks valid authorized discard provenance.");
  }

  for (const op of p.ops) {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      throw new Error("Invalid purge operation: must be a non-null object.");
    }
    if (typeof op.key !== "string" || op.key.trim() === "") {
      throw new Error("Invalid purge operation: missing or invalid storage key.");
    }
    if (!isNlaScopeKey(op.key)) {
      throw new Error(`Purge plan security rejection: operation targets out-of-scope key '${op.key}'.`);
    }

    if (op.kind === "removeKey") {
      if (!NLA_TOMBSTONE_KEYS.includes(op.key)) {
        throw new Error(`Purge plan security rejection: removeKey operation targets unauthorized key '${op.key}'.`);
      }
    } else if (op.kind === "residue") {
      if (op.key !== NLA_SCOPE.residue) {
        throw new Error(`Purge plan security rejection: residue operation targets unauthorized key '${op.key}'.`);
      }
    } else if (op.kind === "filterIds") {
      if (!Array.isArray(op.ids)) {
        throw new Error("Invalid purge operation: filterIds requires an ids array.");
      }
      for (const id of op.ids) {
        if (typeof id !== "string" || id.trim() === "") {
          throw new Error("Invalid purge operation: filterIds contains invalid or non-string record ID.");
        }
      }
      if (op.candidates) {
        if (op.key !== LEGACY_GLOBAL_CANDIDATES_KEY_NLA && op.key !== ANONYMOUS_CANDIDATES_KEY_NLA) {
          throw new Error(`Purge plan security rejection: candidate filterIds targets unauthorized key '${op.key}'.`);
        }
      } else {
        const validRecordKeys = [
          ...NLA_SCOPE.recipes,
          ...NLA_SCOPE.bakeHistory,
          ...NLA_SCOPE.activeBakes,
          ...NLA_SCOPE.feedHistory,
          ...NLA_SCOPE.activeFeed,
        ];
        if (!validRecordKeys.includes(op.key)) {
          throw new Error(`Purge plan security rejection: filterIds targets unauthorized storage key '${op.key}'.`);
        }
      }
    } else {
      throw new Error(`Purge plan security rejection: unknown purge operation kind '${(op as any).kind}'.`);
    }
  }
}

function isDurableDiscardAuthorization(plan: PurgePlan, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const receipt = value as { kind?: unknown; planFingerprint?: unknown };
  return receipt.kind === "explicit-user-choice" &&
    receipt.planFingerprint === stableStringify({ mode: plan.mode, createdAt: plan.createdAt, ops: plan.ops });
}

/**
 * Builds the purge plan from an inventory.
 *  - "discard"  (Proceed Without Importing): every eligible record is removed.
 *  - "import"   (after a VERIFIED import): only the verified ids of recipes / bake history / feed history /
 *               candidates are removed, plus the NLA active work (discarded, never uploaded), tombstones and residue.
 * Conflicts, foreign, malformed and unreadable data are never part of a plan.
 */
export function buildPurgePlan(inv: NlaInventory, mode: "import" | "discard", verified?: VerifiedImportIds): PurgePlan {
  if (!inv.readable) throw new Error("NLA workspace has unreadable data; refusing to plan a purge.");
  if (mode === "import" && !verified) throw new Error("An import purge requires the verified id sets.");

  const idsFor = (type: RecordType): Set<string> => {
    if (mode === "discard" || type === "activeBakes" || type === "activeFeed") {
      return new Set(inv.eligible[type].map((r) => r.id));
    }
    const v = verified!;
    const list = type === "recipes" ? v.recipes : type === "bakeHistory" ? v.bakeHistory : type === "feedHistory" ? v.feedHistory : v.candidates;
    return new Set(list);
  };

  const ops: PurgeOp[] = [];
  for (const type of RECORD_TYPES) {
    const ids = idsFor(type);
    const byKey = new Map<string, string[]>();
    for (const rec of inv.eligible[type]) {
      if (!ids.has(rec.id)) continue;
      for (const source of rec.sources) {
        const list = byKey.get(source) ?? [];
        list.push(rec.id);
        byKey.set(source, list);
      }
    }
    for (const [key, list] of byKey.entries()) {
      ops.push({ kind: "filterIds", key, ids: list, candidates: type === "candidates" });
    }
  }
  for (const key of NLA_TOMBSTONE_KEYS) ops.push({ kind: "removeKey", key });
  if (inv.residue.present) ops.push({ kind: "residue", key: NLA_SCOPE.residue });

  return { mode, createdAt: Date.now(), ops };
}

async function applyOp(op: PurgeOp): Promise<void> {
  if (op.kind === "removeKey") {
    await AsyncStorage.removeItem(op.key);
    return;
  }

  const rawValue = await AsyncStorage.getItem(op.key);
  if (rawValue === null || rawValue === undefined) return;
  let value: any;
  try {
    value = JSON.parse(rawValue);
  } catch {
    throw new Error(`Cannot purge ${op.key}: unreadable data (left untouched).`);
  }

  if (op.kind === "filterIds") {
    const ids = new Set(op.ids);
    // A record is removed only if its id was planned AND it is provably NLA's (stamped anonymous, or unstamped).
    const removable = (rec: any) =>
      op.candidates
        ? !!rec && typeof rec === "object" && ids.has(rec.id)
        : !!rec && typeof rec === "object" && ids.has(rec.id) && isEligibleClass(classifyOwnership(rec));
    if (Array.isArray(value)) {
      const kept = value.filter((rec) => !removable(rec));
      if (kept.length === value.length) return;
      if (kept.length === 0) await AsyncStorage.removeItem(op.key);
      else await AsyncStorage.setItem(op.key, JSON.stringify(kept));
      return;
    }
    if (value && typeof value === "object") {
      if (removable(value)) await AsyncStorage.removeItem(op.key);
      return;
    }
    throw new Error(`Cannot purge ${op.key}: unexpected data shape (left untouched).`);
  }

  // residue bucket: remove only provably-NLA contents; keep everything else.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cannot purge ${op.key}: unexpected data shape (left untouched).`);
  }
  const next: Record<string, any> = { ...value };
  for (const field of ["recipes", "bakeHistory", "feedHistory", "activeBakes"]) {
    if (Array.isArray(next[field])) {
      next[field] = next[field].filter((rec: any) => classifyOwnership(rec) !== "nla");
      if (next[field].length === 0) delete next[field];
    }
  }
  if (next.activeFeed && typeof next.activeFeed === "object" && classifyOwnership(next.activeFeed) === "nla") delete next.activeFeed;
  for (const field of ["deletedRecipeIds", "deletedBakeIds", "deletedFeedIds"]) {
    delete next[field];
  }
  const remaining = Object.keys(next).filter((k) => {
    const v = next[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
  });
  if (remaining.length === 0) await AsyncStorage.removeItem(op.key);
  else await AsyncStorage.setItem(op.key, JSON.stringify(next));
}

async function verifyOps(ops: PurgeOp[]): Promise<string[]> {
  const problems: string[] = [];
  for (const op of ops) {
    const rawValue = await AsyncStorage.getItem(op.key);
    if (op.kind === "removeKey") {
      if (rawValue !== null && rawValue !== undefined) problems.push(`${op.key} still present`);
      continue;
    }
    if (rawValue === null || rawValue === undefined) continue;
    let value: any;
    try {
      value = JSON.parse(rawValue);
    } catch {
      problems.push(`${op.key} unreadable after purge`);
      continue;
    }
    if (op.kind === "filterIds") {
      const ids = new Set(op.ids);
      const list = Array.isArray(value) ? value : [value];
      const stillThere = list.filter((rec: any) =>
        rec && typeof rec === "object" && ids.has(rec.id) && (op.candidates || isEligibleClass(classifyOwnership(rec)))
      );
      if (stillThere.length) problems.push(`${op.key} still holds ${stillThere.length} planned record(s)`);
    } else if (op.kind === "residue") {
      const nla = ["recipes", "bakeHistory", "feedHistory", "activeBakes"].some(
        (f) => Array.isArray(value[f]) && value[f].some((rec: any) => classifyOwnership(rec) === "nla")
      );
      if (nla) problems.push(`${op.key} still holds NLA records`);
    }
  }
  return problems;
}

/** Applies a plan. The caller MUST hold storageMutex (the transition coordinator does). Journaled and repeatable. */
export async function applyNlaPurgeLocked(plan: PurgePlan): Promise<void> {
  validatePurgePlan(plan, plan?.mode, false);
  const discardAuthorization = plan.mode === "discard"
    ? { kind: "explicit-user-choice", planFingerprint: stableStringify({ mode: plan.mode, createdAt: plan.createdAt, ops: plan.ops }) }
    : null;
  await AsyncStorage.setItem(NLA_PURGE_JOURNAL_KEY, JSON.stringify({ version: 1, plan, discardAuthorization }));
  for (const op of plan.ops) {
    await applyOp(op);
  }
  const problems = await verifyOps(plan.ops);
  if (problems.length) throw new NlaPurgeVerificationError(problems);
  await AsyncStorage.removeItem(NLA_PURGE_JOURNAL_KEY);
}

/** Finishes a purge that was interrupted (journal present). Caller MUST hold storageMutex. Returns whether one ran. */
export async function resumePendingNlaPurgeLocked(): Promise<boolean> {
  const rawJournal = await AsyncStorage.getItem(NLA_PURGE_JOURNAL_KEY);
  if (rawJournal === null || rawJournal === undefined) return false;
  let journal: any;
  try {
    journal = JSON.parse(rawJournal);
  } catch {
    throw new Error("The offline-workspace cleanup journal is unreadable; it was left untouched.");
  }
  const plan = journal?.plan as PurgePlan | undefined;
  validatePurgePlan(plan, plan?.mode, true, journal?.discardAuthorization);
  for (const op of plan.ops) {
    await applyOp(op);
  }
  const problems = await verifyOps(plan.ops);
  if (problems.length) throw new NlaPurgeVerificationError(problems);
  await AsyncStorage.removeItem(NLA_PURGE_JOURNAL_KEY);
  return true;
}

export function resumePendingNlaPurge(): Promise<boolean> {
  return storageMutex.run(() => resumePendingNlaPurgeLocked());
}

/** Stand-alone purge (takes the mutex itself). */
export function purgeNlaWorkspace(plan: PurgePlan): Promise<void> {
  return storageMutex.run(() => applyNlaPurgeLocked(plan));
}

/** Removes NLA's pending-deletion queues without any network call. Caller MUST hold storageMutex. */
export async function retireNlaTombstonesLocked(): Promise<void> {
  for (const key of NLA_TOMBSTONE_KEYS) await AsyncStorage.removeItem(key);
}

// ───────────────────────── isolation snapshot ─────────────────────────

/** Values of every key OUTSIDE the NLA scope: other accounts' data and quarantines, credentials, preferences. */
export async function snapshotProtectedKeys(): Promise<Record<string, string | null>> {
  const all = (await AsyncStorage.getAllKeys()) as readonly string[];
  const out: Record<string, string | null> = {};
  for (const key of all) {
    if (isNlaScopeKey(key)) continue;
    out[key] = await AsyncStorage.getItem(key);
  }
  return out;
}

export function diffSnapshots(before: Record<string, string | null>, after: Record<string, string | null>): string[] {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if ((before[k] ?? null) !== (after[k] ?? null)) problems.push(`protected key changed: ${k}`);
  }
  return problems;
}

/**
 * Final local-cleanliness verification after a purge: nothing planned remains, the NLA keys/residue/tombstones
 * are gone, whatever remains is exactly the reported unresolved set, and nothing outside the NLA scope changed.
 */
export async function verifyNlaCleanliness(
  before: NlaInventory,
  plan: PurgePlan,
  protectedBefore: Record<string, string | null>
): Promise<string[]> {
  const problems: string[] = [];
  problems.push(...(await verifyOps(plan.ops)));
  problems.push(...diffSnapshots(protectedBefore, await snapshotProtectedKeys()));

  const after = await inventoryNlaWorkspace();
  if (after.counts.tombstones !== 0) problems.push("NLA pending-deletion queues remain");
  if (after.counts.residue !== 0) problems.push("NLA set-aside residue remains");
  // Anything still eligible must be a record this plan deliberately left (import mode keeps unverified ids).
  const planned = new Set<string>();
  for (const op of plan.ops) if (op.kind === "filterIds") op.ids.forEach((i) => planned.add(`${op.key}:${i}`));
  for (const type of RECORD_TYPES) {
    for (const rec of after.eligible[type]) {
      for (const source of rec.sources) {
        if (planned.has(`${source}:${rec.id}`)) problems.push(`planned record ${rec.id} still in ${source}`);
      }
    }
  }
  // Unresolved items must not have grown or vanished silently.
  const key = (u: UnresolvedItem) => `${u.type}|${u.reason}|${u.id ?? ""}|${u.sources.join(",")}`;
  const beforeSet = new Set(before.unresolved.map(key));
  const afterSet = new Set(after.unresolved.map(key));
  for (const k of beforeSet) if (!afterSet.has(k)) problems.push(`unresolved item disappeared: ${k}`);
  return problems;
}

// ───────────────────────── presentation ─────────────────────────

export interface InventorySummary {
  /** Finished/saved records that Import would carry to the account. */
  records: { recipes: number; bakes: number; feeds: number; drafts: number };
  /** Active Feed/Bake sessions that are discarded either way. */
  activeWork: number;
  /** Older set-aside offline records (separate count). */
  setAside: number;
  unresolved: { conflicts: number; other: number };
  anything: boolean;
}

export function summarizeInventory(inv: NlaInventory): InventorySummary {
  const c = inv.counts;
  return {
    records: { recipes: c.recipes, bakes: c.bakeHistory, feeds: c.feedHistory, drafts: c.candidates },
    activeWork: c.activeBakes + c.activeFeed,
    setAside: c.residue,
    unresolved: { conflicts: c.conflicts, other: c.foreign + c.malformed + c.unreadable },
    anything: !inventoryIsEmpty(inv),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Neutral, factual description of what is on the device. */
export function describeInventory(summary: InventorySummary): string {
  if (!summary.anything) return "No offline records were found on this device.";
  const parts: string[] = [];
  const r = summary.records;
  if (r.recipes) parts.push(plural(r.recipes, "recipe", "recipes"));
  if (r.bakes) parts.push(plural(r.bakes, "bake in your history", "bakes in your history"));
  if (r.feeds) parts.push(plural(r.feeds, "feed in your history", "feeds in your history"));
  if (r.drafts) parts.push(plural(r.drafts, "recipe draft", "recipe drafts"));
  const main = parts.length ? `This device has ${parts.join(", ")} that are not in an account.` : "";
  const extras: string[] = [];
  if (summary.setAside) extras.push(`${plural(summary.setAside, "older record", "older records")} set aside from earlier sign-ins`);
  if (summary.unresolved.conflicts) extras.push(`${plural(summary.unresolved.conflicts, "record has", "records have")} two different copies and will be left on this device`);
  if (summary.unresolved.other) extras.push(`${plural(summary.unresolved.other, "item", "items")} could not be processed automatically and will be left on this device`);
  return [main, extras.length ? `Also found: ${extras.join("; ")}.` : ""].filter(Boolean).join(" ");
}
