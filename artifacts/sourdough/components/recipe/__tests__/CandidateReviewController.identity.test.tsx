import React from "react";
import { render, cleanup } from "@testing-library/react-native";
import { CandidateReviewController } from "../CandidateReviewController";
import { api } from "@/lib/api";
import { fakeServer } from "@/lib/testSupport/fakeApi";
import { getOwnerStorageKey } from "@/lib/storageUtils";
import { RECIPES_KEY } from "@/lib/recipeTypes";

// Issue #89: promotion works under valid authenticated and NLA identities, and under an uncertain identity it fails
// safely - before anything is written - so the Candidate is kept. Real getStoredUser/getStoredToken, real storage keys.

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
jest.mock("@/lib/api", () => require("@/lib/testSupport/fakeApi").makeApiModule());
jest.mock("@/lib/deviceId", () => ({ getDeviceId: jest.fn(async () => "device-1") }));

let mockModalProps: any = null;
jest.mock("../BakerReviewModal", () => {
  const R = require("react");
  return { BakerReviewModal: R.forwardRef((props: any, _ref: any) => { mockModalProps = props; return null; }) };
});

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";
const validPair = (id: string) => {
  mockStore[TOKEN_KEY] = id;
  mockStore[USER_KEY] = JSON.stringify({ id, firstName: "Ann", starterName: "Levain" });
};
const candidateKey = (id: string | null) => `bread_lab_candidates_v1_${id ?? "anonymous"}`;
const portable: any = {
  schemaVersion: "1.0",
  name: "Country Loaf",
  phases: [{ key: "bulk_fermenting", name: "Bulk Fermenting", ingredients: [{ text: "500 g flour" }, { text: "350 g water" }], instructions: [{ text: "Combine." }] }],
};
const uncertain: Array<{ name: string; arm: () => void }> = [
  { name: "mismatched token and profile", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify({ id: "acct-B", firstName: "B", starterName: "S" }); } },
  { name: "token present, profile absent", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; } },
  { name: "profile present, token absent", arm: () => { mockStore[USER_KEY] = JSON.stringify({ id: "acct-A", firstName: "A", starterName: "S" }); } },
  { name: "malformed profile JSON", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = "not-json"; } },
  { name: "credential storage unreadable", arm: () => { validPair("acct-A"); mockAuthReadFails = true; } },
];

const mountAndPromote = async (candidateId: string) => {
  const Controller: any = CandidateReviewController;
  await render(<Controller visible candidateId={candidateId} extractionResult={{ status: "single_candidate" }} onDiscard={() => {}} />);
  return mockModalProps.onPromote(portable);
};

describe("CandidateReviewController promotion under each identity state", () => {
  beforeEach(() => {
    mockStore = {};
    mockAuthReadFails = false;
    mockModalProps = null;
    fakeServer.reset();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 0)); jest.restoreAllMocks(); });

  it("authenticated A: the recipe is stamped and stored for A, uploaded under A, and the Candidate is removed", async () => {
    validPair("acct-A");
    mockStore[candidateKey("acct-A")] = JSON.stringify([{ id: "c-1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: {} }]);
    await mountAndPromote("c-1");

    const stored = JSON.parse(mockStore[getOwnerStorageKey(RECIPES_KEY, "acct-A")]);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "Country Loaf", userId: "acct-A" });
    expect((api.recipes.upsert as jest.Mock).mock.calls[0][0].userId).toBe("acct-A");
    expect(JSON.parse(mockStore[candidateKey("acct-A")])).toEqual([]);
    expect(mockStore[getOwnerStorageKey(RECIPES_KEY, "anonymous")]).toBeUndefined();
  });

  it("NLA (both credentials absent): stamped anonymous in the NLA workspace, no remote call, Candidate removed", async () => {
    mockStore[candidateKey(null)] = JSON.stringify([{ id: "c-1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: {} }]);
    await mountAndPromote("c-1");

    const stored = JSON.parse(mockStore[getOwnerStorageKey(RECIPES_KEY, "anonymous")]);
    expect(stored[0]).toMatchObject({ name: "Country Loaf", userId: "anonymous" });
    expect(api.recipes.upsert).not.toHaveBeenCalled();
    expect(JSON.parse(mockStore[candidateKey(null)])).toEqual([]);
  });

  for (const state of uncertain) {
    it(`${state.name}: promotion rejects before any write; the Candidate and every workspace are untouched`, async () => {
      const candidates = JSON.stringify([{ id: "c-1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: {} }]);
      mockStore[candidateKey("acct-A")] = candidates;
      mockStore[candidateKey(null)] = candidates;
      state.arm();
      const before = JSON.parse(JSON.stringify(mockStore));

      // The RAW identity error: promotion stops at identity resolution itself, not later at the recipe write (whose own
      // owner check would wrap it as "Local recipe commit failed: ...").
      await expect(mountAndPromote("c-1")).rejects.toThrow(/^(Identity integrity failure|Credential read failed)/);

      expect(mockStore).toEqual(before);                         // no recipe written anywhere, Candidates kept
      expect(api.recipes.upsert).not.toHaveBeenCalled();
    });
  }
});
