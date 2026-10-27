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
  multiGet: jest.fn().mockResolvedValue([]),
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

    await expect(saveAuth("failed-id", userObj)).rejects.toThrow(/Credential persistence failed verification/);
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      "bread_lab_auth_token_v1",
      "bread_lab_auth_user_v1",
    ]);
  });

  it("backs up anonymous workspace to isolated key and restores operational data without data loss", async () => {
    const { backupAnonymousWorkspace, restoreAnonymousWorkspace } = require("../storageUtils");

    const multiGetMock = AsyncStorage.multiGet as jest.Mock;
    multiGetMock.mockResolvedValue([
      ["bread_lab_recipes_v1", JSON.stringify([{ id: "anon-rec-1", name: "Anon Loaf", userId: "anonymous" }])],
    ]);

    const hasData = await backupAnonymousWorkspace();
    expect(hasData).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "bread_lab_anonymous_backup_v1",
      expect.stringContaining("anon-rec-1")
    );

    // Test Restore
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_anonymous_backup_v1") {
        return Promise.resolve(JSON.stringify({
          bread_lab_recipes_v1: JSON.stringify([{ id: "anon-rec-1", name: "Anon Loaf", userId: "anonymous" }]),
        }));
      }
      return Promise.resolve(null);
    });

    await restoreAnonymousWorkspace();
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith([
      ["bread_lab_recipes_v1", JSON.stringify([{ id: "anon-rec-1", name: "Anon Loaf", userId: "anonymous" }])],
    ]);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("bread_lab_anonymous_backup_v1");
  });

  it("throws error and fails closed when clearOperationalData verification fails", async () => {
    const { clearOperationalData } = require("../storageUtils");

    // Simulate key remaining in storage after multiRemove
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockResolvedValue("remaining-value");

    await expect(clearOperationalData()).rejects.toThrow(/Operational wipe verification failed/);
  });
});
