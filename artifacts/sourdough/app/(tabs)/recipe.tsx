// ───This is the Recipe tab in the app.────────────────────────────── 
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import AuthModal from "@/components/AuthModal";
import NudgeBanner from "@/components/NudgeBanner";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { YieldPill } from "@/components/YieldPill";
import {
  Alert,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";
import SegmentedNotepad from "@/components/SegmentedNotepad";
import { CopilotStep, walkthroughable } from "react-native-copilot";

const CopilotView = walkthroughable(View);

// ─── Storage keys ─────────────────────────────────────────────────────────────

const RECIPES_KEY = "bread_lab_recipes_v1";
const BAKE_KEY = "bread_lab_bake_v2";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const NUDGE_KEY = "bread_lab_name_nudge_shown_v1";
const DELETED_RECIPE_IDS_KEY = "bread_lab_deleted_recipe_ids_v1";

// ─── Tombstone helpers ────────────────────────────────────────────────────────

async function addToRecipeTombstone(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  const set: string[] = raw ? JSON.parse(raw) : [];
  if (!set.includes(id)) {
    set.push(id);
    await AsyncStorage.setItem(DELETED_RECIPE_IDS_KEY, JSON.stringify(set));
  }
}
async function removeFromRecipeTombstone(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  if (!raw) return;
  await AsyncStorage.setItem(
    DELETED_RECIPE_IDS_KEY,
    JSON.stringify((JSON.parse(raw) as string[]).filter((x) => x !== id))
  );
}
async function getRecipeTombstone(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DELETED_RECIPE_IDS_KEY).catch(() => null);
  return raw ? JSON.parse(raw) : [];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reading {
  id: string;
  temp: string;
  tempUnit: "F" | "C";
  pH: string;
  note: string;
  volume: string;
  loggedAt: number;
}

interface RecipePhaseConfig {
  key: string;
  name: string;
  ingredients: string;
  instructions: string;
}

interface SavedRecipe {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  phases: RecipePhaseConfig[];
  yieldValue?: string;
}

interface BakePhase extends RecipePhaseConfig {
  startedAt: number | null;
  completedAt: number | null;
  readings: Reading[];
  startVolume?: string;
  foldCount?: number;
}

interface ActiveBake {
  id: string;
  recipeId: string;
  recipeName: string;
  startedAt: number;
  phases: BakePhase[];
  notes?: string;
  yieldValue?: string;
}

// ─── Phase catalogue (hierarchical) ──────────────────────────────────────────

const PHASE_CATEGORIES: {
  key: string;
  name: string;
  phases: { key: string; name: string; hint: string }[];
}[] = [
  {
    key: "pre_processing",
    name: "Pre-Processing",
    phases: [
      { key: "building_levain", name: "Building the Levain", hint: "Build your levain/starter culture before mixing" },
      { key: "scalding", name: "Scalding", hint: "Scald flour or grains with boiling water" },
      { key: "toasting_flour", name: "Dry Toasting", hint: "Dry toast nuts, seeds, or flour for deeper flavor" },
      { key: "soaking_seeds", name: "Soaking Seeds/Grains", hint: "Pre-soak seeds or whole grains to soften them" },
    ],
  },
  {
    key: "mixing",
    name: "Mixing",
    phases: [
      { key: "autolysing", name: "Autolysing", hint: "Flour and water rest before salt/levain are added" },
      { key: "fermentolysing", name: "Fermentolysing", hint: "Autolyse with levain included for extra activity" },
      { key: "incorporating", name: "Incorporating", hint: "Combine all dough components into a cohesive mass" },
      { key: "delaying_salt", name: "Delayed Salt", hint: "Add salt separately after initial mixing" },
      { key: "bassinage", name: "Bassinage", hint: "Gradually add reserved water to tighten the dough" },
      { key: "adding_inclusions", name: "Adding Inclusions", hint: "Fold in seeds, nuts, cheese, or other mix-ins" },
    ],
  },
  {
    key: "fermentation",
    name: "Fermentation",
    phases: [
      { key: "stretching_folding", name: "Stretching and Folding", hint: "Develop gluten strength during bulk fermentation" },
      { key: "kneading", name: "Kneading", hint: "Working the dough on a bench or in a machine to build strength" },
      { key: "laminating", name: "Laminating", hint: "Open dough flat and fold to incorporate inclusions" },
      { key: "bulk_fermenting", name: "Bulk Fermenting", hint: "Main fermentation period at room temperature" },
    ],
  },
  {
    key: "shaping",
    name: "Shaping",
    phases: [
      { key: "preshaping", name: "Preshaping", hint: "Initial rough shaping to build tension" },
      { key: "bench_resting", name: "Bench Resting", hint: "Rest on the bench between preshape and final shape" },
      { key: "final_shaping", name: "Final Shaping", hint: "Tight final shaping before proof" },
      { key: "stitching", name: "Stitching", hint: "Tighten the seam side to add more tension" },
    ],
  },
  {
    key: "proofing",
    name: "Proofing",
    phases: [
      { key: "cold_retarding", name: "Cold Retarding", hint: "Long cold proof in the refrigerator overnight" },
      { key: "ambient_proofing", name: "Proofing", hint: "Room-temperature final proof" },
    ],
  },
  {
    key: "baking",
    name: "Baking",
    phases: [
      { key: "scoring", name: "Scoring", hint: "Score the surface for controlled oven spring" },
      { key: "the_bake", name: "Baking", hint: "Into the oven — steam phase then open bake" },
    ],
  },
];

const PHASE_DEFINITIONS = PHASE_CATEGORIES.flatMap((c) => c.phases);

const VOLUME_TRACKING_PHASE_KEYS = new Set([
  "building_levain",
  "bulk_fermenting",
  "cold_retarding",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scalePhaseText(text: string, multiplier: number): string {
  if (multiplier === 1 || !text) return text;
  const MASS_VOLUME_RE = /\b(\d+(?:\.\d+)?)(?:(\s+)?)(g|kg|ml|l|oz|lbs)\b/gi;
  return text.replace(
    MASS_VOLUME_RE,
    (_match, numStr: string, space: string | undefined, unit: string) => {
      const original = parseFloat(numStr);
      const scaled = original * multiplier;
      let formatted: string;
      if (scaled < 1) {
        formatted = "<1";
      } else if (scaled % 1 === 0) {
        formatted = scaled.toString();
      } else if (scaled > 100) {
        formatted = Math.ceil(scaled).toString();
      } else {
        formatted = `${Math.floor(scaled)}-${Math.ceil(scaled)}`;
      }
      return `${formatted}${space ?? ""}${unit}`;
    }
  );
}

function formatScaledYield(yieldStr: string | undefined, multiplier: number): string {
  if (!yieldStr || yieldStr.trim() === "" || yieldStr === "0") return "unk";
  const base = parseFloat(yieldStr);
  const scaled = base * multiplier;
  if (scaled < 1) return "<1";
  if (scaled % 1 === 0) return scaled.toString();
  if (scaled > 100) return Math.ceil(scaled).toString();
  return `${Math.floor(scaled)}-${Math.ceil(scaled)}`;
}

function formatTimer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDone(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m === 0) return "< 1m";
  return `${m}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── UI Components ────────────────────────────────────────────────────────────

function SegmentBar({ phases }: { phases: BakePhase[] }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {phases.map((p) => {
        const done = !!p.completedAt;
        const active = !!p.startedAt && !p.completedAt;
        return (
          <View
            key={p.key}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              backgroundColor: done ? colors.primary : active ? colors.accent : colors.border,
            }}
          />
        );
      })}
    </View>
  );
}

function ReadingRow({
  reading,
  colors,
  onDelete,
}: {
  reading: Reading;
  colors: ReturnType<typeof useColors>;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasNote = !!reading.note;
  return (
    <Pressable
      style={s.readingRow}
      onPress={hasNote ? () => setExpanded((v) => !v) : undefined}
      accessibilityRole={hasNote ? "button" : undefined}
    >
      <Text
        style={[
          s.readingTime,
          { color: hasNote ? colors.primary : colors.mutedForeground },
        ]}
      >
        {formatTime(reading.loggedAt)}
      </Text>
      <View style={[s.readingPills, { flex: 1 }]}>
        {!!reading.temp && (
          <View style={[s.pill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="thermometer" size={10} color={colors.mutedForeground} />
            <Text style={[s.pillText, { color: colors.foreground }]}>
              {reading.temp}°{reading.tempUnit}
            </Text>
          </View>
        )}
        {!!reading.pH && (
          <View style={[s.pill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[s.pillText, { color: colors.foreground }]}>pH {reading.pH}</Text>
          </View>
        )}
        {hasNote && (
          <Text
            style={[s.readingNote, { color: colors.mutedForeground }]}
            numberOfLines={expanded ? undefined : 1}
          >
            {reading.note}
          </Text>
        )}
      </View>
      {onDelete && (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
          hitSlop={8}
          style={{ padding: 4, marginLeft: 4 }}
          accessibilityLabel="Delete reading"
          accessibilityRole="button"
        >
          <Feather name="trash-2" size={13} color={colors.mutedForeground} />
        </Pressable>
      )}
    </Pressable>
  );
}

function PhaseHighlight({
  children,
  active,
  accentColor,
}: {
  children: React.ReactNode;
  active: boolean;
  accentColor: string;
}) {
  const glow = useSharedValue(0);
  useEffect(() => {
    if (active) {
      glow.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0, { duration: 750 })
      );
    }
  }, [active]);
  const animStyle = useAnimatedStyle(() => ({
    borderRadius: 12,
    shadowColor: accentColor,
    shadowOpacity: glow.value * 0.45,
    shadowRadius: glow.value * 14,
    elevation: Math.round(glow.value * 7),
  }));
  return <Animated.View style={animStyle}>{children}</Animated.View>;
}

// ─── Keycap Component ─────────────────────────────────────────────────────────

const KEY_W = 30;
const ALL_W = 42;
const FACE_H = 25;
const LEDGE_H = 2;
const KEY_H = FACE_H + LEDGE_H;
const FLARE = 3;

function keycapPoints(w: number) {
  const face = `${FLARE},0 ${w - FLARE},0 ${w},${FACE_H} 0,${FACE_H}`;
  const ledge = `0,${FACE_H} ${w},${FACE_H} ${w},${KEY_H} 0,${KEY_H}`;
  return { face, ledge };
}

function KeycapKey({
  label,
  active,
  onPress,
  faceFill,
  ledgeFill,
  stroke,
  textColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  faceFill: string;
  ledgeFill: string;
  stroke: string;
  textColor: string;
}) {
  const w = label === "All" ? ALL_W : KEY_W;
  const { face, ledge } = keycapPoints(w);
  return (
    <Pressable onPress={onPress} style={{ width: w, height: KEY_H, marginRight: -5, zIndex: active ? 1 : 0 }}>
      <Svg width={w} height={KEY_H}>
        <Polygon points={face} fill={faceFill} stroke={stroke} strokeWidth={0.5} />
        <Polygon points={ledge} fill={ledgeFill} stroke={stroke} strokeWidth={0.5} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", paddingBottom: LEDGE_H }]}>
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: textColor }}>{label}</Text>
      </View>
    </Pressable>
  );
}

// ─── Main RecipeScreen ────────────────────────────────────────────────────────

export default function RecipeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  const [section, setSection] = useState<"builder" | "runner">("builder");
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [bake, setBake] = useState<ActiveBake | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const runnerScrollRef = useRef<ScrollView | null>(null);
  const phaseCardYOffsets = useRef<Record<string, number>>({});
  const phasesContainerY = useRef(0);

  const [editingRecipe, setEditingRecipe] = useState<SavedRecipe | null>(null);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  const [pickerSelections, setPickerSelections] = useState<Record<string, boolean>>({});
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  const [selectedRecipe, setSelectedRecipe] = useState<SavedRecipe | null>(null);
  const [runPhaseEnabled, setRunPhaseEnabled] = useState<Record<string, boolean>>({});
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [scaleMultiplier, setScaleMultiplier] = useState(1);
  const [copiedIngredientsKey, setCopiedIngredientsKey] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());
  const [expandedRecipeInfo, setExpandedRecipeInfo] = useState<Set<string>>(new Set());
  const [expandedPending, setExpandedPending] = useState<Set<string>>(new Set());

  const [recentlyCompletedKey, setRecentlyCompletedKey] = useState<string | null>(null);
  const [nextHighlightKey, setNextHighlightKey] = useState<string | null>(null);

  const [showReadingModal, setShowReadingModal] = useState(false);
  const [readingPhaseKey, setReadingPhaseKey] = useState<string | null>(null);
  const [readTemp, setReadTemp] = useState("");
  const [readTempUnit, setReadTempUnit] = useState<"F" | "C">("F");
  const [readPH, setReadPH] = useState("");
  const [readNote, setReadNote] = useState("");
  const [readVolume, setReadVolume] = useState("");
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});
  const [bakeNotes, setBakeNotes] = useState("");
  const [showNotesOverlay, setShowNotesOverlay] = useState(false);
  const [overlayDraft, setOverlayDraft] = useState("");

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const toggleFold = async (phaseKey: string, index: number) => {
    if (!bake) return;
    const phases = bake.phases.map(p => {
      if (p.key === phaseKey) {
        // If tapping the current count, decrement; if tapping higher, set to that
        const current = p.foldCount || 0;
        const newCount = index + 1 === current ? index : index + 1;
        return { ...p, foldCount: newCount };
      }
      return p;
    });
    Haptics.selectionAsync();
    await persistBake({ ...bake, phases });
  }

  useEffect(() => {
    loadAll();
    getStoredUser().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current !== "active" && nextState === "active") loadAll();
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!bake) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const upd: Record<string, number> = {};
      bake.phases.forEach((p) => { if (p.startedAt && !p.completedAt) upd[p.key] = now - p.startedAt; });
      setElapsed(upd);
    }, 1000);
    return () => clearInterval(interval);
  }, [bake]);

  useEffect(() => {
    if (bake) {
      const vols: Record<string, string> = {};
      bake.phases.forEach((p) => { vols[p.key] = p.startVolume ?? ""; });
      setPhaseStartVolumes(vols);
    }
    setBakeNotes(bake?.notes ?? "");
  }, [bake?.id]);

  const loadAll = async () => {
    let localBakeFound = false;
    try {
      const [recipeStr, bakeStr] = await Promise.all([
        AsyncStorage.getItem(RECIPES_KEY),
        AsyncStorage.getItem(BAKE_KEY),
      ]);
      if (recipeStr) setRecipes(JSON.parse(recipeStr));
      if (bakeStr) { setBake(JSON.parse(bakeStr)); localBakeFound = true; }
    } catch {}
    try {
      const deviceId = await getDeviceId();
      const token = await getStoredToken().catch(() => null);
      const [apiRecipes, activeBake, deletedRecipeIds] = await Promise.all([
        api.recipes.list(deviceId, token ?? undefined),
        localBakeFound ? Promise.resolve(null) : api.history.bakes.active(deviceId),
        getRecipeTombstone(),
      ]);
      const mapped: SavedRecipe[] = apiRecipes.filter(r => !deletedRecipeIds.includes(r.id)).map(r => ({
        id: r.id, name: r.name, createdAt: new Date(r.createdAt).getTime(),
        phases: r.phases.map(p => ({ key: p.key, name: p.name, ingredients: p.ingredients ?? "", instructions: p.instructions ?? "" })),
        yieldValue: (r.yield_value && r.yield_value > 0) ? r.yield_value.toString() : "",
      }));
      if (token || apiRecipes.length > 0) {
        setRecipes(mapped);
        await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(mapped));
      }
      if (!localBakeFound && activeBake) {
        const restored: ActiveBake = {
          id: activeBake.id, recipeId: activeBake.recipeId ?? "", recipeName: activeBake.recipeName,
          startedAt: activeBake.startedAt,
          phases: activeBake.phases.map(p => ({
            key: p.key, name: p.name, ingredients: p.ingredients ?? "", instructions: p.instructions ?? "",
            startedAt: p.startedAt ?? null, completedAt: p.completedAt ?? null, readings: p.readings ?? [], startVolume: p.startVolume,
          })),
          yieldValue: (activeBake.yield_value && activeBake.yield_value > 0) ? activeBake.yield_value.toString() : "",
        };
        setBake(restored);
        await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(restored));
      }
    } catch {}
  };

  const persistRecipes = async (updated: SavedRecipe[]) => {
    setRecipes(updated);
    await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(updated));
  };

  const persistBake = async (updated: ActiveBake) => {
    setBake(updated);
    await AsyncStorage.setItem(BAKE_KEY, JSON.stringify(updated));
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.history.bakes.upsert({
          id: updated.id, deviceId, userId: userId ?? undefined, recipeId: updated.recipeId,
          recipeName: updated.recipeName, yield_value: updated.yieldValue ? parseInt(updated.yieldValue, 10) : 0,
          savedAt: Date.now(), startedAt: updated.startedAt,
          phases: updated.phases.map(p => ({ key: p.key, name: p.name, ingredients: p.ingredients, instructions: p.instructions, startedAt: p.startedAt, completedAt: p.completedAt, readings: p.readings, startVolume: p.startVolume })),
          inProgress: true,
        })
      ).catch(() => {});
  };

  const saveBakeToHistory = async (b: ActiveBake) => {
    const savedAt = Date.now();
    const phases = b.phases.map(p => ({ key: p.key, name: p.name, ingredients: p.ingredients, instructions: p.instructions, startedAt: p.startedAt, completedAt: p.completedAt, readings: p.readings, startVolume: p.startVolume }));
    try {
      const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
      const existing = stored ? JSON.parse(stored) : [];
      existing.unshift({ id: b.id, recipeId: b.recipeId, recipeName: b.recipeName, savedAt, startedAt: b.startedAt, notes: b.notes, phases });
      await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(existing.slice(0, 200)));
    } catch {}
    reportSyncStart();
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.history.bakes.upsert({
          id: b.id, deviceId, userId: userId ?? undefined, recipeId: b.recipeId, recipeName: b.recipeName,
          yield_value: b.yieldValue ? parseInt(b.yieldValue, 10) : 0, savedAt, startedAt: b.startedAt, phases, inProgress: false,
        })
      ).then(() => reportSyncSuccess()).catch(() => reportSyncFailure());
  };

  const refresh = async () => { setRefreshing(true); await loadAll(); setRefreshing(false); };

  // ── Builder Handlers ──
  const openNewRecipe = () => {
    setEditingRecipe({
      id: Date.now().toString(),
      name: "",
      createdAt: Date.now(),
      phases: [],
    });
    setIsNewRecipe(true);
  };

  const openEditRecipe = (r: SavedRecipe) => {
    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));
    const sorted = [...r.phases].sort(
      (a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999)
    );
    setEditingRecipe({ ...r, phases: sorted });
    setIsNewRecipe(false);
  };

  const cancelEdit = () => {
    setEditingRecipe(null);
    setIsNewRecipe(false);
  };

  const updateEditName = (name: string) =>
    setEditingRecipe(prev => (prev ? { ...prev, name } : null));

  const togglePickerPhase = (key: string) => {
    setPickerSelections(prev => ({ ...prev, [key]: !prev[key] }));
    Haptics.selectionAsync();
  };

  const confirmPhaseSelections = () => {
    const keysToAdd = PHASE_DEFINITIONS
      .filter(def => pickerSelections[def.key])
      .map(def => def.key);

    if (!keysToAdd.length) {
      setShowPhasePicker(false);
      return;
    }

    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));

    setEditingRecipe(prev => {
      if (!prev) return null;

      const existingKeys = new Set(prev.phases.map(p => p.key));
      const newPhases = keysToAdd
        .filter(k => !existingKeys.has(k))
        .map(k => ({
          key: k,
          name: PHASE_DEFINITIONS.find(x => x.key === k)!.name,
          ingredients: "",
          instructions: "",
        }));

      const sorted = [...prev.phases, ...newPhases].sort(
        (a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999)
      );

      return { ...prev, phases: sorted };
    });

    setPickerSelections({});
    setShowPhasePicker(false);
  };

  const removePhaseFromEdit = (key: string) =>
    setEditingRecipe(prev =>
      prev ? { ...prev, phases: prev.phases.filter(p => p.key !== key) } : null
    );

  const updatePhaseField = (
    key: string,
    field: "ingredients" | "instructions",
    val: string
  ) =>
    setEditingRecipe(prev =>
      prev
        ? {
            ...prev,
            phases: prev.phases.map(p => (p.key === key ? { ...p, [field]: val } : p)),
          }
        : null
    );

  const saveRecipe = async () => {
    if (!editingRecipe) return;

    if (!editingRecipe.name.trim()) {
      Alert.alert("Name required");
      return;
    }

    const saved = {
      ...editingRecipe,
      name: editingRecipe.name.trim(),
      updatedAt: isNewRecipe ? undefined : Date.now(),
    };

    const updated = isNewRecipe
      ? [saved, ...recipes]
      : recipes.map(r => (r.id === saved.id ? saved : r));

    await persistRecipes(updated);
    setEditingRecipe(null);
    reportSyncStart();

    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.recipes.upsert({
          id: saved.id,
          deviceId,
          userId: userId ?? undefined,
          name: saved.name,
          yield_value: parseInt(saved.yieldValue || "0", 10),
          phases: saved.phases,
        })
      )
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  const deleteRecipe = (id: string) => {
    const doDelete = async () => {
      const updated = recipes.filter(r => r.id !== id);
      await persistRecipes(updated);
      await addToRecipeTombstone(id);
      setEditingRecipe(null);

      const [did, t] = await Promise.all([
        getDeviceId(),
        getStoredToken().catch(() => null),
      ]);

      api.recipes
        .delete(id, did, t ?? undefined)
        .then(d => {
          if (d) removeFromRecipeTombstone(id);
        });
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Recipe?", "Cannot be undone.", [
        { text: "Cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const printRecipe = async (r: SavedRecipe) => {
    const html = `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica', sans-serif; padding: 40px; color: #333; }
            h1 { color: #C4704F; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            .yield { font-style: italic; color: #666; margin-bottom: 20px; }
            .phase { margin-bottom: 30px; }
            .phase-name { font-weight: bold; font-size: 1.2em; text-transform: uppercase; color: #444; }
            .ingredients { background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 10px 0; }
            .instructions { line-height: 1.6; }
          </style>
        </head>
        <body>
          <h1>${r.name}</h1>
          ${r.yieldValue ? `<p class="yield">Yields: ${r.yieldValue}</p>` : ''}
          ${r.phases.map(p => `
            <div class="phase">
              <div class="phase-name">${p.name}</div>
              ${p.ingredients ? `<div class="ingredients"><strong>Ingredients:</strong><br/>${p.ingredients.replace(/\n/g, '<br/>')}</div>` : ''}
              <div class="instructions">${p.instructions.replace(/\n/g, '<br/>')}</div>
            </div>
          `).join('')}
        </body>
      </html>
    `;
    await Print.printAsync({ html });
  };
  const shareAsPdf = async (r: SavedRecipe) => {
    const html = `<html><body><h1>${r.name}</h1></body></html>`;
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri);
  };

  // ── Runner Handlers ──
  const selectRecipeForRun = (r: SavedRecipe) => { setSelectedRecipe(r); setRunPhaseEnabled(r.phases.reduce((a, b) => ({ ...a, [b.key]: true }), {})); setShowRecipePicker(false); };
  const toggleRunPhase = (key: string) => { setRunPhaseEnabled(prev => ({ ...prev, [key]: !prev[key] })); Haptics.selectionAsync(); };
  const startBake = async () => {
    if (!selectedRecipe) return;
    const phases = selectedRecipe.phases.filter(p => runPhaseEnabled[p.key]).map(p => ({ ...p, startedAt: null, completedAt: null, readings: [] }));
    const newBake = { id: Date.now().toString(), recipeId: selectedRecipe.id, recipeName: selectedRecipe.name, startedAt: Date.now(), phases, yieldValue: selectedRecipe.yieldValue || "1" };
    await persistBake(newBake); setSelectedRecipe(null); setSection("runner");
  };
  const resetBake = () => {
    const doReset = async () => { if (bake) await saveBakeToHistory(bake); await AsyncStorage.removeItem(BAKE_KEY); setBake(null); };
    if (Platform.OS === 'web') { if (window.confirm("New Bake?")) doReset(); }
    else { Alert.alert("New Bake?", "Clears logged phases.", [{ text: "Cancel" }, { text: "Reset", style: "destructive", onPress: doReset }]); }
  };
  const startPhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map(p => p.key === key ? { ...p, startedAt: Date.now() } : (p.startedAt && !p.completedAt ? { ...p, completedAt: Date.now() } : p));
    await persistBake({ ...bake, phases }); setExpandedRecipeInfo(prev => new Set([...prev, key]));
  };
  const completePhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map(p => p.key === key ? { ...p, completedAt: Date.now() } : p);
    setRecentlyCompletedKey(key); setTimeout(() => setRecentlyCompletedKey(null), 800);
    await persistBake({ ...bake, phases }); setExpandedRecipeInfo(prev => { const n = new Set(prev); n.delete(key); return n; });
  };
  const openReadingModal = (key: string) => { setReadingPhaseKey(key); setReadTemp(""); setReadPH(""); setReadNote(""); setReadVolume(""); setShowReadingModal(true); };
  const saveReading = async () => {
    if (!bake || !readingPhaseKey) return;
    const reading = { id: Date.now().toString(), temp: readTemp, tempUnit: readTempUnit, pH: readPH, note: readNote, volume: readVolume, loggedAt: Date.now() };
    const phases = bake.phases.map(p => p.key === readingPhaseKey ? { ...p, readings: [...p.readings, reading] } : p);
    await persistBake({ ...bake, phases }); setShowReadingModal(false);
  };
  const deleteReading = (pk: string, rid: string) => {
    if (!bake) return;
    const phases = bake.phases.map(p => p.key === pk ? { ...p, readings: p.readings.filter(r => r.id !== rid) } : p);
    persistBake({ ...bake, phases });
  };

  const openNotesOverlay = () => { setOverlayDraft(bakeNotes); setShowNotesOverlay(true); };
  const saveNotesOverlay = async () => { setBakeNotes(overlayDraft); if (bake) await persistBake({ ...bake, notes: overlayDraft }); setShowNotesOverlay(false); };

  const printBake = async () => { if (bake) await Print.printAsync({ html: "<h1>Bake</h1>" }); };
  const shareBakePdf = async () => { if (bake) { const { uri } = await Print.printToFileAsync({ html: "<h1>Bake</h1>" }); await Sharing.shareAsync(uri); } };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Section Toggle */}
      <View style={[s.sectionToggleWrap, { paddingTop: insets.top + webTop + 16, paddingHorizontal: 20, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={[s.sectionToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <CopilotStep text="The Recipe Builder is your digital cookbook." order={13} name="recipe-builder-toggle">
            <CopilotView style={[s.sectionBtn, section === "builder" && { backgroundColor: colors.card }]}>
              <Pressable onPress={() => setSection("builder")} style={{ width: '100%', alignItems: 'center' }}><Text style={[s.sectionBtnText, { color: section === "builder" ? colors.foreground : colors.mutedForeground }]}>Recipe Builder</Text></Pressable>
            </CopilotView>
          </CopilotStep>
          <CopilotStep text="The Recipe Runner guides you through every phase of your bake." order={14} name="recipe-runner-toggle">
            <CopilotView style={[s.sectionBtn, section === "runner" && { backgroundColor: colors.card }]}>
              <Pressable onPress={() => setSection("runner")} style={{ width: '100%', alignItems: 'center' }}><Text style={[s.sectionBtnText, { color: section === "runner" ? colors.foreground : colors.mutedForeground }]}>Recipe Runner</Text></Pressable>
            </CopilotView>
          </CopilotStep>
        </View>
      </View>

      {section === "builder" && !editingRecipe && (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 40,
            paddingHorizontal: 20
          }}
        >
          {/* Header Section */}
          <View style={s.listHeader}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Recipes</Text>

            <CopilotStep text="New" order={2} name="recipe-builder-button">
              <CopilotView>
                <Pressable onPress={openNewRecipe} style={[s.addBtn, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryForeground }}>New Recipe</Text>
                </Pressable>
              </CopilotView>
            </CopilotStep>
          </View>

          {/* Recipes List / Empty State */}
          {recipes.length === 0 ? (
            <View style={s.emptyCard}>
              <Text>No recipes yet</Text>
            </View>
          ) : (
            recipes.map(r => (
              <Pressable
                key={r.id}
                onPress={() => openEditRecipe(r)}
                style={[
                  s.recipeCard,
                  { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 8 }
                ]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                  {r.name}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {section === "builder" && editingRecipe && (
        <>
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 60,
            paddingHorizontal: 20
          }}
          keyboardShouldPersistTaps="handled" // Allows saving while keyboard is up
          automaticallyAdjustKeyboardInsets={true} // Modern way to handle keyboard pushing
        >
          {/* Header */}
          <View style={s.editHeader}>
            <Pressable onPress={cancelEdit}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>

            <Text style={[s.editTitle, { color: colors.foreground }]}>
              {isNewRecipe ? "New Recipe" : "Edit"}
            </Text>

            <Pressable onPress={saveRecipe}>
              <Text style={{ color: colors.accent }}>Save</Text>
            </Pressable>
          </View>

          {/* Inputs & Custom Components */}
          <TextInput
            style={[s.nameInput, { borderColor: colors.border, color: colors.foreground }]}
            value={editingRecipe.name}
            onChangeText={t => setEditingRecipe({ ...editingRecipe, name: t })}
            placeholder="Recipe Name"
          />

          <YieldPill
            isBuilder={true}
            value={editingRecipe.yieldValue || ""}
            onChangeValue={t => setEditingRecipe({ ...editingRecipe, yieldValue: t })}
          />

          {/* Phase List Mapping */}
          {editingRecipe.phases.map(p => (
            <View
              key={p.key}
              style={[
                s.editPhaseCard,
                { borderColor: colors.border, backgroundColor: colors.card, marginTop: 12 }
              ]}
            >
              <View style={s.editPhaseHeader}>
                <Text style={{ color: colors.foreground }}>{p.name}</Text>
                <Pressable onPress={() => removePhaseFromEdit(p.key)}>
                  <Feather name="x" size={16} />
                </Pressable>
              </View>

              <TextInput
                multiline
                style={[
                  s.phaseTextarea,
                  {
                    borderColor: colors.border,
                    color: colors.foreground,
                    backgroundColor: colors.background // Slight contrast from colors.card
                  }
                ]}
                value={p.ingredients}
                onChangeText={t => updatePhaseField(p.key, "ingredients", t)}
                placeholder="Ingredients"
                placeholderTextColor={colors.mutedForeground}
                scrollEnabled={true} // Ensures scrolling works once maxHeight is hit
              />

              <TextInput
                multiline
                style={[
                  s.phaseTextarea,
                  {
                    borderColor: colors.border,
                    color: colors.foreground,
                    backgroundColor: colors.background
                  }
                ]}
                value={p.instructions}
                onChangeText={t => updatePhaseField(p.key, "instructions", t)}
                placeholder="Instructions"
                placeholderTextColor={colors.mutedForeground}
                scrollEnabled={true}
              />
            </View>
          ))}

          {/* Actions */}
          <Pressable onPress={() => setShowPhasePicker(true)} style={s.addPhaseBtn}>
            <Text style={{ color: colors.accent }}>Add Phase</Text>
          </Pressable>

          {!isNewRecipe && (
            <Pressable onPress={() => deleteRecipe(editingRecipe.id)} style={{ marginTop: 20 }}>
              <Text style={{ color: "red", textAlign: "center" }}>Delete Recipe</Text>
            </Pressable>
          )}
        </ScrollView>

        <Pressable
          onPress={saveRecipe}
          style={[
            s.fab,
            {
              bottom: insets.bottom + tabBarPad + 16,
              backgroundColor: colors.primary
            }
          ]}
        >
          <Feather name="save" size={24} color={colors.primaryForeground} />
        </Pressable>
        </>
      )}

      {section === "runner" && !bake && !selectedRecipe && (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={[s.sectionTitle, { color: colors.foreground }]}>Recipe Runner</Text>
          <Pressable onPress={() => setShowRecipePicker(true)} style={[s.addBtn, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>Select Recipe</Text></Pressable>
        </ScrollView>
      )}

      {section === "runner" && !bake && selectedRecipe && (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={[s.sectionTitle, { color: colors.foreground }]}>Confirm Bake</Text>
          <Text style={{ color: colors.foreground, fontSize: 18, marginBottom: 12 }}>{selectedRecipe.name}</Text>
          <Pressable onPress={startBake} style={[s.addBtn, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>Start Bake</Text></Pressable>
        </ScrollView>
      )}

      {section === "runner" && bake && (
        <ScrollView
          ref={runnerScrollRef}
          contentContainerStyle={{
            paddingTop: 20,
            paddingBottom: insets.bottom + tabBarPad + 128,
            paddingHorizontal: 20
          }}
        >
          {/* Tracker Header */}
          <View style={s.trackerHeader}>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>
              {bake.recipeName}
            </Text>
            <Pressable onPress={resetBake} style={s.newBakeBtn}>
              <Text>New Bake</Text>
            </Pressable>
          </View>

          <SegmentBar phases={bake.phases} />

          {/* Phase Iteration Container */}
          <View style={{ gap: 8, marginTop: 16 }}>
            {bake.phases.map(phase => {
              const isDone = !!phase.completedAt;
              const isActive = !!phase.startedAt && !phase.completedAt;

              // State 1: Unstarted Phase Card
              if (!phase.startedAt) {
                return (
                  <View key={phase.key} style={[s.compactCard, { borderColor: colors.border }]}>
                    <View style={s.compactRow}>
                      <Text style={{ flex: 1, color: colors.mutedForeground }}>{phase.name}</Text>
                      <Pressable onPress={() => startPhase(phase.key)} style={s.startBtn}>
                        <Text>Start</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }

              // State 2: Completed Phase Card
              if (isDone) {
                return (
                  <Pressable
                    key={phase.key}
                    onPress={() => setExpandedDone(prev => {
                      const n = new Set(prev);
                      n.has(phase.key) ? n.delete(phase.key) : n.add(phase.key);
                      return n;
                    })}
                    style={[s.compactCard, { borderColor: colors.border }]}
                  >
                    <View style={s.compactRow}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      <Text style={{ flex: 1 }}>{phase.name}</Text>
                    </View>
                  </Pressable>
                );
              }

              // State 3: Active Phase Card
              return (
                <CopilotStep key={phase.key} text="Active Phase" order={15} name="active-bake">
                  <CopilotView style={[s.activeCard, { borderColor: colors.accent, backgroundColor: colors.card }]}>
                    <View style={s.activeHeader}>
                      <Text style={{ fontWeight: "700" }}>{phase.name}</Text>
                      <Text style={{ color: colors.accent }}>
                        {formatTimer(elapsed[phase.key] ?? 0)}
                      </Text>
                    </View>

                    {phase.key === "stretching_folding" && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: -4 }}>
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Folds:</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                         {[0, 1, 2, 3].map((idx) => {
                           const isFilled = (phase.foldCount || 0) > idx;
                             return (
                               <Pressable
                                 key={idx}
                                 onPress={() => toggleFold(phase.key, idx)}
                                 style={{
                                   width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                                   borderColor: isFilled ? "#6E7558" : colors.border,
                                   backgroundColor: isFilled ? "#6E7558" : "transparent",
                                   alignItems: 'center', justifyContent: 'center'
                                 }}
                               >
                               {/* isFilled && <Feather name="check" size={14} color="white" /> */}
                               </Pressable>
                             );
                         })}
                       </View>
                      </View>
                    )}

                    <View style={s.activeActions}>
                      {phase.key !== "the_bake" && (
                        <Pressable onPress={() => openReadingModal(phase.key)} style={s.actionBtn}>
                          <Text>Log Reading</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => completePhase(phase.key)} style={s.actionBtn}>
                        <Text>Complete</Text>
                      </Pressable>
                    </View>

                    {phase.readings.map(r => (
                      <ReadingRow
                        key={r.id}
                        reading={r}
                        colors={colors}
                        onDelete={() => deleteReading(phase.key, r.id)}
                      />
                    ))}
                  </CopilotView>
                </CopilotStep>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Floating Action Button */}
      {section === "runner" && !!bake && (
        <Pressable onPress={openNotesOverlay} style={[s.fab, { bottom: insets.bottom + tabBarPad + 16, backgroundColor: colors.primary }]}>
          <Feather name="edit-3" size={22} color={colors.primaryForeground} />
        </Pressable>
      )}

      <Modal visible={showNotesOverlay} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 20 }}>
          <View style={s.sheetHeader}><Text style={s.sheetTitle}>Notes</Text><Pressable onPress={saveNotesOverlay}><Text>Save</Text></Pressable></View>
          <SegmentedNotepad initialValue={overlayDraft} onChange={setOverlayDraft} phases={bake?.phases ?? []} colors={colors} bottomInset={insets.bottom} />
        </View>
      </Modal>

      <Modal visible={showReadingModal} animationType="slide" presentationStyle="pageSheet"><View style={{ padding: 20, paddingTop: insets.top + 20 }}><Text>Log Reading</Text><TextInput placeholder="pH" value={readPH} onChangeText={setReadPH} keyboardType="decimal-pad" /><Pressable onPress={saveReading}><Text>Save</Text></Pressable><Pressable onPress={() => setShowReadingModal(false)}><Text>Cancel</Text></Pressable></View></Modal>
      <Modal visible={showPhasePicker} animationType="slide" presentationStyle="pageSheet"><ScrollView style={{ paddingTop: insets.top + 20 }}>{PHASE_DEFINITIONS.map(d => <Pressable key={d.key} onPress={() => { setEditingRecipe({ ...editingRecipe!, phases: [...editingRecipe!.phases, { ...d, ingredients: "", instructions: "" }] }); setShowPhasePicker(false); }}><Text>{d.name}</Text></Pressable>)}</ScrollView></Modal>
      <Modal visible={showRecipePicker} animationType="slide" presentationStyle="pageSheet"><ScrollView style={{ paddingTop: insets.top + 20 }}>{recipes.map(r => <Pressable key={r.id} onPress={() => selectRecipeForRun(r)}><Text>{r.name}</Text></Pressable>)}</ScrollView></Modal>
      <AuthModal visible={showAuthModal} currentUser={currentUser} onClose={() => setShowAuthModal(false)} onAuthChange={setCurrentUser} />
    </View>
  );
}

const s = StyleSheet.create({
  sectionToggleWrap: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionToggle: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  sectionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionBtnText: {
    fontSize: 14,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  recipeCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  editTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  nameInput: {
    height: 50,
    paddingHorizontal: 14,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 12,
  },
  editPhaseCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  editPhaseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  phaseTextarea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginTop: 8,
    textAlignVertical: 'top', // Critical for multiline alignment on Android
    minHeight: 44,            // Approximately 1 row with padding
    maxHeight: 220,           // Approximately 10 rows
  },
  addPhaseBtn: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 14,
    alignItems: "center",
  },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  trackerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  newBakeBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  compactCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 8,
  },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  startBtn: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  activeCard: {
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 8,
  },
  activeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  activeActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  readingRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  readingTime: {
    fontSize: 12,
  },
  readingPills: {
    flexDirection: "row",
    gap: 4,
  },
  pill: {
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 10,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  startVolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8
  },
  startVolLabel: {
    fontSize: 12
  },
  startVolInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    padding: 4,
    height: 30
  }
});