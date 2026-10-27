// artifacts/sourdough/lib/__tests__/authError.test.ts
import { api } from "../api";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
    },
    from: jest.fn(),
  },
}));

describe("Auth Error Handling & Domain Regression", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses production-compatible derived domain (@breadlab.user) for identification emails", async () => {
    const authMod: any = supabase!.auth;
    authMod.signInWithPassword.mockResolvedValue({ data: { user: { id: "test-uuid" }, session: { access_token: "tok" } }, error: null });

    const supabaseMod: any = supabase;
    supabaseMod.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          returns: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: "test-uuid", first_name: "Test", starter_name: "Starter" }, error: null }),
          }),
        }),
      }),
    });

    const result = await api.auth.identify({ firstName: "Test", starterName: "Starter" });
    expect(result).toEqual({
      token: "test-uuid",
      user: { id: "test-uuid", firstName: "Test", starterName: "Starter" },
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test.starter@breadlab.user" })
    );
  });

  it("stops sign-in loop and throws when Email not confirmed occurs", async () => {
    const authMod: any = supabase!.auth;
    authMod.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Email not confirmed" },
    });

    await expect(
      api.auth.identify({ firstName: "Test", starterName: "Starter" })
    ).rejects.toThrow("Email confirmation is required");
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("does NOT trigger implicit signup fallback when sign-in fails and isSignUp is false/omitted", async () => {
    const authMod: any = supabase!.auth;
    // All 3 strategies fail with invalid login credentials
    authMod.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });

    await expect(
      api.auth.identify({ firstName: "Luke", starterName: "Baker" })
    ).rejects.toThrow(/Account sign-in failed/);

    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("triggers explicit signup when isSignUp: true is provided and sign-in fails", async () => {
    const authMod: any = supabase!.auth;
    authMod.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });
    authMod.signUp.mockResolvedValue({
      data: { user: { id: "new-uuid" }, session: { access_token: "new-tok" } },
      error: null,
    });

    const supabaseMod: any = supabase;
    supabaseMod.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          returns: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: "new-uuid", first_name: "New", starter_name: "Baker" }, error: null }),
          }),
        }),
      }),
    });

    const result = await api.auth.identify({ firstName: "New", starterName: "Baker", isSignUp: true });
    expect(result.token).toBe("new-uuid");
    expect(supabase.auth.signUp).toHaveBeenCalled();
  });

  it("throws error when signup returns no session", async () => {
    const authMod: any = supabase!.auth;
    authMod.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });
    authMod.signUp.mockResolvedValue({
      data: { user: { id: "new-uuid" }, session: null }, // no session
      error: null,
    });

    await expect(
      api.auth.identify({ firstName: "New", starterName: "Baker", isSignUp: true })
    ).rejects.toThrow("authentication session could not be established");
  });

  it("throws error when profile read fails after authentication", async () => {
    const authMod: any = supabase!.auth;
    authMod.signInWithPassword.mockResolvedValue({
      data: { user: { id: "test-uuid" }, session: { access_token: "tok" } },
      error: null,
    });

    const supabaseMod: any = supabase;
    supabaseMod.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          returns: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      }),
    });

    await expect(
      api.auth.identify({ firstName: "Test", starterName: "Starter" })
    ).rejects.toThrow("Profile loading failed");
  });
});
