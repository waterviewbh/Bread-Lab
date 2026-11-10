import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NLA_SCOPE,
  NLA_ALL_KEYS,
  NLA_PURGE_JOURNAL_KEY,
  LEGACY_GLOBAL_CANDIDATES_KEY_NLA,
  ANONYMOUS_CANDIDATES_KEY_NLA,
  inventoryNlaWorkspace,
  buildPurgePlan,
  applyNlaPurgeLocked,
  resumePendingNlaPurgeLocked,
  verifyNlaCleanliness,
  snapshotProtectedKeys,
  nlaSnapshotChanged,
  summarizeInventory,
  describeInventory,
  classifyOwnership,
  stableStringify,
  type NlaInventory,
} from "../nlaWorkspace";

// Authoritative NLA inventory, conflict rule, journaled purge and isolation (Omicron_CLI-4).

let mockStore: Record<string, string> = {};
let mockFailOnRemoveKey: string | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => {
    if (mockFailOnRemoveKey && k === mockFailOnRemoveKey) throw new Error("simulated crash");
    delete mockStore[k];
  }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
  multiGet: jest.fn(async (ks: string[]) => ks.map((k) => [k, k in mockStore ? mockStore[k] : null])),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));

const K = {
  recipesA: "bread_lab_recipes_v1",
  recipesB: "bread_lab_recipes_v1_anonymous",
  bakeHistA: "bread_lab_bake_history_v1",
  bakeHistB: "bread_lab_bake_history_v1_anonymous",
  activeBakeA: "bread_lab_bake_v2",
  activeBakeB: "bread_lab_bake_v2_anonymous",
  feedHist: "sourdough_feed_history_v1",
  activeFeed: "sourdough_feed_session_v1",
  candLegacy: "bread_lab_candidates_v1",
  candAnon: "bread_lab_candidates_v1_anonymous",
  tombRecipe: "bread_lab_deleted_recipe_ids_v1_anonymous",
  tombBake: "bread_lab_deleted_bake_ids_v1_anonymous",
  tombFeed: "bread_lab_deleted_feed_ids_v1_anonymous",
  residue: "bread_lab_quarantine_anonymous",
};
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const get = (key: string) => (key in mockStore ? JSON.parse(mockStore[key]) : undefined);

// Data that must NEVER be touched by any NLA purge.
const seedProtected = () => {
  put("bread_lab_recipes_v1_acct-1", [{ id: "a1", name: "Account recipe", userId: "acct-1" }]);
  put("bread_lab_bake_v2_acct-1", [{ id: "ab1", userId: "acct-1" }]);
  put("bread_lab_deleted_feed_ids_v1_acct-1", ["acct-pending"]);
  put("bread_lab_candidates_v1_acct-1", [{ id: "ac1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: {} }]);
  put("bread_lab_quarantine_acct-1", { recipes: [{ id: "q1", userId: "acct-1" }] });
  put("bread_lab_quarantine_acct-2", { feedHistory: [{ id: "q2", userId: "acct-2" }] });
  put("bread_lab_quarantine_unknown", { recipes: [{ id: "u1" }] });
  put("bread_lab_import_ledger_acct-1", { "recipe:x": "y" });
  mockStore["bread_lab_auth_token_v1"] = "acct-1";
  mockStore["bread_lab_device_id_v1"] = "device-xyz";
  mockStore["bread_lab_temp_unit_v1"] = "F";
  mockStore["bread_lab_starter_tutorial_active_v1"] = "true";
  mockStore["font_size_large_v1"] = "1";
  mockStore["global_bulk_estimator_v1"] = JSON.stringify({ x: 1 });
};

const seedWorkspace = () => {
  // Cabinet A (fixed names) and cabinet B (owner-named), NLA stamped and unstamped
  put(K.recipesA, [{ id: "r-legacy", name: "Legacy recipe" }]);                      // unstamped
  put(K.recipesB, [{ id: "r-1", name: "Country loaf", userId: "anonymous" }, { id: "r-2", name: "Rye", userId: "anonymous" }]);
  put(K.bakeHistA, [{ id: "b-1", recipeName: "Loaf", userId: "anonymous" }]);
  put(K.bakeHistB, [{ id: "b-2", recipeName: "Rye", userId: "anonymous" }]);
  put(K.activeBakeB, [{ id: "ab-1", recipeName: "Active", userId: "anonymous" }]);
  put(K.feedHist, [{ id: "f-1", userId: "anonymous" }, { id: "f-2" }]);               // one unstamped
  put(K.activeFeed, { id: "af-1", userId: "anonymous" });
  put(K.candAnon, [{ id: "c-1", sharedAt: "2026-02-02T00:00:00.000Z", extractionResult: { s: 1 } }]);
  put(K.candLegacy, [{ id: "c-2", sharedAt: "2026-02-03T00:00:00.000Z", extractionResult: { s: 2 } }]);
  put(K.tombRecipe, ["r-gone"]);
  put(K.tombFeed, ["f-gone"]);
  put(K.residue, { recipes: [{ id: "old-r", userId: "anonymous" }], bakeHistory: [{ id: "old-b", userId: "anonymous" }] });
};

describe("NLA workspace inventory, conflicts, purge and isolation", () => {
  beforeEach(() => {
    mockStore = {};
    mockFailOnRemoveKey = null;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe("inventory", () => {
    it("candidate key constants match candidateStorage's exports", () => {
      const cs = jest.requireActual("../candidateStorage");
      expect(LEGACY_GLOBAL_CANDIDATES_KEY_NLA).toBe(cs.LEGACY_GLOBAL_CANDIDATES_KEY);
      expect(ANONYMOUS_CANDIDATES_KEY_NLA).toBe(cs.ANONYMOUS_CANDIDATES_KEY);
    });

    it("reads BOTH cabinets, counts every type, and counts unstamped records", async () => {
      seedWorkspace();
      const inv = await inventoryNlaWorkspace();
      expect(inv.readable).toBe(true);
      expect(inv.counts).toMatchObject({
        recipes: 3,        // 1 fixed-name (unstamped) + 2 owner-named
        bakeHistory: 2,
        activeBakes: 1,
        feedHistory: 2,
        activeFeed: 1,
        candidates: 2,     // legacy global key + anonymous key
        tombstones: 2,
        residue: 2,
        unstamped: 2,      // r-legacy and f-2
        conflicts: 0,
        unresolvedTotal: 0,
      });
      expect(inv.eligible.recipes.find((r) => r.id === "r-legacy")!.cls).toBe("unstamped");
      expect(inv.eligible.recipes.find((r) => r.id === "r-1")!.sources).toEqual([K.recipesB]);
    });

    it("an empty device reports nothing and every key it inspected is a known NLA key", async () => {
      const inv = await inventoryNlaWorkspace();
      expect(summarizeInventory(inv).anything).toBe(false);
      expect(describeInventory(summarizeInventory(inv))).toBe("No offline records were found on this device.");
      expect(Object.keys(inv.raw).sort()).toEqual([...NLA_ALL_KEYS].sort());
    });

    it("de-duplicates the same record found in both cabinets when only the ownership stamp differs", async () => {
      put(K.recipesA, [{ id: "r-dup", name: "Same", phases: [] }]);                                // unstamped
      put(K.recipesB, [{ id: "r-dup", name: "Same", phases: [], userId: "anonymous" }]);           // stamped
      const inv = await inventoryNlaWorkspace();
      expect(inv.eligible.recipes).toHaveLength(1);
      expect(inv.eligible.recipes[0].sources.sort()).toEqual([K.recipesA, K.recipesB].sort());
      expect(inv.counts.conflicts).toBe(0);
    });

    it("reports a CONFLICT (never picks a copy) when the same id has different content", async () => {
      put(K.recipesA, [{ id: "r-x", name: "Version A" }]);
      put(K.recipesB, [{ id: "r-x", name: "Version B", userId: "anonymous" }]);
      const inv = await inventoryNlaWorkspace();
      expect(inv.eligible.recipes).toHaveLength(0);
      expect(inv.counts.conflicts).toBe(1);
      expect(inv.unresolved[0]).toMatchObject({ type: "recipes", reason: "conflict", id: "r-x" });
      expect(inv.unresolved[0].sources.sort()).toEqual([K.recipesA, K.recipesB].sort());
    });

    it("applies the conflict rule to bakes, feeds and candidates too", async () => {
      put(K.bakeHistA, [{ id: "b", recipeName: "One" }]);
      put(K.bakeHistB, [{ id: "b", recipeName: "Two", userId: "anonymous" }]);
      put(K.feedHist, [{ id: "f", n: 1 }, { id: "f", n: 2 }]);
      put(K.candLegacy, [{ id: "c", sharedAt: "x", extractionResult: { a: 1 } }]);
      put(K.candAnon, [{ id: "c", sharedAt: "x", extractionResult: { a: 2 } }]);
      const inv = await inventoryNlaWorkspace();
      expect(inv.unresolved.filter((u) => u.reason === "conflict").map((u) => u.type).sort()).toEqual(["bakeHistory", "candidates", "feedHistory"]);
      expect(inv.counts.eligibleTotal).toBe(0);
    });

    it("never treats foreign-owned, conflicting-stamp or malformed records as eligible", async () => {
      put(K.recipesA, [
        { id: "mine", name: "Mine" },
        { id: "theirs", name: "Theirs", userId: "acct-9" },
        { id: "both", name: "Both", userId: "anonymous", user_id: "acct-9" },
        { name: "no id" },
        "garbage",
      ]);
      const inv = await inventoryNlaWorkspace();
      expect(inv.eligible.recipes.map((r) => r.id)).toEqual(["mine"]);
      expect(inv.unresolved.map((u) => u.reason).sort()).toEqual(["conflicting-stamp", "foreign", "malformed", "malformed"]);
    });

    it("flags unreadable data and marks the inventory unreadable (so nothing can proceed)", async () => {
      mockStore[K.recipesB] = "{not json";
      const inv = await inventoryNlaWorkspace();
      expect(inv.readable).toBe(false);
      expect(inv.unresolved.some((u) => u.reason === "unreadable")).toBe(true);
      expect(() => buildPurgePlan(inv, "discard")).toThrow(/unreadable/);
    });

    it("counts older set-aside records separately and leaves foreign contents of the bucket unresolved", async () => {
      put(K.residue, {
        recipes: [{ id: "old", userId: "anonymous" }, { id: "other", userId: "acct-3" }],
        deletedFeedIds: ["x", "y"],
      });
      const inv = await inventoryNlaWorkspace();
      expect(inv.counts.residue).toBe(3); // 1 NLA recipe + 2 queued ids
      expect(inv.unresolved).toEqual([expect.objectContaining({ type: "residue", reason: "foreign", id: "other" })]);
    });

    it("classifies ownership stamps correctly", () => {
      expect(classifyOwnership({ id: "a" })).toBe("unstamped");
      expect(classifyOwnership({ id: "a", userId: "  " })).toBe("unstamped");
      expect(classifyOwnership({ id: "a", userId: "anonymous" })).toBe("nla");
      expect(classifyOwnership({ id: "a", user_id: "anonymous" })).toBe("nla");
      expect(classifyOwnership({ id: "a", userId: "acct" })).toBe("foreign");
      expect(classifyOwnership({ id: "a", userId: "acct", user_id: "other" })).toBe("conflicting-stamp");
      expect(classifyOwnership(null)).toBe("malformed");
      expect(classifyOwnership({ id: "" })).toBe("malformed");
    });

    it("stableStringify ignores key order and undefined", () => {
      expect(stableStringify({ b: 1, a: { d: undefined, c: 2 } })).toBe(stableStringify({ a: { c: 2 }, b: 1 }));
    });
  });

  describe("purge (Proceed Without Importing)", () => {
    it("removes the whole NLA workspace from BOTH cabinets and leaves everything else byte-for-byte unchanged", async () => {
      seedWorkspace();
      seedProtected();
      const before = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(before, "discard");
      const protectedBefore = await snapshotProtectedKeys();

      await applyNlaPurgeLocked(plan);

      for (const key of NLA_ALL_KEYS) expect(mockStore[key]).toBeUndefined();
      expect(await snapshotProtectedKeys()).toEqual(protectedBefore); // other accounts, credentials, preferences intact
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();        // journal cleared on success
      expect(await verifyNlaCleanliness(before, plan, protectedBefore)).toEqual([]);
      const after = await inventoryNlaWorkspace();
      expect(summarizeInventory(after).anything).toBe(false);
    });

    it("never touches another account's keys or quarantine even when the ids are identical", async () => {
      put(K.recipesB, [{ id: "same-id", name: "NLA", userId: "anonymous" }]);
      put("bread_lab_recipes_v1_acct-1", [{ id: "same-id", name: "Account", userId: "acct-1" }]);
      put("bread_lab_quarantine_acct-1", { recipes: [{ id: "same-id", userId: "acct-1" }] });
      const inv = await inventoryNlaWorkspace();
      await applyNlaPurgeLocked(buildPurgePlan(inv, "discard"));
      expect(mockStore[K.recipesB]).toBeUndefined();
      expect(get("bread_lab_recipes_v1_acct-1")).toEqual([{ id: "same-id", name: "Account", userId: "acct-1" }]);
      expect(get("bread_lab_quarantine_acct-1")).toEqual({ recipes: [{ id: "same-id", userId: "acct-1" }] });
    });

    it("keeps foreign-owned and conflicting records in a fixed-name key and removes only the NLA ones", async () => {
      put(K.recipesA, [
        { id: "nla-1", name: "mine" },
        { id: "foreign-1", name: "theirs", userId: "acct-9" },
        { id: "c", name: "A copy" },
      ]);
      put(K.recipesB, [{ id: "c", name: "B copy", userId: "anonymous" }]);
      const before = await inventoryNlaWorkspace();
      await applyNlaPurgeLocked(buildPurgePlan(before, "discard"));
      expect(get(K.recipesA).map((r: any) => r.id).sort()).toEqual(["c", "foreign-1"]);   // conflict + foreign kept
      expect(get(K.recipesB)).toEqual([{ id: "c", name: "B copy", userId: "anonymous" }]); // conflict kept
      const after = await inventoryNlaWorkspace();
      expect(after.counts.conflicts).toBe(1);
      expect(after.counts.foreign).toBe(1);
    });

    it("re-checks ownership at removal time: a planned id whose record now belongs to another account is NOT removed", async () => {
      put(K.recipesA, [{ id: "shared-id", name: "was NLA's" }, { id: "plain", name: "still NLA's" }]);
      put(K.bakeHistB, [{ id: "bk", recipeName: "Rye", userId: "anonymous" }]);
      const plan = buildPurgePlan(await inventoryNlaWorkspace(), "discard");
      // Between planning and applying (e.g. a resumed purge after a crash) the records changed hands.
      put(K.recipesA, [{ id: "shared-id", name: "now theirs", userId: "acct-9" }, { id: "plain", name: "still NLA's" }]);
      put(K.bakeHistB, [{ id: "bk", recipeName: "Rye", userId: "acct-9" }]);

      await expect(applyNlaPurgeLocked(plan)).resolves.toBeUndefined();

      expect(get(K.recipesA)).toEqual([{ id: "shared-id", name: "now theirs", userId: "acct-9" }]); // theirs kept, NLA's removed
      expect(get(K.bakeHistB)).toEqual([{ id: "bk", recipeName: "Rye", userId: "acct-9" }]);
    });

    it("purges the residue bucket by verified NLA ownership and keeps non-NLA contents", async () => {
      put(K.residue, {
        recipes: [{ id: "old", userId: "anonymous" }, { id: "other", userId: "acct-3" }],
        activeFeed: { id: "af", userId: "anonymous" },
      });
      const inv = await inventoryNlaWorkspace();
      await applyNlaPurgeLocked(buildPurgePlan(inv, "discard"));
      expect(get(K.residue)).toEqual({ recipes: [{ id: "other", userId: "acct-3" }] });
    });

    it("is repeatable: purging an already-clean device changes nothing", async () => {
      seedWorkspace();
      seedProtected();
      const inv = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(inv, "discard");
      await applyNlaPurgeLocked(plan);
      const snapshot = { ...mockStore };
      await applyNlaPurgeLocked(plan);
      expect(mockStore).toEqual(snapshot);
    });
  });

  describe("purge after a verified import", () => {
    it("removes only the verified ids plus the discarded active work, tombstones and residue", async () => {
      seedWorkspace();
      const inv = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(inv, "import", {
        recipes: ["r-1", "r-legacy"],          // r-2 was NOT verified
        bakeHistory: ["b-1", "b-2"],
        feedHistory: ["f-1", "f-2"],
        candidates: ["c-1", "c-2"],
      });
      await applyNlaPurgeLocked(plan);

      expect(get(K.recipesB).map((r: any) => r.id)).toEqual(["r-2"]);   // unverified record is still on the device
      expect(mockStore[K.recipesA]).toBeUndefined();
      expect(mockStore[K.activeBakeB]).toBeUndefined();                  // active work discarded, never uploaded
      expect(mockStore[K.activeFeed]).toBeUndefined();
      expect(mockStore[K.tombRecipe]).toBeUndefined();
      expect(mockStore[K.residue]).toBeUndefined();
    });

    it("refuses to build an import purge without the verified id sets", async () => {
      const inv = await inventoryNlaWorkspace();
      expect(() => buildPurgePlan(inv, "import")).toThrow(/verified id sets/);
    });
  });

  describe("crash safety", () => {
    it("a crash mid-purge leaves a journal; resuming finishes exactly the planned work", async () => {
      seedWorkspace();
      seedProtected();
      const inv = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(inv, "discard");
      const protectedBefore = await snapshotProtectedKeys();

      mockFailOnRemoveKey = K.tombRecipe; // simulated crash part-way through
      await expect(applyNlaPurgeLocked(plan)).rejects.toThrow(/simulated crash/);
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeDefined();       // journal survives the crash
      expect(mockStore[K.tombRecipe]).toBeDefined();                 // not finished

      mockFailOnRemoveKey = null;
      // Something the baker creates AFTER the crash is not part of the journaled plan...
      put(K.recipesB, [{ id: "brand-new", name: "New", userId: "anonymous" }]);
      expect(await resumePendingNlaPurgeLocked()).toBe(true);

      expect(mockStore[K.tombRecipe]).toBeUndefined();
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBeUndefined();
      expect(get(K.recipesB).map((r: any) => r.id)).toEqual(["brand-new"]);   // ...so it survives the resume
      const protectedAfter = await snapshotProtectedKeys();
      delete protectedAfter[K.recipesB];
      expect(protectedAfter).toEqual(protectedBefore);
      expect(await resumePendingNlaPurgeLocked()).toBe(false);               // nothing left to resume
    });

    it("an unreadable journal is left untouched and surfaced, never guessed at", async () => {
      mockStore[NLA_PURGE_JOURNAL_KEY] = "{broken";
      await expect(resumePendingNlaPurgeLocked()).rejects.toThrow(/journal is unreadable/);
      expect(mockStore[NLA_PURGE_JOURNAL_KEY]).toBe("{broken");
    });

    it("detects when the workspace changed after the snapshot was taken", async () => {
      seedWorkspace();
      const inv = await inventoryNlaWorkspace();
      expect(await nlaSnapshotChanged(inv.raw)).toBe(false);
      put(K.recipesB, [...get(K.recipesB), { id: "late", name: "Late", userId: "anonymous" }]);
      expect(await nlaSnapshotChanged(inv.raw)).toBe(true);
    });
  });

  describe("final local-cleanliness verification", () => {
    it("reports any change outside the NLA scope", async () => {
      seedWorkspace();
      seedProtected();
      const before = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(before, "discard");
      const protectedBefore = await snapshotProtectedKeys();
      await applyNlaPurgeLocked(plan);
      mockStore["bread_lab_quarantine_acct-1"] = JSON.stringify({ recipes: [] }); // someone disturbed another account
      const problems = await verifyNlaCleanliness(before, plan, protectedBefore);
      expect(problems).toContain("protected key changed: bread_lab_quarantine_acct-1");
    });

    it("reports planned data that is still there", async () => {
      seedWorkspace();
      const before = await inventoryNlaWorkspace();
      const plan = buildPurgePlan(before, "discard");
      const problems = await verifyNlaCleanliness(before, plan, await snapshotProtectedKeys());
      expect(problems.length).toBeGreaterThan(0);
    });
  });

  describe("presentation", () => {
    it("describes what is on the device in neutral, factual wording", async () => {
      seedWorkspace();
      const text = describeInventory(summarizeInventory(await inventoryNlaWorkspace()));
      expect(text).toBe(
        "This device has 3 recipes, 2 bakes in your history, 2 feeds in your history, 2 recipe drafts that are not in an account. " +
        "Also found: 2 older records set aside from earlier sign-ins."
      );
      expect(text).not.toMatch(/anonymous|lost|warning|permanent|discard/i);
    });

    it("reports conflicts and unprocessable items plainly", async () => {
      put(K.recipesA, [{ id: "x", name: "A" }]);
      put(K.recipesB, [{ id: "x", name: "B", userId: "anonymous" }]);
      put(K.bakeHistA, [{ id: "f", userId: "acct-9" }]);
      const text = describeInventory(summarizeInventory(await inventoryNlaWorkspace()));
      expect(text).toContain("1 record has two different copies and will be left on this device");
      expect(text).toContain("1 item could not be processed automatically and will be left on this device");
    });
  });
});
