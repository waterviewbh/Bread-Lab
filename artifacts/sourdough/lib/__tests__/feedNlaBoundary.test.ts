import { api } from "../api";
import { getStoredToken } from "../auth";
import { NlaSupabaseBoundaryError } from "../nlaBoundary";

// The REAL api module with only the Supabase client and credentials mocked.
//  - Feed upsert / list / active / get refuse the NLA workspace BEFORE any request, and are unchanged for accounts.
//  - Nothing else in the API changed (recipes, bakes, feed delete / verifyAbsent).
//  - fetchRowsByIds (new, read-only) requires an authenticated destination, queries only supplied ids, completes every
//    batch, and returns foreign or duplicate rows untouched so the verifier can fail on them.

const mockFrom = jest.fn();
const mockGetSession = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: (...a: any[]) => mockGetSession(...a), signOut: jest.fn() },
    from: (...a: any[]) => mockFrom(...a),
  },
}));
jest.mock("../auth", () => ({ getStoredToken: jest.fn(), getStoredUser: jest.fn() }));

const ACCT = "acct-1";
const session = (id: string | null) => mockGetSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null }, error: null });
const token = (t: string | null) => (getStoredToken as jest.Mock).mockResolvedValue(t);

// A query builder that records what was asked and resolves to canned data.
const builder = (data: any = [], error: any = null) => {
  const chain: any = {};
  for (const m of ["select", "or", "eq", "order", "limit", "returns", "in", "delete"]) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error }));
  chain.single = jest.fn(async () => ({ data: Array.isArray(data) ? data[0] : data, error }));
  chain.upsert = jest.fn(() => chain);
  chain.then = (res: any, rej: any) => Promise.resolve({ data, error }).then(res, rej);
  return chain;
};

describe("Feed API refuses the NLA workspace (four endpoints) and is unchanged for accounts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockImplementation(() => builder([]));
    session(null);
    token(null);
  });

  describe("NLA: refused before any request", () => {
    it("history.feed.list", async () => {
      await expect(api.history.feed.list("device-1")).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
      await expect(api.history.feed.list("device-1", "")).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("history.feed.active", async () => {
      await expect(api.history.feed.active("device-1")).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("history.feed.get", async () => {
      await expect(api.history.feed.get("feed-1")).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("history.feed.upsert (no session, no owner)", async () => {
      const body = { id: "f", deviceId: "device-1", savedAt: 1, inProgress: false, data: {} };
      await expect(api.history.feed.upsert(body)).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("the refusal is distinguishable from an empty result (it is an error, never [])", async () => {
      const outcome = await api.history.feed.list("device-1").then(() => "resolved", (e) => e.name);
      expect(outcome).toBe("NlaSupabaseBoundaryError");
    });
  });

  describe("authenticated account: behaviour preserved", () => {
    beforeEach(() => {
      token(ACCT);
      session(ACCT);
    });

    it("list is scoped to the account", async () => {
      const b = builder([]);
      mockFrom.mockImplementation(() => b);
      await expect(api.history.feed.list("device-1")).resolves.toEqual([]);
      expect(mockFrom).toHaveBeenCalledWith("feed_sessions");
      expect(b.or).toHaveBeenCalledWith(`user_id.eq.${ACCT}`);
    });

    it("active is scoped to the account", async () => {
      const b = builder(null);
      mockFrom.mockImplementation(() => b);
      await expect(api.history.feed.active("device-1")).resolves.toBeNull();
      expect(b.or).toHaveBeenCalledWith(`user_id.eq.${ACCT}`);
    });

    it("get reaches the table", async () => {
      mockFrom.mockImplementation(() => builder(null));
      await expect(api.history.feed.get("feed-1")).resolves.toBeNull();
      expect(mockFrom).toHaveBeenCalledWith("feed_sessions");
    });

    it("upsert with the matching session writes the row for that owner", async () => {
      const row = { id: "f", device_id: "device-1", user_id: ACCT, saved_at: 1, started_at: null, updated_at: 2, in_progress: false, data: {}, created_at: "" };
      const b = builder(row);
      mockFrom.mockImplementation(() => b);
      await api.history.feed.upsert({ id: "f", deviceId: "device-1", userId: ACCT, savedAt: 1, inProgress: false, data: {} });
      expect(b.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: "f", user_id: ACCT, in_progress: false }));
    });

    it("existing owner errors are unchanged (mismatch, omitted owner, no session)", async () => {
      const body = { id: "f", deviceId: "d", savedAt: 1, inProgress: false, data: {} };
      session("acct-2");
      await expect(api.history.feed.upsert({ ...body, userId: ACCT })).rejects.toThrow(/Owner\/Session mismatch/);
      session(ACCT);
      await expect(api.history.feed.upsert(body)).rejects.toThrow(/omitted explicit user ownership/);
      session(null);
      await expect(api.history.feed.upsert({ ...body, userId: ACCT })).rejects.toThrow(/Authentication required/);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe("scope: nothing else changed", () => {
    it("feed delete and verifyAbsent are NOT part of this refusal (tombstone semantics unchanged)", async () => {
      mockFrom.mockImplementation(() => builder([]));
      await api.history.feed.delete("f", "device-1", undefined).catch(() => {});
      await api.history.feed.verifyAbsent("f", "device-1", undefined).catch(() => {});
      expect(mockFrom).toHaveBeenCalledWith("feed_sessions");
    });

    it("recipes and bakes keep their existing device-scoped behaviour (scheduled for a later change)", async () => {
      mockFrom.mockImplementation(() => builder([]));
      await api.recipes.list("device-1", undefined).catch(() => {});
      await api.history.bakes.list("device-1", undefined).catch(() => {});
      expect(mockFrom).toHaveBeenCalledWith("recipes");
      expect(mockFrom).toHaveBeenCalledWith("bake_sessions");
    });
  });
});

describe("api.fetchRowsByIds (read-only read-back)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session(ACCT);
  });

  const rowsFor = (ids: string[]) => ids.map((id) => ({ id, user_id: ACCT }));
  const batchesSeen: string[][] = [];
  const stubTable = (impl?: (batch: string[], n: number) => { data?: any; error?: any }) => {
    batchesSeen.length = 0;
    let n = 0;
    mockFrom.mockImplementation((table: string) => ({
      select: () => ({
        in: async (col: string, batch: string[]) => {
          expect(col).toBe("id");
          batchesSeen.push(batch);
          const r = impl ? impl(batch, n++) : { data: rowsFor(batch) };
          return { data: r.data ?? null, error: r.error ?? null };
        },
      }),
      __table: table,
    }));
  };

  it("requires an authenticated destination account", async () => {
    stubTable();
    await expect(api.fetchRowsByIds("recipes", ["a"], "")).rejects.toBeInstanceOf(NlaSupabaseBoundaryError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("requires the live session to BE the destination (no cross-account read-back)", async () => {
    stubTable();
    session("acct-2");
    await expect(api.fetchRowsByIds("recipes", ["a"], ACCT)).rejects.toThrow(/Owner\/Session mismatch/);
    session(null);
    await expect(api.fetchRowsByIds("recipes", ["a"], ACCT)).rejects.toThrow(/Owner\/Session mismatch/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("queries only the supplied ids, in complete batches of 100, and loses nothing (250 ids = 3 batches)", async () => {
    stubTable();
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const { requested, rows } = await api.fetchRowsByIds("bakes", ids, ACCT);
    expect(requested).toBe(250);
    expect(rows).toHaveLength(250);
    expect(batchesSeen.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batchesSeen.flat()).toEqual(ids);
    expect(mockFrom).toHaveBeenCalledWith("bake_sessions");
  });

  it("maps each kind to its table", async () => {
    stubTable();
    await api.fetchRowsByIds("recipes", ["a"], ACCT);
    await api.fetchRowsByIds("feed", ["a"], ACCT);
    expect(mockFrom.mock.calls.map((c) => c[0])).toEqual(["recipes", "feed_sessions"]);
  });

  it("a failing batch fails the whole call (never a silent partial result)", async () => {
    stubTable((_b, n) => (n === 1 ? { error: new Error("batch 2 failed") } : { data: [] }));
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    await expect(api.fetchRowsByIds("recipes", ids, ACCT)).rejects.toThrow("batch 2 failed");
  });

  it("returns foreign-owned and duplicate rows UNFILTERED so the verifier can fail on them", async () => {
    stubTable(() => ({ data: [{ id: "a", user_id: "someone-else" }, { id: "a", user_id: ACCT }, { id: "b", user_id: null }] }));
    const { rows } = await api.fetchRowsByIds("recipes", ["a", "b", "c"], ACCT);
    expect(rows).toEqual([{ id: "a", user_id: "someone-else" }, { id: "a", user_id: ACCT }, { id: "b", user_id: null }]);
  });

  it("rejects an impossible result (more rows than requested)", async () => {
    stubTable(() => ({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] }));
    await expect(api.fetchRowsByIds("recipes", ["a"], ACCT)).rejects.toThrow(/more rows returned than ids requested/);
  });

  it("rejects bad input: duplicate ids, blank ids, unknown kind", async () => {
    stubTable();
    await expect(api.fetchRowsByIds("recipes", ["a", "a"], ACCT)).rejects.toThrow(/duplicate ids/);
    await expect(api.fetchRowsByIds("recipes", ["a", " "], ACCT)).rejects.toThrow(/non-empty strings/);
    await expect(api.fetchRowsByIds("nope" as any, ["a"], ACCT)).rejects.toThrow(/unknown kind/);
  });

  it("an empty id list makes no query at all", async () => {
    stubTable();
    await expect(api.fetchRowsByIds("recipes", [], ACCT)).resolves.toEqual({ requested: 0, rows: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
