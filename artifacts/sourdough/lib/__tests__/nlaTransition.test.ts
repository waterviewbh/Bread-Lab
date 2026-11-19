import {
  executeWorkspaceTransition,
  getCoordinatorState,
  setCoordinatorState,
  ActiveFeedNotAcknowledgedError,
  NlaWorkspaceChangedError,
} from "../transitionCoordinator";
import {
  inventoryNlaWorkspace,
  buildPurgePlan,
  authorizeDiscardPlan,
  NLA_ALL_KEYS,
  NLA_PURGE_JOURNAL_KEY,
  NlaPurgeVerificationError,
  resumePendingNlaPurge,
  snapshotProtectedKeys,
  classifyOwnership,
} from "../nlaWorkspace";
import { importNlaWorkspace, candidatesKeyFor } from "../nlaImport";
import { runSchemaMigrations } from "../migrationPipeline";
import { fakeServer } from "../testSupport/fakeApi";

// The whole NLA -> account transition with the REAL coordinator, credentials and storage code (storage and the
// network are in memory). Both baker choices must leave the device clean, the account's data intact, and every
// other account's data and quarantine byte-for-byte untouched.

let mockStore: Record<string, string> = {};
let mockFailRemoveKey: string | null = null;
let mockKeepJournal = false;
let mockFailRestoredRecipeRead = false;
let mockFailMultiSet = false;
let mockOnRemove: ((key: string) => void) | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => {
    if (mockFailRestoredRecipeRead && k === "bread_lab_recipes_v1_acct-1" && mockStore[k]?.includes('"q1"')) return null;
    return k in mockStore ? mockStore[k] : null;
  }),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => {
    if (mockFailRemoveKey && k === mockFailRemoveKey) throw new Error("simulated crash");
    if (mockKeepJournal && k === "bread_lab_nla_purge_journal_v1") return;
    if (mockOnRemove) mockOnRemove(k);
    delete mockStore[k];
  }),
  multiSet: jest.fn(async (pairs: [string, string][]) => {
    if (mockFailMultiSet) throw new Error("simulated credential write failure");
    pairs.forEach(([k, v]) => { mockStore[k] = v; });
  }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
  multiGet: jest.fn(async (ks: string[]) => ks.map((k) => [k, k in mockStore ? mockStore[k] : null])),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));
jest.mock("../api", () => require("../testSupport/fakeApi").makeApiModule());
jest.mock("../deviceId", () => ({ getDeviceId: jest.fn(async () => "device-1") }));

const TOKEN = "acct-1";
const USER = { id: TOKEN, firstName: "A", starterName: "S" };
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const get = (key: string) => (key in mockStore ? JSON.parse(mockStore[key]) : undefined);
const phases = [{ key: "mix", name: "Mix", ingredients: ["flour"], instructions: ["stir"] }];

const seedNla = () => {
  put("bread_lab_recipes_v1", [{ id: "r-legacy", name: "Legacy", phases }]);
  put("bread_lab_recipes_v1_anonymous", [{ id: "r-1", name: "Loaf", userId: "anonymous", phases }]);
  put("bread_lab_bake_history_v1", [{ id: "b-1", recipeName: "Loaf", savedAt: 1, startedAt: 1, userId: "anonymous", phases: [] }]);
  put("bread_lab_bake_history_v1_anonymous", [{ id: "b-2", recipeName: "Rye", savedAt: 2, startedAt: 2, phases: [] }]);
  put("bread_lab_bake_v2_anonymous", [{ id: "ab-1", recipeName: "Active", savedAt: 3, startedAt: 3, userId: "anonymous", phases: [] }]);
  put("sourdough_feed_history_v1", [{ id: "f-1", userId: "anonymous", savedAt: 5, readings: [] }]);
  put("sourdough_feed_session_v1", { id: "af-1", userId: "anonymous", savedAt: 7 });
  put("bread_lab_candidates_v1_anonymous", [{ id: "c-1", sharedAt: "2026-02-02T00:00:00.000Z", extractionResult: { s: 1 } }]);
  put("bread_lab_deleted_feed_ids_v1_anonymous", ["gone"]);
  put("bread_lab_quarantine_anonymous", { recipes: [{ id: "old", name: "Parked Recipe", userId: "anonymous", phases }] });
};

// Everything that belongs to ANOTHER account (or to nobody): must survive every transition untouched.
const seedOthers = () => {
  put("bread_lab_recipes_v1_acct-1", [{ id: "r-1", name: "Account's own r-1", userId: "acct-1" }]); // same id as an NLA record
  put("bread_lab_recipes_v1_acct-2", [{ id: "x", name: "Other account", userId: "acct-2" }]);
  put("bread_lab_bake_v2_acct-2", [{ id: "ab-2", userId: "acct-2" }]);
  put("bread_lab_deleted_feed_ids_v1_acct-2", ["theirs"]);
  put("bread_lab_candidates_v1_acct-2", [{ id: "oc", sharedAt: "x", extractionResult: {} }]);
  put("bread_lab_quarantine_acct-1", { recipes: [{ id: "q1", userId: "acct-1" }] });
  put("bread_lab_quarantine_acct-2", { feedHistory: [{ id: "q2", userId: "acct-2" }] });
  put("bread_lab_quarantine_unknown", { recipes: [{ id: "u1" }] });
  mockStore["bread_lab_device_id_v1"] = "device-xyz";
  mockStore["bread_lab_temp_unit_v1"] = "F";
  mockStore["bread_lab_starter_tutorial_active_v1"] = "true";
  mockStore["font_size_large_v1"] = "1";
  mockStore["global_bulk_estimator_v1"] = JSON.stringify({ x: 1 });
};
const OTHER_KEYS = [
  "bread_lab_recipes_v1_acct-2", "bread_lab_bake_v2_acct-2", "bread_lab_deleted_feed_ids_v1_acct-2",
  "bread_lab_candidates_v1_acct-2", "bread_lab_quarantine_acct-2", "bread_lab_quarantine_unknown",
  "bread_lab_device_id_v1", "bread_lab_temp_unit_v1", "bread_lab_starter_tutorial_active_v1", "font_size_large_v1", "global_bulk_estimator_v1",
];
const snapshotOthers = () => Object.fromEntries(OTHER_KEYS.map((k) => [k, mockStore[k] ?? null]));

const NLA_ONLY_KEYS = NLA_ALL_KEYS.filter(
  (k) => /_anonymous$/.test(k) || k === "bread_lab_candidates_v1"
);
const expectNoNlaWorkspaceLeft = () => {
  for (const key of NLA_ONLY_KEYS) expect(mockStore[key]).toBeUndefined();
  // Fixed-name keys may now hold the destination account's OWN restored cache, but never an NLA record.
  for (const key of NLA_ALL_KEYS) {
    if (!(key in mockStore) || NLA_ONLY_KEYS.includes(key)) continue;
    const value = JSON.parse(mockStore[key]);
    const records = Array.isArray(value) ? value : [value];
    for (const rec of records) {
      if (rec && typeof rec === "object") expect(["nla", "unstamped"]).not.toContain(classifyOwnership(rec));
    }
  }
};

const runTransition = async (mode: "import" | "discard", extra: Record<string, any> = {}) => {
  if (mode === "import") {
    const out = await importNlaWorkspace(TOKEN);
    expect(out.report.ok).toBe(true);
    return executeWorkspaceTransition(null, TOKEN, TOKEN, USER, {
      activeFeedAcknowledged: true,
      nlaDisposition: { mode: "import", plan: out.purgePlan!, snapshotRaw: out.inventory.raw },
      ...extra,
    });
  }
  const inv = await inventoryNlaWorkspace();
  return executeWorkspaceTransition(null, TOKEN, TOKEN, USER, {
    activeFeedAcknowledged: true,
    nlaDisposition: { mode: "discard", plan: authorizeDiscardPlan(buildPurgePlan(inv, "discard")), snapshotRaw: inv.raw },
    ...extra,
  });
};

describe("NLA -> account transition (real coordinator)", () => {
  beforeEach(() => {
    mockStore = {};
    mockFailRemoveKey = null;
    mockKeepJournal = false;
    mockFailRestoredRecipeRead = false;
    mockFailMultiSet = false;
    mockOnRemove = null;
    fakeServer.reset();
    setCoordinatorState("IDLE");
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["import", "discard"] as const)("blocks %s before mutation when a legacy Candidate has unknown ownership", async mode => {
    seedNla();
    put("bread_lab_candidates_v1", [{ id: "legacy-candidate", extractionResult: {} }]);
    const before = { ...mockStore };
    const inventory = await inventoryNlaWorkspace();
    expect(inventory.eligible.candidates.map(candidate => candidate.id)).toEqual(["c-1"]);
    expect(inventory.unresolved).toContainEqual(expect.objectContaining({
      id: "legacy-candidate", reason: "unknown-owner", sources: ["bread_lab_candidates_v1"],
    }));

    const { authorizeNlaTransitionIntent } = require("../nlaWorkspace");
    const intent = authorizeNlaTransitionIntent(mode, inventory.raw);
    const prepareIncoming = jest.fn();
    await expect(executeWorkspaceTransition(null, null, null, null, {
      nlaTransitionIntent: intent, prepareIncoming, activeFeedAcknowledged: true,
    })).rejects.toThrow(/no confirmed workspace owner/);
    expect(prepareIncoming).not.toHaveBeenCalled();

    if (mode === "import") {
      const result = await importNlaWorkspace(TOKEN);
      expect(result.report.ok).toBe(false);
      expect(result.purgePlan).toBeNull();
    }
    expect(fakeServer.calls).toEqual([]);
    expect(mockStore).toEqual(before);
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it.each([
    { recipes: "unexpected malformed content" },
    { unknownField: [] },
    { activeFeed: [] },
    { deletedFeedIds: [null] },
    { bakeHistory: [{ id: "ownerless" }] },
  ])("blocks both sign-in choices when offline quarantine cannot be accounted for (%j)", async residue => {
    seedNla();
    put("bread_lab_quarantine_anonymous", residue);
    const before = { ...mockStore };
    const inventory = await inventoryNlaWorkspace();
    expect(inventory.readable).toBe(false);
    expect(inventory.unresolved).toContainEqual(expect.objectContaining({ type: "residue" }));

    for (const mode of ["import", "discard"] as const) {
      const { authorizeNlaTransitionIntent } = require("../nlaWorkspace");
      const prepareIncoming = jest.fn();
      await expect(executeWorkspaceTransition(null, null, null, null, {
        nlaTransitionIntent: authorizeNlaTransitionIntent(mode, inventory.raw),
        prepareIncoming, activeFeedAcknowledged: true,
      })).rejects.toThrow(/offline quarantine/);
      expect(prepareIncoming).not.toHaveBeenCalled();
    }
    expect((await importNlaWorkspace(TOKEN)).purgePlan).toBeNull();
    expect(fakeServer.calls).toEqual([]);
    expect(mockStore).toEqual(before);
  });

  it("imports quarantine-only completed work and preserves it until remote verification succeeds", async () => {
    const key = "bread_lab_quarantine_anonymous";
    put(key, {
      recipes: [{ id: "parked-recipe", userId: "anonymous", name: "Parked Loaf", phases }],
      bakeHistory: [{ id: "parked-bake", userId: "anonymous", recipeId: "parked-recipe", recipeName: "Parked Loaf", savedAt: 2, startedAt: 1, phases }],
      feedHistory: [{ id: "parked-feed", userId: "anonymous", savedAt: 3 }],
    });
    const original = mockStore[key];
    fakeServer.dropUpsert = kind => kind === "recipe";
    const failed = await importNlaWorkspace(TOKEN);
    expect(failed.report.ok).toBe(false);
    expect(failed.purgePlan).toBeNull();
    expect(mockStore[key]).toBe(original);
    expect(mockStore.bread_lab_auth_token_v1).toBeUndefined();

    fakeServer.dropUpsert = null;
    await runTransition("import");
    expect(mockStore[key]).toBeUndefined();
    expect(mockStore.bread_lab_auth_token_v1).toBe(TOKEN);
    const [recipe] = [...fakeServer.tables.recipe.values()];
    expect(recipe).toMatchObject({ name: "Parked Loaf", user_id: TOKEN });
    expect(fakeServer.tables.bake.get("parked-bake")).toMatchObject({ recipe_id: recipe.id, user_id: TOKEN });
    expect(fakeServer.tables.feed.get("parked-feed")).toMatchObject({ user_id: TOKEN });
  });

  it("blocks import before upload when a quarantine Recipe conflicts with a live copy", async () => {
    const key = "bread_lab_quarantine_anonymous";
    put(key, { recipes: [{ id: "shared-id", userId: "anonymous", name: "Parked Loaf", phases }] });
    put("bread_lab_recipes_v1_anonymous", [{ id: "shared-id", userId: "anonymous", name: "Different Loaf", phases }]);
    const before = { ...mockStore };

    const result = await importNlaWorkspace(TOKEN);
    expect(result.report.ok).toBe(false);
    expect(result.inventory.unresolved).toContainEqual(expect.objectContaining({ type: "residue", reason: "conflict" }));
    expect(fakeServer.calls).toEqual([]);
    expect(mockStore).toEqual(before);
  });

  describe.each(["import", "discard"] as const)("%s: NLA cleanup and incoming-account restoration", (mode) => {
    it("clears eligible NLA data, restores the incoming account, and preserves unrelated storage", async () => {
      seedNla();
      seedOthers();
      const others = snapshotOthers();

      await runTransition(mode);

      expect(getCoordinatorState()).toBe("IDLE");
      expectNoNlaWorkspaceLeft();                                                  // owner-named keys, residue, tombstones, and every NLA record
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();                    // journal cleared
      expect(snapshotOthers()).toEqual(others);                                    // other accounts, unknown quarantine, device settings
      expect(get("bread_lab_recipes_v1_acct-1")).toEqual([
        { id: "r-1", name: "Account's own r-1", userId: TOKEN },
        { id: "q1", userId: TOKEN },
      ]);
      expect(get("bread_lab_quarantine_acct-1")).toEqual({});
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);                    // signed in
      const after = await inventoryNlaWorkspace();
      expect(after.counts.eligibleTotal + after.counts.tombstones + after.counts.residue).toBe(0);
    });

    it("an active bake in the FIXED-NAME key (even one with no owner stamp) does not block the gate: it is discarded, never uploaded", async () => {
      put("bread_lab_bake_v2", [{ id: "ab-legacy", recipeName: "Old active bake", savedAt: 1, startedAt: 1, phases: [] }]); // unstamped
      await runTransition(mode);
      expect(getCoordinatorState()).toBe("IDLE");
      expect(mockStore["bread_lab_bake_v2"]).toBeUndefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
      expect(fakeServer.tables.bake.has("ab-legacy")).toBe(false);
    });

    it("preserves the incoming account's existing record and restores its parked record exactly once", async () => {
      seedNla();
      seedOthers();
      const original = get("bread_lab_recipes_v1_acct-1")[0];
      await runTransition(mode);
      const recipes = get("bread_lab_recipes_v1_acct-1");
      expect(recipes.find((recipe: any) => recipe.id === "r-1")).toEqual(original);
      expect(recipes.filter((recipe: any) => recipe.id === "r-1")).toHaveLength(1);
      expect(recipes.filter((recipe: any) => recipe.id === "q1")).toEqual([{ id: "q1", userId: TOKEN }]);
      expect(get("bread_lab_quarantine_acct-1")).toEqual({});
    });

    it("keeps the incoming account's quarantine when destination read-back fails", async () => {
      seedNla();
      seedOthers();
      const parked = mockStore["bread_lab_quarantine_acct-1"];
      const unrelated = snapshotOthers();
      mockFailRestoredRecipeRead = true;
      await expect(runTransition(mode)).rejects.toThrow(/Restore verification failed/);
      expect(mockStore["bread_lab_quarantine_acct-1"]).toBe(parked);
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
      expect(snapshotOthers()).toEqual(unrelated);
    });

    it("discards the NLA active bake (owner-named cabinet) and never uploads it", async () => {
      seedNla();
      await runTransition(mode);
      expect(mockStore["bread_lab_bake_v2_anonymous"]).toBeUndefined();
      expect(fakeServer.tables.bake.has("ab-1")).toBe(false);
    });

    it("reports and keeps what it cannot process: conflicts and foreign-owned records stay put, the transition still completes", async () => {
      put("bread_lab_recipes_v1", [{ id: "dup", name: "A" }, { id: "theirs", name: "Theirs", userId: "acct-9" }, { id: "fine", name: "Fine", phases }]);
      put("bread_lab_recipes_v1_anonymous", [{ id: "dup", name: "B", userId: "anonymous" }]);

      await runTransition(mode);

      expect(get("bread_lab_recipes_v1").map((r: any) => r.id).sort()).toEqual(["dup", "theirs"]);
      expect(get("bread_lab_recipes_v1_anonymous")).toEqual([{ id: "dup", name: "B", userId: "anonymous" }]);
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
    });
  });

  describe("import specifics", () => {
    it("the account really has the data: recipes, bakes, feeds uploaded and drafts re-homed (not promoted, not uploaded)", async () => {
      seedNla();
      await runTransition("import");
      expect(fakeServer.tables.recipe.size).toBe(3);
      expect(fakeServer.tables.bake.size).toBe(2);
      expect(fakeServer.tables.feed.size).toBe(1);
      expect(get(candidatesKeyFor(TOKEN)).map((c: any) => c.id).sort()).toEqual(["c-1"]);
    });
  });

  describe("Proceed Without Importing: nothing is uploaded and nothing is deleted from Supabase", () => {
    it("makes no API call at all", async () => {
      seedNla();
      await runTransition("discard");
      expect(fakeServer.calls).toEqual([]);
      expect(get(candidatesKeyFor(TOKEN))).toBeUndefined(); // drafts are removed, not moved
    });
  });

  describe("safety gates", () => {
    it("refuses (before changing anything) when the offline workspace changed after the baker's choice", async () => {
      seedNla();
      seedOthers();
      const inv = await inventoryNlaWorkspace();
      const plan = authorizeDiscardPlan(buildPurgePlan(inv, "discard"));
      put("bread_lab_recipes_v1_anonymous", [...get("bread_lab_recipes_v1_anonymous"), { id: "late", name: "Added meanwhile", userId: "anonymous" }]);
      const stateBefore = { ...mockStore };

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "discard", plan, snapshotRaw: inv.raw } })
      ).rejects.toBeInstanceOf(NlaWorkspaceChangedError);

      expect(mockStore).toEqual(stateBefore);   // nothing deleted that the baker did not see
      expect(getCoordinatorState()).toBe("IDLE");
    });

    it("refuses (before changing anything) to discard active Feed or Bake work the baker was not warned about", async () => {
      put("bread_lab_bake_v2_anonymous", [{ id: "ab-1", userId: "anonymous", phases: [] }]);
      const inv = await inventoryNlaWorkspace();
      const stateBefore = { ...mockStore };

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { nlaDisposition: { mode: "discard", plan: authorizeDiscardPlan(buildPurgePlan(inv, "discard")), snapshotRaw: inv.raw } })
      ).rejects.toBeInstanceOf(ActiveFeedNotAcknowledgedError);

      expect(mockStore).toEqual(stateBefore);
      expect(getCoordinatorState()).toBe("IDLE");
    });

    it("a stale 'import in progress' marker and pending NLA deletions do not block the baker's explicit choice", async () => {
      seedNla();
      mockStore["bread_lab_migration_pending_v1"] = "1";
      await expect(runTransition("discard")).resolves.toBeUndefined();
      expect(mockStore["bread_lab_migration_pending_v1"]).toBeUndefined();
    });

    it("an unresolved LEGACY flat tombstone queue still blocks, and nothing is purged", async () => {
      seedNla();
      put("bread_lab_deleted_recipe_ids_v1", ["legacy-pending"]); // pre-ownership queue with unknown provenance
      const before = Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
      const inv = await inventoryNlaWorkspace();

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "discard", plan: authorizeDiscardPlan(buildPurgePlan(inv, "discard")), snapshotRaw: inv.raw } })
      ).rejects.toThrow(/Transition blocked/);

      expect(getCoordinatorState()).toBe("IDLE");
      // NLA's own pending deletions were retired (they have no remote copy), but no record was purged.
      const after = Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
      expect({ ...after, bread_lab_deleted_feed_ids_v1_anonymous: before.bread_lab_deleted_feed_ids_v1_anonymous }).toEqual(before);
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
    });
  });

  describe("crash safety and recovery", () => {
    it("blocks transition and recovery while journal retirement remains unverified", async () => {
      const { recoverTransition } = require("../transitionCoordinator");
      put("bread_lab_candidates_v1_anonymous", [{ id: "draft", extractionResult: {} }]);
      mockKeepJournal = true;
      await expect(runTransition("discard")).rejects.toThrow(/journal remains after removal/);
      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeDefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      setCoordinatorState("IDLE");
      await expect(runTransition("discard")).rejects.toThrow(/recovery required/i);
      expect(await recoverTransition()).toMatchObject({ localClear: false });
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeDefined();
      mockKeepJournal = false;
      expect(await recoverTransition()).toEqual({ remoteSignout: true, localClear: true });
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      expectNoNlaWorkspaceLeft();
    });

    it("blocks a fresh transition and recovers an interrupted purge without an active-work snapshot", async () => {
      const { recoverTransition } = require("../transitionCoordinator");
      put("bread_lab_candidates_v1_anonymous", [{ id: "draft", extractionResult: {} }]);
      put("bread_lab_quarantine_anonymous", { recipes: [{ id: "parked", userId: "anonymous" }] });
      mockFailRemoveKey = "bread_lab_quarantine_anonymous";
      await expect(runTransition("discard")).rejects.toThrow("simulated crash");
      const journal = mockStore[NLA_PURGE_JOURNAL_KEY];
      expect(journal).toBeDefined();
      expect(mockStore["bread_lab_pending_nla_active_snapshot_v1"]).toBeUndefined();

      setCoordinatorState("IDLE"); // A new process has only the durable journal.
      const beforeTransition = jest.fn();
      await expect(runTransition("discard", { beforeTransition })).rejects.toThrow(/recovery required/i);
      expect(beforeTransition).not.toHaveBeenCalled();
      expect(await recoverTransition()).toMatchObject({ localClear: false });
      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBe(journal);
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();

      mockFailRemoveKey = null;
      expect(await recoverTransition()).toEqual({ remoteSignout: true, localClear: true });
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();
      expectNoNlaWorkspaceLeft();
      expect(getCoordinatorState()).toBe("IDLE");
      await runTransition("discard");
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
    });

    it("a crash part-way through the purge preserves active NLA work through startup recovery", async () => {
      seedNla();
      seedOthers();
      const others = snapshotOthers();
      const inv = await inventoryNlaWorkspace();
      const plan = authorizeDiscardPlan(buildPurgePlan(inv, "discard"));
      mockFailRemoveKey = "bread_lab_quarantine_anonymous"; // fails when the residue is reached

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "discard", plan, snapshotRaw: inv.raw } })
      ).rejects.toThrow("simulated crash");

      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();   // never signed in half-clean
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeDefined();         // the work is journaled

      // "Next launch": crash recovery runs from the startup pipeline.
      mockFailRemoveKey = null;
      await runSchemaMigrations();

      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();
      expect(get("bread_lab_bake_v2_anonymous").map((b: any) => b.id)).toEqual(["ab-1"]);
      expect(get("sourdough_feed_session_v1").id).toBe("af-1");
      expect(mockStore["bread_lab_pending_nla_active_snapshot_v1"]).toBeUndefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      expect(snapshotOthers()).toEqual(others);
    });

    it("recovery never removes a record the baker created after the crash (the journal names exact records)", async () => {
      seedNla();
      const inv = await inventoryNlaWorkspace();
      const plan = authorizeDiscardPlan(buildPurgePlan(inv, "discard"));
      mockFailRemoveKey = "bread_lab_quarantine_anonymous";
      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "discard", plan, snapshotRaw: inv.raw } })
      ).rejects.toThrow();
      mockFailRemoveKey = null;
      put("bread_lab_recipes_v1_anonymous", [{ id: "created-after-crash", name: "New", userId: "anonymous", phases }]);

      await resumePendingNlaPurge();

      expect(get("bread_lab_recipes_v1_anonymous")).toEqual([{ id: "created-after-crash", name: "New", userId: "anonymous", phases }]);
    });

    it("restores unfinished NLA work when saving account credentials fails", async () => {
      seedNla();
      const out = await importNlaWorkspace(TOKEN);
      expect(out.report.ok).toBe(true);
      mockFailMultiSet = true;

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "import", plan: out.purgePlan!, snapshotRaw: out.inventory.raw } })
      ).rejects.toThrow();

      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();   // still NLA, but the verified records live in the account
      expect(fakeServer.tables.recipe.size).toBe(3);
      expect(fakeServer.tables.bake.size).toBe(2);
      expect(get("bread_lab_bake_v2_anonymous").map((b: any) => b.id)).toEqual(["ab-1"]);
      expect(get("sourdough_feed_session_v1").id).toBe("af-1");

      // The baker can retry; the unfinished work remains in NLA until that transition succeeds.
      mockFailMultiSet = false;
      setCoordinatorState("IDLE");
      await expect(runTransition("import")).resolves.toBeUndefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
      expect(fakeServer.tables.recipe.size).toBe(3); // no duplicates from the second pass
    });
  });

  describe("final local-cleanliness verification", () => {
    it("fails the transition if the purge disturbed anything outside the NLA scope", async () => {
      seedNla();
      seedOthers();
      const inv = await inventoryNlaWorkspace();
      const plan = authorizeDiscardPlan(buildPurgePlan(inv, "discard"));
      // A misbehaving removal that also damages another account's quarantine, during the purge itself.
      mockOnRemove = (key) => {
        if (key === "bread_lab_quarantine_anonymous") mockStore["bread_lab_quarantine_acct-1"] = JSON.stringify({ recipes: [] });
      };

      await expect(
        executeWorkspaceTransition(null, TOKEN, TOKEN, USER, { activeFeedAcknowledged: true, nlaDisposition: { mode: "discard", plan, snapshotRaw: inv.raw } })
      ).rejects.toBeInstanceOf(NlaPurgeVerificationError);

      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
    });
  });

  describe("startup", () => {
    it("with no journal the startup recovery leaves the offline workspace untouched", async () => {
      seedNla();
      const before = Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
      await runSchemaMigrations();
      const after = Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
      expect(after.bread_lab_recipes_v1_anonymous).toBe(before.bread_lab_recipes_v1_anonymous);
      expect(after.bread_lab_candidates_v1_anonymous).toBe(before.bread_lab_candidates_v1_anonymous);
      expect(after.bread_lab_quarantine_anonymous).toBe(before.bread_lab_quarantine_anonymous);
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();
    });
  });
  it("(support) protected snapshot ignores the NLA scope and the journal", async () => {
    seedNla();
    const snap = await snapshotProtectedKeys();
    for (const key of NLA_ALL_KEYS) expect(Object.keys(snap)).not.toContain(key);
  });
});
