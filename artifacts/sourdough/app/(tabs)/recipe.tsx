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
import { YieldPill } from "@/components/YieldPill";

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
      { key: "toasting_flour", name: "Dry Toasting", hint: "Dry toast flour, nuts, or seeds for deeper flavor (Flour, nuts, seeds)" },
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

// Flat list derived from categories (for backward-compatible lookups)
const PHASE_DEFINITIONS = PHASE_CATEGORIES.flatMap((c) => c.phases);

/**
 * Phase keys whose active card and reading modal should show volume fields.
 * These are the fermentation / proofing phases where rise tracking matters.
 */
const VOLUME_TRACKING_PHASE_KEYS = new Set([
  "building_levain",
  "bulk_fermenting",
  "cold_retarding",
  // "ambient_proofing" removed — proofing volume tracking not useful in practice
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * scalePhaseText — display-only quantity scaler for phase spec text blocks.
 *
 * Applies a global regex search-and-replace over a raw phase text string,
 * scaling only mass/volume quantities (Extensive Properties) while leaving
 * all Intensive Properties (time, temperature, manipulation cycles) untouched.
 *
 * Regex pattern (case-insensitive):
 *   \b(\d+(?:\.\d+)?)(?:(\s+)?)(g|kg|ml|l|oz|lbs)\b
 *
 * - Group 1  — numeric value (integer or decimal)
 * - Group 2  — optional whitespace between number and unit (preserves format)
 * - Group 3  — unit token (g | kg | ml | l | oz | lbs)
 *
 * The function handles both spaced notation ("250 g") and condensed keyboard
 * notation ("250g"). Original unit casing and spacing style are preserved.
 * The multiplied value is rounded to ≤1 decimal place with the trailing ".0"
 * stripped so "500.0g" becomes "500g" instead of cluttering the output.
 *
 * When multiplier === 1 the original string is returned unchanged (no-op).
 */
function scalePhaseText(text: string, multiplier: number): string {
  // Fast-path: no transformation needed at 1× or on empty input.
  if (multiplier === 1 || !text) return text;

  // Case-insensitive flag ensures "G", "KG", "ML" etc. are also matched.
  const MASS_VOLUME_RE = /\b(\d+(?:\.\d+)?)(?:(\s+)?)(g|kg|ml|l|oz|lbs)\b/gi;

  return text.replace(
    MASS_VOLUME_RE,
    (_match, numStr: string, space: string | undefined, unit: string) => {
      const original = parseFloat(numStr);
      const scaled = original * multiplier;

      // Round to 1 decimal, then coerce back through parseFloat to drop
      // trailing zeros — e.g. 500.0 → "500", 250.5 → "250.5".
      const formatted = parseFloat(scaled.toFixed(1)).toString();

      // Preserve the original spacing style between number and unit.
      // When space is undefined (condensed "250g"), fall back to "".
      return `${formatted}${space ?? ""}${unit}`;
    }
  );
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

// ─── Segment bar ──────────────────────────────────────────────────────────────

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

// ─── Reading row ──────────────────────────────────────────────────────────────

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

// ─── Phase highlight wrapper ──────────────────────────────────────────────────
// Briefly glows with an accent shadow when `active` flips to true, drawing the
// baker's eye to the next pending phase after auto-scroll lands.
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

// ─── Main screen ──────────────────────────────────────────────────────────────

// ─── Keycap key ───────────────────────────────────────────────────────────────

const KEY_W = 30;   // letter key SVG width
const ALL_W = 42;   // "All" key SVG width
const HASH_W = 30;  // "#" key same as letter
const FACE_H = 25;  // height of the key face
const LEDGE_H = 2;  // height of the bottom ledge
const KEY_H = FACE_H + LEDGE_H;
const FLARE = 3;    // px each side flares out at the bottom

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
      <View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: "center", justifyContent: "center", paddingBottom: LEDGE_H },
        ]}
      >
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: textColor }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RecipeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  const [section, setSection] = useState<"builder" | "runner">("builder");

  // ── Shared data ────────────────────────────────────────────────────────────
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [bake, setBake] = useState<ActiveBake | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Runner auto-scroll ─────────────────────────────────────────────────────
  const runnerScrollRef = useRef<ScrollView | null>(null);
  /** y-offset of each phase card within the phases container (from onLayout) */
  const phaseCardYOffsets = useRef<Record<string, number>>({});
  /** y-offset of the phases container within the runner ScrollView content */
  const phasesContainerY = useRef(0);

  // ── Builder state ──────────────────────────────────────────────────────────
  const [editingRecipe, setEditingRecipe] = useState<SavedRecipe | null>(null);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  // Which phases are checked in the multi-select picker (cleared on open/confirm).
  const [pickerSelections, setPickerSelections] = useState<Record<string, boolean>>({});
  // A–Z index filter; null = show all
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  // Letters that have at least one recipe (only populated letters are shown as chips).
  const populatedLetters = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      const ch = r.name.trim()[0]?.toUpperCase() ?? "";
      if (ch >= "A" && ch <= "Z") set.add(ch);
      else if (ch) set.add("#");
    });
    const sorted = [...set].filter((l) => l !== "#").sort();
    if (set.has("#")) sorted.push("#");
    return sorted;
  }, [recipes]);

  // Recipes visible under the active letter filter.
  const displayedRecipes = useMemo(() => {
    if (!letterFilter) return recipes;
    if (letterFilter === "#") {
      return recipes.filter((r) => {
        const ch = r.name.trim()[0]?.toUpperCase() ?? "";
        return !(ch >= "A" && ch <= "Z");
      });
    }
    return recipes.filter(
      (r) => r.name.trim()[0]?.toUpperCase() === letterFilter
    );
  }, [recipes, letterFilter]);

  // ── Runner state ───────────────────────────────────────────────────────────
  const [selectedRecipe, setSelectedRecipe] = useState<SavedRecipe | null>(null);
  // phases the user toggled for this run (keyed booleans)
  const [runPhaseEnabled, setRunPhaseEnabled] = useState<Record<string, boolean>>({});
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [scaleMultiplier, setScaleMultiplier] = useState(1);
  const [copiedIngredientsKey, setCopiedIngredientsKey] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());
  const [expandedRecipeInfo, setExpandedRecipeInfo] = useState<Set<string>>(new Set());
  /** Keys of pending (not-yet-started) phase cards the user has tapped open to preview. */
  const [expandedPending, setExpandedPending] = useState<Set<string>>(new Set());

  // ── Phase transition animation state ───────────────────────────────────────
  /** Key of the phase that was just marked complete (drives FadeIn on its Done card). */
  const [recentlyCompletedKey, setRecentlyCompletedKey] = useState<string | null>(null);
  /** Key of the next pending phase to highlight after auto-scroll lands. */
  const [nextHighlightKey, setNextHighlightKey] = useState<string | null>(null);

  // ── Reading modal ──────────────────────────────────────────────────────────
  const [showReadingModal, setShowReadingModal] = useState(false);
  const [readingPhaseKey, setReadingPhaseKey] = useState<string | null>(null);
  const [readTemp, setReadTemp] = useState("");
  const [readTempUnit, setReadTempUnit] = useState<"F" | "C">("F");
  const [readPH, setReadPH] = useState("");
  const [readNote, setReadNote] = useState("");
  const [readVolume, setReadVolume] = useState("");
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});
  const [bakeNotes, setBakeNotes] = useState("");
  // FAB notepad overlay
  const [showNotesOverlay, setShowNotesOverlay] = useState(false);
  const [overlayDraft, setOverlayDraft] = useState("");

  // ── Nudge banner ───────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    loadAll();
    getStoredUser().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current !== "active" && nextState === "active") {
        loadAll();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!bake) return;
    const hasActive = bake.phases.some((p) => p.startedAt && !p.completedAt);
    if (!hasActive) return;
    const id = setInterval(() => {
      const now = Date.now();
      const upd: Record<string, number> = {};
      bake.phases.forEach((p) => {
        if (p.startedAt && !p.completedAt) upd[p.key] = now - p.startedAt;
      });
      setElapsed(upd);
    }, 1000);
    return () => clearInterval(id);
  }, [bake]);

  useEffect(() => {
    if (bake) {
      const vols: Record<string, string> = {};
      bake.phases.forEach((p) => { vols[p.key] = p.startVolume ?? ""; });
      setPhaseStartVolumes(vols);
    }
    setBakeNotes(bake?.notes ?? "");
  }, [bake?.id]);

  const refresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const loadAll = async () => {
    let localBakeFound = false;
    try {
      const [recipeStr, bakeStr] = await Promise.all([
        AsyncStorage.getItem(RECIPES_KEY),
        AsyncStorage.getItem(BAKE_KEY),
      ]);
      if (recipeStr) setRecipes(JSON.parse(recipeStr));
      if (bakeStr) {
        setBake(JSON.parse(bakeStr));
        localBakeFound = true;
      }
    } catch {}
    try {
      const deviceId = await getDeviceId();
      const token = await getStoredToken().catch(() => null);
      const [apiRecipes, activeBake, deletedRecipeIds] = await Promise.all([
        api.recipes.list(deviceId, token ?? undefined),
        localBakeFound ? Promise.resolve(null) : api.history.bakes.active(deviceId),
        getRecipeTombstone(),
      ]);
      const mapped: SavedRecipe[] = apiRecipes.filter((r) => !deletedRecipeIds.includes(r.id)).map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: new Date(r.createdAt).getTime(),
        phases: r.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients ?? "",
          instructions: p.instructions ?? "",
          yieldValue: (r.yield_value && r.yield_value > 0) ? r.yield_value.toString() : "",
        })),
      }));
      if (token || apiRecipes.length > 0) {
        setRecipes(mapped);
        await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(mapped));
      }
      if (!localBakeFound && activeBake) {
        const restored: ActiveBake = {
          id: activeBake.id,
          recipeId: activeBake.recipeId ?? "",
          recipeName: activeBake.recipeName,
          startedAt: activeBake.startedAt,
          yieldValue: (activeBake.yield_value && activeBake.yield_value > 0) ? activeBake.yield_value.toString() : "",
          phases: activeBake.phases.map((p) => ({
            key: p.key,
            name: p.name,
            ingredients: p.ingredients ?? "",
            instructions: p.instructions ?? "",
            startedAt: p.startedAt ?? null,
            completedAt: p.completedAt ?? null,
            readings: p.readings ?? [],
            startVolume: p.startVolume,
          })),
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
          id: updated.id,
          deviceId,
          userId: userId ?? undefined,
          recipeId: updated.recipeId,
          recipeName: updated.recipeName,
          yield_value: updated.yieldValue ? parseInt(updated.yieldValue, 10) : 0,
          savedAt: Date.now(),
          startedAt: updated.startedAt,
          phases: updated.phases.map((p) => ({
            key: p.key,
            name: p.name,
            ingredients: p.ingredients,
            instructions: p.instructions,
            startedAt: p.startedAt,
            completedAt: p.completedAt,
            readings: p.readings,
            startVolume: p.startVolume,
            foldCount: p.foldCount,
          })),
          inProgress: true,
        })
      )
      .catch(() => {});
  };

  const saveBakeToHistory = async (b: ActiveBake) => {
    const savedAt = Date.now();
    // Store full phase data (readings + startVolume) so the Calendar detail
    // modal can show them without a separate API round-trip.
    const phases = b.phases.map((p) => ({
      key: p.key,
      name: p.name,
      ingredients: p.ingredients,
      instructions: p.instructions,
      yield_value: b.yieldValue ? parseInt(b.yieldValue, 10) : 0,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      readings: p.readings,
      startVolume: p.startVolume,
      foldCount: p.foldCount,
    }));
    try {
      const stored = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
      const existing = stored ? JSON.parse(stored) : [];
      existing.unshift({
        id: b.id,
        recipeId: b.recipeId,
        recipeName: b.recipeName,
        savedAt,
        startedAt: b.startedAt,
        notes: b.notes,
        phases,
      });
      await AsyncStorage.setItem(
        BAKE_HISTORY_KEY,
        JSON.stringify(existing.slice(0, 200))
      );
    } catch {}
    reportSyncStart();
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.history.bakes.upsert({
          id: b.id,
          deviceId,
          userId: userId ?? undefined,
          recipeId: b.recipeId,
          recipeName: b.recipeName,
          yield_value: b.yieldValue ? parseInt(b.yieldValue, 10) : 0,
          savedAt,
          startedAt: b.startedAt,
          phases,
          inProgress: false,
        })
      )
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  const checkAndShowNudge = async () => {
    try {
      const [nudgeShown, user, historyRaw] = await Promise.all([
        AsyncStorage.getItem(NUDGE_KEY),
        getStoredUser(),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
      ]);
      if (nudgeShown) return;
      if (user) return;
      const history: unknown[] = historyRaw ? JSON.parse(historyRaw) : [];
      if (history.length !== 1) return;
      await AsyncStorage.setItem(NUDGE_KEY, "1");
      setShowNudge(true);
    } catch {}
  };

  // ── Builder handlers ───────────────────────────────────────────────────────

  const openNewRecipe = () => {
    setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] });
    setIsNewRecipe(true);
  };

  const openEditRecipe = (r: SavedRecipe) => {
    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));
    const sorted = r.phases
      .map((p) => ({ ...p }))
      .sort((a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999));
    setEditingRecipe({ ...r, phases: sorted });
    setIsNewRecipe(false);
  };

  const updateEditName = (name: string) =>
    setEditingRecipe((prev) => prev ? { ...prev, name } : null);

  const addPhaseToEdit = (key: string) => {
    const def = PHASE_DEFINITIONS.find((p) => p.key === key)!;
    const newPhase: RecipePhaseConfig = { key, name: def.name, ingredients: "", instructions: "" };
    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));
    setEditingRecipe((prev) => {
      if (!prev) return null;
      const sorted = [...prev.phases, newPhase].sort(
        (a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999)
      );
      return { ...prev, phases: sorted };
    });
    setShowPhasePicker(false);
    Haptics.selectionAsync();
  };

  /** Toggle a phase's checkbox state in the multi-select picker. */
  const togglePickerPhase = (key: string) => {
    setPickerSelections((prev) => ({ ...prev, [key]: !prev[key] }));
    Haptics.selectionAsync();
  };

  /**
   * Add all currently-checked phases to the recipe in catalog order, then
   * close the picker. Phases already in the recipe are silently skipped.
   */
  const confirmPhaseSelections = () => {
    const keysToAdd = PHASE_DEFINITIONS
      .filter((def) => pickerSelections[def.key])
      .map((def) => def.key);
    if (!keysToAdd.length) {
      setShowPhasePicker(false);
      return;
    }
    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));
    setEditingRecipe((prev) => {
      if (!prev) return null;
      const existingKeys = new Set(prev.phases.map((p) => p.key));
      const newPhases = keysToAdd
        .filter((key) => !existingKeys.has(key))
        .map((key) => {
          const def = PHASE_DEFINITIONS.find((p) => p.key === key)!;
          return { key, name: def.name, ingredients: "", instructions: "" } as RecipePhaseConfig;
        });
      const sorted = [...prev.phases, ...newPhases].sort(
        (a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999)
      );
      return { ...prev, phases: sorted };
    });
    setPickerSelections({});
    setShowPhasePicker(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removePhaseFromEdit = (key: string) => {
    const defOrder = new Map(PHASE_DEFINITIONS.map((d, i) => [d.key, i]));
    setEditingRecipe((prev) => {
      if (!prev) return null;
      const filtered = prev.phases
        .filter((p) => p.key !== key)
        .sort((a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999));
      return { ...prev, phases: filtered };
    });
  };

  const updatePhaseField = (
    key: string,
    field: "ingredients" | "instructions",
    value: string
  ) =>
    setEditingRecipe((prev) =>
      prev
        ? { ...prev, phases: prev.phases.map((p) => (p.key === key ? { ...p, [field]: value } : p)) }
        : null
    );

  const saveRecipe = async () => {
    if (!editingRecipe) return;
    if (!editingRecipe.name.trim()) {
      Alert.alert("Name required", "Give your recipe a name before saving.");
      return;
    }
    const now = Date.now();
    const saved = {
      ...editingRecipe,
      name: editingRecipe.name.trim(),
      updatedAt: isNewRecipe ? undefined : now,
    };
    const updated = isNewRecipe
      ? [saved, ...recipes]
      : recipes.map((r) => (r.id === saved.id ? saved : r));
    await persistRecipes(updated);
    setEditingRecipe(null);
    setIsNewRecipe(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    reportSyncStart();
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.recipes.upsert({
          id: saved.id,
          deviceId,
          userId: userId ?? undefined,
          name: saved.name,
          phases: saved.phases.map((p) => ({
            key: p.key,
            name: p.name,
            ingredients: p.ingredients,
            instructions: p.instructions,
          })),
        })
      )
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  const deleteRecipe = (id: string) => {
    const doDelete = async () => {
      const updated = recipes.filter((r) => r.id !== id);
      await persistRecipes(updated);
      await addToRecipeTombstone(id);
      setEditingRecipe(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const [deviceId, token] = await Promise.all([
        getDeviceId().catch(() => ""),
        getStoredToken().catch(() => null),
      ]);
      api.recipes.delete(id, deviceId || undefined, token ?? undefined)
        .then((deleted) => { if (deleted) removeFromRecipeTombstone(id); })
        .catch(() => {});
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Recipe?", "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const cancelEdit = () => {
    setEditingRecipe(null);
    setIsNewRecipe(false);
  };

  const buildRecipeHtml = (r: SavedRecipe) => {
    const date = new Date(r.createdAt).toLocaleDateString([], {
      year: "numeric", month: "long", day: "numeric",
    });
    const phasesHtml = r.phases
      .map((p, i) => {
        const foldHtml = p.key === "stretching_folding"
          ? `<div class="fold-row"><span class="recipe-label">Folds</span>
               <div class="fold-circles">
                 <div class="fold-circle"></div>
                 <div class="fold-circle"></div>
                 <div class="fold-circle"></div>
                 <div class="fold-circle"></div>
               </div>
             </div>`
          : "";
        const ingHtml = p.ingredients
          ? `<div class="recipe-info"><span class="recipe-label">Ingredients</span><p class="recipe-text">${p.ingredients.replace(/\n/g, "<br>")}</p></div>`
          : "";
        const insHtml = p.instructions
          ? `<div class="recipe-info"><span class="recipe-label">Instructions</span><p class="recipe-text">${p.instructions.replace(/\n/g, "<br>")}</p></div>`
          : "";
        const empty = !p.ingredients && !p.instructions
          ? `<p class="recipe-empty">No ingredients or instructions added.</p>`
          : "";
        return `<div class="phase"><div class="phase-header">Phase ${i + 1}: ${p.name}</div>${foldHtml}${ingHtml}${insHtml}${empty}</div>`;
      })
      .join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${r.name}</title>
        <style>*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:24px;color:#111;font-size:13px;line-height:1.6}h1{font-size:22px;margin:0 0 4px;font-weight:700}h2{font-size:14px;font-weight:600;margin:20px 0 10px;color:#555}
          .meta{color:#888;font-size:12px;margin:0 0 20px}
          .phase{border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin-bottom:12px}
          .phase-header{font-size:14px;font-weight:600;margin-bottom:8px}
          .recipe-info{margin:0 0 10px}
          .recipe-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#999;display:block;margin-bottom:3px}
          .recipe-text{margin:0;white-space:pre-wrap}
          .fold-row{margin:0 0 10px;display:flex;align-items:center;gap:10px}
          .fold-circles{display:flex;gap:8px}
          .fold-circle{width:18px;height:18px;border-radius:50%;border:2px solid #555;background:transparent}
          .recipe-empty{color:#bbb;font-style:italic;margin:0}
          .footer{margin-top:24px;color:#aaa;font-size:11px;text-align:center}@media print{body{padding:16px}
          .phase{break-inside:avoid}}
        </style>
      </head>
      <body><h1>${r.name}</h1><p class="meta">${r.phases.length} ${r.phases.length === 1 ? "phase" : "phases"} · Created ${date}</p>
        <h2>Phases</h2>${phasesHtml}<p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p>
      </body>
    </html>`;
  };

  const printRecipe = async (r: SavedRecipe) => {
    const html = buildRecipeHtml(r);
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
      } else {
        await Print.printAsync({ html });
      }
    } catch (err) {
        // Notify user instead of silently swallowing the error
        Alert.alert("Could not print", "Something went wrong while printing. Please try again.");
      }
  };

  const shareAsPdf = async (r: SavedRecipe) => {
    const html = buildRecipeHtml(r);
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
        return;
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Share ${r.name}`, UTI: "com.adobe.pdf" });
    } catch (err) {
      Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again.");
    }
  };

  const sharePhaseAsPdf = async (phase: BakePhase) => {
    const scaledIngredients = phase.ingredients
      ? scalePhaseText(phase.ingredients, scaleMultiplier)
      : "";
    const scaledInstructions = phase.instructions
      ? scalePhaseText(phase.instructions, scaleMultiplier)
      : "";
    const recipeName = bake?.recipeName ?? "Bake";
    const scaleNote = scaleMultiplier !== 1 ? ` · ${scaleMultiplier}× batch` : "";
    const ingHtml = scaledIngredients
      ? `<div class="section"><span class="label">Ingredients</span><p class="text">${scaledIngredients.replace(/\n/g, "<br>")}</p></div>`
      : "";
    const insHtml = scaledInstructions
      ? `<div class="section"><span class="label">Instructions</span><p class="text">${scaledInstructions.replace(/\n/g, "<br>")}</p></div>`
      : "";
    const emptyHtml = !scaledIngredients && !scaledInstructions
      ? `<p class="empty">No ingredients or instructions defined for this phase.</p>`
      : "";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${phase.name} — ${recipeName}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:28px;color:#111;font-size:14px;line-height:1.6}h1{font-size:22px;margin:0 0 4px;font-weight:700}.recipe{color:#888;font-size:13px;margin:0 0 24px}.section{margin-bottom:20px}.label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#999;display:block;margin-bottom:6px}.text{margin:0;white-space:pre-wrap;color:#333;font-size:14px;line-height:1.6}.empty{color:#bbb;font-style:italic;margin:0}.footer{margin-top:32px;color:#aaa;font-size:11px;text-align:center}@media print{body{padding:20px}}</style></head><body><h1>${phase.name}</h1><p class="recipe">${recipeName}${scaleNote}</p>${ingHtml}${insHtml}${emptyHtml}<p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p></body></html>`;
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
        return;
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Share ${phase.name} spec`, UTI: "com.adobe.pdf" });
    } catch {
      Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again.");
    }
  };

  // ── Runner handlers ────────────────────────────────────────────────────────

  const selectRecipeForRun = (r: SavedRecipe) => {
    setSelectedRecipe(r);
    const enabled: Record<string, boolean> = {};
    r.phases.forEach((p) => { enabled[p.key] = true; });
    setRunPhaseEnabled(enabled);
    setShowRecipePicker(false);
  };

  const toggleRunPhase = (key: string) => {
    setRunPhaseEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
    Haptics.selectionAsync();
  };

  const startBake = async () => {
    if (!selectedRecipe) return;
    const phases: BakePhase[] = selectedRecipe.phases
      .filter((p) => runPhaseEnabled[p.key])
      .map((p) => ({ ...p, startedAt: null, completedAt: null, readings: [] }));
    if (phases.length === 0) {
      Alert.alert("Select at least one phase to start.");
      return;
    }
    const newBake: ActiveBake = {
      id: Date.now().toString(),
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      startedAt: Date.now(),
      phases,
      yieldValue: selectedRecipe.yieldValue || "1",
    };
    await persistBake(newBake);
    setSelectedRecipe(null);
    setSection("runner");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const resetBake = () => {
    Alert.alert(
      "New Bake?",
      "This clears all logged phases for the current bake.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            const abandonedBake = bake;
            if (abandonedBake) await saveBakeToHistory(abandonedBake);
            await checkAndShowNudge();
            await AsyncStorage.removeItem(BAKE_KEY);
            setBake(null);
            setElapsed({});
            setExpandedDone(new Set());
            setExpandedRecipeInfo(new Set());
            setScaleMultiplier(1);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (abandonedBake) {
              reportSyncStart();
              getDeviceId()
                .then((deviceId) => api.history.bakes.delete(abandonedBake.id, deviceId))
                .then(() => reportSyncSuccess())
                .catch(() => reportSyncFailure());
            }
          },
        },
      ]
    );
  };

  const startPhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) => {
      if (p.key === key) return { ...p, startedAt: Date.now() };
      if (p.startedAt && !p.completedAt) return { ...p, completedAt: Date.now() };
      return p;
    });
    await persistBake({ ...bake, phases });
    const startedPhase = bake.phases.find((p) => p.key === key);
    if (startedPhase && (startedPhase.ingredients?.trim() || startedPhase.instructions?.trim())) {
      setExpandedRecipeInfo((prev) => new Set([...prev, key]));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const completePhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) =>
      p.key === key ? { ...p, completedAt: Date.now() } : p
    );
    // Set recentlyCompletedKey in the same render batch as persistBake so the
    // Done card's FadeIn entering animation fires on the first mount.
    setRecentlyCompletedKey(key);
    setTimeout(() => setRecentlyCompletedKey(null), 800);

    await persistBake({ ...bake, phases });
    setExpandedRecipeInfo((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Auto-scroll to the next pending phase after a short delay so layout
    // has settled (the completed card collapses, next card may shift up/down).
    const nextPhase = phases.find((p) => !p.completedAt);
    if (nextPhase) {
      setTimeout(() => {
        const cardY = phaseCardYOffsets.current[nextPhase.key];
        if (cardY !== undefined) {
          const scrollY = phasesContainerY.current + cardY - 16;
          runnerScrollRef.current?.scrollTo({ y: Math.max(0, scrollY), animated: true });
        }
        // Trigger the next-card highlight glow after the scroll has landed.
        setNextHighlightKey(nextPhase.key);
        setTimeout(() => setNextHighlightKey(null), 1200);
      }, 320);
    }
  };

  const toggleFold = async (key: string, idx: number) => {
    if (!bake) return;
    const phases = bake.phases.map((p) => {
      if (p.key !== key) return p;
      // Tapping the nth circle fills circles 0..n, clears if already at n+1
      const current = p.foldCount ?? 0;
      const next = current === idx + 1 ? idx : idx + 1;
      return { ...p, foldCount: next };
    });
      await persistBake({ ...bake, phases });
      Haptics.selectionAsync();
  };

  const openReadingModal = (key: string) => {
    setReadingPhaseKey(key);
    setReadTemp(""); setReadPH(""); setReadNote(""); setReadVolume("");
    setShowReadingModal(true);
  };

  const saveReading = async () => {
    if (!bake || !readingPhaseKey) return;
    if (!readTemp && !readPH) {
      Alert.alert("Enter at least a temperature or pH.");
      return;
    }
    const reading: Reading = {
      id: Date.now().toString(),
      temp: readTemp,
      tempUnit: readTempUnit,
      pH: readPH,
      note: readNote,
      volume: readVolume,
      loggedAt: Date.now(),
    };
    const phases = bake.phases.map((p) =>
      p.key === readingPhaseKey ? { ...p, readings: [...p.readings, reading] } : p
    );
    await persistBake({ ...bake, phases });
    setShowReadingModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const deleteReading = (phaseKey: string, readingId: string) => {
    const doDelete = async () => {
      if (!bake) return;
      const phases = bake.phases.map((p) =>
        p.key === phaseKey
          ? { ...p, readings: p.readings.filter((r) => r.id !== readingId) }
          : p
      );
      await persistBake({ ...bake, phases });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete reading?", "This reading will be permanently removed.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const toggleExpandDone = (key: string) =>
    setExpandedDone((prev) => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });

  const toggleExpandRecipeInfo = (key: string) =>
    setExpandedRecipeInfo((prev) => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });

  /** Toggle expand/collapse of a pending phase card to preview its recipe info. */
  const toggleExpandPending = (key: string) =>
    setExpandedPending((prev) => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });

  const updatePhaseStartVolume = async (key: string, value: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) =>
      p.key === key ? { ...p, startVolume: value } : p
    );
    await persistBake({ ...bake, phases });
  };

  const saveBakeNotes = async (text: string) => {
    if (!bake) return;
    await persistBake({ ...bake, notes: text });
  };

  /** Open the notepad overlay, seeding the draft with the persisted notes. */
  const openNotesOverlay = () => {
    setOverlayDraft(bakeNotes);
    setShowNotesOverlay(true);
  };

  /** Save the draft, persist it, and close the overlay. */
  const saveNotesOverlay = async () => {
    setBakeNotes(overlayDraft);
    await saveBakeNotes(overlayDraft);
    setShowNotesOverlay(false);
  };

  // appendPhaseTag is now handled inside SegmentedNotepad via insertChip

  const buildBakeHtml = () => {
    if (!bake) return "";
    const date = new Date(bake.startedAt).toLocaleDateString([], {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const totalDur = bake.phases.reduce((acc, p) => {
      if (p.startedAt && p.completedAt) return acc + (p.completedAt - p.startedAt);
      return acc;
    }, 0);
    const phasesHtml = bake.phases
      .map((p, i) => {
        const dur =
          p.startedAt && p.completedAt
            ? formatDone(p.completedAt - p.startedAt)
            : p.startedAt ? "In progress" : "Not started";
        const status = p.completedAt ? "✓" : p.startedAt ? "●" : "○";
        const lastVol = p.readings.filter((r) => r.volume).at(-1)?.volume;
        const volLine =
          p.startVolume || lastVol
            ? `<p class="vol">Volume: ${p.startVolume || "—"} → ${lastVol || "—"}</p>`
            : "";
        const readingsHtml =
          p.readings.length > 0
            ? `<table class="readings"><thead><tr><th>Time</th><th>Temp</th><th>pH</th><th>Volume</th><th>Note</th></tr></thead><tbody>${p.readings
                .map(
                  (r) =>
                    `<tr><td>${new Date(r.loggedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td><td>${r.temp ? `${r.temp}°${r.tempUnit}` : "—"}</td><td>${r.pH ? `pH ${r.pH}` : "—"}</td><td>${r.volume || "—"}</td><td>${r.note || "—"}</td></tr>`
                )
                .join("")}</tbody></table>`
            : "";
        const ingHtml = p.ingredients
          ? `<div class="recipe-info"><span class="recipe-label">Ingredients</span><p class="recipe-text">${p.ingredients.replace(/\n/g, "<br>")}</p></div>`
          : "";
        const insHtml = p.instructions
          ? `<div class="recipe-info"><span class="recipe-label">Instructions</span><p class="recipe-text">${p.instructions.replace(/\n/g, "<br>")}</p></div>`
          : "";
        const foldHtml = p.key === "stretching_folding"
          ? (() => {
              const count = (p as any).foldCount ?? 0;
              const circles = [0,1,2,3].map(i =>
                `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #6E7558;background:${i < count ? '#6E7558' : 'transparent'};margin-right:5px"></span>`
              ).join('');
              return `<p style="margin:4px 0 8px"><span style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px">Folds</span><br/>${circles}</p>`;
            })()
          : "";
        return `<div class="phase"><div class="phase-header"><span class="phase-status">${status}</span> Phase ${i + 1}: ${p.name} <span class="dur">${dur}</span></div>${ingHtml}${insHtml}${foldHtml}${volLine}${readingsHtml}</div>`;
      })
      .join("");
    const notesHtml = bakeNotes
      ? `<div class="notes"><strong>Bake Notes</strong><p>${bakeNotes.replace(/\n/g, "<br>")}</p></div>`
      : "";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${bake.recipeName} — ${date}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:24px;color:#111;font-size:13px;line-height:1.5}h1{font-size:20px;margin:0 0 4px;font-weight:700}h2{font-size:14px;font-weight:600;margin:0 0 16px;color:#555}.meta{color:#666;margin:0 0 20px;font-size:12px}.notes{background:#f9f6f0;border-radius:6px;padding:12px 16px;margin-bottom:20px;border:1px solid #e8e0d4}.notes p{margin:6px 0 0}.phase{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin-bottom:10px}.phase-header{font-size:14px;font-weight:600;margin-bottom:6px}.phase-status{display:inline-block;width:16px}.dur{color:#777;font-weight:400;font-size:12px;margin-left:6px}.vol{margin:4px 0;color:#666;font-size:12px}table.readings{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}th{text-align:left;color:#888;border-bottom:1px solid #eee;padding:3px 6px;font-weight:500}td{padding:3px 6px;border-bottom:1px solid #f5f5f5}.footer{margin-top:24px;color:#aaa;font-size:11px;text-align:center}.recipe-info{margin:6px 0 8px}.recipe-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#999;display:block;margin-bottom:3px}.recipe-text{margin:0;white-space:pre-wrap;color:#555}@media print{body{padding:16px}.phase{break-inside:avoid}}</style></head><body><h1>${bake.recipeName}</h1><p class="meta">${date} · ${completedCount}/${bake.phases.length} phases${totalDur > 0 ? " · Total active time: " + formatDone(totalDur) : ""}</p>${notesHtml}<h2>Phases</h2>${phasesHtml}<p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p></body></html>`;
  };

  const printBake = async () => {
    if (!bake) return;
    const html = buildBakeHtml();
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
      } else {
        await Print.printAsync({ html });
      }
    } catch {}
  };

  const shareBakePdf = async () => {
    if (!bake) return;
    const html = buildBakeHtml();
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
        return;
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Share ${bake.recipeName} bake summary`, UTI: "com.adobe.pdf" });
    } catch {
      Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again.");
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const activePhase = bake?.phases.find((p) => p.startedAt && !p.completedAt);
  const completedCount = bake?.phases.filter((p) => p.completedAt).length ?? 0;
  const allDone = !!bake && completedCount === bake.phases.length && bake.phases.length > 0;
  const availablePhases = editingRecipe
    ? PHASE_DEFINITIONS.filter((d) => !editingRecipe.phases.find((p) => p.key === d.key))
    : [];
  const readingModalPhase = bake?.phases.find((p) => p.key === readingPhaseKey);

  // Is the source recipe newer than the bake start? (item 5)
  const recipeStale = !!bake && (() => {
    const sourceRecipe = recipes.find((r) => r.id === bake.recipeId);
    return !!(sourceRecipe?.updatedAt && sourceRecipe.updatedAt > bake.startedAt);
  })();

  // Available category groups for phase picker (only categories with remaining phases)
  const availableCategories = PHASE_CATEGORIES.map((cat) => ({
    ...cat,
    phases: cat.phases.filter((d) => availablePhases.some((a) => a.key === d.key)),
  })).filter((cat) => cat.phases.length > 0);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>

      {/* ── Top section toggle ─────────────────────────────────────────────── */}
      <View
        style={[
          s.sectionToggleWrap,
          {
            paddingTop: insets.top + webTop + 16,
            paddingHorizontal: 20,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View
          style={[s.sectionToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}
        >
          {(["builder", "runner"] as const).map((sec) => (
            <Pressable
              key={sec}
              onPress={() => { setSection(sec); Haptics.selectionAsync(); }}
              style={[
                s.sectionBtn,
                section === sec && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
              ]}
            >
              <Text
                style={[
                  s.sectionBtnText,
                  {
                    color: section === sec ? colors.foreground : colors.mutedForeground,
                    fontFamily: section === sec ? "Inter_600SemiBold" : "Inter_400Regular",
                  },
                ]}
              >
                {sec === "builder" ? "Recipe Builder" : "Recipe Runner"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* BUILDER SECTION                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {section === "builder" && !editingRecipe && (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 60,
            paddingHorizontal: 20,
          }}
          keyboardShouldPersistTaps="handled" // Allows saving while keyboard is up
          automaticallyAdjustKeyboardInsets={true} // Modern way to handle keyboard pushing
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.mutedForeground}
            />
          }
        >
          <Animated.View entering={FadeIn.duration(300)}>
            <View style={s.listHeader}>
              <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                Recipes
              </Text>
              <Pressable
                onPress={openNewRecipe}
                style={({ pressed }) => [
                  s.addBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Feather name="plus" size={14} color={colors.primaryForeground} />
                <Text style={[s.addBtnText, { color: colors.primaryForeground }]}>
                  New Recipe
                </Text>
              </Pressable>
            </View>

            {/* A–Z index — keycap style, two rows */}
            {recipes.length > 1 && populatedLetters.length > 1 && (
              <View style={{ marginBottom: 12 }}>
                {/* Row 1: All + first 13 letters (14 keys max) */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0, paddingRight: 4 }}>
                  <KeycapKey
                    label="All"
                    active={letterFilter === null}
                    onPress={() => setLetterFilter(null)}
                    faceFill={letterFilter === null ? colors.secondary : colors.card}
                    ledgeFill={colors.muted}
                    stroke={colors.border}
                    textColor={letterFilter === null ? colors.foreground : colors.mutedForeground}
                  />
                  {populatedLetters.slice(0, 13).map((letter) => {
                    const active = letterFilter === letter;
                    return (
                      <KeycapKey
                        key={letter}
                        label={letter}
                        active={active}
                        onPress={() => setLetterFilter(active ? null : letter)}
                        faceFill={active ? colors.secondary : colors.card}
                        ledgeFill={colors.muted}
                        stroke={colors.border}
                        textColor={active ? colors.foreground : colors.mutedForeground}
                      />
                    );
                  })}
                </ScrollView>
                {/* Row 2: remaining letters (up to 14) */}
                {populatedLetters.length > 13 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0, paddingLeft: 14, paddingRight: 4 }}>
                    {populatedLetters.slice(13).map((letter) => {
                      const active = letterFilter === letter;
                      return (
                        <KeycapKey
                          key={letter}
                          label={letter}
                          active={active}
                          onPress={() => setLetterFilter(active ? null : letter)}
                          faceFill={active ? colors.secondary : colors.card}
                          ledgeFill={colors.muted}
                          stroke={colors.border}
                          textColor={active ? colors.foreground : colors.mutedForeground}
                        />
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}

            {recipes.length === 0 ? (
              <View style={[s.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="book-open" size={28} color={colors.mutedForeground} />
                <Text style={[s.emptyTitle, { color: colors.foreground }]}>No recipes yet</Text>
                <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
                  Tap "New Recipe" to define your first bake — add phases, ingredients, and instructions.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {displayedRecipes.map((r, i) => (
                  <Animated.View key={r.id} entering={FadeInDown.delay(i * 40).duration(300)}>
                    <Pressable
                      onPress={() => openEditRecipe(r)}
                      style={({ pressed }) => [
                        s.recipeCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <View style={s.recipeCardTop}>
                        <Text style={[s.recipeName, { color: colors.foreground }]} numberOfLines={1}>
                          {r.name}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Pressable
                            onPress={(e) => { e.stopPropagation?.(); printRecipe(r); }}
                            hitSlop={8}
                            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                          >
                            <Feather name="printer" size={15} color={colors.mutedForeground} />
                          </Pressable>
                          <Pressable
                            onPress={(e) => { e.stopPropagation?.(); shareAsPdf(r); }}
                            hitSlop={8}
                            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                          >
                            <Feather name="share-2" size={15} color={colors.mutedForeground} />
                          </Pressable>
                          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                        </View>
                      </View>
                      <View style={s.recipeCardMeta}>
                        <Text style={[s.recipeMeta, { color: colors.mutedForeground }]}>
                          {r.phases.length} {r.phases.length === 1 ? "phase" : "phases"}
                        </Text>
                        <Text style={[s.recipeMeta, { color: colors.mutedForeground }]}>
                          · {formatDate(r.createdAt)}
                        </Text>
                      </View>
                      {r.phases.length > 0 && (
                        <View style={s.phasePillRow}>
                          {r.phases.map((p) => (
                            <View
                              key={p.key}
                              style={[
                                s.phasePill,
                                { backgroundColor: colors.primary + "12", borderColor: colors.primary + "28" },
                              ]}
                            >
                              <Text style={[s.phasePillText, { color: colors.primary }]}>
                                {p.name}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}
          </Animated.View>
        </ScrollView>
      )}

      {/* ── Builder edit view ──────────────────────────────────────────────── */}

      {section === "builder" && !!editingRecipe && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: 24,
              paddingBottom: insets.bottom + tabBarPad + 60,
              paddingHorizontal: 20,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View entering={FadeIn.duration(300)}>
              {/* Header row */}
              <View style={s.editHeader}>
                <Pressable
                  onPress={cancelEdit}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
                <Text style={[s.editTitle, { color: colors.foreground }]}>
                  {isNewRecipe ? "New Recipe" : "Edit Recipe"}
                </Text>
                <Pressable
                  onPress={saveRecipe}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={[s.saveLink, { color: colors.accent }]}>Save</Text>
                </Pressable>
              </View>

              {/* Recipe name */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Recipe Name</Text>
              <TextInput
                style={[
                  s.nameInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    fontFamily: "Inter_500Medium",
                  },
                ]}
                placeholder="e.g. Saturday Country Loaf"
                placeholderTextColor={colors.mutedForeground}
                value={editingRecipe.name}
                onChangeText={updateEditName}
                returnKeyType="done"
              />
               <YieldPill
                 isBuilder={true}
                 value={editingRecipe.yieldValue || ""}
                 onChangeValue={t => setEditingRecipe({ ...editingRecipe, yieldValue: t })}
               />

              {/* Phase list */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 24 }]}>
                Phases
              </Text>

              {editingRecipe.phases.length === 0 && (
                <View
                  style={[
                    s.emptyPhasesHint,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <Text style={[s.emptyPhasesText, { color: colors.mutedForeground }]}>
                    Tap "Add Phase" below to start building your recipe. Each phase can hold its own ingredients and instructions.
                  </Text>
                </View>
              )}

              <View style={{ gap: 12, marginTop: editingRecipe.phases.length > 0 ? 0 : 12 }}>
                {editingRecipe.phases.map((phase, pi) => (
                  <Animated.View
                    key={phase.key}
                    entering={FadeInDown.delay(pi * 30).duration(300)}
                    style={[
                      s.editPhaseCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <View style={s.editPhaseHeader}>
                      <View style={s.editPhaseHeaderLeft}>
                        <View
                          style={[s.phaseNumBadge, { backgroundColor: colors.primary + "18" }]}
                        >
                          <Text style={[s.phaseNumText, { color: colors.primary }]}>
                            {pi + 1}
                          </Text>
                        </View>
                        <Text style={[s.editPhaseName, { color: colors.foreground }]}>
                          {phase.name}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          if (Platform.OS === "web") {
                            removePhaseFromEdit(phase.key);
                          } else {
                            Alert.alert(
                              "Remove Phase",
                              `Remove "${phase.name}" from this recipe?`,
                              [
                                { text: "Cancel", style: "cancel" },
                                { text: "Remove", style: "destructive", onPress: () => removePhaseFromEdit(phase.key) },
                              ]
                            );
                          }
                        }}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                      >
                        <Feather name="x" size={16} color={colors.mutedForeground} />
                      </Pressable>
                    </View>

                    <Text style={[s.subFieldLabel, { color: colors.mutedForeground }]}>
                      Ingredients
                    </Text>
                    <TextInput
                      style={[
                        s.phaseTextarea,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 500 g bread flour, 350 g water, 100 g levain…"
                      placeholderTextColor={colors.mutedForeground}
                      value={phase.ingredients}
                      onChangeText={(v) => updatePhaseField(phase.key, "ingredients", v)}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      scrollEnabled={true} // Allow scroll once content exceeds maxHeight
                    />

                    <Text style={[s.subFieldLabel, { color: colors.mutedForeground, marginTop: 10 }]}>
                      Instructions
                    </Text>
                    <TextInput
                      style={[
                        s.phaseTextarea,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. Mix until shaggy, autolyse 30 min, then add salt…"
                      placeholderTextColor={colors.mutedForeground}
                      value={phase.instructions}
                      onChangeText={(v) => updatePhaseField(phase.key, "instructions", v)}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      scrollEnabled={true} // Allow scroll once content exceeds maxHeight
                    />
                  </Animated.View>
                ))}
              </View>

              {/* Add phase button */}
              {availablePhases.length > 0 && (
                <Pressable
                  onPress={() => { setPickerSelections({}); setShowPhasePicker(true); }}
                  style={({ pressed }) => [
                    s.addPhaseBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      opacity: pressed ? 0.7 : 1,
                      marginTop: 14,
                    },
                  ]}
                >
                  <Feather name="plus" size={14} color={colors.accent} />
                  <Text style={[s.addPhaseBtnText, { color: colors.accent }]}>
                    Add Phase
                  </Text>
                  <Text style={[s.addPhaseHint, { color: colors.mutedForeground }]}>
                    {availablePhases.length} remaining
                  </Text>
                </Pressable>
              )}

              {/* Delete (existing recipes only) */}
              {!isNewRecipe && (
                <Pressable
                  onPress={() => deleteRecipe(editingRecipe.id)}
                  style={({ pressed }) => [s.deleteLinkRow, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <Feather name="trash-2" size={14} color={colors.destructive ?? "#C0392B"} />
                  <Text style={[s.deleteLink, { color: colors.destructive ?? "#C0392B" }]}>
                    Delete Recipe
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          </ScrollView>
          {/* ── Builder FAB: floating save button (v1.0.11) ─────────────── */}
          <Pressable
            onPress={saveRecipe}
            style={[
              s.fab,
              {
                bottom: insets.bottom + tabBarPad + 16,
                backgroundColor: colors.primary,
              },
            ]}
          >
            <Feather name="save" size={24} color={colors.primaryForeground} />
          </Pressable>
        </KeyboardAvoidingView>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RUNNER SECTION                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* ── Runner: no bake, no recipe selected ──────────────────────────── */}

      {section === "runner" && !bake && !selectedRecipe && (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 40,
            paddingHorizontal: 20,
            flex: 1,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.mutedForeground}
            />
          }
        >
          <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { color: colors.foreground, marginBottom: 4 }]}>
              Recipe Runner
            </Text>
            <Text style={[s.pageSubtitle, { color: colors.mutedForeground, marginBottom: 32 }]}>
              pick a recipe and track your bake
            </Text>

            {recipes.length === 0 ? (
              <View style={[s.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="book-open" size={28} color={colors.mutedForeground} />
                <Text style={[s.emptyTitle, { color: colors.foreground }]}>No recipes saved</Text>
                <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
                  Build a recipe first — then you can run it and track your bake here.
                </Text>
                <Pressable
                  onPress={() => { setSection("builder"); openNewRecipe(); }}
                  style={({ pressed }) => [
                    s.primaryBtn,
                    { backgroundColor: colors.primary, borderRadius: 10, opacity: pressed ? 0.8 : 1, marginTop: 8, paddingHorizontal: 20 },
                  ]}
                >
                  <Feather name="plus" size={15} color={colors.primaryForeground} />
                  <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
                    Create Recipe
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => setShowRecipePicker(true)}
                  style={({ pressed }) => [
                    s.primaryBtn,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: 12,
                      opacity: pressed ? 0.85 : 1,
                      marginBottom: 16,
                    },
                  ]}
                >
                  <Feather name="list" size={16} color={colors.primaryForeground} />
                  <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
                    Select Recipe
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setSection("builder")}
                  style={({ pressed }) => [s.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[s.ghostBtnText, { color: colors.mutedForeground }]}>
                    Go to Recipe Builder
                  </Text>
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                </Pressable>
              </>
            )}
          </Animated.View>
        </ScrollView>
      )}

      {/* ── Runner: recipe selected, pre-start confirm ────────────────────── */}

      {section === "runner" && !bake && !!selectedRecipe && (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 60,
            paddingHorizontal: 20,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.mutedForeground}
            />
          }
        >
          <Animated.View entering={FadeIn.duration(300)}>
            <View style={s.preStartHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.preStartLabel, { color: colors.mutedForeground }]}>Baking from</Text>
                <Text style={[s.preStartName, { color: colors.foreground }]} numberOfLines={2}>
                  {selectedRecipe.name}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedRecipe(null)}
                style={({ pressed }) => [
                  s.changeBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[s.changeBtnText, { color: colors.mutedForeground }]}>Change</Text>
              </Pressable>
            </View>

            {!!selectedRecipe.yieldValue && (
              <View style={{ marginBottom: 12 }}>
                <YieldPill isBuilder={false} value={selectedRecipe.yieldValue} />
              </View>
            )}

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginBottom: 10 }]}>
              Confirm phases for this bake
            </Text>
            <Text style={[s.preStartHint, { color: colors.mutedForeground, marginBottom: 14 }]}>
              Toggle off any phases you want to skip today.
            </Text>

            <View style={{ gap: 8 }}>
              {selectedRecipe.phases.map((phase, pi) => {
                const enabled = !!runPhaseEnabled[phase.key];
                return (
                  <Pressable
                    key={phase.key}
                    onPress={() => toggleRunPhase(phase.key)}
                    style={({ pressed }) => [
                      s.confirmPhaseRow,
                      {
                        backgroundColor: colors.card,
                        borderColor: enabled ? colors.primary + "40" : colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        s.confirmCheck,
                        {
                          borderColor: enabled ? colors.primary : colors.border,
                          backgroundColor: enabled ? colors.primary : "transparent",
                        },
                      ]}
                    >
                      {enabled && <Ionicons name="checkmark" size={12} color={colors.primaryForeground} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          s.confirmPhaseName,
                          {
                            color: enabled ? colors.foreground : colors.mutedForeground,
                            fontFamily: enabled ? "Inter_500Medium" : "Inter_400Regular",
                          },
                        ]}
                      >
                        {phase.name}
                      </Text>
                      {!!phase.ingredients && (
                        <Text
                          style={[s.confirmPhaseSub, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {phase.ingredients}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={startBake}
              style={({ pressed }) => [
                s.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  opacity: pressed ? 0.85 : 1,
                  marginTop: 24,
                },
              ]}
            >
              <Feather name="play" size={16} color={colors.primaryForeground} />
              <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
                Start Bake
              </Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      )}

      {/* ── Runner: active bake tracker ───────────────────────────────────── */}

      {section === "runner" && !!bake && (
        <ScrollView
          ref={runnerScrollRef}
          contentContainerStyle={{
            paddingTop: 20,
            // Extra 96px so the last phase card clears the FAB
            paddingBottom: insets.bottom + tabBarPad + 128,
            paddingHorizontal: 20,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.mutedForeground}
            />
          }
        >
          {/* Compact header */}
          <View style={s.trackerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[s.trackerRecipeName, { color: colors.mutedForeground }]}>
                {bake.recipeName}
              </Text>
              <View style={s.statusRow}>
                {activePhase ? (
                  <>
                    <View style={[s.activeDot, { backgroundColor: colors.accent }]} />
                    <Text style={[s.statusText, { color: colors.foreground }]}>
                      {activePhase.name}
                    </Text>
                    <Text style={[s.timerInline, { color: colors.accent }]}>
                      {formatTimer(elapsed[activePhase.key] ?? 0)}
                    </Text>
                  </>
                ) : allDone ? (
                  <Text style={[s.statusText, { color: colors.accent }]}>Bake complete</Text>
                ) : (
                  <Text style={[s.statusText, { color: colors.mutedForeground }]}>
                    Start a phase below
                  </Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <Pressable
                onPress={shareBakePdf}
                style={({ pressed }) => [
                  s.newBakeBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
                ]}
                accessibilityLabel="Share bake summary as PDF"
                accessibilityRole="button"
              >
                <Feather name="share" size={13} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={printBake}
                style={({ pressed }) => [
                  s.newBakeBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
                ]}
              >
                <Feather name="printer" size={13} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={resetBake}
                style={({ pressed }) => [
                  s.newBakeBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
                ]}
              >
                <Text style={[s.newBakeBtnText, { color: colors.mutedForeground }]}>New Bake</Text>
              </Pressable>
            </View>
          </View>

          {/* Recipe version warning */}
          {recipeStale && (
            <View style={[s.staleWarning, { backgroundColor: "#FFF3CD", borderColor: "#FBBF24" }]}>
              <Feather name="alert-triangle" size={13} color="#92400E" />
              <Text style={[s.staleWarningText, { color: "#92400E" }]}>
                This recipe was updated after the bake started. Phases shown are from the original version.
              </Text>
            </View>
          )}

          {/* Scale factor selector */}
          <View style={[s.scaleRow, { borderColor: colors.border }]}>
            <Text style={[s.scaleLabel, { color: colors.mutedForeground }]}>Scale</Text>
            <View style={s.scalePills}>
              {[0.5, 0.75, 1, 1.5, 2, 3].map((m) => (
                <Pressable
                  key={m}
                  onPress={() => { setScaleMultiplier(m); Haptics.selectionAsync(); }}
                  style={[
                    s.scalePill,
                    {
                      backgroundColor: scaleMultiplier === m ? colors.primary : colors.muted,
                      borderColor: scaleMultiplier === m ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.scalePillText,
                      { color: scaleMultiplier === m ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {m === 1 ? "1×" : `${m}×`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Segment bar */}
          <View style={{ marginBottom: 24 }}>
            <SegmentBar phases={bake.phases} />
            <Text style={[s.segmentCount, { color: colors.mutedForeground }]}>
              {completedCount} / {bake.phases.length} phases
            </Text>
          </View>

          {/* Phase cards */}
          <View
            style={{ gap: 8 }}
            onLayout={(e) => { phasesContainerY.current = e.nativeEvent.layout.y; }}
          >
            {bake.phases.map((phase) => {
              const isDone = !!phase.completedAt;
              const isActive = !!phase.startedAt && !phase.completedAt;
              const isExpanded = expandedDone.has(phase.key);
              const isRecipeExpanded = expandedRecipeInfo.has(phase.key);
              const hasRecipeInfo = !!(phase.ingredients || phase.instructions);

              // Pending
              if (!phase.startedAt) {
                const isPendingExpanded = expandedPending.has(phase.key);
                const hasPendingInfo = !!(phase.ingredients || phase.instructions);
                return (
                  <PhaseHighlight
                    key={`${phase.key}-pending`}
                    active={nextHighlightKey === phase.key}
                    accentColor={colors.accent}
                  >
                  <View
                    style={[s.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onLayout={(e) => { phaseCardYOffsets.current[phase.key] = e.nativeEvent.layout.y; }}
                  >
                    {/* Row: tap the name/chevron area to expand recipe info; Start is a separate button */}
                    <Pressable
                      onPress={() => hasPendingInfo && toggleExpandPending(phase.key)}
                      style={s.compactRow}
                    >
                      <Ionicons name="ellipse-outline" size={18} color={colors.border} />
                      <Text
                        style={[
                          s.compactName,
                          { color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1 },
                        ]}
                      >
                        {phase.name}
                      </Text>
                      {hasPendingInfo && (
                        <Feather
                          name={isPendingExpanded ? "chevron-up" : "chevron-down"}
                          size={14}
                          color={colors.mutedForeground}
                          style={{ marginRight: 6 }}
                        />
                      )}
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); startPhase(phase.key); }}
                        style={({ pressed }) => [
                          s.startBtn,
                          { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <Text style={[s.startBtnText, { color: colors.foreground }]}>Start</Text>
                        <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
                      </Pressable>
                    </Pressable>
                    {/* Expanded recipe info — ingredients and/or instructions */}
                    {isPendingExpanded && hasPendingInfo && (
                      <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
                        {!!phase.ingredients && (
                          <>
                            <Text style={[s.noReadings, { color: colors.mutedForeground, marginBottom: 4 }]}>
                              Ingredients
                            </Text>
                            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" }}>
                              {phase.ingredients}
                            </Text>
                          </>
                        )}
                        {!!phase.instructions && (
                          <>
                            <Text style={[s.noReadings, { color: colors.mutedForeground, marginTop: phase.ingredients ? 10 : 0, marginBottom: 4 }]}>
                              Instructions
                            </Text>
                            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" }}>
                              {phase.instructions}
                            </Text>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                  </PhaseHighlight>
                );
              }

              // Done — wrap in Animated.View so FadeIn fires when this phase
              // first transitions from active to done (key suffix changes force remount).
              if (isDone) {
                return (
                  <Animated.View
                    key={`${phase.key}-done`}
                    entering={recentlyCompletedKey === phase.key ? FadeIn.duration(300) : undefined}
                    onLayout={(e) => { phaseCardYOffsets.current[phase.key] = e.nativeEvent.layout.y; }}
                  >
                  <Pressable
                    onPress={() => toggleExpandDone(phase.key)}
                    style={({ pressed }) => [
                      s.compactCard,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <View style={s.compactRow}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      <Text style={[s.compactName, { color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }]}>
                        {phase.name}
                      </Text>
                      <Text style={[s.doneTime, { color: colors.mutedForeground }]}>
                        {phase.startedAt && phase.completedAt
                          ? formatDone(phase.completedAt - phase.startedAt)
                          : ""}
                      </Text>
                      {phase.readings.length > 0 && (
                        <View style={[s.readingCountBadge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                          <Text style={[s.readingCountText, { color: colors.mutedForeground }]}>
                            {phase.readings.length}
                          </Text>
                        </View>
                      )}
                      <Feather
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={colors.mutedForeground}
                      />
                    </View>
                    {isExpanded && (
                      <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
                        {VOLUME_TRACKING_PHASE_KEYS.has(phase.key) && (!!phase.startVolume || phase.readings.some((r) => r.volume)) && (
                          <View style={[s.volRangeRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                            <Text style={[s.volRangeLabel, { color: colors.mutedForeground }]}>Volume</Text>
                            <Text style={[s.volRangeValue, { color: colors.foreground }]}>
                              {phase.startVolume || "—"} → {phase.readings.filter((r) => r.volume).at(-1)?.volume || "—"}
                            </Text>
                          </View>
                        )}
                        {phase.readings.length > 0
                          ? phase.readings.map((r) => (
                              <ReadingRow
                                key={r.id}
                                reading={r}
                                colors={colors}
                                onDelete={() => deleteReading(phase.key, r.id)}
                              />
                            ))
                          : <Text style={[s.noReadings, { color: colors.mutedForeground }]}>No readings logged</Text>}
                        <Pressable
                          onPress={(e) => { e.stopPropagation?.(); openReadingModal(phase.key); }}
                          style={({ pressed }) => [s.addReadingBtn, { opacity: pressed ? 0.6 : 1 }]}
                        >
                          <Feather name="plus" size={12} color={colors.mutedForeground} />
                          <Text style={[s.addReadingText, { color: colors.mutedForeground }]}>Add reading</Text>
                        </Pressable>
                        {/* Recipe builder info — shown at the bottom of an expanded done card */}
                        {(!!phase.ingredients || !!phase.instructions) && (
                          <View style={{ marginTop: 12 }}>
                            {!!phase.ingredients && (
                              <>
                                <Text style={[s.noReadings, { color: colors.mutedForeground, marginBottom: 4 }]}>
                                  Ingredients
                                </Text>
                                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" }}>
                                  {phase.ingredients}
                                </Text>
                              </>
                            )}
                            {!!phase.instructions && (
                              <>
                                <Text style={[s.noReadings, { color: colors.mutedForeground, marginTop: phase.ingredients ? 10 : 0, marginBottom: 4 }]}>
                                  Instructions
                                </Text>
                                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" }}>
                                  {phase.instructions}
                                </Text>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </Pressable>
                  </Animated.View>
                );
              }

              // Active
              return (
                <View
                  key={`${phase.key}-active`}
                  style={[s.activeCard, { backgroundColor: colors.card, borderColor: colors.accent }]}
                  onLayout={(e) => { phaseCardYOffsets.current[phase.key] = e.nativeEvent.layout.y; }}
                >
                  <View style={[s.activeStrip, { backgroundColor: colors.accent }]} />
                  <View style={s.activeHeader}>
                    <View style={s.compactRow}>
                      <Ionicons name="radio-button-on" size={18} color={colors.accent} />
                      <Text style={[s.compactName, { color: colors.foreground, fontFamily: "Inter_600SemiBold", flex: 1 }]}>
                        {phase.name}
                      </Text>
                      <Text style={[s.timerLarge, { color: colors.accent }]}>
                        {formatTimer(elapsed[phase.key] ?? 0)}
                      </Text>
                    </View>
                  </View>

                  {/* Starting volume — only for fermentation/proofing phases that track rise */}
                  {VOLUME_TRACKING_PHASE_KEYS.has(phase.key) && (
                  <View style={[s.startVolRow, { borderTopColor: colors.border }]}>
                    <Text style={[s.startVolLabel, { color: colors.mutedForeground }]}>Start vol.</Text>
                    <TextInput
                      style={[s.startVolInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                      placeholder="—"
                      placeholderTextColor={colors.mutedForeground}
                      value={phaseStartVolumes[phase.key] ?? ""}
                      onChangeText={(v) => setPhaseStartVolumes((prev) => ({ ...prev, [phase.key]: v }))}
                      onEndEditing={() => updatePhaseStartVolume(phase.key, phaseStartVolumes[phase.key] ?? "")}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                    />
                  </View>
                  )}

                 {phase.key === "stretching_folding" && (
                   <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: -4, paddingLeft: 12 }}>
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
                           />
                         );
                       })}
                     </View>
                   </View>
                 )}

                  {/* Recipe info toggle */}
                  {hasRecipeInfo && (
                    <Pressable
                      onPress={() => toggleExpandRecipeInfo(phase.key)}
                      style={({ pressed }) => [
                        s.recipeInfoToggle,
                        { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Feather
                        name="book-open"
                        size={12}
                        color={isRecipeExpanded ? colors.accent : colors.mutedForeground}
                      />
                      <Text
                        style={[
                          s.recipeInfoToggleText,
                          {
                            color: isRecipeExpanded ? colors.accent : colors.mutedForeground,
                          },
                        ]}
                      >
                        Phase specs
                      </Text>
                      <Feather
                        name={isRecipeExpanded ? "chevron-up" : "chevron-down"}
                        size={12}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                  )}

                  {isRecipeExpanded && (
                    <View style={[s.recipeInfoSection, { borderTopColor: colors.border }]}>
                      {/*
                       * Scale banner — shown whenever a non-1× multiplier is active.
                       * The message confirms that mass/volume values in the text below
                       * have already been auto-scaled by the parser; users do NOT need
                       * to do the math themselves.  Intensive properties (time, temp,
                       * fold counts etc.) are unchanged and shown at their original values.
                       */}
                      {scaleMultiplier !== 1 && (
                        <View style={[s.scaleBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}>
                          <Text style={[s.scaleBadgeText, { color: colors.primary }]}>
                            {scaleMultiplier}× — mass & volume quantities auto-scaled below
                          </Text>
                        </View>
                      )}

                      {/*
                       * Ingredients — passed through scalePhaseText() so every mass/
                       * volume token (g, kg, ml, l, oz, lbs) is multiplied by the
                       * active scaleMultiplier at render time.  The original stored
                       * string is never mutated; scaling is purely display-side.
                       */}
                      {!!phase.ingredients && (
                        <>
                          <View style={s.ingredientsLabelRow}>
                            <Text style={[s.recipeInfoLabel, { color: colors.mutedForeground }]}>Ingredients</Text>
                            <Pressable
                              onPress={async () => {
                                const text = scalePhaseText(phase.ingredients!, scaleMultiplier);
                                await Clipboard.setStringAsync(text);
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setCopiedIngredientsKey(phase.key);
                                setTimeout(() => setCopiedIngredientsKey(null), 2000);
                              }}
                              style={({ pressed }) => [s.copyBtn, { opacity: pressed ? 0.6 : 1 }]}
                              hitSlop={8}
                              accessibilityLabel="Copy ingredients to clipboard"
                              accessibilityRole="button"
                            >
                              <Feather
                                name={copiedIngredientsKey === phase.key ? "check" : "copy"}
                                size={11}
                                color={copiedIngredientsKey === phase.key ? colors.primary : colors.mutedForeground}
                              />
                              <Text style={[s.copyBtnText, { color: copiedIngredientsKey === phase.key ? colors.primary : colors.mutedForeground }]}>
                                {copiedIngredientsKey === phase.key ? "Copied!" : "Copy"}
                              </Text>
                            </Pressable>
                          </View>
                          <Text style={[s.recipeInfoText, { color: colors.foreground }]}>
                            {scalePhaseText(phase.ingredients, scaleMultiplier)}
                          </Text>
                        </>
                      )}

                      {/*
                       * Instructions — also scaled so that inline quantities such as
                       * "dissolve 10g salt in 50 ml water" stay consistent with the
                       * chosen batch size.  Time, temperature, and process steps are
                       * left verbatim because they are Intensive Properties.
                       */}
                      {!!phase.instructions && (
                        <>
                          <Text style={[s.recipeInfoLabel, { color: colors.mutedForeground, marginTop: phase.ingredients ? 10 : 0 }]}>Instructions</Text>
                          <Text style={[s.recipeInfoText, { color: colors.foreground }]}>
                            {scalePhaseText(phase.instructions, scaleMultiplier)}
                          </Text>
                        </>
                      )}

                      {/* Share phase spec as PDF */}
                      <Pressable
                        onPress={() => sharePhaseAsPdf(phase)}
                        style={({ pressed }) => [
                          s.sharePhaseBtn,
                          { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                        ]}
                        accessibilityLabel={`Share ${phase.name} spec sheet as PDF`}
                        accessibilityRole="button"
                      >
                        <Feather name="share-2" size={12} color={colors.mutedForeground} />
                        <Text style={[s.sharePhaseText, { color: colors.mutedForeground }]}>
                          Export spec sheet
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  <View style={s.activeActions}>
                    {/* Log Reading is not useful during the actual oven-bake phase */}
                    {phase.key !== "the_bake" && (
                    <Pressable
                      onPress={() => openReadingModal(phase.key)}
                      style={({ pressed }) => [
                        s.actionBtn,
                        { borderColor: colors.accent + "50", backgroundColor: colors.accent + "12", flex: 1, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Feather name="thermometer" size={13} color={colors.accent} />
                      <Text style={[s.actionBtnText, { color: colors.accent }]}>Log Reading</Text>
                    </Pressable>
                    )}
                    <Pressable
                      onPress={() => completePhase(phase.key)}
                      style={({ pressed }) => [
                        s.actionBtn,
                        { borderColor: colors.primary + "50", backgroundColor: colors.primary + "12", flex: 1, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Ionicons name="checkmark" size={13} color={colors.primary} />
                      <Text style={[s.actionBtnText, { color: colors.primary }]}>Complete</Text>
                    </Pressable>
                  </View>

                  {phase.readings.length > 0 && (
                    <View style={[s.activeReadings, { borderTopColor: colors.border }]}>
                      {phase.readings.map((r) => (
                        <ReadingRow key={r.id} reading={r} colors={colors} />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {allDone && (
            <Animated.View
              entering={FadeInDown.duration(400)}
              style={[s.allDoneCard, { backgroundColor: colors.accent + "14", borderColor: colors.accent + "35" }]}
            >
              <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
              <Text style={[s.allDoneTitle, { color: colors.foreground }]}>Bake complete</Text>
              <Text style={[s.allDoneBody, { color: colors.mutedForeground }]}>
                All phases logged. Tap New Bake to start fresh.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={shareBakePdf}
                  style={({ pressed }) => [
                    s.printBakeBtn,
                    { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10", opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityLabel="Share bake summary as PDF"
                  accessibilityRole="button"
                >
                  <Feather name="share" size={14} color={colors.primary} />
                  <Text style={[s.printBakeBtnText, { color: colors.primary }]}>Share PDF</Text>
                </Pressable>
                <Pressable
                  onPress={printBake}
                  style={({ pressed }) => [
                    s.printBakeBtn,
                    { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10", opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Feather name="printer" size={14} color={colors.primary} />
                  <Text style={[s.printBakeBtnText, { color: colors.primary }]}>Print</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      )}

      {/* ── Floating Action Button: bake notepad (runner only) ─────────────── */}
      {section === "runner" && !!bake && (
        <Pressable
          onPress={openNotesOverlay}
          style={({ pressed }) => [
            s.fab,
            {
              backgroundColor: colors.primary,
              bottom: insets.bottom + tabBarPad + 16,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityLabel="Open bake notes"
          accessibilityRole="button"
        >
          {/* Pen/journal icon — indicates a writing action */}
          <Feather name="edit-3" size={22} color={colors.primaryForeground} />
          {/* Dot indicator when notes have been written */}
          {bakeNotes.length > 0 && (
            <View style={[s.fabDot, { backgroundColor: colors.accent }]} />
          )}
        </Pressable>
      )}

      {/* ── Notes overlay modal ────────────────────────────────────────────── */}
      <Modal
        visible={showNotesOverlay}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNotesOverlay(false)}
      >
        {/* <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, backgroundColor: colors.background }}
        > */}

          {/* Header */}
          <View style={[s.sheetHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Bake Notes</Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              {/* Save button */}
              <Pressable
                onPress={saveNotesOverlay}
                style={({ pressed }) => [
                  s.notesSaveBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityLabel="Save notes"
              >
                <Text style={[s.notesSaveBtnText, { color: colors.primaryForeground }]}>Save</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowNotesOverlay(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Ionicons name="close" size={22} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          {/* Segmented notepad: handles its own text/chip segments + tag dock */}
          <SegmentedNotepad
            initialValue={overlayDraft}
            onChange={setOverlayDraft}
            phases={bake?.phases ?? []}
            colors={colors}
            bottomInset={insets.bottom}
          />
        {/* </KeyboardAvoidingView> */}
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE PICKER MODAL (builder "Add Phase")                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <Modal
        visible={showPhasePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPhasePicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={[
              s.sheetHeader,
              {
                borderBottomColor: colors.border,
                paddingTop: insets.top + 20,
              },
            ]}
          >
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Add Phase</Text>
            <Pressable
              onPress={() => { setShowPhasePicker(false); setPickerSelections({}); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 80 }}
          >
            {availableCategories.map((cat) => (
              <View key={cat.key}>
                <View style={[s.phaseGroupHeader, { borderBottomColor: colors.border, backgroundColor: colors.muted }]}>
                  <Text style={[s.phaseGroupName, { color: colors.mutedForeground }]}>
                    {cat.name.toUpperCase()}
                  </Text>
                </View>
                {cat.phases.map((def) => {
                  const selected = !!pickerSelections[def.key];
                  return (
                    <Pressable
                      key={def.key}
                      onPress={() => togglePickerPhase(def.key)}
                      style={({ pressed }) => [
                        s.sheetRow,
                        { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.sheetRowName, { color: colors.foreground }]}>{def.name}</Text>
                        <Text style={[s.sheetRowHint, { color: colors.mutedForeground }]}>{def.hint}</Text>
                      </View>
                      {/* Circular checkbox that fills with accent when this phase is selected */}
                      <View style={[
                        s.pickerCheckbox,
                        {
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.accent : "transparent",
                        },
                      ]}>
                        {selected && <Feather name="check" size={12} color={colors.card} />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          {/* Continue button — appears as soon as at least one phase is checked */}
          {Object.values(pickerSelections).some(Boolean) && (
            <View style={[s.pickerFooter, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
              <Pressable
                onPress={confirmPhaseSelections}
                style={[s.pickerContinueBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={[s.pickerContinueBtnText, { color: "#fff" }]}>
                  Add {Object.values(pickerSelections).filter(Boolean).length} Phase
                  {Object.values(pickerSelections).filter(Boolean).length !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RECIPE PICKER MODAL (runner "Select Recipe")                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <Modal
        visible={showRecipePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRecipePicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={[
              s.sheetHeader,
              { borderBottomColor: colors.border, paddingTop: insets.top + 20 },
            ]}
          >
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Select Recipe</Text>
            <Pressable
              onPress={() => setShowRecipePicker(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 24 }}
          >
            {recipes.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => selectRecipeForRun(r)}
                style={({ pressed }) => [
                  s.sheetRow,
                  { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.sheetRowName, { color: colors.foreground }]}>{r.name}</Text>
                  <Text style={[s.sheetRowHint, { color: colors.mutedForeground }]}>
                    {r.phases.length} phase{r.phases.length !== 1 ? "s" : ""} · {formatDate(r.createdAt)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* READING MODAL                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <Modal
        visible={showReadingModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReadingModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, backgroundColor: colors.background }}
        >
          <ScrollView
            contentContainerStyle={[
              s.modalContent,
              { paddingTop: insets.top + webTop + 24, paddingBottom: insets.bottom + 32 },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.modalHeader}>
              <Pressable
                onPress={() => setShowReadingModal(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Ionicons name="close" size={24} color={colors.foreground} />
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={[s.modalTitle, { color: colors.foreground }]}>Log Reading</Text>
                {readingModalPhase && (
                  <Text style={[s.modalSubtitle, { color: colors.mutedForeground }]}>
                    {readingModalPhase.name}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={saveReading}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Text style={[s.saveLink, { color: colors.accent }]}>Save</Text>
              </Pressable>
            </View>

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
            <TextInput
              style={[
                s.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  borderRadius: 10,
                },
              ]}
              placeholder="e.g. 5.2"
              placeholderTextColor={colors.mutedForeground}
              value={readPH}
              onChangeText={setReadPH}
              keyboardType="decimal-pad"
            />

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Temperature</Text>
            <View style={s.tempRow}>
              <TextInput
                style={[
                  s.input,
                  {
                    flex: 1,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    fontFamily: "Inter_400Regular",
                    borderRadius: 10,
                  },
                ]}
                placeholder="e.g. 76"
                placeholderTextColor={colors.mutedForeground}
                value={readTemp}
                onChangeText={setReadTemp}
                keyboardType="decimal-pad"
              />
              <View
                style={[
                  s.unitToggle,
                  { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 10 },
                ]}
              >
                {(["F", "C"] as const).map((u) => (
                  <Pressable
                    key={u}
                    onPress={() => setReadTempUnit(u)}
                    style={[
                      s.unitBtn,
                      { backgroundColor: readTempUnit === u ? colors.primary : "transparent", borderRadius: 8 },
                    ]}
                  >
                    <Text
                      style={[
                        s.unitBtnText,
                        { color: readTempUnit === u ? colors.primaryForeground : colors.mutedForeground },
                      ]}
                    >
                      °{u}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Volume field only shown for phases that track fermentation rise */}
            {VOLUME_TRACKING_PHASE_KEYS.has(readingPhaseKey ?? "") && (
            <>
            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Volume</Text>
            <TextInput
              style={[
                s.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  borderRadius: 10,
                },
              ]}
              placeholder="e.g. 450 mL"
              placeholderTextColor={colors.mutedForeground}
              value={readVolume}
              onChangeText={setReadVolume}
              keyboardType="decimal-pad"
            />
            </>
            )}

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
              Note (optional)
            </Text>
            <TextInput
              style={[
                s.inputMulti,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  borderRadius: 10,
                },
              ]}
              placeholder="e.g. dough is extensible, nice window pane"
              placeholderTextColor={colors.mutedForeground}
              value={readNote}
              onChangeText={setReadNote}
              multiline
              numberOfLines={2}
              returnKeyType="done"
            />

          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      {showNudge && (
        <NudgeBanner
          onNameMyData={() => setShowAuthModal(true)}
          onDismiss={() => setShowNudge(false)}
        />
      )}
      <AuthModal
        visible={showAuthModal}
        currentUser={currentUser}
        onClose={() => setShowAuthModal(false)}
        onAuthChange={(user) => {
          setCurrentUser(user);
          if (user) setShowNudge(false);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Section toggle
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
  sectionBtnText: { fontSize: 14 },

  // Builder list
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  keycap: {
    minWidth: 30,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  keycapText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  // Recipe card
  recipeCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  recipeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recipeName: { fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1 },
  recipeCardMeta: { flexDirection: "row", gap: 2 },
  recipeMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  phasePillRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 },
  phasePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  phasePillText: { fontSize: 11, fontFamily: "Inter_500Medium" },

  // Empty state
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
  },

  // Builder edit view
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  editTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  saveLink: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  nameInput: {
    height: 50,
    paddingHorizontal: 14,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 10,
  },
  emptyPhasesHint: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
  },
  emptyPhasesText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  editPhaseCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  editPhaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  editPhaseHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  phaseNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  phaseNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  editPhaseName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  subFieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addPhaseBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  addPhaseHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    marginTop: 28,
    paddingVertical: 12,
  },
  deleteLink: { fontSize: 14, fontFamily: "Inter_500Medium" },

  // Runner pre-start
  preStartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  preStartLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 2 },
  preStartName: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
  },
  changeBtnText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  preStartHint: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 0 },
  confirmPhaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  confirmCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmPhaseName: { fontSize: 15 },
  confirmPhaseSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Runner tracker
  trackerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  trackerRecipeName: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  timerInline: { fontSize: 15, fontFamily: "Inter_600SemiBold", letterSpacing: -0.3 },
  newBakeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  newBakeBtnText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  segmentCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Phase cards
  compactCard: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compactName: { fontSize: 15 },
  doneTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginRight: 4 },
  readingCountBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  readingCountText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  expandedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  noReadings: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 4 },
  addReadingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  addReadingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  startBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  activeCard: { borderRadius: 10, borderWidth: 1.5, overflow: "hidden", position: "relative" },
  activeStrip: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  activeHeader: { paddingLeft: 3 },
  timerLarge: { fontSize: 16, fontFamily: "Inter_600SemiBold", letterSpacing: -0.5 },
  recipeInfoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recipeInfoToggleText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  recipeInfoSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 17,
    paddingTop: 12,
    paddingBottom: 12,
  },
  recipeInfoLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  recipeInfoText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  ingredientsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  copyBtnText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  sharePhaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sharePhaseText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  activeActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingLeft: 17,
    paddingBottom: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeReadings: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingLeft: 17,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },

  // Reading row
  readingRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, flexWrap: "wrap" },
  readingTime: { fontSize: 12, fontFamily: "Inter_400Regular", paddingTop: 3, minWidth: 62 },
  readingPills: { flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  readingNote: { fontSize: 12, fontFamily: "Inter_400Regular", paddingTop: 3, flex: 1 },

  // All done
  allDoneCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  allDoneTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  allDoneBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  // Buttons
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    gap: 10,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  ghostBtnText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  // Modals / sheets
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  sheetRowName: { fontSize: 16, fontFamily: "Inter_500Medium", marginBottom: 2 },
  sheetRowHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modalContent: { paddingHorizontal: 20 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5, textAlign: "center" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },

  // Stale warning
  staleWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  staleWarningText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },

  // Scale selector
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scaleLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, minWidth: 38 },
  scalePills: { flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 },
  scalePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  scalePillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scaleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 10,
  },
  scaleBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Phase group header in picker
  phaseGroupHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  phaseGroupName: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  input: { height: 48, paddingHorizontal: 14, fontSize: 16, borderWidth: 1 },
  inputMulti: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    minHeight: 72,
    textAlignVertical: "top",
  },
  tempRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    padding: 3,
    height: 48,
    alignItems: "center",
  },
  unitBtn: {
    paddingHorizontal: 12,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  unitBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Bake notes (legacy card styles kept in case referenced elsewhere)
  bakeNotesCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 14 },
  bakeNotesLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  bakeNotesInput: { fontSize: 14, lineHeight: 20, minHeight: 40, fontFamily: "Inter_400Regular" },

  // Floating Action Button (bake notepad)
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    // Subtle shadow for elevation
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  // Small dot on the FAB when notes exist
  fabDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Notes overlay — save/close header controls
  notesSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  notesSaveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },

  // Phase start volume
  startVolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 17,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  startVolLabel: { fontSize: 12, fontFamily: "Inter_500Medium", minWidth: 68 },
  startVolInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    height: 34,
  },

  // Volume range on done card
  volRangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 2,
  },
  volRangeLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    minWidth: 52,
  },
  volRangeValue: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  // Print button
  printBakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  printBakeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Multi-select phase picker
  pickerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerContinueBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  pickerContinueBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});