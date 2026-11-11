import { getWorkspaceIdentity, assertWorkspaceOperationCurrent } from "../recipeStorage";
import { saveAuth, clearAuth } from "../auth";
import { advanceWorkspaceGeneration, getWorkspaceGeneration, StaleWorkspaceError, WorkspaceIdentityError } from "../storageUtils";

// Workspace identity capture: ONE consistent {owner, generation} pair, rejected when it cannot be. Real auth.ts and the
// real generation counter run against an in-memory AsyncStorage; hooks on the credential reads make each interleaving
// deterministic. Nothing here mocks getStoredToken / getStoredUser.

let mockStore: Record<string, string> = {};
let mockReadHook: ((key: string, nth: number) => void | Promise<void>) | null = null;
const mockReads: Record<string, number> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    mockReads[key] = (mockReads[key] ?? 0) + 1;
    if (mockReadHook) await mockReadHook(key, mockReads[key]);
    return key in mockStore ? mockStore[key] : null;
  }),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
}));

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";
const user = (id: string) => ({ id, firstName: id, starterName: "S" });
const setPair = (id: string) => { mockStore[TOKEN_KEY] = id; mockStore[USER_KEY] = JSON.stringify(user(id)); };

describe("getWorkspaceIdentity / assertWorkspaceOperationCurrent", () => {
  beforeEach(() => {
    mockStore = {};
    mockReadHook = null;
    for (const k of Object.keys(mockReads)) delete mockReads[k];
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  describe("capture", () => {
    it("returns the owner and the generation of one consistent workspace (account and NLA)", async () => {
      setPair("acct-A");
      expect(await getWorkspaceIdentity()).toEqual({ owner: "acct-A", generation: getWorkspaceGeneration() });
      delete mockStore[TOKEN_KEY]; delete mockStore[USER_KEY];
      expect(await getWorkspaceIdentity()).toEqual({ owner: "anonymous", generation: getWorkspaceGeneration() });
    });

    it("REJECTS when the generation changes while the identity is being captured (no mixed context)", async () => {
      setPair("acct-A");
      mockReadHook = (key, nth) => { if (key === TOKEN_KEY && nth === 1) advanceWorkspaceGeneration(); };
      const attempt = getWorkspaceIdentity();
      await expect(attempt).rejects.toBeInstanceOf(StaleWorkspaceError);
      await expect(attempt).rejects.toThrow(/generation changed while the workspace identity was being captured/);
    });

    it("REJECTS when the owner changes while the identity is being captured, even if no generation advanced", async () => {
      setPair("acct-A");
      const generation = getWorkspaceGeneration();
      mockReadHook = (key, nth) => { if (key === TOKEN_KEY && nth === 2) setPair("acct-B"); }; // between the two owner reads
      const attempt = getWorkspaceIdentity();
      await expect(attempt).rejects.toBeInstanceOf(StaleWorkspaceError);
      await expect(attempt).rejects.toThrow(/owner changed while the workspace identity was being captured/);
      expect(getWorkspaceGeneration()).toBe(generation); // proves the owner check, not the generation check, caught it
    });
  });

  describe("assertion", () => {
    it("accepts the unchanged workspace", async () => {
      setPair("acct-A");
      const ctx = await getWorkspaceIdentity();
      await expect(assertWorkspaceOperationCurrent(ctx)).resolves.toBeUndefined();
    });

    it("A -> B -> A invalidates a context captured in the first A session (owner matches again, generation does not)", async () => {
      await saveAuth("acct-A", user("acct-A"));
      const ctx = await getWorkspaceIdentity();
      await saveAuth("acct-B", user("acct-B"));
      await saveAuth("acct-A", user("acct-A"));
      expect((await getWorkspaceIdentity()).owner).toBe(ctx.owner);              // same owner again...
      await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toBeInstanceOf(StaleWorkspaceError); // ...still stale
      await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toThrow(/generation changed/);
    });

    it("A -> NLA -> A is also stale", async () => {
      await saveAuth("acct-A", user("acct-A"));
      const ctx = await getWorkspaceIdentity();
      await clearAuth();
      await saveAuth("acct-A", user("acct-A"));
      await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toBeInstanceOf(StaleWorkspaceError);
    });

    it("detects an owner change that did not advance the generation (owner check, not generation check)", async () => {
      setPair("acct-A");
      const ctx = await getWorkspaceIdentity();
      setPair("acct-B");
      await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toThrow(/owner changed/);
    });

    it("detects a generation that moves while the assertion itself is reading the owner", async () => {
      setPair("acct-A");
      const ctx = await getWorkspaceIdentity();
      mockReadHook = (key) => { if (key === TOKEN_KEY) advanceWorkspaceGeneration(); };
      await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toBeInstanceOf(StaleWorkspaceError);
    });
  });

  describe("identity failure is never NLA", () => {
    const uncertain: Array<{ name: string; arm: () => void }> = [
      { name: "token present, profile absent", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; } },
      { name: "profile present, token absent", arm: () => { mockStore[USER_KEY] = JSON.stringify(user("acct-A")); } },
      { name: "mismatched token and profile", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify(user("acct-B")); } },
      { name: "malformed profile JSON", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = "not-json"; } },
      { name: "credential read failure", arm: () => { setPair("acct-A"); mockReadHook = (key) => { if (key.startsWith("bread_lab_auth_")) throw new Error("Disk read error"); }; } },
    ];
    for (const state of uncertain) {
      it(`${state.name}: capture and assertion reject with WorkspaceIdentityError (not anonymous, not stale)`, async () => {
        const ctx = { owner: "anonymous", generation: getWorkspaceGeneration() };
        state.arm();
        const capture = getWorkspaceIdentity();
        await expect(capture).rejects.toBeInstanceOf(WorkspaceIdentityError);
        await expect(capture).rejects.not.toBeInstanceOf(StaleWorkspaceError);
        // Even a context captured as NLA does not validate against an uncertain identity.
        await expect(assertWorkspaceOperationCurrent(ctx)).rejects.toBeInstanceOf(WorkspaceIdentityError);
      });
    }
  });
});
