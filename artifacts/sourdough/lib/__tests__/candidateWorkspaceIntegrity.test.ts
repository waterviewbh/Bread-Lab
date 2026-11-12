import { AppState } from "react-native";
import {
  saveCandidate,
  loadCandidates,
  updateCandidateExtraction,
  removeCandidate,
  clearCandidates,
  ingestStagedNativeShares,
  inspectLegacyCandidates,
  adoptLegacyCandidates,
  candidatesKeyForOwner,
  CandidateStorageError,
  LegacyCandidateVerificationError,
  StagedShareExtractionError,
  LEGACY_GLOBAL_CANDIDATES_KEY,
  ANONYMOUS_CANDIDATES_KEY,
} from "../candidateStorage";
import { getWorkspaceIdentity } from "../recipeStorage";
import { saveAuth, clearAuth } from "../auth";
import { storageMutex, StaleWorkspaceError, WorkspaceIdentityError } from "../storageUtils";

// Candidate storage integrity. Every operation belongs to ONE captured workspace; every mutation re-verifies it at the
// final write boundary under storageMutex. Real auth.ts, real generation counters, real storageMutex and an in-memory
// AsyncStorage (with read/write hooks to force interleavings and failures). No accessor is mocked.

let mockStore: Record<string, string> = {};
let mockGetHook: ((key: string, nth: number) => void | Promise<void>) | null = null;
let mockSetHook: ((key: string, value: string) => string | void | Promise<string | void>) | null = null;
let mockRemoveFails = false;
const mockReads: Record<string, number> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    mockReads[key] = (mockReads[key] ?? 0) + 1;
    const value = key in mockStore ? mockStore[key] : null; // the value as of the START of the read
    if (mockGetHook) await mockGetHook(key, mockReads[key]);
    return value;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    let toStore = value;
    if (mockSetHook) { const replaced = await mockSetHook(key, value); if (typeof replaced === "string") toStore = replaced; }
    mockStore[key] = toStore;
  }),
  removeItem: jest.fn(async (key: string) => { if (!mockRemoveFails) delete mockStore[key]; }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
}));

const mockShares: { items: any[]; consumed: number } = { items: [], consumed: 0 };
jest.mock("../stagedShareBridge", () => ({
  getAndClearStagedShares: jest.fn(async () => { mockShares.consumed++; const i = mockShares.items; mockShares.items = []; return i; }),
}));
const mockExtract: { text: (t: string) => any; url: (u: string) => Promise<any> } = {
  text: () => ({ status: "single_candidate", recipe: { name: "Staged" } }),
  url: async () => ({ status: "single_candidate", recipe: { name: "Fetched" } }),
};
jest.mock("../recipeExtractor", () => ({ extractRecipeFromText: jest.fn((t: string) => mockExtract.text(t)) }));
jest.mock("../webAcquisition", () => ({ fetchAndExtractRecipeFromUrl: jest.fn((u: string) => mockExtract.url(u)) }));
jest.mock("../shareDiagnostics", () => ({ recordShareDiagnosticLog: jest.fn(async () => {}), flushNativeDiagnosticLogs: jest.fn(async () => {}) }));

const user = (id: string) => ({ id, firstName: id, starterName: "S" });
const key = (owner: string) => candidatesKeyForOwner(owner);
const cand = (id: string, extra: Record<string, unknown> = {}) => ({ id, sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: { status: "single_candidate", ...extra } });
const result: any = { status: "single_candidate", recipe: { name: "New" } };
const ids = (k: string) => (mockStore[k] ? JSON.parse(mockStore[k]).map((c: any) => c.id) : null);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  mockStore = {};
  mockGetHook = null;
  mockSetHook = null;
  mockRemoveFails = false;
  mockShares.items = [];
  mockShares.consumed = 0;
  mockExtract.text = () => ({ status: "single_candidate", recipe: { name: "Staged" } });
  mockExtract.url = async () => ({ status: "single_candidate", recipe: { name: "Fetched" } });
  for (const k of Object.keys(mockReads)) delete mockReads[k];
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  await clearAuth();
});
afterEach(() => { jest.restoreAllMocks(); });

/** A has Candidates, B has Candidates, A is signed in; returns A's context. Then the workspace changes to B. */
const staleScenario = async () => {
  await saveAuth("acct-A", user("acct-A"));
  mockStore[key("acct-A")] = JSON.stringify([cand("a-1")]);
  mockStore[key("acct-B")] = JSON.stringify([cand("b-1")]);
  const ctxA = await getWorkspaceIdentity();
  await saveAuth("acct-B", user("acct-B"));
  return { ctxA, snapshot: JSON.parse(JSON.stringify(mockStore)) };
};

describe("stale context is rejected at every Candidate mutation, with no write to ANY owner's key", () => {
  const ops: Array<{ name: string; run: (ctx: any) => Promise<unknown> }> = [
    { name: "saveCandidate", run: (ctx) => saveCandidate(result, undefined, "paste", ctx) },
    { name: "updateCandidateExtraction", run: (ctx) => updateCandidateExtraction("a-1", { status: "multiple_candidates" } as any, ctx) },
    { name: "removeCandidate", run: (ctx) => removeCandidate("a-1", ctx) },
    { name: "clearCandidates", run: (ctx) => clearCandidates(ctx) },
    { name: "loadCandidates", run: (ctx) => loadCandidates(ctx) },
  ];
  for (const op of ops) {
    it(`${op.name}: context captured under A, workspace is now B -> StaleWorkspaceError; A's and B's Candidates untouched`, async () => {
      const { ctxA, snapshot } = await staleScenario();
      const attempt = op.run(ctxA);
      await expect(attempt).rejects.toBeInstanceOf(StaleWorkspaceError);
      await expect(attempt).rejects.not.toBeInstanceOf(WorkspaceIdentityError);
      expect(mockStore).toEqual(snapshot);
    });

    it(`${op.name}: A -> B -> A still invalidates the context from the first A session`, async () => {
      const { ctxA } = await staleScenario();
      await saveAuth("acct-A", user("acct-A"));
      const snapshot = JSON.parse(JSON.stringify(mockStore));
      await expect(op.run(ctxA)).rejects.toBeInstanceOf(StaleWorkspaceError);
      expect(mockStore).toEqual(snapshot);
    });
  }

  it("the fence is at the FINAL write boundary: a workspace change while the write waits for storageMutex is caught", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockStore[key("acct-A")] = JSON.stringify([cand("a-1")]);
    const ctxA = await getWorkspaceIdentity();

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const holder = storageMutex.run(() => gate);                        // something else holds the storage lock
    const queued = saveCandidate(result, undefined, "paste", ctxA);     // context is valid NOW; the write is queued behind it
    await tick(5);
    await saveAuth("acct-B", user("acct-B"));                           // ...and the workspace changes while it waits
    const snapshot = JSON.parse(JSON.stringify(mockStore));
    release();
    await holder;

    await expect(queued).rejects.toBeInstanceOf(StaleWorkspaceError);
    expect(mockStore).toEqual(snapshot);                                // nothing landed in A's or B's namespace
  });

  it("an operation with no context captures the CURRENT workspace and writes only there", async () => {
    await saveAuth("acct-B", user("acct-B"));
    const saved = await saveCandidate(result);
    expect(ids(key("acct-B"))).toEqual([saved.id]);
    expect(mockStore[key("acct-A")]).toBeUndefined();
  });
});

describe("errors stay distinguishable: identity vs stale vs storage", () => {
  it("identity failure -> WorkspaceIdentityError, never an empty list, never NLA", async () => {
    mockStore["bread_lab_auth_token_v1"] = "acct-A"; // token without profile
    mockStore[ANONYMOUS_CANDIDATES_KEY] = JSON.stringify([cand("nla-1")]);
    const attempt = loadCandidates();
    await expect(attempt).rejects.toBeInstanceOf(WorkspaceIdentityError);
    await expect(saveCandidate(result)).rejects.toBeInstanceOf(WorkspaceIdentityError);
    expect(ids(ANONYMOUS_CANDIDATES_KEY)).toEqual(["nla-1"]);
  });

  it("storage read failure -> the raw storage error (neither identity nor stale), not an empty list", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockStore[key("acct-A")] = JSON.stringify([cand("a-1")]);
    mockGetHook = (k) => { if (k === key("acct-A")) throw new Error("Disk read error"); };
    const attempt = loadCandidates();
    await expect(attempt).rejects.toThrow("Disk read error");
    await expect(attempt).rejects.not.toBeInstanceOf(WorkspaceIdentityError);
    await expect(attempt).rejects.not.toBeInstanceOf(StaleWorkspaceError);
    mockGetHook = null;
    expect(ids(key("acct-A"))).toEqual(["a-1"]);
  });

  it("unreadable stored Candidates -> CandidateStorageError for load/save/update/remove, and the stored value is preserved byte for byte", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockStore[key("acct-A")] = "{not json";
    for (const run of [
      () => loadCandidates(),
      () => saveCandidate(result),
      () => updateCandidateExtraction("x", result),
      () => removeCandidate("x"),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(CandidateStorageError);
    }
    expect(mockStore[key("acct-A")]).toBe("{not json");
  });

  it("a failed write leaves the existing Candidates intact", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockStore[key("acct-A")] = JSON.stringify([cand("a-1"), cand("a-2")]);
    const before = mockStore[key("acct-A")];
    mockSetHook = (k) => { if (k === key("acct-A")) throw new Error("Disk full"); };
    await expect(saveCandidate(result)).rejects.toThrow("Disk full");
    await expect(removeCandidate("a-1")).rejects.toThrow("Disk full");
    mockSetHook = null;
    expect(mockStore[key("acct-A")]).toBe(before);
  });
});

describe("legacy global Candidates: serialized, verified, and never assigned automatically", () => {
  const seedLegacy = () => { mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = JSON.stringify([cand("legacy-1"), cand("legacy-2")]); };

  it("no Candidate operation assigns ownerless legacy records to NLA or to an account (source untouched)", async () => {
    for (const who of [null, "acct-A"]) {
      mockStore = {};
      if (who) await saveAuth(who, user(who)); else await clearAuth();
      seedLegacy();
      const legacyBefore = mockStore[LEGACY_GLOBAL_CANDIDATES_KEY];
      const saved = await saveCandidate(result);
      await loadCandidates();
      await updateCandidateExtraction(saved.id, result);
      await removeCandidate(saved.id);
      await clearCandidates();
      mockShares.items = [{ rawContent: "Simple loaf: 500g flour", sharedAt: 1 }];
      await ingestStagedNativeShares();
      expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBe(legacyBefore);
      expect(ids(key(who ?? "anonymous"))).not.toEqual(expect.arrayContaining(["legacy-1"]));
    }
  });

  it("inspectLegacyCandidates reports presence, count and readability without modifying anything", async () => {
    expect(await inspectLegacyCandidates()).toEqual({ present: false, count: 0, readable: true });
    seedLegacy();
    const before = JSON.stringify(mockStore);
    expect(await inspectLegacyCandidates()).toEqual({ present: true, count: 2, readable: true });
    mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = "{broken";
    expect(await inspectLegacyCandidates()).toEqual({ present: true, count: null, readable: false });
    mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = JSON.stringify([cand("legacy-1"), cand("legacy-2")]);
    expect(JSON.stringify(mockStore)).toBe(before);
  });

  it("explicit adoption copies into the CURRENT workspace, verifies the read-back, and only then removes the source", async () => {
    await saveAuth("acct-A", user("acct-A"));
    seedLegacy();
    mockStore[key("acct-A")] = JSON.stringify([cand("a-1"), cand("legacy-2")]); // one identical record is already there
    expect(await adoptLegacyCandidates()).toEqual({ moved: 1, alreadyPresent: 1 });
    expect(ids(key("acct-A"))).toEqual(["a-1", "legacy-2", "legacy-1"]);
    expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBeUndefined();
    expect(mockStore[ANONYMOUS_CANDIDATES_KEY]).toBeUndefined();
  });

  it("source intact when the destination WRITE fails", async () => {
    await saveAuth("acct-A", user("acct-A"));
    seedLegacy();
    mockStore[key("acct-A")] = JSON.stringify([cand("a-1")]);
    const legacyBefore = mockStore[LEGACY_GLOBAL_CANDIDATES_KEY];
    const destBefore = mockStore[key("acct-A")];
    mockSetHook = (k) => { if (k === key("acct-A")) throw new Error("Disk full"); };
    await expect(adoptLegacyCandidates()).rejects.toThrow("Disk full");
    mockSetHook = null;
    expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBe(legacyBefore);
    expect(mockStore[key("acct-A")]).toBe(destBefore);
  });

  it("source intact when the destination VERIFICATION fails (a write that silently drops a record)", async () => {
    await saveAuth("acct-A", user("acct-A"));
    seedLegacy();
    const legacyBefore = mockStore[LEGACY_GLOBAL_CANDIDATES_KEY];
    mockSetHook = (k, v) => (k === key("acct-A") ? JSON.stringify(JSON.parse(v).slice(0, 1)) : undefined); // drops legacy-2
    const attempt = adoptLegacyCandidates();
    await expect(attempt).rejects.toBeInstanceOf(LegacyCandidateVerificationError);
    mockSetHook = null;
    expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBe(legacyBefore);
  });

  it("an unreadable legacy value is preserved byte for byte (not parsed into [] and deleted)", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = "{broken";
    await expect(adoptLegacyCandidates()).rejects.toBeInstanceOf(CandidateStorageError);
    expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBe("{broken");
    expect(mockStore[key("acct-A")]).toBeUndefined();
  });

  it("a legacy id that conflicts with a DIFFERENT existing Candidate changes nothing", async () => {
    await saveAuth("acct-A", user("acct-A"));
    seedLegacy();
    mockStore[key("acct-A")] = JSON.stringify([cand("legacy-1", { different: true })]);
    const before = JSON.parse(JSON.stringify(mockStore));
    await expect(adoptLegacyCandidates()).rejects.toBeInstanceOf(CandidateStorageError);
    expect(mockStore).toEqual(before);
  });

  it("source kept and an error raised when the verified copy cannot be removed", async () => {
    await saveAuth("acct-A", user("acct-A"));
    seedLegacy();
    mockRemoveFails = true;
    await expect(adoptLegacyCandidates()).rejects.toBeInstanceOf(LegacyCandidateVerificationError);
    expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBeDefined();
  });

  it("adoption is fenced like every mutation: a stale context moves nothing", async () => {
    const { ctxA } = await staleScenario();
    seedLegacy();
    const snapshot = JSON.parse(JSON.stringify(mockStore));
    await expect(adoptLegacyCandidates(ctxA)).rejects.toBeInstanceOf(StaleWorkspaceError);
    expect(mockStore).toEqual(snapshot);
  });

  it("concurrent adoption and Candidate save lose neither the legacy records nor the new one (either order, slow reads)", async () => {
    for (const adoptFirst of [true, false]) {
      mockStore = {};
      await clearAuth();
      seedLegacy();
      // The FIRST read of the destination is slow and would return a stale (empty) value to an unserialized migration.
      for (const k of Object.keys(mockReads)) delete mockReads[k];
      mockGetHook = async (k, nth) => { if (k === ANONYMOUS_CANDIDATES_KEY && nth === 1) await tick(60); };
      const run = adoptFirst
        ? async () => { const a = adoptLegacyCandidates(); await tick(5); const s = saveCandidate(result); return Promise.all([a, s]); }
        : async () => { const s = saveCandidate(result); await tick(5); const a = adoptLegacyCandidates(); return Promise.all([a, s]); };
      const [, saved] = (await run()) as [unknown, { id: string }];
      mockGetHook = null;
      expect(ids(ANONYMOUS_CANDIDATES_KEY)).toEqual(expect.arrayContaining(["legacy-1", "legacy-2", saved.id]));
      expect(ids(ANONYMOUS_CANDIDATES_KEY)).toHaveLength(3);
      expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBeUndefined();
    }
  });

  it("concurrent saves are serialized and none is lost", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockGetHook = async (k, nth) => { if (k === key("acct-A") && nth === 1) await tick(40); };
    const saved = await Promise.all([saveCandidate(result), saveCandidate(result), saveCandidate(result)]);
    expect(ids(key("acct-A"))!.sort()).toEqual(saved.map((s) => s.id).sort());
  });
});

describe("native staged shares", () => {
  const share = (n = 1) => { mockShares.items = Array.from({ length: n }, (_, i) => ({ rawContent: `Simple loaf ${i}: 500g flour`, sharedAt: 1 + i })); };

  it("identity failure does not consume staged shares", async () => {
    mockStore["bread_lab_auth_token_v1"] = "acct-A"; // partial identity
    share();
    await expect(ingestStagedNativeShares()).rejects.toBeInstanceOf(WorkspaceIdentityError);
    await expect(loadCandidates()).rejects.toBeInstanceOf(WorkspaceIdentityError);
    expect(mockShares.consumed).toBe(0);
    expect(mockShares.items).toHaveLength(1);
  });

  it("a stale context does not consume staged shares either (workspace changed before the destructive read)", async () => {
    const { ctxA } = await staleScenario();
    share();
    await expect(ingestStagedNativeShares(ctxA)).rejects.toBeInstanceOf(StaleWorkspaceError);
    expect(mockShares.consumed).toBe(0);
    expect(mockShares.items).toHaveLength(1);
  });

  it("saves shares into the captured workspace; extraction/network work runs WITHOUT holding storageMutex", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [{ rawContent: "https://example.com/loaf", sharedAt: 1 }];
    let lockWasFree: string | null = null;
    mockExtract.url = async () => {
      lockWasFree = await Promise.race([storageMutex.run(async () => "free"), tick(80).then(() => "held")]) as string;
      return { status: "single_candidate", recipe: { name: "Fetched" } };
    };
    await ingestStagedNativeShares();
    expect(lockWasFree).toBe("free");
    expect(ids(key("acct-A"))).toHaveLength(1);
  });

  it("workspace changes AFTER consumption: nothing is misfiled in either workspace, the loss is raised (not swallowed)", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { rawContent: "https://example.com/one", sharedAt: 1 },
      { rawContent: "https://example.com/two", sharedAt: 2 },
    ];
    // The workspace switches to B while the first share is being fetched (network work, no lock held).
    mockExtract.url = async () => {
      await saveAuth("acct-B", user("acct-B"));
      return { status: "single_candidate", recipe: { name: "Fetched" } };
    };
    const candidateKeysBefore = Object.keys(mockStore).filter((k) => k.includes("candidates_v1_"));

    await expect(ingestStagedNativeShares()).rejects.toBeInstanceOf(StaleWorkspaceError);

    expect(mockShares.consumed).toBe(1);                                  // the destructive read happened exactly once
    expect(mockStore[key("acct-A")]).toBeUndefined();                      // A got nothing...
    expect(mockStore[key("acct-B")]).toBeUndefined();                      // ...and B got nothing: never misfiled
    expect(Object.keys(mockStore).filter((k) => k.includes("candidates_v1_"))).toEqual(candidateKeysBefore);
    expect((console.error as jest.Mock).mock.calls.some((c) => String(c[0]).includes("2 staged share(s) were consumed but only 0 could be saved"))).toBe(true);
  });

  it("loadCandidates ingests into the SAME captured workspace it then reads", async () => {
    await saveAuth("acct-A", user("acct-A"));
    share();
    const list = await loadCandidates();
    expect(list).toHaveLength(1);
    expect(ids(key("acct-A"))).toEqual([list[0].id]);
  });

  it("extraction failure on the first staged item rejects, reports consumed=2, saved=0, unsaved=2, correct failed item ID and index, and saves 0 candidates", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { id: "item-1-fail", rawContent: "Bad content", sharedAt: 1 },
      { id: "item-2-good", rawContent: "Good content", sharedAt: 2 },
    ];
    let callCount = 0;
    mockExtract.text = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Extraction failed");
      }
      return { status: "single_candidate", recipe: { name: "Good" } };
    };

    let err: any = null;
    try {
      await ingestStagedNativeShares();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(CandidateStorageError);
    expect(err.consumedCount).toBe(2);
    expect(err.savedCount).toBe(0);
    expect(err.unsavedCount).toBe(2);
    expect(err.failedItemId).toBe("item-1-fail");
    expect(err.failedItemIndex).toBe(0);

    expect(ids(key("acct-A"))).toBeNull();
  });

  it("extraction failure on a later staged item saves earlier valid items, rejects with consumed=2, saved=1, unsaved=1, correct failed item ID/index, and preserves workspace isolation", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { id: "item-1-good", rawContent: "Good content 1", sharedAt: 1 },
      { id: "item-2-fail", rawContent: "Bad content 2", sharedAt: 2 },
    ];
    let callCount = 0;
    mockExtract.text = () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Later extraction failed");
      }
      return { status: "single_candidate", recipe: { name: `Good ${callCount}` } };
    };

    let err: any = null;
    try {
      await ingestStagedNativeShares();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(CandidateStorageError);
    expect(err.consumedCount).toBe(2);
    expect(err.savedCount).toBe(1);
    expect(err.unsavedCount).toBe(1);
    expect(err.failedItemId).toBe("item-2-fail");
    expect(err.failedItemIndex).toBe(1);

    const saved = ids(key("acct-A"));
    expect(saved).toHaveLength(1);
  });

  it("extraction result producing no usable Candidate is treated as a failure", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { id: "item-no-cand", rawContent: "No candidate text", sharedAt: 1 },
    ];
    mockExtract.text = () => ({ status: "no_candidate", reason: "None found" });

    await expect(ingestStagedNativeShares()).rejects.toBeInstanceOf(CandidateStorageError);
    expect(ids(key("acct-A"))).toBeNull();
  });

  it("persistence failure (e.g. disk full during save) is not an extraction failure: rejects with original CandidateStorageError, not StagedShareExtractionError", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { id: "item-save-fail", rawContent: "Valid content", sharedAt: 1 },
    ];
    mockExtract.text = () => ({ status: "single_candidate", recipe: { name: "Valid" } });
    mockSetHook = (k) => { if (k === key("acct-A")) throw new CandidateStorageError("Disk full"); };

    let err: any = null;
    try {
      await ingestStagedNativeShares();
    } catch (e) {
      err = e;
    }
    mockSetHook = null;

    expect(err).toBeInstanceOf(CandidateStorageError);
    expect(err).not.toBeInstanceOf(StagedShareExtractionError);
    expect(err.message).toContain("Disk full");
  });

  it("earlier successful save remains intact when a later item's persistence operation fails", async () => {
    await saveAuth("acct-A", user("acct-A"));
    mockShares.items = [
      { id: "item-1-save-ok", rawContent: "Content 1", sharedAt: 1 },
      { id: "item-2-save-fail", rawContent: "Content 2", sharedAt: 2 },
    ];
    let callCount = 0;
    mockExtract.text = () => {
      callCount++;
      return { status: "single_candidate", recipe: { name: `Recipe ${callCount}` } };
    };
    let setCalls = 0;
    mockSetHook = (k) => {
      if (k === key("acct-A")) {
        setCalls++;
        if (setCalls === 2) {
          throw new CandidateStorageError("Secondary write failed");
        }
      }
    };

    let err: any = null;
    try {
      await ingestStagedNativeShares();
    } catch (e) {
      err = e;
    }
    mockSetHook = null;

    expect(err).toBeInstanceOf(CandidateStorageError);
    expect(err).not.toBeInstanceOf(StagedShareExtractionError);
    expect(err.message).toContain("Secondary write failed");

    const saved = ids(key("acct-A"));
    expect(saved).toHaveLength(1);
  });
});
