// artifacts/sourdough/lib/__tests__/apiOwnership.test.ts
import { api } from "../api";
import { supabase } from "../supabase";

const mockSingle = jest.fn().mockResolvedValue({
  data: {
    id: "res-1",
    device_id: "dev-1",
    user_id: "user-1",
    name: "Test",
    phases: [],
    created_at: new Date().toISOString(),
    yield_value: 1,
    recipe_data: {},
    is_archived: false,
  },
  error: null,
});

const mockChain: any = {
  order: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  returns: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  single: mockSingle,
};

const mockOr = jest.fn().mockReturnValue(mockChain);

const mockDeleteOr = jest.fn().mockResolvedValue({ error: null });

const mockDeleteEq = jest.fn().mockReturnValue({
  or: mockDeleteOr,
});

const mockUpsert = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnValue({
    returns: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: {
          id: "res-1",
          device_id: "dev-1",
          user_id: "user-1",
          name: "Test",
          phases: [],
          created_at: new Date().toISOString(),
          yield_value: 1,
          recipe_data: {},
          is_archived: false,
          saved_at: 1,
          started_at: 1,
          in_progress: false,
          completed_at: null,
          status: null,
          outcome: null,
          notes: null,
        },
        error: null,
      }),
    }),
  }),
});

const mockInsert = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnValue({
    returns: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: {
          id: "dup-1",
          device_id: "dev-1",
          user_id: "user-1",
          name: "Duplicated Name",
          phases: [],
          created_at: new Date().toISOString(),
        },
        error: null,
      }),
    }),
  }),
});

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn().mockImplementation((table: string) => ({
      select: jest.fn().mockReturnValue({
        or: mockOr,
        eq: jest.fn().mockReturnValue({
          single: mockSingle,
        }),
      }),
      insert: mockInsert,
      upsert: mockUpsert,
      delete: jest.fn().mockReturnValue({
        eq: mockDeleteEq,
      }),
    })),
  },
}));

describe("API Ownership & Signout Real Implementation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("invokes real Supabase signOut and propagates signout errors", async () => {
    const signOutMock = (supabase!.auth.signOut as jest.Mock);
    signOutMock.mockResolvedValueOnce({ error: null });

    const res = await api.auth.signout();
    expect(res).toEqual({ signedOut: true });
    expect(signOutMock).toHaveBeenCalled();

    signOutMock.mockResolvedValueOnce({ error: new Error("Cloud signout failed") });
    await expect(api.auth.signout()).rejects.toThrow(/Cloud signout failed/);
  });

  it("permits recipe/bake/feed upsert when matching authenticated session and body.userId are provided", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-123" } } },
      error: null,
    });

    const res = await api.recipes.upsert({ id: "rec-1", name: "Test", userId: "user-123", phases: [], yield_value: 1, deviceId: "dev" });
    expect(res).toBeDefined();
  });

  it("permits anonymous/device-scoped writes when no target user ID is supplied", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const res = await api.recipes.upsert({ id: "rec-1", name: "Anon Test", phases: [], yield_value: 1, deviceId: "dev" });
    expect(res).toBeDefined();
  });

  it("refuses recipe/bake/feed upsert when session user ID does not match target user ID or session is missing", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);

    // Case 1: Target user ID supplied but no active session exists
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    await expect(
      api.recipes.upsert({ id: "r-1", name: "Bad", userId: "user-1" })
    ).rejects.toThrow(/Authentication required/);

    // Case 2: Session user ID does not match target user ID
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    await expect(
      api.recipes.upsert({ id: "r-1", name: "Bad", userId: "user-2" })
    ).rejects.toThrow(/Owner\/Session mismatch/);
  });

  it("enforces correct ownership filtering for list operations", async () => {
    await api.recipes.list("dev-1", "user-A");
    expect(mockOr).toHaveBeenCalledWith("user_id.eq.user-A");

    mockOr.mockClear();
    await api.recipes.list("dev-1", undefined);
    // When userId is undefined, api.recipes.list resolves via getStoredToken()
  });

  it("deletes records strictly scoped to owner when authenticated or device when anonymous", async () => {
    await api.recipes.delete("rec-1", "shared-dev", "user-A");
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "rec-1");
    expect(mockDeleteOr).toHaveBeenCalledWith("user_id.eq.user-A");
    expect(mockDeleteOr).not.toHaveBeenCalledWith(expect.stringContaining("device_id.eq.shared-dev"));

    mockDeleteOr.mockClear();
    await api.recipes.delete("rec-1", "shared-dev", "user-B");
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "rec-1");
    expect(mockDeleteOr).toHaveBeenCalledWith("user_id.eq.user-B");
    expect(mockDeleteOr).not.toHaveBeenCalledWith(expect.stringContaining("device_id.eq.shared-dev"));
  });

  it("Workstream B: Missing owner with active session throws explicit error and does not silently infer owner", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    await expect(
      api.recipes.upsert({ id: "r-1", name: "Missing Owner", userId: null })
    ).rejects.toThrow(/Authentication required/);
  });

  it("Workstream B: Explicit valid owner matches session and succeeds", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    const res = await api.recipes.upsert({ id: "r-1", name: "Valid Owner", userId: "user-1" });
    expect(res).toBeDefined();
  });

  it("Workstream B: Conflicting owner between body and session throws mismatch error", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    await expect(
      api.recipes.upsert({ id: "r-1", name: "Conflict", userId: "user-2" })
    ).rejects.toThrow(/Owner\/Session mismatch/);
  });

  it("getSession throwing a rejected promise in resolveAndVerifyOwner rejects upsert", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockRejectedValue(new Error("Session retrieval error"));

    await expect(
      api.recipes.upsert({ id: "r-1", name: "Test", userId: "user-1" })
    ).rejects.toThrow(/Failed to retrieve active authentication session/);
  });

  it("preserves original recipe creation timestamps during upsert: valid numeric createdAt converts to ISO string", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockUpsert.mockClear();

    const timestampMs = 1700000000000;
    await api.recipes.upsert({
      id: "rec-1",
      name: "Timestamp Test",
      userId: "user-1",
      createdAt: timestampMs,
      phases: [],
      yield_value: 1,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        created_at: new Date(timestampMs).toISOString(),
      })
    );
  });

  it("omits created_at when createdAt is missing or invalid", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockUpsert.mockClear();

    // Case A: Missing createdAt
    await api.recipes.upsert({
      id: "rec-1",
      name: "No Timestamp",
      userId: "user-1",
      phases: [],
      yield_value: 1,
    });

    const payloadMissing = mockUpsert.mock.calls[0][0];
    expect(payloadMissing).not.toHaveProperty("created_at");

    // Case B: Invalid createdAt
    await api.recipes.upsert({
      id: "rec-1",
      name: "Invalid Timestamp",
      userId: "user-1",
      createdAt: "not-a-date",
      phases: [],
      yield_value: 1,
    });

    const payloadInvalid = mockUpsert.mock.calls[1][0];
    expect(payloadInvalid).not.toHaveProperty("created_at");
  });

  it("rejects recipe duplication when user attempts to duplicate another user's recipe", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-current" } } },
      error: null,
    });

    mockSingle.mockResolvedValueOnce({
      data: { id: "rec-source", user_id: "user-other", name: "Other Recipe", overview: "", recipe_data: {} },
      error: null,
    });

    await expect(
      api.recipes.duplicate("rec-source", "Duplicated Name", "dev-1", "user-current")
    ).rejects.toThrow(/Unauthorized: cannot duplicate a recipe owned by another user/);
  });

  it("rejects recipe duplication when user attempts to duplicate an unassigned recipe into an authenticated account", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-current" } } },
      error: null,
    });

    mockSingle.mockResolvedValueOnce({
      data: { id: "rec-source", user_id: null, name: "Anon Recipe", overview: "", recipe_data: {} },
      error: null,
    });

    await expect(
      api.recipes.duplicate("rec-source", "Duplicated Name", "dev-1", "user-current")
    ).rejects.toThrow(/Unauthorized: cannot duplicate an unassigned recipe/);
  });

  it("allows a user to duplicate their own recipe", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-current" } } },
      error: null,
    });

    mockSingle.mockResolvedValueOnce({
      data: { id: "rec-source", user_id: "user-current", name: "My Recipe", overview: "", recipe_data: {} },
      error: null,
    });
    mockUpsert.mockClear();

    const res = await api.recipes.duplicate("rec-source", "Duplicated Name", "dev-1", "user-current");
    expect(res).toBeDefined();
    expect(res.name).toBe("Duplicated Name");
  });

  describe("API Fail-Closed Read Coverage (Issue #89)", () => {
    const readMethods = [
      { name: "recipes.list", fn: () => api.recipes.list("dev-1") },
      { name: "history.feed.list", fn: () => api.history.feed.list("dev-1") },
      { name: "history.feed.active", fn: () => api.history.feed.active("dev-1") },
      { name: "history.bakes.list", fn: () => api.history.bakes.list("dev-1") },
      { name: "history.bakes.active", fn: () => api.history.bakes.active("dev-1") },
    ];

    for (const m of readMethods) {
      it(`${m.name}: uses validated owner when userId omitted and valid token present`, async () => {
        const authModule = require("../auth");
        jest.spyOn(authModule, "getStoredToken").mockResolvedValue("user-123");
        mockOr.mockClear();

        await m.fn();
        expect(mockOr).toHaveBeenCalledWith("user_id.eq.user-123");
      });

      it(`${m.name}: rejects when userId omitted and getStoredToken rejects`, async () => {
        const authModule = require("../auth");
        jest.spyOn(authModule, "getStoredToken").mockRejectedValue(new Error("Identity integrity failure"));

        await expect(m.fn()).rejects.toThrow(/Identity integrity failure/);
        expect(mockOr).not.toHaveBeenCalledWith(expect.stringContaining("device_id.eq.dev-1"));
      });

      it(`${m.name}: rejects with storage failure when underlying AsyncStorage read fails and does not fall back to device-id`, async () => {
        const AsyncStorage = require("@react-native-async-storage/async-storage");
        jest.restoreAllMocks();
        jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("Disk read error"));
        mockOr.mockClear();

        await expect(m.fn()).rejects.toThrow(/Credential read failed|Disk read error/);
        expect(mockOr).not.toHaveBeenCalledWith(expect.stringContaining("device_id.eq.dev-1"));
      });
    }
  });
});
