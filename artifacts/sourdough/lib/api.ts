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
  parent_recipe_id?: string;
  version_label?: string;
  isArchived?: boolean;
  diagnosticHypothesis?: string;
  isUneditedIteration?: boolean;
  clonedFromBakeName?: string;
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
  completedAt?: number | null;
  status?: string | null;
  outcome?: any | null;
  estimatorState?: any;
  bulkCheckInHistory?: any[];
  notes?: string | null;
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
  parent_recipe_id?: string | null;
  version_label?: string | null;
  is_archived: boolean;
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
  completed_at: number | null;
  status: string | null;
  outcome: any | null;
  notes: string | null;
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
    parent_recipe_id: r.parent_recipe_id ?? undefined,
    version_label: r.version_label ?? undefined,
    isArchived: r.is_archived,
    diagnosticHypothesis: r.recipe_data?.diagnosticHypothesis ?? undefined,
    isUneditedIteration: r.recipe_data?.isUneditedIteration ?? undefined,
    clonedFromBakeName: r.recipe_data?.clonedFromBakeName ?? undefined,
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

export function packBakeOutcome(outcome: any, estimatorState: any, bulkCheckInHistory: any): any {
  if (estimatorState !== undefined || bulkCheckInHistory !== undefined) {
    return {
      _bread_lab_wrapped: true,
      outcome: outcome !== undefined ? outcome : null,
      estimatorState,
      bulkCheckInHistory,
    };
  }
  return outcome !== undefined ? outcome : null;
}

export function unpackBakeOutcome(storedOutcome: any): { outcome: any; estimatorState?: any; bulkCheckInHistory?: any[] } {
  if (storedOutcome && typeof storedOutcome === 'object' && !Array.isArray(storedOutcome)) {
    // 1. Explicitly marked new records
    if (storedOutcome._bread_lab_wrapped === true) {
      return {
        outcome: storedOutcome.outcome !== undefined ? storedOutcome.outcome : null,
        estimatorState: storedOutcome.estimatorState,
        bulkCheckInHistory: storedOutcome.bulkCheckInHistory,
      };
    }
    // Trade-off note: Heuristic guessing on unmarked objects is ambiguous because ordinary user outcome
    // objects can legitimately contain properties named `estimatorState` or `bulkCheckInHistory`.
    // To prevent silent data loss and misinterpretation of user data, heuristic fallback is intentionally
    // omitted. Unmarked objects are preserved as ordinary outcomes, relying on the explicit `_bread_lab_wrapped: true`
    // marker for wrapped records.
  }

  // 2. Fallback: Ordinary outcome objects, strings, nulls, etc., are preserved as ordinary outcomes.
  return {
    outcome: storedOutcome !== undefined ? storedOutcome : null,
  };
}

export function rowToApiBakeSession(r: BakeSessionRow): ApiBakeSession {
  const unpacked = unpackBakeOutcome(r.outcome);
  return {
    id: r.id,
    deviceId: r.device_id,
    recipeId: r.recipe_id ?? null,
    recipeName: r.recipe_name,
    savedAt: Number(r.saved_at),
    startedAt: Number(r.started_at),
    phases: (r.phases ?? []).map((p: any) => ({
      ...p,
      bulkFermentState: p.bulkFermentState,
      readings: p.readings ?? [],
      foldCount: p.foldCount,
      foldTimestamps: p.foldTimestamps,
    })),
    inProgress: r.in_progress ?? false,
    createdAt: r.created_at,
    yield_value: r.yield_value,
    completedAt: r.completed_at != null ? Number(r.completed_at) : null,
    status: r.status ?? undefined,
    outcome: unpacked.outcome,
    estimatorState: unpacked.estimatorState,
    bulkCheckInHistory: unpacked.bulkCheckInHistory,
    notes: r.notes ?? undefined,
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

      // Modern Email Derivation (Lower + No Spaces)
      const sanitizedFn = fn.toLowerCase().replace(/\s/g, "");
      const sanitizedSn = sn.toLowerCase().replace(/\s/g, "");
      const email = `${sanitizedFn}.${sanitizedSn}@breadlab.user`;

      const derivePassword = (source: string) => {
        const s = source.replace(/^\s+|\s+$/g, ""); // trim outer only
        return s.length >= 6 ? s : `${s}breadlab`.slice(0, 10);
      };

      // Strategies: [Password Source, Description]
      const strategies = [
        [sanitizedSn, "Modern (lowercase, no spaces)"],
        [sn.toLowerCase(), "Legacy A (lowercase, with spaces)"],
        [sn, "Legacy B (original case, with spaces)"],
      ];

      let authData: any = null;
      let lastError: any = null;

      for (const [source, desc] of strategies) {
        const password = derivePassword(source);
        console.log(`[Auth Debug] Trying strategy: ${desc}...`);

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error && error.message.includes("Email not confirmed")) {
          throw new Error("Email confirmation is required for this account. Please verify your email.");
        }

        if (!error && data?.user) {
          console.log(`[Auth Debug] Success with strategy: ${desc}`);
          authData = data;
          break;
        }

        lastError = error;
        console.log(`[Auth Debug] Strategy ${desc} failed:`, error?.message);
      }

      // If all sign-ins failed, check if we should sign up
      if (!authData?.user) {
        const isInvalidCredentials = lastError && (
          lastError.message.includes("Invalid login credentials") ||
          lastError.message.includes("Invalid grant") ||
          lastError.message.includes("User not found")
        );

        if (isInvalidCredentials) {
          console.log("[Auth Debug] All sign-in strategies failed with invalid credentials. Attempting Sign-up as new user...");
          const password = derivePassword(sanitizedSn);
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email, password, options: { data: { first_name: fn, starter_name: sn } },
          });

          if (signUpError) {
            console.log("[Auth Debug] Sign-up failed:", signUpError.message);
            if (signUpError.message.includes("User already registered")) {
              throw new Error("Account exists but recovery failed. Please check name spellings.");
            }
            throw signUpError;
          }
          authData = signUpData;
        } else {
          throw lastError || new Error("Authentication failed");
        }
      }

      if (!authData?.user) throw new Error("Authentication failed");

      if (!authData?.session) {
        throw new Error("Account created successfully, but authentication session could not be established.");
      }

      const { data: userRow, error: profileError } = await supabase
        .from("users")
        .select("*")
        .eq("id", authData.user.id)
        .returns<UserRow[]>()
        .single();

      if (profileError || !userRow) {
        console.error("[Auth Debug] Profile loading failed:", profileError?.message);
        throw new Error("Profile loading failed: Account authenticated, but profile record could not be loaded.");
      }

      return {
        token: authData.user.id,
        user: { id: authData.user.id, firstName: userRow.first_name, starterName: userRow.starter_name },
      };
    },

    me: async (userId?: string): Promise<{ user: ApiAuthUser }> => {
      if (!supabase || !userId) throw new Error("Not authenticated");
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("users").select("*").eq("id", authUser?.id ?? userId).returns<UserRow[]>().single();
      if (error || !data) throw new Error("User not found");
      return { user: { id: data.id, firstName: data.first_name, starterName: data.starter_name } };
    },

    linkDevice: async (_deviceId: string, _userId: string): Promise<{ linked: boolean }> => {
      // Secure remediation: Unsafe anonymous device claiming removed.
      // Local records are migrated explicitly via migrateLocalDataToAccount.
      return { linked: false };
    },
    claimOrphans: async () => ({ claimed: { feed: 0, bakes: 0, recipes: 0 } }),
    signout: async () => {
      if (!supabase) return { signedOut: true };
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { signedOut: true };
    },
  },

  recipes: {
    list: async (deviceId?: string, userId?: string): Promise<ApiRecipe[]> => {
      if (!supabase || !userId) return [];
      const filter = ownerFilter(deviceId, userId);
      if (!filter) return [];
      const { data, error } = await supabase.from("recipes").select("*").or(filter).order("created_at", { ascending: false }).returns<RecipeRow[]>();
      if (error) throw error;
      return (data ?? []).map(rowToApiRecipe);
    },

    upsert: async (body: any): Promise<ApiRecipe> => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data: { session } } = await supabase.auth.getSession();
      const resolvedUserId = session?.user?.id ?? body.userId ?? null;
      const { data, error } = await supabase.from("recipes").upsert({
        id: body.id, device_id: body.deviceId, user_id: resolvedUserId, name: body.name,
        overview: body.overview ?? null, yield_value: body.yield_value,
        phases: flattenPhasesForLegacy(body.phases), recipe_data: body,
        updated_at: new Date().toISOString(), total_flour_g: body.total_flour_g,
        hydration_pct: body.hydration_pct, parent_recipe_id: body.parentRecipeId ?? null,
        version_label: body.versionLabel ?? null, is_archived: body.isArchived ?? false,
      }).select().returns<RecipeRow[]>().single();
      if (error) throw error;
      return rowToApiRecipe(data);
    },

    duplicate: async (id: string, newName: string, deviceId: string, userId?: string, makeIndependent?: boolean): Promise<ApiRecipe> => {
      if (!supabase) throw new Error("Supabase not configured");

      const { data: source, error: fetchError } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError || !source) {
        throw fetchError || new Error("Source recipe not found");
      }

      const newId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
      const now = new Date().toISOString();

      const parentRecipeId = makeIndependent ? null : id;
      const versionLabel = makeIndependent ? "Master" : "Copy";

      let recipeData = source.recipe_data;
      if (recipeData && typeof recipeData === 'object') {
        recipeData = {
          ...recipeData,
          id: newId,
          name: newName,
          parentRecipeId: parentRecipeId ?? undefined,
          versionLabel: versionLabel,
        };
      }

      const newRow = {
        id: newId,
        device_id: deviceId,
        user_id: source.user_id ?? userId ?? null,
        name: newName,
        overview: source.overview,
        phases: source.phases,
        recipe_data: recipeData,
        yield_value: source.yield_value,
        total_flour_g: source.total_flour_g,
        hydration_pct: source.hydration_pct,
        parent_recipe_id: parentRecipeId,
        version_label: versionLabel,
        created_at: now,
        updated_at: now,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("recipes")
        .insert(newRow)
        .select()
        .returns<RecipeRow[]>()
        .single();

      if (insertError) throw insertError;
      return rowToApiRecipe(inserted);
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
        if (!supabase || !userId) return [];
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
        if (!supabase || !userId) return null;
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
        if (!supabase || !userId) return [];
        const filter = ownerFilter(deviceId, userId);
        if (!filter) return [];
        const { data, error } = await supabase.from("bake_sessions").select("*").or(filter).order("saved_at", { ascending: false }).limit(200).returns<BakeSessionRow[]>();
        if (error) throw error;
        return (data ?? []).map(rowToApiBakeSession);
      },

      active: async (deviceId?: string, userId?: string) => {
        if (!supabase || !deviceId || !userId) return null;
        const { data, error } = await supabase.from("bake_sessions").select("*").eq("device_id", deviceId).eq("user_id", userId).eq("in_progress", true).order("started_at", { ascending: false }).limit(1).returns<BakeSessionRow[]>().maybeSingle();
        if (error) throw error;
        return data ? rowToApiBakeSession(data) : null;
      },

      upsert: async (body: any): Promise<ApiBakeSession> => {
        if (!supabase) throw new Error("Supabase not configured");
        const { data: { session } } = await supabase.auth.getSession();
        if (body.userId && !session) throw new Error("No active Supabase session");

        const storedOutcome = packBakeOutcome(body.outcome, body.estimatorState, body.bulkCheckInHistory);

        const { data, error } = await supabase.from("bake_sessions").upsert({
          id: body.id, device_id: body.deviceId, user_id: body.userId ?? null, recipe_id: body.recipeId ?? null,
          recipe_name: body.recipeName, yield_value: body.yield_value, saved_at: body.savedAt,
          started_at: body.startedAt, completed_at: body.completedAt ?? null, status: body.status ?? null,
          outcome: storedOutcome, notes: body.notes ?? null,
          phases: flattenPhasesForLegacy(body.phases), in_progress: body.inProgress ?? true,
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