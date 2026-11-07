// artifacts/sourdough/lib/__tests__/authError.test.ts
import { api } from "../api";
import { supabase } from "../supabase";
import { saveAuth, clearAuth, getStoredToken, getStoredUser } from "../auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
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
      data: { user: { id: "new-uuid" }, session: null },
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

  it("verifies saveAuth multiSet and purges partial key fragments if verification fails", async () => {
    const userObj = { id: "valid-id", firstName: "Valid", starterName: "User" };

    // Case 1: Successful multiSet and verification match
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_auth_token_v1") return Promise.resolve("valid-id");
      if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
      return Promise.resolve(null);
    });

    await saveAuth("valid-id", userObj);
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith([
      ["bread_lab_auth_token_v1", "valid-id"],
      ["bread_lab_auth_user_v1", JSON.stringify(userObj)],
    ]);

    // Case 2: Verification read back fails -> saveAuth throws error and purges keys via clearAuth
    getItemMock.mockResolvedValue(null); // Read back returns null (simulating write failure)

    await expect(saveAuth("valid-id", userObj)).rejects.toThrow(/Credential persistence failed verification/);
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      "bread_lab_auth_token_v1",
      "bread_lab_auth_user_v1",
    ]);
  });

  it("throws error and fails closed when clearOperationalData verification fails", async () => {
    const { clearOperationalData } = require("../storageUtils");

    // Simulate key remaining in storage after multiRemove
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockResolvedValue("remaining-value");

    await expect(clearOperationalData()).rejects.toThrow(/Operational wipe verification failed/);
  });

  describe("Issue #89: Validated Local Identity Contract", () => {
    it("returns null when both keys are absent (NLA)", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockResolvedValue(null);

      expect(await getStoredToken()).toBeNull();
      expect(await getStoredUser()).toBeNull();
    });

    it("returns token and user when matching pair is present", async () => {
      const userObj = { id: "user-123", firstName: "Alice", starterName: "Levain" };
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
        return Promise.resolve(null);
      });

      expect(await getStoredToken()).toBe("user-123");
      expect(await getStoredUser()).toEqual(userObj);
    });

    it("fails closed (throws error) when token is present but profile is absent", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure/);
      await expect(getStoredUser()).rejects.toThrow(/Identity integrity failure/);
    });

    it("fails closed (throws error) when profile is present but token is absent", async () => {
      const userObj = { id: "user-123", firstName: "Alice", starterName: "Levain" };
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve(null);
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure/);
      await expect(getStoredUser()).rejects.toThrow(/Identity integrity failure/);
    });

    it("fails closed (throws error) when token and profile IDs differ", async () => {
      const userObj = { id: "user-999", firstName: "Alice", starterName: "Levain" };
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure.*IDs differ/);
      await expect(getStoredUser()).rejects.toThrow(/Identity integrity failure.*IDs differ/);
    });

    it("fails closed when profile JSON is malformed", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve("not-json");
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure.*malformed/);
    });

    it("fails closed when profile object is invalid (missing fields)", async () => {
      const invalidUser = { id: "user-123", firstName: "Alice" }; // missing starterName
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(invalidUser));
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure/);
    });

    it("fails closed when token is blank or invalid", async () => {
      const userObj = { id: "", firstName: "Alice", starterName: "Levain" };
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("   ");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
        return Promise.resolve(null);
      });

      await expect(getStoredToken()).rejects.toThrow(/Identity integrity failure/);
    });

    it("fails closed when reading credentials throws storage error", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockRejectedValue(new Error("Disk read error"));

      await expect(getStoredToken()).rejects.toThrow(/Credential read failed/);
    });

    it("saveAuth rejects mismatched IDs before persisting", async () => {
      const userObj = { id: "user-456", firstName: "Bob", starterName: "Levain" };
      await expect(saveAuth("user-123", userObj)).rejects.toThrow(/token and profile IDs differ/);
      expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    });

    it("clearAuth verifies successful removal leaves both keys absent", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockResolvedValue(null);

      await expect(clearAuth()).resolves.toBeUndefined();
    });

    it("clearAuth fails verification when a blank token remains", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("   ");
        return Promise.resolve(null);
      });

      await expect(clearAuth()).rejects.toThrow(/Auth storage cleanup verification failed/);
    });

    it("clearAuth fails verification when a profile remains", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify({ id: "user-123" }));
        return Promise.resolve(null);
      });

      await expect(clearAuth()).rejects.toThrow(/Auth storage cleanup verification failed/);
    });

    it("clearAuth fails verification when a blank profile remains", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_user_v1") return Promise.resolve("   ");
        return Promise.resolve(null);
      });

      await expect(clearAuth()).rejects.toThrow(
        /Auth storage cleanup verification failed/
      );
    });

    it("clearAuth propagates storage read failure during verification", async () => {
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockRejectedValue(new Error("Disk read error"));

      await expect(clearAuth()).rejects.toThrow(/Disk read error/);
    });

    it("Candidate storage selects anonymous when both keys absent, verified owner when valid, and rejects on integrity error", async () => {
      const { getCandidatesKey } = require("../candidateStorage");

      // 1. Both absent -> anonymous
      const getItemMock = AsyncStorage.getItem as jest.Mock;
      getItemMock.mockResolvedValue(null);
      expect(await getCandidatesKey()).toBe("bread_lab_candidates_v1_anonymous");

      // 2. Valid authenticated pair -> owner key
      const userObj = { id: "user-123", firstName: "Alice", starterName: "Levain" };
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify(userObj));
        return Promise.resolve(null);
      });
      expect(await getCandidatesKey()).toBe("bread_lab_candidates_v1_user-123");

      // 3. Integrity failure (mismatched) -> rejects (does NOT fall back to anonymous)
      getItemMock.mockImplementation((key) => {
        if (key === "bread_lab_auth_token_v1") return Promise.resolve("user-123");
        if (key === "bread_lab_auth_user_v1") return Promise.resolve(JSON.stringify({ id: "user-999", firstName: "Alice", starterName: "Levain" }));
        return Promise.resolve(null);
      });
      await expect(getCandidatesKey()).rejects.toThrow(/Identity integrity failure/);
    });
  });
});
