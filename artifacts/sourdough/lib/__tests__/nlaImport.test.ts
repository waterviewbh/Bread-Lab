import {
  importNlaWorkspace,
  rehomeCandidates,
  reconcileRows,
  compareCriticalFields,
  describeImportReport,
  candidatesKeyFor,
  type ImportReport,
} from "../nlaImport";
import { inventoryNlaWorkspace, NLA_ALL_KEYS } from "../nlaWorkspace";
import { fakeServer } from "../testSupport/fakeApi";
import { api } from "../api";

// Import and Proceed: upload -> read-back -> exact id-set / ownership / critical-field reconciliation ->
// candidate drafts re-homed -> verified purge plan. Every failure mode leaves the device untouched.

let mockStore: Record<string, string> = {};
let mockCorruptKey: string | null = null;
let mockWriteTransform: ((key: string, value: string) => string) | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k: string, v: string) => {
    const corrupted = mockCorruptKey && k === mockCorruptKey ? v.replace(/c-1/g, "c-X") : v;
    mockStore[k] = mockWriteTransform ? mockWriteTransform(k, corrupted) : corrupted;
  }),
  removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
  multiGet: jest.fn(async (ks: string[]) => ks.map((k) => [k, k in mockStore ? mockStore[k] : null])),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));
jest.mock("../api", () => require("../testSupport/fakeApi").makeApiModule());
jest.mock("../deviceId", () => ({ getDeviceId: jest.fn(async () => "device-1") }));

const TOKEN = "acct-1";
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const nlaRaw = () => Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
const phases = [{ key: "mix", name: "Mix", ingredients: ["flour"], instructions: ["stir"] }];
const bakePhases = [{ key: "mix", name: "Mix", startedAt: 900, completedAt: 950, readings: [{ id: "x" }] }];

const seedImportable = () => {
  put("bread_lab_recipes_v1", [{ id: "r-legacy", name: "Legacy loaf", phases }]);                                   // fixed-name, unstamped
  put("bread_lab_recipes_v1_anonymous", [
    { id: "r-1", name: "Country loaf", userId: "anonymous", phases },
    { id: "r-2", name: "Country loaf II", userId: "anonymous", parentRecipeId: "r-1", phases },
  ]);
  put("bread_lab_bake_history_v1", [
    { id: "b-1", recipeId: "r-1", recipeName: "Loaf", savedAt: 1000, startedAt: 900, userId: "anonymous", phases: bakePhases, outcome: { overallScore: 4 }, notes: "good" },
  ]);
  put("bread_lab_bake_history_v1_anonymous", [{ id: "b-2", recipeName: "Rye", savedAt: 2000, startedAt: 1900, phases: [] }]);   // unstamped
  put("bread_lab_bake_v2_anonymous", [{ id: "ab-1", recipeName: "Active", savedAt: 3000, startedAt: 3000, userId: "anonymous", phases: [] }]);
  put("sourdough_feed_history_v1", [{ id: "f-1", userId: "anonymous", savedAt: 5000, readings: [] }, { id: "f-2", savedAt: 6000, readings: [] }]);
  put("sourdough_feed_session_v1", { id: "af-1", userId: "anonymous", savedAt: 7000 });
  put("bread_lab_candidates_v1_anonymous", [{ id: "c-1", sharedAt: "2026-02-02T00:00:00.000Z", extractionResult: { status: "single_candidate" } }]);
  put("bread_lab_deleted_feed_ids_v1_anonymous", ["gone"]);
};

describe("importNlaWorkspace", () => {
  beforeEach(() => {
    mockStore = {};
    mockCorruptKey = null;
    mockWriteTransform = null;
    fakeServer.reset();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const expectDeviceUntouched = (before: Record<string, string | null>) => {
    expect(nlaRaw()).toEqual(before);
  };

  describe("success", () => {
    it("imports every eligible record (both cabinets, unstamped included), verifies each, and returns a purge plan", async () => {
      seedImportable();
      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(true);
      expect(out.report.failures).toEqual([]);
      expect(out.report.planned).toEqual({ recipes: 3, bakes: 2, feeds: 2, drafts: 1 });
      expect(out.report.verified).toEqual({ recipes: 3, bakes: 2, feeds: 2, drafts: 1 });
      expect(out.purgePlan).not.toBeNull();

      // Everything arrived, owned by the destination account (explicit ownership, including for unstamped records)
      expect(fakeServer.tables.recipe.size).toBe(3);
      expect(fakeServer.tables.bake.size).toBe(2);
      expect(fakeServer.tables.feed.size).toBe(2);
      for (const kind of ["recipe", "bake", "feed"] as const) {
        for (const row of fakeServer.tables[kind].values()) expect(row.user_id).toBe(TOKEN);
      }
    });

    it("keeps bake and feed ids stable; recipes get fresh ids (existing collision-safety rule) and bakes follow the remap", async () => {
      seedImportable();
      await importNlaWorkspace(TOKEN);
      expect([...fakeServer.tables.bake.keys()].sort()).toEqual(["b-1", "b-2"]);
      expect([...fakeServer.tables.feed.keys()].sort()).toEqual(["f-1", "f-2"]);
      const recipeIds = [...fakeServer.tables.recipe.keys()];
      expect(recipeIds).not.toContain("r-1");
      const bake1 = fakeServer.tables.bake.get("b-1")!;
      expect(recipeIds).toContain(bake1.recipe_id); // the bake points at the NEW id of its recipe
      const child = [...fakeServer.tables.recipe.values()].find((r) => r.name === "Country loaf II")!;
      expect(recipeIds).toContain(child.parent_recipe_id);
    });

    it("never uploads active work: the NLA active bake and active feed stay out of Supabase", async () => {
      seedImportable();
      await importNlaWorkspace(TOKEN);
      expect(fakeServer.tables.bake.has("ab-1")).toBe(false);
      expect(fakeServer.tables.feed.has("af-1")).toBe(false);
      for (const row of fakeServer.tables.bake.values()) expect(row.in_progress).toBe(false);
    });

    it("does not upload or promote candidate drafts; they are re-homed locally under the account", async () => {
      seedImportable();
      await importNlaWorkspace(TOKEN);
      expect(JSON.parse(mockStore[candidatesKeyFor(TOKEN)])).toEqual([
        { id: "c-1", sharedAt: "2026-02-02T00:00:00.000Z", extractionResult: { status: "single_candidate" } },
      ]);
      expect(fakeServer.tables.recipe.size).toBe(3); // drafts did not become recipes
      expect(fakeServer.calls.filter((c) => /candidate/i.test(c))).toEqual([]);
    });

    it("leaves foreign-owned records and conflicts on the device and reports them, without blocking the rest", async () => {
      put("bread_lab_recipes_v1", [
        { id: "mine", name: "Mine", phases },
        { id: "theirs", name: "Theirs", userId: "acct-9", phases },
        { id: "dup", name: "Copy A", phases },
      ]);
      put("bread_lab_recipes_v1_anonymous", [{ id: "dup", name: "Copy B", userId: "anonymous", phases }]);
      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(true);
      expect(out.report.verified.recipes).toBe(1);
      expect(fakeServer.tables.recipe.size).toBe(1);
      expect(out.report.unresolved.map((u) => u.reason).sort()).toEqual(["conflict", "foreign"]);
      expect(describeImportReport(out.report)).toContain("1 record has two different copies and will stay on this device");
      // ...and the purge plan can never touch them
      const planIds = out.purgePlan!.ops.flatMap((op) => (op.kind === "filterIds" ? op.ids : []));
      expect(planIds).toEqual(["mine"]);
    });

    it("reports a record that cannot be imported (a recipe with no name) and keeps it out of the purge", async () => {
      put("bread_lab_recipes_v1_anonymous", [{ id: "ok", name: "Fine", userId: "anonymous", phases }, { id: "nameless", userId: "anonymous", phases }]);
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(true);
      expect(out.report.cannotImport).toEqual([{ type: "recipe", id: "nameless", reason: "has no name" }]);
      const planIds = out.purgePlan!.ops.flatMap((op) => (op.kind === "filterIds" ? op.ids : []));
      expect(planIds).toEqual(["ok"]);
    });

    it("an empty workspace imports nothing, successfully", async () => {
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(true);
      expect(describeImportReport(out.report)).toBe("There was nothing to import.");
      expect(fakeServer.calls).toEqual([]);
    });
  });

  describe("failure injection (on ANY failure: no purge plan, device untouched)", () => {
    it("partial upload: one record is rejected", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.failUpsert = (kind, body) => (kind === "bake" && body.id === "b-2" ? new Error("write failed") : null);

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "upload", kind: "bake", id: "b-2" })]);
      expectDeviceUntouched(before);
    });

    it("RLS denial: every upload is refused with a policy error", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.failUpsert = () => Object.assign(new Error("new row violates row-level security policy"), { code: "42501" });

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.verified).toEqual({ recipes: 0, bakes: 0, feeds: 0, drafts: 0 });
      expect(out.report.failures.length).toBe(7); // 3 recipes + 2 bakes + 2 feeds, each accounted for
      expectDeviceUntouched(before);
      expect(mockStore[candidatesKeyFor(TOKEN)]).toBeUndefined(); // drafts are not touched when the upload fails
    });

    it("silently skipped record: the upload 'succeeds' but nothing is stored", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.dropUpsert = (kind, body) => kind === "feed" && body.id === "f-2";

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "verify", kind: "feed", id: "f-2", reason: "missing after upload" })]);
      expectDeviceUntouched(before);
    });

    it("read-back mismatch: a stored field differs from what was sent", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.corruptRow = (kind, row) => (kind === "bake" && row.id === "b-1" ? { ...row, recipe_name: "Changed" } : row);

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.failures[0]).toMatchObject({ stage: "verify", kind: "bake", id: "b-1" });
      expect(out.report.failures[0].reason).toContain("recipe_name");
      expectDeviceUntouched(before);
    });

    it("wrong owner: a record is stored under a different account", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.ownerOverride = (kind, body) => (kind === "recipe" && body.name === "Legacy loaf" ? "acct-other" : undefined);

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "verify", kind: "recipe", reason: "owned by a different account" })]);
      expect(out.purgePlan).toBeNull();
      expectDeviceUntouched(before);
    });

    it("no owner: a record is stored without any owner", async () => {
      seedImportable();
      fakeServer.ownerOverride = (kind, body) => (kind === "feed" && body.id === "f-1" ? null : undefined);
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.failures).toEqual([expect.objectContaining({ kind: "feed", id: "f-1", reason: "stored without an owner" })]);
      expect(out.purgePlan).toBeNull();
    });

    it("duplicate rows come back from the read-back", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.fetchTransform = (kind, rows) => (kind === "bake" ? [...rows, rows[0]] : rows);

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "verify", kind: "bake", reason: "duplicate rows returned" })]);
      expectDeviceUntouched(before);
    });

    it("an unexpected extra row comes back from the read-back", async () => {
      seedImportable();
      fakeServer.fetchTransform = (kind, rows) => (kind === "feed" ? [...rows, { id: "intruder", user_id: TOKEN }] : rows);
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.failures).toEqual([expect.objectContaining({ kind: "feed", id: "intruder", reason: "unexpected record returned" })]);
      expect(out.purgePlan).toBeNull();
    });

    it("a missing row in the read-back fails (truncated result)", async () => {
      seedImportable();
      fakeServer.fetchTransform = (kind, rows) => (kind === "recipe" ? rows.slice(1) : rows);
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(false);
      expect(out.report.failures[0]).toMatchObject({ stage: "verify", kind: "recipe", reason: "missing after upload" });
    });

    it("network interruption during read-back: nothing is confirmed, nothing is purged", async () => {
      seedImportable();
      const before = nlaRaw();
      fakeServer.fetchError = new Error("Network request failed");

      const out = await importNlaWorkspace(TOKEN);

      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "verify", reason: expect.stringContaining("Network request failed") })]);
      expectDeviceUntouched(before);
    });

    it("unreadable local data: nothing is uploaded at all", async () => {
      seedImportable();
      mockStore["bread_lab_recipes_v1_anonymous"] = "{broken";
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(false);
      expect(out.report.failures).toEqual([expect.objectContaining({ stage: "plan" })]);
      expect(fakeServer.calls).toEqual([]);
    });

    it("duplicate ids across cabinets with DIFFERENT content: neither copy is imported or touched", async () => {
      put("bread_lab_bake_history_v1", [{ id: "dup-b", recipeName: "One", savedAt: 1, startedAt: 1, phases: [] }]);
      put("bread_lab_bake_history_v1_anonymous", [{ id: "dup-b", recipeName: "Two", savedAt: 1, startedAt: 1, phases: [], userId: "anonymous" }]);
      const before = nlaRaw();
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(true);
      expect(fakeServer.tables.bake.size).toBe(0);
      expect(out.report.unresolved).toEqual([expect.objectContaining({ reason: "conflict", id: "dup-b" })]);
      expectDeviceUntouched(before);
    });

    it("a failed attempt leaves no 'import in progress' marker behind", async () => {
      seedImportable();
      fakeServer.fetchError = new Error("offline");
      await importNlaWorkspace(TOKEN);
      expect(mockStore["bread_lab_migration_pending_v1"]).toBeUndefined();
    });
  });

  describe("recovery and retry", () => {
    it("retry after a failure is idempotent: same destination ids, no duplicate rows", async () => {
      seedImportable();
      fakeServer.fetchError = new Error("offline");
      const first = await importNlaWorkspace(TOKEN);
      expect(first.report.ok).toBe(false);
      const idsAfterFirst = [...fakeServer.tables.recipe.keys()].sort();

      fakeServer.fetchError = null;
      const second = await importNlaWorkspace(TOKEN);

      expect(second.report.ok).toBe(true);
      expect([...fakeServer.tables.recipe.keys()].sort()).toEqual(idsAfterFirst); // the ledger reused the same ids
      expect(fakeServer.tables.recipe.size).toBe(3);
      expect(fakeServer.tables.bake.size).toBe(2);
      expect(fakeServer.tables.feed.size).toBe(2);
    });

    it("crash between upload and purge: nothing was deleted locally, and re-running is safe and complete", async () => {
      seedImportable();
      const before = nlaRaw();
      const first = await importNlaWorkspace(TOKEN);
      expect(first.report.ok).toBe(true);
      // (the app stops here: the transition that would purge never runs)
      expectDeviceUntouched(before);
      const rowsAfterFirst = JSON.stringify([...fakeServer.tables.recipe.entries()]);

      const again = await importNlaWorkspace(TOKEN);

      expect(again.report.ok).toBe(true);
      expect(again.report.draftsAlreadyImported).toBe(1); // the draft copy from the first run is recognised
      expect(JSON.stringify([...fakeServer.tables.recipe.entries()])).toBe(rowsAfterFirst);
      expect(fakeServer.tables.recipe.size).toBe(3);
    });

    it("the purge plan covers exactly the verified records plus active work, tombstones and nothing else", async () => {
      seedImportable();
      const out = await importNlaWorkspace(TOKEN);
      const ids = out.purgePlan!.ops.flatMap((op) => (op.kind === "filterIds" ? op.ids : [])).sort();
      expect(ids).toEqual(["ab-1", "af-1", "b-1", "b-2", "c-1", "f-1", "f-2", "r-1", "r-2", "r-legacy"].sort());
    });
  });

  describe("candidate drafts (interim preservation; permanent lifecycle belongs to CLI-5)", () => {
    const draft = (id: string, n: number) => ({ id, sharedAt: "2026-03-01T00:00:00.000Z", extractionResult: { n } });
    const eligible = async () => (await inventoryNlaWorkspace()).eligible.candidates;

    it("copies drafts into the destination key, merging with the account's own drafts", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1), draft("b", 2)]);
      put(candidatesKeyFor(TOKEN), [draft("mine", 9)]);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res).toMatchObject({ ok: true, copied: 2, alreadyImported: 0, renamed: [] });
      expect(JSON.parse(mockStore[candidatesKeyFor(TOKEN)]).map((c: any) => c.id).sort()).toEqual(["a", "b", "mine"]);
      expect(res.verifiedSourceIds.sort()).toEqual(["a", "b"]);
    });

    it("identical id and content counts as already imported (no duplicate)", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1)]);
      put(candidatesKeyFor(TOKEN), [draft("a", 1)]);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res).toMatchObject({ ok: true, copied: 0, alreadyImported: 1 });
      expect(JSON.parse(mockStore[candidatesKeyFor(TOKEN)])).toHaveLength(1);
    });

    it("same id with DIFFERENT content gets a new id and an explicit conflict report; the account's draft is untouched", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1)]);
      put(candidatesKeyFor(TOKEN), [draft("a", 99)]);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res.ok).toBe(true);
      expect(res.renamed).toHaveLength(1);
      expect(res.renamed[0].oldId).toBe("a");
      const stored = JSON.parse(mockStore[candidatesKeyFor(TOKEN)]);
      expect(stored).toHaveLength(2);
      expect(stored.find((c: any) => c.id === "a").extractionResult.n).toBe(99);                 // the account's own draft
      expect(stored.find((c: any) => c.id === res.renamed[0].newId).extractionResult.n).toBe(1);  // the NLA draft, kept
    });

    it("an unreadable destination fails the re-home and writes nothing", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1)]);
      mockStore[candidatesKeyFor(TOKEN)] = "{broken";
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res.ok).toBe(false);
      expect(mockStore[candidatesKeyFor(TOKEN)]).toBe("{broken");
    });

    it("a write that does not read back identically fails verification (originals are never purged on this basis)", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("c-1", 1)]);
      mockCorruptKey = candidatesKeyFor(TOKEN);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res.ok).toBe(false);
      expect(res.verifiedSourceIds).toEqual([]);
    });

    it("a write that leaves an EXTRA draft behind fails the set check even though every expected draft matches", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1)]);
      const key = candidatesKeyFor(TOKEN);
      mockWriteTransform = (k, v) => (k === key ? JSON.stringify([...JSON.parse(v), draft("stray", 5)]) : v);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res.ok).toBe(false);
      expect(res.failures.join(" ")).toMatch(/did not match the expected set/);
      expect(res.verifiedSourceIds).toEqual([]);
    });

    it("a write that keeps every id but changes a draft's CONTENT fails the per-draft check", async () => {
      put("bread_lab_candidates_v1_anonymous", [draft("a", 1)]);
      const key = candidatesKeyFor(TOKEN);
      mockWriteTransform = (k, v) => (k === key ? JSON.stringify(JSON.parse(v).map((c: any) => ({ ...c, extractionResult: { n: 12345 } }))) : v);
      const res = await rehomeCandidates(TOKEN, await eligible());
      expect(res.ok).toBe(false);
      expect(res.failures.join(" ")).toMatch(/did not read back identically/);
      expect(res.verifiedSourceIds).toEqual([]);
    });

    it("a draft failure fails the whole import and no purge plan is produced", async () => {
      seedImportable();
      const before = nlaRaw();
      mockCorruptKey = candidatesKeyFor(TOKEN);
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(false);
      expect(out.purgePlan).toBeNull();
      expect(out.report.failures.some((f) => f.stage === "candidates")).toBe(true);
      expectDeviceUntouched(before);
    });
  });

  describe("reconciliation unit checks", () => {
    const payloads = {
      recipe: { id: "d1", userId: TOKEN, name: "N", overview: undefined, yield_value: 2, parentRecipeId: null, phases: [] },
      feed: { id: "d3", userId: TOKEN, savedAt: 5, startedAt: null, updatedAt: null, inProgress: false, data: { a: 1 } },
    };
    const goodRecipeRow = () => ({ id: "d1", user_id: TOKEN, name: "N", overview: null, yield_value: 2, parent_recipe_id: null, recipe_data: JSON.parse(JSON.stringify(payloads.recipe)) });
    const goodFeedRow = () => ({ id: "d3", user_id: TOKEN, saved_at: "5", started_at: null, updated_at: 7, in_progress: false, data: { a: 1 } });
    const up = (kind: "recipe" | "feed", payload: any) => [{ kind, localId: "l", destinationId: payload.id, payload, ok: true }];

    it("accepts rows that match exactly (including bigint-as-string numbers)", () => {
      expect(reconcileRows("recipe", up("recipe", payloads.recipe) as any, [goodRecipeRow()], TOKEN)).toEqual([]);
      expect(reconcileRows("feed", up("feed", payloads.feed) as any, [goodFeedRow()], TOKEN)).toEqual([]);
    });

    it("rejects each kind of discrepancy", () => {
      const u = up("recipe", payloads.recipe) as any;
      expect(reconcileRows("recipe", u, [], TOKEN)[0].reason).toBe("missing after upload");
      expect(reconcileRows("recipe", u, [goodRecipeRow(), goodRecipeRow()], TOKEN)[0].reason).toBe("duplicate rows returned");
      expect(reconcileRows("recipe", u, [{ ...goodRecipeRow(), user_id: "x" }], TOKEN)[0].reason).toBe("owned by a different account");
      expect(reconcileRows("recipe", u, [{ ...goodRecipeRow(), user_id: null }], TOKEN)[0].reason).toBe("stored without an owner");
      expect(reconcileRows("recipe", u, [{ ...goodRecipeRow(), name: "Other" }], TOKEN)[0].reason).toContain("name");
      expect(reconcileRows("recipe", u, [{ ...goodRecipeRow(), recipe_data: { ...goodRecipeRow().recipe_data, extra: 1 } }], TOKEN)[0].reason).toContain("recipe_data");
      expect(reconcileRows("recipe", u, [goodRecipeRow(), { id: "zzz", user_id: TOKEN }], TOKEN).map((f) => f.reason)).toContain("unexpected record returned");
      expect(compareCriticalFields("feed", payloads.feed, { ...goodFeedRow(), data: { a: 2 } }, TOKEN)).toEqual(["data"]);
      expect(compareCriticalFields("feed", payloads.feed, { ...goodFeedRow(), in_progress: true }, TOKEN)).toEqual(["in_progress"]);
    });
  });

  describe("wording", () => {
    const base = (): ImportReport => ({
      ok: true, planned: { recipes: 2, bakes: 1, feeds: 1, drafts: 1 }, uploaded: { recipes: 2, bakes: 1, feeds: 1 },
      verified: { recipes: 2, bakes: 1, feeds: 1, drafts: 1 }, cannotImport: [], unresolved: [], draftsAlreadyImported: 0, draftsRenamed: [], failures: [],
    });

    it("success is neutral and factual", () => {
      expect(describeImportReport(base())).toBe("Imported and confirmed: 2 recipes, 1 bake, 1 feed, 1 recipe draft.");
    });

    it("failure says nothing was changed, gives counts, and groups reasons", () => {
      const r = base();
      r.ok = false;
      r.verified = { recipes: 1, bakes: 1, feeds: 0, drafts: 0 };
      r.failures = [
        { stage: "verify", kind: "feed", id: "f", reason: "missing after upload" },
        { stage: "verify", kind: "recipe", id: "r", reason: "missing after upload" },
      ];
      const text = describeImportReport(r);
      expect(text).toContain("Nothing on this device was changed. You are still in your offline workspace and can try again.");
      expect(text).toContain("2 of 4 records were confirmed in your account");
      expect(text).toContain("2 × missing after upload");
      expect(text).not.toMatch(/anonymous|lost|permanent|warning/i);
    });
  });

  it("(sanity) the fake API is what the code under test talks to", () => {
    expect(jest.isMockFunction(api.fetchRowsByIds)).toBe(true);
  });
});
