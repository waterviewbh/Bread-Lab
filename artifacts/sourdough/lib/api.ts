// api.ts — Supabase-backed data layer.
// The "token" stored in AsyncStorage is the user's row ID from the `users`
// table. It is used as a stable cross-device identity: any device that
// identifies with the same first_name + starter_name gets the same userId,
// and all data rows are then queryable by EITHER device_id OR user_id.

import { supabase } from "./supabase";
import {
  computeVitalityAnalytics,
  updateAllTimeAnalytics,
  sessionPoints,
} from "./analytics";
import type { SessionForAnalytics, StarterAnalytics } from "./analytics";

// ── Unauthorized handler registry (kept for backward compat; never fires) ────

type UnauthorizedHandler = () => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(fn: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(fn);
  return () => unauthorizedHandlers.delete(fn);
}

// ── Exported API types ────────────────────────────────────────────────────────

export type ApiRecipePhase = {
  key: string;
  name: string;
  ingredients?: string;
  instructions?: string;
};

export type ApiRecipe = {
  id: string;
  deviceId: string;
  name: string;
  phases: ApiRecipePhase[];
  createdAt: string;
  updatedAt: string;
  yield_value: number;
};

export type ApiFeedSession = {
  id: string;
  deviceId: string;
  savedAt: number;
  startedAt?: number | null;
  updatedAt?: number | null;
  inProgress?: boolean;
  data: Record<string, unknown>;
  createdAt: string;
};

export type ApiBakePhaseReading = {
  id: string;
  temp: string;
  tempUnit: "F" | "C";
  pH: string;
  note: string;
  volume: string;
  loggedAt: number;
};

export type ApiBakePhase = {
  key: string;
  name: string;
  ingredients?: string;
  instructions?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  readings?: ApiBakePhaseReading[];
  startVolume?: string;

};

export type ApiBakeSession = {
  id: string;
  deviceId: string;
  recipeId?: string | null;
  recipeName: string;
  savedAt: number;
  startedAt: number;
  phases: ApiBakePhase[];
  inProgress: boolean;
  createdAt: string;
  yield_value: number;
};

export type ApiAuthUser = { id: string; firstName: string; starterName: string };
export type ApiAuthResponse = { token: string; user: ApiAuthUser };

// ── Typed DB row shapes (snake_case, matching the Supabase schema) ────────────

interface UserRow {
  id: string;
  first_name: string;
  starter_name: string;
  created_at: string;
}

interface RecipeRow {
  id: string;
  device_id: string;
  user_id: string | null;
  name: string;
  phases: ApiRecipePhase[];
  created_at: string;
  updated_at: string | null;
  yield_value: number;
}

interface FeedSessionRow {
  id: string;
  device_id: string;
  user_id: string | null;
  saved_at: number;
  started_at: number | null;
  updated_at: number | null;
  in_progress: boolean;
  data: Record<string, unknown>;
  created_at: string;
}

interface FeedSessionAnalyticsRow {
  id: string;
  saved_at: number;
  data: Record<string, unknown>;
}

interface BakeSessionRow {
  id: string;
  device_id: string;
  user_id: string | null;
  recipe_id: string | null;
  recipe_name: string;
  saved_at: number;
  started_at: number;
  phases: ApiBakePhase[];
  in_progress: boolean;
  created_at: string;
  yield_value: number;
}

interface StarterAnalyticsRow {
  device_id: string;
  updated_at: number;
  vitality_sessions: number | null;
  vitality_x_max: number | null;
  vitality_points: [number, number][] | null;
  all_time_sessions: number | null;
  all_time_x_max: number | null;
  all_time_points: [number, number][] | null;
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToApiRecipe(r: RecipeRow): ApiRecipe {
  return {
    id: r.id,
    deviceId: r.device_id,
    name: r.name,
    phases: r.phases ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    yield_value: r.yield_value,
  };
}

function rowToApiFeedSession(r: FeedSessionRow): ApiFeedSession {
  return {
    id: r.id,
    deviceId: r.device_id,
    savedAt: Number(r.saved_at),
    startedAt: r.started_at != null ? Number(r.started_at) : null,
    updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
    inProgress: r.in_progress ?? false,
    data: r.data ?? {},
    createdAt: r.created_at,
  };
}

function rowToApiBakeSession(r: BakeSessionRow): ApiBakeSession {
  return {
    id: r.id,
    deviceId: r.device_id,
    recipeId: r.recipe_id ?? null,
    recipeName: r.recipe_name,
    savedAt: Number(r.saved_at),
    startedAt: Number(r.started_at),
    phases: r.phases ?? [],
    inProgress: r.in_progress ?? false,
    createdAt: r.created_at,
    yield_value: r.yield_value,
  };
}

function rowToStarterAnalytics(r: StarterAnalyticsRow): StarterAnalytics {
  return {
    deviceId: r.device_id,
    updatedAt: Number(r.updated_at),
    vitalitySessions: r.vitality_sessions ?? 0,
    vitalityXMax: r.vitality_x_max ?? 120,
    vitalityPoints: r.vitality_points ?? [],
    allTimeSessions: r.all_time_sessions ?? 0,
    allTimeXMax: r.all_time_x_max ?? 120,
    allTimePoints: r.all_time_points ?? [],
  };
}

function rowToSessionForAnalytics(r: FeedSessionAnalyticsRow): SessionForAnalytics {
  const d = r.data as Record<string, unknown>;
  return {
    savedAt: Number(r.saved_at),
    readings: (d.readings as { pH: string; loggedAt: number }[]) ?? [],
    initialPH: d.initialPH as string | undefined,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a random 32-char alphanumeric ID (no external dependency needed). */
function genId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/**
 * Build a Supabase OR filter string for "rows owned by this device OR this user".
 * Returns undefined when neither value is present (caller should handle as empty result).
 */
function ownerFilter(
  deviceId: string | undefined,
  userId: string | undefined
): string | undefined {
  if (deviceId && userId) return `device_id.eq.${deviceId},user_id.eq.${userId}`;
  if (userId) return `user_id.eq.${userId}`;
  if (deviceId) return `device_id.eq.${deviceId}`;
  return undefined;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
  auth: {
    /**
     * Create or retrieve a user by first name + starter name.
     * This uses Supabase Auth internally (Shadow Account) to satisfy RLS
     * requirements while keeping the "no-login" UX.
     */
    identify: async (body: {
      firstName: string;
      starterName: string;
    }): Promise<ApiAuthResponse> => {
      console.log(">>> IDENTIFY BUTTON CLICKED <<<");
      console.log("Supabase Client Status:", supabase ? "INITIALIZED" : "NULL");
        if (!supabase) {
          const errorMsg = "Supabase not configured. URL: " + (process.env.EXPO_PUBLIC_SUPABASE_URL ? "Present" : "MISSING");
          console.error(errorMsg);
          throw new Error(errorMsg);
        }
      const fn = body.firstName.trim();
      const sn = body.starterName.trim();

      // 1. Generate a "Shadow" identity
      // We create a deterministic email and a password of at least 6 chars.
      const sanitizedFn = fn.toLowerCase().replace(/\s/g, "");
      const sanitizedSn = sn.toLowerCase().replace(/\s/g, "");
      const email = `${sanitizedFn}.${sanitizedSn}@breadlab.user`;

      // Ensure password is at least 6 characters for Supabase Auth
      const password = sn.length >= 6 ? sn : `${sn}breadlab`.slice(0, 10);

      // 2. Attempt to Sign In
      let { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      // 3. If User doesn't exist (First time), Sign Up
      if (signInError && signInError.message.includes("Invalid login credentials")) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { first_name: fn, starter_name: sn },
          },
        });
        if (signUpError) throw signUpError;
        authData = signUpData;
      } else if (signInError) {
        throw signInError;
      }

      if (!authData.user) throw new Error("Authentication failed");

      // 4. Sync the public 'users' table (Backward compatibility for metadata)
      const { data: userRow, error: upsertError } = await supabase
        .from("users")
        .upsert({
          id: authData.user.id, // Now using the real Auth UUID
          first_name: fn,
          starter_name: sn,
        })
        .select()
        .returns<UserRow[]>()
        .single();

      if (upsertError) console.error("Metadata sync error:", upsertError);

      return {
        token: authData.user.id,
        user: {
          id: authData.user.id,
          firstName: userRow?.first_name ?? fn,
          starterName: userRow?.starter_name ?? sn,
        },
      };
    },

    /**
     * Look up a user by their ID.
     * Uses the active Supabase session to verify the user is who they say they are.
     */
    me: async (userId?: string): Promise<{ user: ApiAuthUser }> => {
      if (!supabase || !userId) throw new Error("Not authenticated");

      // Get the current verified session
      const { data: { user: authUser } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser?.id ?? userId) // Prefer the verified Auth ID
        .returns<UserRow[]>()
        .single();

      if (error || !data) throw new Error("User not found");
      return {
        user: {
          id: data.id,
          firstName: data.first_name,
          starterName: data.starter_name,
        },
      };
    },

    /**
     * Tag all existing sessions and recipes for `deviceId` with `userId` so
     * they become visible on any other device that identifies with the same name.
     * Only rows that have no user_id yet are updated (idempotent).
     */
    linkDevice: async (
      deviceId: string,
      userId: string
    ): Promise<{ linked: boolean }> => {
      if (!supabase || !deviceId || !userId) return { linked: false };
      await Promise.all([
        supabase
          .from("feed_sessions")
          .update({ user_id: userId })
          .eq("device_id", deviceId)
          .or("user_id.is.null,user_id.eq."),
        supabase
          .from("bake_sessions")
          .update({ user_id: userId })
          .eq("device_id", deviceId)
          .or("user_id.is.null,user_id.eq."),
        supabase
          .from("recipes")
          .update({ user_id: userId })
          .eq("device_id", deviceId)
          .or("user_id.is.null,user_id.eq."),
      ]);
      return { linked: true };
    },

    claimOrphans: async (): Promise<{
      claimed: { feed: number; bakes: number; recipes: number };
    }> => ({ claimed: { feed: 0, bakes: 0, recipes: 0 } }),

    signout: async (): Promise<{ signedOut: boolean }> => ({
      signedOut: true,
    }),
  },

  recipes: {
    list: async (deviceId?: string, userId?: string): Promise<ApiRecipe[]> => {
      if (!supabase) return [];
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return [];
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .or(filter)
        .order("created_at", { ascending: false })
        .returns<RecipeRow[]>();
      if (error) throw error;
      return (data ?? []).map(rowToApiRecipe);
    },

    upsert: async (body: {
      id: string;
      deviceId: string;
      userId?: string;
      name: string;
      yield_value: number;
      phases: ApiRecipePhase[];
    }): Promise<ApiRecipe> => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase
        .from("recipes")
        .upsert({
          id: body.id,
          device_id: body.deviceId,
          user_id: body.userId ?? null,
          name: body.name,
          yield_value: body.yield_value,
          phases: body.phases,
          updated_at: new Date().toISOString(),
        })
        .select()
        .returns<RecipeRow[]>()
        .single();
      if (error) throw error;
      return rowToApiRecipe(data);
    },

    update: async (
      id: string,
      body: { deviceId: string; name: string; phases: ApiRecipePhase[] }
    ): Promise<ApiRecipe> => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase
        .from("recipes")
        .update({
          name: body.name,
          phases: body.phases,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("device_id", body.deviceId)
        .select()
        .returns<RecipeRow[]>()
        .single();
      if (error) throw error;
      return rowToApiRecipe(data);
    },

    delete: async (id: string, deviceId?: string, userId?: string): Promise<boolean> => {
      if (!supabase) return false;
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return false;
      const { error } = await supabase
        .from("recipes")
        .delete()
        .eq("id", id)
        .or(filter);
      if (error) throw error;
      return true;
    },
  },

  history: {
    feed: {
      /**
       * List feed sessions for this device and/or user.
       * When userId is supplied, returns sessions from ALL devices that share
       * the same identity — enabling cross-device data recovery.
       */
      list: async (
        deviceId?: string,
        userId?: string
      ): Promise<ApiFeedSession[]> => {
        if (!supabase) return [];
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return [];
        const { data, error } = await supabase
          .from("feed_sessions")
          .select("*")
          .or(filter)
          .order("saved_at", { ascending: false })
          .limit(500)
          .returns<FeedSessionRow[]>();
        if (error) throw error;
        return (data ?? []).map(rowToApiFeedSession);
      },

      upsert: async (body: {
        id: string;
        deviceId: string;
        userId?: string;
        savedAt: number;
        startedAt?: number | null;
        updatedAt?: number;
        inProgress?: boolean;
        data: Record<string, unknown>;
      }): Promise<ApiFeedSession> => {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
          .from("feed_sessions")
          .upsert({
            id: body.id,
            device_id: body.deviceId,
            user_id: body.userId ?? null,
            saved_at: body.savedAt,
            started_at: body.startedAt ?? null,
            updated_at: body.updatedAt ?? Date.now(),
            in_progress: body.inProgress ?? false,
            data: body.data,
          })
          .select()
          .returns<FeedSessionRow[]>()
          .single();
        if (error) throw error;
        return rowToApiFeedSession(data);
      },

    /** Find an in-progress feed session for this device OR this identity —
     *  used to discover a session another device started. */
    active: async (deviceId?: string, userId?: string): Promise<ApiFeedSession | null> => {
      if (!supabase) return null;
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return null;
      const { data, error } = await supabase
        .from("feed_sessions")
        .select("*")
        .or(filter)
        .eq("in_progress", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .returns<FeedSessionRow[]>()
        .maybeSingle();
      if (error) throw error;
      return data ? rowToApiFeedSession(data) : null;
    },

    /** Fetch a specific session by id, regardless of in_progress status — used
     *  to detect when OUR active session was completed on another device. */
    get: async (id: string): Promise<ApiFeedSession | null> => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("feed_sessions")
        .select("*")
        .eq("id", id)
        .returns<FeedSessionRow[]>()
        .maybeSingle();
      if (error) throw error;
      return data ? rowToApiFeedSession(data) : null;
    },

      delete: async (id: string, deviceId?: string, userId?: string): Promise<boolean> => {
        if (!supabase) return false;
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return false;
        const { error } = await supabase
          .from("feed_sessions")
          .delete()
          .eq("id", id)
          .or(filter);
        if (error) throw error;
        return true;
      },
    },

    bakes: {
      list: async (
        deviceId?: string,
        userId?: string
      ): Promise<ApiBakeSession[]> => {
        if (!supabase) return [];
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return [];
        const { data, error } = await supabase
          .from("bake_sessions")
          .select("*")
          .or(filter)
          .order("saved_at", { ascending: false })
          .limit(200)
          .returns<BakeSessionRow[]>();
        if (error) throw error;
        return (data ?? []).map(rowToApiBakeSession);
      },

      active: async (deviceId?: string): Promise<ApiBakeSession | null> => {
        if (!supabase || !deviceId) return null;
        const { data, error } = await supabase
          .from("bake_sessions")
          .select("*")
          .eq("device_id", deviceId)
          .eq("in_progress", true)
          .order("started_at", { ascending: false })
          .limit(1)
          .returns<BakeSessionRow[]>()
          .maybeSingle();
        if (error) throw error;
        return data ? rowToApiBakeSession(data) : null;
      },

      upsert: async (body: {
        id: string;
        deviceId: string;
        userId?: string;
        recipeId?: string | null;
        recipeName: string;
        yield_value: number;
        savedAt: number;
        startedAt: number;
        phases: ApiBakePhase[];
        inProgress?: boolean;
      }): Promise<ApiBakeSession> => {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
          .from("bake_sessions")
          .upsert({
            id: body.id,
            device_id: body.deviceId,
            user_id: body.userId ?? null,
            recipe_id: body.recipeId ?? null,
            recipe_name: body.recipeName,
            yield_value: body.yield_value,
            saved_at: body.savedAt,
            started_at: body.startedAt,
            phases: body.phases,
            in_progress: body.inProgress ?? true,
          })
          .select()
          .returns<BakeSessionRow[]>()
          .single();
        if (error) throw error;
        return rowToApiBakeSession(data);
      },

      delete: async (id: string, deviceId?: string, userId?: string): Promise<boolean> => {
        if (!supabase) return false;
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return false;
        const { error } = await supabase
          .from("bake_sessions")
          .delete()
          .eq("id", id)
          .or(filter);
        if (error) throw error;
        return true;
      },
    },
  },

  analytics: {
    getStarter: async (deviceId: string): Promise<StarterAnalytics | null> => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("starter_analytics")
        .select("*")
        .eq("device_id", deviceId)
        .returns<StarterAnalyticsRow[]>()
        .maybeSingle();
      if (error) throw error;
      return data ? rowToStarterAnalytics(data) : null;
    },

    /**
     * Update starter_analytics after a new feed session is saved.
     * Scans up to 50 recent rows so we always find 5 qualifying sessions
     * even when many recent sessions have no readings.
     */
    updateStarter: async (
      deviceId: string,
      newSession: SessionForAnalytics
    ): Promise<void> => {
      if (!supabase) return;
      if (sessionPoints(newSession).length < 2) return;

      const [analyticsResult, recentResult] = await Promise.all([
        supabase
          .from("starter_analytics")
          .select("*")
          .eq("device_id", deviceId)
          .returns<StarterAnalyticsRow[]>()
          .maybeSingle(),
        supabase
          .from("feed_sessions")
          .select("id, saved_at, data")
          .eq("device_id", deviceId)
          .order("saved_at", { ascending: false })
          .limit(50)
          .returns<FeedSessionAnalyticsRow[]>(),
      ]);

      const qualifying5 = (recentResult.data ?? [])
        .map(rowToSessionForAnalytics)
        .filter((s) => sessionPoints(s).length >= 2)
        .slice(0, 5);

      const current: StarterAnalytics = analyticsResult.data
        ? rowToStarterAnalytics(analyticsResult.data)
        : {
            deviceId,
            updatedAt: Date.now(),
            vitalitySessions: 0,
            vitalityXMax: 120,
            vitalityPoints: [],
            allTimeSessions: 0,
            allTimeXMax: 120,
            allTimePoints: [],
          };

      const vitality = computeVitalityAnalytics(qualifying5);
      const allTime = updateAllTimeAnalytics(current, newSession);

      const { error } = await supabase.from("starter_analytics").upsert({
        device_id: deviceId,
        updated_at: Date.now(),
        vitality_sessions: vitality.vitalitySessions,
        vitality_x_max: vitality.vitalityXMax,
        vitality_points: vitality.vitalityPoints,
        all_time_sessions: allTime.allTimeSessions,
        all_time_x_max: allTime.allTimeXMax,
        all_time_points: allTime.allTimePoints,
      });
      if (error) throw error;
    },
  },
};
