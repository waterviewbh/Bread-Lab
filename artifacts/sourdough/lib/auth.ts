import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";

export interface AuthUser {
  id: string;
  firstName: string;
  starterName: string;
}

export async function getStoredToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.id === "string" &&
      typeof parsed?.firstName === "string" &&
      typeof parsed?.starterName === "string"
    ) {
      return parsed as AuthUser;
    }
    await AsyncStorage.removeItem(USER_KEY);
    return null;
  } catch {
    return null;
  }
}

export async function saveAuth(token: string, user: AuthUser): Promise<void> {
  const userJson = JSON.stringify(user);
  let attempts = 0;
  let verified = false;

  while (attempts < 3 && !verified) {
    attempts++;
    try {
      await AsyncStorage.multiSet([
        [TOKEN_KEY, token],
        [USER_KEY, userJson],
      ]);

      const [readToken, readUserRaw] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
      ]);

      if (readToken === token && readUserRaw === userJson) {
        verified = true;
      } else {
        console.warn(`[saveAuth] Verification attempt ${attempts} failed, retrying...`);
        if (attempts < 3) await new Promise((r) => setTimeout(r, 100 * attempts));
      }
    } catch (error) {
      console.warn(`[saveAuth] multiSet attempt ${attempts} failed`, error);
      if (attempts < 3) await new Promise((r) => setTimeout(r, 100 * attempts));
    }
  }

  if (!verified) {
    await clearAuth().catch(() => {});
    throw new Error("Credential persistence failed verification. Session reset to unauthenticated.");
  }
}

export async function clearAuth(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  } catch {
    try {
      await Promise.all([
        AsyncStorage.removeItem(TOKEN_KEY),
        AsyncStorage.removeItem(USER_KEY),
      ]);
    } catch (e) {
      console.warn("[clearAuth] Fallback removal failed", e);
    }
  }

  const [token, userRaw] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);

  if (token !== null || userRaw !== null) {
    throw new Error("Credential clearing failed verification: credentials remain in storage.");
  }
}
