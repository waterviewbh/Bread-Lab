// --- lib/supabase.ts ---
// Locate the 'auth' object inside the createClient call. RLS is enabled and connecting users to
// their data relies on the name+starter name mechanic.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env["EXPO_PUBLIC_SUPABASE_URL"]?.trim() ?? "";
const key = process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"]?.trim() ?? "";

// Fail-closed validation for partial/invalid config, while permitting graceful offline operation when fully absent.
if ((url && !key) || (!url && key)) {
  throw new Error(
    "Invalid Supabase configuration: Both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be provided together, or both omitted for offline mode."
  );
}

// Extract project reference safely for startup verification guard without exposing secrets
function extractProjectRef(supabaseUrl: string): string {
  try {
    const parsed = new URL(supabaseUrl);
    const host = parsed.hostname; // e.g. qdcqaiojtzmwiwlsjppr.supabase.co
    const parts = host.split(".");
    return parts.length > 0 ? parts[0] : "unknown";
  } catch {
    return "unknown";
  }
}

if (url && key) {
  const projectRef = extractProjectRef(url);
  console.log(`[Supabase] Initialized client for project reference: ${projectRef}`);
} else {
  console.log("[Supabase] Running in offline/local-only mode (no Supabase configuration detected).");
}

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,  // set to true to keep sessions alive
          persistSession: true,    // set to true to remember identity
          detectSessionInUrl: false,
        },
      })
    : null;
