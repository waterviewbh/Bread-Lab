import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getCandidatesKey,
  loadCandidates,
  saveCandidate,
  updateCandidateExtraction,
  removeCandidate,
  clearCandidates,
  ingestStagedNativeShares,
  ANONYMOUS_CANDIDATES_KEY,
  LEGACY_GLOBAL_CANDIDATES_KEY,
} from "../candidateStorage";
import { candidatesKeyFor } from "../nlaImport";

// Issue #89: every Candidate operation resolves and validates the workspace identity FIRST. The real getStoredToken /
// getStoredUser run against realistic storage states (nothing here mocks an accessor). An uncertain identity must not
// migrate the legacy Candidates, consume staged shares, or read/write any Candidate namespace; it must never become NLA.

let mockStore: Record<string, string> = {};
let mockAuthReadFails = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    if (mockAuthReadFails && key.startsWith("bread_lab_auth_")) throw new Error("Disk read error");
    return key in mockStore ? mockStore[key] : null;
  }),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStore[key]; }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete mockStore[k]); }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
  clear: jest.fn(async () => { mockStore = {}; }),
}));

const mockShares: { calls: number; items: any[] } = { calls: 0, items: [] };
jest.mock("../stagedShareBridge", () => ({
  getAndClearStagedShares: jest.fn(async () => {
    mockShares.calls++;
    const items = mockShares.items;
    mockShares.items = [];
    return items;
  }),
}));
jest.mock("../recipeExtractor", () => ({
  extractRecipeFromText: jest.fn(() => ({ status: "single_candidate", recipe: { name: "Staged" } })),
}));
jest.mock("../shareDiagnostics", () => ({
  recordShareDiagnosticLog: jest.fn(async () => {}),
  flushNativeDiagnosticLogs: jest.fn(async () => {}),
}));
jest.mock("../webAcquisition", () => ({ fetchAndExtractRecipeFromUrl: jest.fn() }));

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";
const keyOf = (id: string | null) => (id === null ? ANONYMOUS_CANDIDATES_KEY : `bread_lab_candidates_v1_${id}`);
const validPair = (id: string) => {
  mockStore[TOKEN_KEY] = id;
  mockStore[USER_KEY] = JSON.stringify({ id, firstName: id, starterName: "S" });
};
const cand = (id: string) => ({ id, sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: { status: "single_candidate" } });
const result: any = { status: "single_candidate", recipe: { name: "New" } };
const IDENTITY_ERROR = /Identity integrity failure|Credential read failed/;

// Every kind of uncertain identity, held the way storage would really hold it.
const uncertain: Array<{ name: string; arm: () => void }> = [
  { name: "mismatched token and profile", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify({ id: "acct-B", firstName: "B", starterName: "S" }); } },
  { name: "token present, profile absent", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; } },
  { name: "profile present, token absent", arm: () => { mockStore[USER_KEY] = JSON.stringify({ id: "acct-A", firstName: "A", starterName: "S" }); } },
  { name: "malformed profile JSON", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = "not-json"; } },
  { name: "profile missing required fields", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify({ id: "acct-A" }); } },
  { name: "credential storage unreadable", arm: () => { validPair("acct-A"); mockAuthReadFails = true; } },
];

const operations: Array<{ name: string; run: () => Promise<unknown> }> = [
  { name: "loadCandidates", run: () => loadCandidates() },
  { name: "saveCandidate", run: () => saveCandidate(result) },
  { name: "updateCandidateExtraction", run: () => updateCandidateExtraction("c-1", result) },
  { name: "removeCandidate", run: () => removeCandidate("c-1") },
  { name: "clearCandidates", run: () => clearCandidates() },
  { name: "ingestStagedNativeShares", run: () => ingestStagedNativeShares() },
];

const writeSpies = () => [AsyncStorage.setItem, AsyncStorage.removeItem, AsyncStorage.multiSet, AsyncStorage.multiRemove] as jest.Mock[];

describe("Candidate storage under each identity state (real accessors)", () => {
  beforeEach(() => {
    mockStore = {};
    mockAuthReadFails = false;
    mockShares.calls = 0;
    mockShares.items = [];
    jest.clearAllMocks();
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  describe("uncertain identity: nothing is migrated, consumed, read or written", () => {
    for (const state of uncertain) {
      for (const op of operations) {
        it(`${state.name} -> ${op.name} rejects and changes nothing`, async () => {
          // Everything a premature migration or write could touch.
          mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = JSON.stringify([cand("legacy-1")]);
          mockStore[keyOf(null)] = JSON.stringify([cand("anon-1")]);
          mockStore[keyOf("acct-A")] = JSON.stringify([cand("a-1")]);
          mockStore[keyOf("acct-B")] = JSON.stringify([cand("b-1")]);
          state.arm();
          mockShares.items = [{ rawContent: "Simple loaf: 500g flour", sharedAt: 1 }];
          const before = JSON.parse(JSON.stringify(mockStore));
          writeSpies().forEach((s) => s.mockClear());

          await expect(op.run()).rejects.toThrow(IDENTITY_ERROR);

          expect(mockStore).toEqual(before);                       // legacy source and every namespace byte-identical
          for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
          expect(mockShares.calls).toBe(0);                         // staged shares not consumed
          expect(mockShares.items).toHaveLength(1);                 // ...and still waiting in staging
        });
      }
    }
  });

  describe("valid identities keep the existing namespaces", () => {
    const identities: Array<{ name: string; id: string | null }> = [
      { name: "NLA (both credentials absent)", id: null },
      { name: "authenticated A", id: "acct-A" },
      { name: "authenticated B", id: "acct-B" },
    ];
    for (const who of identities) {
      it(`${who.name}: save, load, update, remove, clear all use ${keyOf(who.id)} and nothing else`, async () => {
        mockStore[keyOf(null) + "-sentinel"] = "x";
        for (const other of ["acct-A", "acct-B"]) mockStore[keyOf(other)] = JSON.stringify([cand(`${other}-own`)]);
        if (who.id !== null) validPair(who.id);
        const others = () => Object.fromEntries(Object.entries(mockStore).filter(([k]) => k !== keyOf(who.id) && !k.startsWith("bread_lab_auth_")));
        const othersBefore = others();

        expect(await getCandidatesKey()).toBe(keyOf(who.id));
        const saved = await saveCandidate(result);
        expect((await loadCandidates()).map((c) => c.id)).toContain(saved.id);
        await updateCandidateExtraction(saved.id, { status: "multiple_candidates" } as any);
        expect(JSON.parse(mockStore[keyOf(who.id)])[0].extractionResult.status).toBe("multiple_candidates");
        await removeCandidate(saved.id);
        expect(JSON.parse(mockStore[keyOf(who.id)]).some((c: any) => c.id === saved.id)).toBe(false);
        await saveCandidate(result);
        await clearCandidates();
        expect(mockStore[keyOf(who.id)]).toBeUndefined();

        // Only this identity's namespace changed; every other namespace is exactly as it was.
        const own = who.id === null ? {} : { [keyOf(who.id)]: undefined };
        expect({ ...others(), ...own }).toEqual({ ...othersBefore, ...own });
      });
    }

    it("a Candidate saved as A is invisible to B and to NLA, and returns for A", async () => {
      validPair("acct-A");
      const saved = await saveCandidate(result);
      validPair("acct-B");
      expect(await loadCandidates()).toEqual([]);
      delete mockStore[TOKEN_KEY]; delete mockStore[USER_KEY];
      expect(await loadCandidates()).toEqual([]);
      validPair("acct-A");
      expect((await loadCandidates()).map((c) => c.id)).toEqual([saved.id]);
    });

    it("existing legacy behavior is preserved under a VALID identity (ownerless legacy -> anonymous namespace, source removed)", async () => {
      mockStore[LEGACY_GLOBAL_CANDIDATES_KEY] = JSON.stringify([cand("legacy-1")]);
      validPair("acct-A");
      expect(await loadCandidates()).toEqual([]);               // never attributed to the account
      expect(mockStore[LEGACY_GLOBAL_CANDIDATES_KEY]).toBeUndefined();
      expect(JSON.parse(mockStore[ANONYMOUS_CANDIDATES_KEY]).map((c: any) => c.id)).toEqual(["legacy-1"]);
    });

    it("staged shares are consumed and saved under the validated identity's namespace", async () => {
      validPair("acct-A");
      mockShares.items = [{ rawContent: "Simple loaf: 500g flour", sharedAt: 1 }];
      await ingestStagedNativeShares();
      expect(mockShares.calls).toBe(1);
      expect(JSON.parse(mockStore[keyOf("acct-A")])).toHaveLength(1);
      expect(mockStore[ANONYMOUS_CANDIDATES_KEY]).toBeUndefined();

      delete mockStore[TOKEN_KEY]; delete mockStore[USER_KEY];
      mockShares.items = [{ rawContent: "Another loaf: 400g flour", sharedAt: 2 }];
      await ingestStagedNativeShares();
      expect(JSON.parse(mockStore[ANONYMOUS_CANDIDATES_KEY])).toHaveLength(1);
      expect(JSON.parse(mockStore[keyOf("acct-A")])).toHaveLength(1); // A's namespace untouched by the NLA share
    });

    it("the NLA->account import destination key is the same key candidate storage uses", async () => {
      validPair("acct-A");
      expect(candidatesKeyFor("acct-A")).toBe(await getCandidatesKey());
    });
  });
});
