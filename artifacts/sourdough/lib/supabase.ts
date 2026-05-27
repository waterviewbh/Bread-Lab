// Security model: the app uses the Supabase anon key + device_id-filtered
// queries (no RLS, no user accounts). `persistSession: false` is intentional —
// we never call supabase.auth.signIn* so there is no session to persist.
// `autoRefreshToken: false` follows the same reasoning. Row-level security can
// be added in a future iteration if multi-user support is needed.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const key = process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;
