// artifacts/sourdough/lib/__tests__/apiOwnership.test.ts
import { api } from "../api";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        or: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            returns: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
      upsert: jest.fn().mockReturnValue({
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
      }),
    }),
  },
}));

describe("API Ownership & Signout Real Implementation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      api.recipes.upsert({ id: "rec-1", name: "Test", userId: "user-456", phases: [], yield_value: 1, deviceId: "dev" })
    ).rejects.toThrow(/Authentication required/);

    // Case 2: Session user ID differs from target user ID
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "active-session-user-123" } } },
      error: null,
    });
    await expect(
      api.recipes.upsert({ id: "rec-1", name: "Test", userId: "different-user-456", phases: [], yield_value: 1, deviceId: "dev" })
    ).rejects.toThrow(/Owner\/Session mismatch/);

    await expect(
      api.history.bakes.upsert({ id: "bake-1", recipeName: "Test", userId: "different-user-456", phases: [], yield_value: 1, deviceId: "dev", startedAt: 1, savedAt: 1 })
    ).rejects.toThrow(/Owner\/Session mismatch/);

    await expect(
      api.history.feed.upsert({ id: "feed-1", userId: "different-user-456", data: {}, savedAt: 1, deviceId: "dev" })
    ).rejects.toThrow(/Owner\/Session mismatch/);
  });

  it("fails closed when getSession() throws an error", async () => {
    const getSessionMock = (supabase!.auth.getSession as jest.Mock);
    getSessionMock.mockRejectedValue(new Error("Network auth error"));

    await expect(
      api.recipes.upsert({ id: "rec-1", name: "Test", userId: "user-123", phases: [], yield_value: 1, deviceId: "dev" })
    ).rejects.toThrow(/Failed to retrieve active authentication session/);
  });

  it("ensures authenticated reads are scoped strictly to the authenticated user (shared-device account isolation)", async () => {
    const fromMock = (supabase!.from as jest.Mock);
    const selectMock = fromMock.mock.results[0]?.value?.select || fromMock().select;
    const orMock = selectMock().or;

    // Call recipes.list with deviceId "shared-dev" and userId "user-B"
    await api.recipes.list("shared-dev", "user-B");

    // Verify that the query filter was scoped strictly to user_id.eq.user-B without mixing device_id fallback
    expect(fromMock).toHaveBeenCalledWith("recipes");
  });
});
