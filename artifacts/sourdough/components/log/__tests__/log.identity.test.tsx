import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react-native";
import { HistorySection } from "../log";
import { api } from "@/lib/api";
import { upsertBakeRemote, upsertRecipeRemote } from "@/lib/recipeStorage";

// Issue #89, consumers of the identity contract. Real getStoredToken/getStoredUser run against realistic storage states.
// An uncertain identity (partial, mismatched, malformed, unreadable) must never be read as NLA: History must not show
// NLA records, no remote list may be called under it, and remote upserts must not go out as device-id-only writes.

let mockStore: Record<string, string> = {};
let mockAuthReadFails = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    if (mockAuthReadFails && key.startsWith("bread_lab_auth_")) throw new Error("Disk read error");
    return key in mockStore ? mockStore[key] : null;
  }),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStore[key]; }),
  clear: jest.fn(async () => { mockStore = {}; }),
  multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, k in mockStore ? mockStore[k] : null])),
  multiSet: jest.fn(async (entries: [string, string][]) => { entries.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete mockStore[k]); }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
}));
jest.mock("@/lib/api", () => ({
  api: {
    history: {
      feed: { list: jest.fn().mockResolvedValue([]), delete: jest.fn().mockResolvedValue(true), verifyAbsent: jest.fn().mockResolvedValue(true), upsert: jest.fn().mockResolvedValue({}) },
      bakes: { list: jest.fn().mockResolvedValue([]), delete: jest.fn().mockResolvedValue(true), verifyAbsent: jest.fn().mockResolvedValue(true), upsert: jest.fn().mockResolvedValue({}) },
    },
    recipes: { delete: jest.fn().mockResolvedValue(true), verifyAbsent: jest.fn().mockResolvedValue(true), upsert: jest.fn().mockResolvedValue({}) },
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }), signout: jest.fn() },
  },
}));
jest.mock("@/lib/deviceId", () => ({ getDeviceId: jest.fn().mockResolvedValue("device-123") }));
jest.mock("@/contexts/SyncContext", () => ({ useSyncStatus: () => ({ pendingCount: 0 }) }));
jest.mock("@/contexts/MigrationToastContext", () => ({
  useMigrationToast: () => ({ isMigrationActive: false, startMigration: jest.fn(), finishMigration: jest.fn() }),
}));

const BAKES_KEY = "bread_lab_bake_history_v1";
const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";
const now = Date.now();
const bake = (id: string, userId: string, recipeName: string) => ({ id, userId, recipeName, savedAt: now, startedAt: now, phases: [] });
const seedBakes = () => {
  mockStore[BAKES_KEY] = JSON.stringify([bake("b-nla", "anonymous", "NLA Loaf"), bake("b-a", "acct-A", "Account A Loaf")]);
};
const validPair = (id: string) => {
  mockStore[TOKEN_KEY] = id;
  mockStore[USER_KEY] = JSON.stringify({ id, firstName: "A", starterName: "S" });
};

// Every kind of uncertain identity, built the way storage would really hold it.
const uncertain: Array<{ name: string; arm: () => void }> = [
  { name: "mismatched token and profile", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify({ id: "acct-B", firstName: "B", starterName: "S" }); } },
  { name: "token present, profile absent", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; } },
  { name: "profile present, token absent", arm: () => { mockStore[USER_KEY] = JSON.stringify({ id: "acct-A", firstName: "A", starterName: "S" }); } },
  { name: "malformed profile JSON", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = "not-json"; } },
  { name: "profile missing required fields", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify({ id: "acct-A" }); } },
  { name: "credential storage unreadable", arm: () => { validPair("acct-A"); mockAuthReadFails = true; } },
];

describe("History (log.tsx) under each identity state", () => {
  beforeEach(() => {
    mockStore = {};
    mockAuthReadFails = false;
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it("NLA (both credentials absent): shows NLA records only (legitimate offline behavior unchanged)", async () => {
    seedBakes();
    await render(<HistorySection />);
    await waitFor(() => expect(screen.getByText("NLA Loaf")).toBeTruthy());
    expect(screen.queryByText("Account A Loaf")).toBeNull();
  });

  it("valid account A: shows A's records only, never NLA's", async () => {
    seedBakes();
    validPair("acct-A");
    await render(<HistorySection />);
    await waitFor(() => expect(screen.getByText("Account A Loaf")).toBeTruthy());
    expect(screen.queryByText("NLA Loaf")).toBeNull();
  });

  it("records already on screen for account A are cleared when the identity later becomes uncertain (nothing stays visible)", async () => {
    seedBakes();
    validPair("acct-A");
    await render(<HistorySection />);
    await waitFor(() => expect(screen.getByText("Account A Loaf")).toBeTruthy());

    const storedBefore = { ...mockStore };
    delete mockStore[USER_KEY]; // the profile is lost: token present, profile absent
    const refresh = screen.getByTestId("history-scroll-view").props.refreshControl.props.onRefresh;
    await act(async () => { await refresh(); });

    expect(screen.queryByText("Account A Loaf")).toBeNull();
    expect(screen.queryByText("NLA Loaf")).toBeNull();
    expect(mockStore[BAKES_KEY]).toBe(storedBefore[BAKES_KEY]); // shown nothing, rewrote nothing
  });

  for (const state of uncertain) {
    it(`${state.name}: shows NO records (not NLA's, not the account's) and calls no remote list`, async () => {
      seedBakes();
      state.arm();
      await render(<HistorySection />);
      await waitFor(() => expect(screen.getByText("Calendar")).toBeTruthy());
      await new Promise((r) => setTimeout(r, 30)); // let the load settle
      expect(screen.queryByText("NLA Loaf")).toBeNull();
      expect(screen.queryByText("Account A Loaf")).toBeNull();
      expect(api.history.bakes.list).not.toHaveBeenCalled();
      expect(api.history.feed.list).not.toHaveBeenCalled();
      expect(JSON.parse(mockStore[BAKES_KEY]).length).toBe(2); // nothing was deleted or rewritten
    });
  }
});

describe("remote upserts under each identity state (recipeStorage)", () => {
  beforeEach(() => {
    mockStore = {};
    mockAuthReadFails = false;
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  const recipe: any = { id: "r1", name: "Loaf", phases: [{ key: "mix", name: "Mix", ingredients: [], instructions: [] }], createdAt: 1, updatedAt: 1 };
  const activeBake: any = { id: "bk1", recipeId: "r1", recipeName: "Loaf", startedAt: 1, status: "active", phases: [] };

  it("valid account: the owner id is sent with the write", async () => {
    validPair("acct-A");
    await upsertRecipeRemote(recipe);
    await upsertBakeRemote(activeBake);
    expect((api.recipes.upsert as jest.Mock).mock.calls[0][0].userId).toBe("acct-A");
    expect((api.history.bakes.upsert as jest.Mock).mock.calls[0][0].userId).toBe("acct-A");
  });

  it("NLA: existing behavior is unchanged (no owner id on the write)", async () => {
    await upsertRecipeRemote(recipe);
    expect((api.recipes.upsert as jest.Mock).mock.calls[0][0].userId).toBeUndefined();
  });

  for (const state of uncertain) {
    it(`${state.name}: both upserts reject and nothing is sent (never a device-id-only write)`, async () => {
      state.arm();
      await expect(upsertRecipeRemote(recipe)).rejects.toThrow(/Identity integrity failure|Credential read failed/);
      await expect(upsertBakeRemote(activeBake)).rejects.toThrow(/Identity integrity failure|Credential read failed/);
      expect(api.recipes.upsert).not.toHaveBeenCalled();
      expect(api.history.bakes.upsert).not.toHaveBeenCalled();
    });
  }
});
