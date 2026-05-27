import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_ID_KEY = "bread_lab_device_id_v1";

let cached: string | null = null;

function makeId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {}
  const id = makeId();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {}
  cached = id;
  return id;
}
