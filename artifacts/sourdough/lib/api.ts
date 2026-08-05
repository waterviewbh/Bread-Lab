// artifacts/sourdough/lib/api.ts — Supabase-backed data layer.
import { supabase } from "./supabase";
import {
  computeVitalityAnalytics,
  updateAllTimeAnalytics,
  sessionPoints,
} from "./analytics";
import type { SessionForAnalytics, StarterAnalytics } from "./analytics";

/**
 * flattenPhasesForLegacy — Converts rich CheckableLine arrays back into
 * newline-separated strings so older app versions don't crash.
 */
function flattenPhasesForLegacy(phases: any[]): any[] {
  if (!Array.isArray(phases)) return [];

  return phases.map(p => {
    if (!p || typeof p !== 'object') return p;

    const flattenItems = (items: any) => {
      if (!Array.isArray(items)) return items;

      return items
        .map(i => (typeof i === 'object' && i !== null ? i.text : i))
        .filter(Boolean) // Drop undefined, null, or empty strings
        .join('\n');
    };

    return {
      ...p,
      ingredients: flattenItems(p.ingredients),
      instructions: flattenItems(p.instructions),
    };
  });
}

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
  ingredients?: string | any[];
  instructions?: string | any[];
};

export type ApiRecipe = {
  id: string;
  deviceId: string;
  name: string;
  overview?: string;
  phases: ApiRecipePhase[];
  createdAt: string;
  updatedAt: string;
  yield_value: number;
  total_flour_g?: number;
  hydration_pct?: number;
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
  ingredients?: string | any[];
  instructions?: string | any[];
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
  overview?: string | null;
  phases: ApiRecipePhase[];
  created_at: string;
  updated_at: string | null;
  yield_value: number;
  recipe_data?: any;
  total_flour_g?: number;
  hydration_pct?: number;
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

function rowToApiRecipe(r: RecipeRow): ApiRecipe {
  const richPhases = r.recipe_data?.phases;
  return {
    id: r.id,
    deviceId: r.device_id,
    name: r.name,
    overview: r.overview ?? undefined,
    phases: richPhases ?? r.phases ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    yield_value: r.yield_value,
    total_flour_g: r.total_flour_g,
    hydration_pct: r.hydration_pct,
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

function ownerFilter(
  deviceId: string | undefined,
  userId: string | undefined
): string | undefined {
  if (deviceId && userId) return `device_id.eq.${deviceId},user_id.eq.${userId}`;
  if (userId) return `user_id.eq.${userId}`;
  if (deviceId) return `device_id.eq.${deviceId}`;
  return undefined;
}

export const api = {
  auth: {
    getSession: () => supabase?.auth.getSession(),
    identify: async (body: { firstName: string; starterName: string; }): Promise<ApiAuthResponse> => {
      if (!supabase) throw new Error("Supabase not configured");
      const fn = body.firstName.trim();
      const sn = body.starterName.trim();
      const sanitizedFn = fn.toLowerCase().replace(/\s/g, "");
      const sanitizedSn = sn.toLowerCase().replace(/\s/g, "");
      const email = `${sanitizedFn}.${sanitizedSn}@breadlab.user`;
      const password = sanitizedSn.length >= 6 ? sanitizedSn : `${sanitizedSn}breadlab`.slice(0, 10);

      // STITCH: authData as 'any' to bridge the Supabase union type mismatch
      let authData: any;
      let { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      authData = signInData;

      if (signInError && signInError.message.includes("Invalid login credentials")) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email, password, options: { data: { first_name: fn, starter_name: sn } },
        });
        authData = signUpData;
      }

      if (!authData?.user) throw new Error("Authentication failed");
      const { data: userRow } = await supabase.from("users").upsert({ id: authData.user.id, first_name: fn, starter_name: sn }).select().returns<UserRow[]>().single();

      return {
        token: authData.user.id,
        user: { id: authData.user.id, firstName: userRow?.first_name ?? fn, starterName: userRow?.starter_name ?? sn },
      };
    },

    me: async (userId?: string): Promise<{ user: ApiAuthUser }> => {
      if (!supabase || !userId) throw new Error("Not authenticated");
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("users").select("*").eq("id", authUser?.id ?? userId).returns<UserRow[]>().single();
      if (error || !data) throw new Error("User not found");
      return { user: { id: data.id, firstName: data.first_name, starterName: data.starter_name } };
    },

    linkDevice: async (deviceId: string, userId: string): Promise<{ linked: boolean }> => {
      if (!supabase || !deviceId || !userId) return { linked: false };
      await Promise.all([
        supabase.from("feed_sessions").update({ user_id: userId }).eq("device_id", deviceId).or("user_id.is.null,user_id.eq."),
        supabase.from("bake_sessions").update({ user_id: userId }).eq("device_id", deviceId).or("user_id.is.null,user_id.eq."),
        supabase.from("recipes").update({ user_id: userId }).eq("device_id", deviceId).or("user_id.is.null,user_id.eq."),
      ]);
      return { linked: true };
    },
    claimOrphans: async () => ({ claimed: { feed: 0, bakes: 0, recipes: 0 } }),
    signout: async () => ({ signedOut: true }),
  },

  recipes: {
    list: async (deviceId?: string, userId?: string): Promise<ApiRecipe[]> => {
      if (!supabase) return [];
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return [];
      const { data, error } = await supabase.from("recipes").select("*").or(filter).order("created_at", { ascending: false }).returns<RecipeRow[]>();
      if (error) throw error;
      return (data ?? []).map(rowToApiRecipe);
    },

    upsert: async (body: any): Promise<ApiRecipe> => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase.from("recipes").upsert({
        id: body.id, device_id: body.deviceId, user_id: body.userId ?? null, name: body.name,
        overview: body.overview ?? null, yield_value: body.yield_value,
        phases: flattenPhasesForLegacy(body.phases), recipe_data: body,
        updated_at: new Date().toISOString(), total_flour_g: body.total_flour_g, hydration_pct: body.hydration_pct,
      }).select().returns<RecipeRow[]>().single();
      if (error) throw error;
      return rowToApiRecipe(data);
    },

    delete: async (id: string, deviceId?: string, userId?: string): Promise<boolean> => {
      if (!supabase) return false;
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return false;
      const { error } = await supabase.from("recipes").delete().eq("id", id).or(filter);
      if (error) throw error;
      return true;
    },
  },

  history: {
    feed: {
      list: async (deviceId?: string, userId?: string): Promise<ApiFeedSession[]> => {
        if (!supabase) return [];
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return [];
        const { data, error } = await supabase.from("feed_sessions").select("*").or(filter).order("saved_at", { ascending: false }).eq("in_progress", false).limit(500).returns<FeedSessionRow[]>();
        if (error) throw error;
        return (data ?? []).map(rowToApiFeedSession);
      },

      upsert: async (body: any): Promise<ApiFeedSession> => {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase.from("feed_sessions").upsert({
          id: body.id, device_id: body.deviceId, user_id: body.userId ?? null, saved_at: body.savedAt,
          started_at: body.startedAt ?? null, updated_at: body.updatedAt ?? Date.now(),
          in_progress: body.inProgress ?? false, data: body.data,
        }).select().returns<FeedSessionRow[]>().single();
        if (error) throw error;
        return rowToApiFeedSession(data);
      },

      active: async (deviceId?: string, userId?: string) => {
        if (!supabase) return null;
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return null;
        const { data, error } = await supabase.from("feed_sessions").select("*").or(filter).eq("in_progress", true).order("updated_at", { ascending: false }).limit(1).returns<FeedSessionRow[]>().maybeSingle();
        if (error) throw error;
        return data ? rowToApiFeedSession(data) : null;
      },

      get: async (id: string) => {
        if (!supabase) return null;
        const { data, error } = await supabase.from("feed_sessions").select("*").eq("id", id).returns<FeedSessionRow[]>().maybeSingle();
        if (error) throw error;
        return data ? rowToApiFeedSession(data) : null;
      },

      delete: async (id: string, deviceId?: string, userId?: string) => {
        if (!supabase) return false;
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return false;
        const { error } = await supabase.from("feed_sessions").delete().eq("id", id).or(filter);
        return !error;
      },
    },

    bakes: {
      list: async (deviceId?: string, userId?: string): Promise<ApiBakeSession[]> => {
        if (!supabase) return [];
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return [];
        const { data, error } = await supabase.from("bake_sessions").select("*").or(filter).order("saved_at", { ascending: false }).limit(200).returns<BakeSessionRow[]>();
        if (error) throw error;
        return (data ?? []).map(rowToApiBakeSession);
      },

      active: async (deviceId?: string) => {
        if (!supabase || !deviceId) return null;
        const { data, error } = await supabase.from("bake_sessions").select("*").eq("device_id", deviceId).eq("in_progress", true).order("started_at", { ascending: false }).limit(1).returns<BakeSessionRow[]>().maybeSingle();
        if (error) throw error;
        return data ? rowToApiBakeSession(data) : null;
      },

      upsert: async (body: any): Promise<ApiBakeSession> => {
        if (!supabase) throw new Error("Supabase not configured");
        const { data: { session } } = await supabase.auth.getSession();
        if (body.userId && !session) throw new Error("No active Supabase session");
        const { data, error } = await supabase.from("bake_sessions").upsert({
          id: body.id, device_id: body.deviceId, user_id: body.userId ?? null, recipe_id: body.recipeId ?? null,
          recipe_name: body.recipeName, yield_value: body.yield_value, saved_at: body.savedAt,
          started_at: body.startedAt, phases: flattenPhasesForLegacy(body.phases), in_progress: body.inProgress ?? true,
        }).select().returns<BakeSessionRow[]>().single();
        if (error) throw error;
        return rowToApiBakeSession(data);
      },

      delete: async (id: string, deviceId?: string, userId?: string) => {
        if (!supabase) return false;
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return false;
        const { error } = await supabase.from("bake_sessions").delete().eq("id", id).or(filter);
        return !error;
      },
    },
  },

  analytics: {
    getStarter: async (deviceId: string) => {
      if (!supabase) return null;
      const { data, error } = await supabase.from("starter_analytics").select("*").eq("device_id", deviceId).returns<StarterAnalyticsRow[]>().maybeSingle();
      if (error) throw error;
      return data ? rowToStarterAnalytics(data) : null;
    },

    updateStarter: async (deviceId: string, newSession: SessionForAnalytics) => {
      if (!supabase || sessionPoints(newSession).length < 2) return;
      const [analyticsResult, recentResult] = await Promise.all([
        supabase.from("starter_analytics").select("*").eq("device_id", deviceId).returns<StarterAnalyticsRow[]>().maybeSingle(),
        supabase.from("feed_sessions").select("id, saved_at, data").eq("device_id", deviceId).order("saved_at", { ascending: false }).limit(50).returns<FeedSessionAnalyticsRow[]>(),
      ]);
      const qualifying5 = (recentResult.data ?? []).map(rowToSessionForAnalytics).filter((s) => sessionPoints(s).length >= 2).slice(0, 5);
      const current = analyticsResult.data ? rowToStarterAnalytics(analyticsResult.data) : { deviceId, updatedAt: Date.now(), vitalitySessions: 0, vitalityXMax: 120, vitalityPoints: [], allTimeSessions: 0, allTimeXMax: 120, allTimePoints: [] };
      const vitality = computeVitalityAnalytics(qualifying5);
      const allTime = updateAllTimeAnalytics(current, newSession);
      await supabase.from("starter_analytics").upsert({ device_id: deviceId, updated_at: Date.now(), vitality_sessions: vitality.vitalitySessions, vitality_x_max: vitality.vitalityXMax, vitality_points: vitality.vitalityPoints, all_time_sessions: allTime.allTimeSessions, all_time_x_max: allTime.allTimeXMax, all_time_points: allTime.allTimePoints });
    },
  },
};