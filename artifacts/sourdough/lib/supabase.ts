// --- lib/supabase.ts ---
// Locate the 'auth' object inside the createClient call. RLS is enabled and connecting users to
// their data relies on the name+starter name mechanic.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const key = process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,  // CHANGE: set to true to keep sessions alive
          persistSession: true,    // CHANGE: set to true to remember identity
          detectSessionInUrl: false,
        },
      })
    : null;
