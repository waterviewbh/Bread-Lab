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
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, token),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
  ]);
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
  ]);
}
