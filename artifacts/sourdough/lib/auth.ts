import AsyncStorage from "@react-native-async-storage/async-storage";
import { advanceWorkspaceGeneration } from "./storageUtils";

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";

export interface AuthUser {
  id: string;
  firstName: string;
  starterName: string;
}

interface ValidatedAuth {
  token: string;
  user: AuthUser;
}

async function getValidatedAuth(): Promise<ValidatedAuth | null> {
  let t: any = null;
  let u: any = null;
  try {
    const res = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    t = res[0];
    u = res[1];
  } catch (error) {
    throw new Error(`Credential read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const tokenRaw = (t !== undefined && t !== null && String(t).trim() !== "") ? String(t).trim() : null;
  const userRaw = (u !== undefined && u !== null && String(u).trim() !== "") ? String(u).trim() : null;

  // Both keys absent: NLA / offline workspace
  if (tokenRaw === null && userRaw === null) {
    return null;
  }

  // Integrity Failure: Token present, profile absent
  if (tokenRaw !== null && userRaw === null) {
    throw new Error("Identity integrity failure: token present but profile absent.");
  }

  // Integrity Failure: Profile present, token absent
  if (tokenRaw === null && userRaw !== null) {
    throw new Error("Identity integrity failure: profile present but token absent.");
  }

  // Parse profile JSON
  let parsed: any;
  try {
    parsed = JSON.parse(userRaw!);
  } catch (_error) {
    throw new Error("Identity integrity failure: stored profile JSON is malformed.");
  }

  // Validate profile object structure according to existing profile contract
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.id !== "string" ||
    parsed.id.trim() === "" ||
    typeof parsed.firstName !== "string" ||
    typeof parsed.starterName !== "string"
  ) {
    throw new Error("Identity integrity failure: stored profile object is invalid or malformed.");
  }

  // Validate ID match: user.id === token
  if (parsed.id !== tokenRaw) {
    throw new Error("Identity integrity failure: token and profile IDs differ.");
  }

  return {
    token: tokenRaw,
    user: parsed as AuthUser,
  };
}

export async function getStoredToken(): Promise<string | null> {
  const auth = await getValidatedAuth();
  return auth ? auth.token : null;
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const auth = await getValidatedAuth();
  return auth ? auth.user : null;
}

export async function saveAuth(token: string, user: AuthUser): Promise<void> {
  // Validate token and user before persisting
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("Cannot save auth: token is blank or invalid.");
  }
  if (
    !user ||
    typeof user !== "object" ||
    typeof user.id !== "string" ||
    user.id.trim() === "" ||
    typeof user.firstName !== "string" ||
    typeof user.starterName !== "string"
  ) {
    throw new Error("Cannot save auth: user profile object is invalid or malformed.");
  }
  if (user.id !== token) {
    throw new Error("Cannot save auth: token and profile IDs differ.");
  }

  advanceWorkspaceGeneration();
  console.log(`[BL-DIAG] [Auth] saveAuth starting for user: ${user.id} (${user.firstName})`);
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

      const auth = await getValidatedAuth();
      if (auth && auth.token === token && JSON.stringify(auth.user) === userJson) {
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
    console.log(`[BL-DIAG] [Auth] saveAuth verification FAILED after attempts.`);
    await clearAuth().catch(() => {});
    throw new Error("Credential persistence failed verification. Session reset to unauthenticated.");
  }
  console.log(`[BL-DIAG] [Auth] saveAuth verification SUCCEEDED for user: ${user.id}`);
}

export async function clearAuth(): Promise<void> {
  advanceWorkspaceGeneration();
  console.log(`[BL-DIAG] [Auth] clearAuth starting...`);
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    console.log(`[BL-DIAG] [Auth] clearAuth multiRemove completed.`);
  } catch (err) {
    console.log(`[BL-DIAG] [Auth] clearAuth multiRemove threw error, trying fallback:`, err);
    try {
      await Promise.all([
        AsyncStorage.removeItem(TOKEN_KEY),
        AsyncStorage.removeItem(USER_KEY),
      ]);
      console.log(`[BL-DIAG] [Auth] clearAuth fallback removal completed.`);
    } catch (e) {
      console.warn("[clearAuth] Fallback removal failed", e);
    }
  }

  const [storedToken, storedUser] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);

  const tokenStillPresent = storedToken !== null && storedToken !== undefined;
  const userStillPresent = storedUser !== null && storedUser !== undefined;

  if (tokenStillPresent || userStillPresent) {
    console.log(`[BL-DIAG] [Auth] clearAuth verification FAILED: credentials remain on disk.`);
    throw new Error("Auth storage cleanup verification failed");
  }
  console.log(`[BL-DIAG] [Auth] clearAuth verification SUCCEEDED: credentials absent.`);
}
