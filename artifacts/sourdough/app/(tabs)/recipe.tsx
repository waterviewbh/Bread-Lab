import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import AuthModal from "@/components/AuthModal";
import NudgeBanner from "@/components/NudgeBanner";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";
import SegmentedNotepad from "@/components/SegmentedNotepad";
import { YieldPill } from "@/components/YieldPill";
import {
  type Reading,
  type RecipePhaseConfig,
  type SavedRecipe,
  type BakePhase,
  type ActiveBake,
  PHASE_CATEGORIES,
  PHASE_DEFINITIONS,
  VOLUME_TRACKING_PHASE_KEYS,
  BAKE_KEY,
  BAKE_HISTORY_KEY,
  NUDGE_KEY,
} from "@/lib/recipeTypes";
import {
  scalePhaseText,
  formatTimer,
  formatDate,
} from "@/lib/recipeUtils";
import {
  loadAll as loadAllData,
  writeRecipesLocal,
  writeBakeLocal,
  upsertBakeRemote,
  upsertRecipeRemote,
  saveBakeToHistory as saveBakeToHistoryLib,
  addToRecipeTombstone,
  removeFromRecipeTombstone,
} from "@/lib/recipeStorage";
import {
  buildRecipeHtml,
  buildPhaseHtml,
  buildBakeHtml,
  printHtml,
  shareHtmlAsPdf,
} from "@/lib/recipeHtml";
import { SegmentBar } from "@/components/recipe/SegmentBar";
import { KeycapKey } from "@/components/recipe/KeycapKey";
//import { ReadingRow } from "@/components/recipe/ReadingRow";   Added earlier in this refactor so eliminating is curious
import {
  PendingPhaseCard,
  DonePhaseCard,
  ActivePhaseCard,
} from "@/components/recipe/PhaseCard";
import { useActiveBakeTimer } from "@/hooks/useActiveBakeTimer";
import { ReadingModal } from "@/components/recipe/ReadingModal";
import { PhasePickerModal } from "@/components/recipe/PhasePickerModal";
import { RecipePickerModal } from "@/components/recipe/RecipePickerModal";
import { RecipeBuilderListView } from "@/components/recipe/RecipeBuilderListView";
import { RecipeBuilderEditView } from "@/components/recipe/RecipeBuilderEditView";
import { RecipeRunnerSetupView } from "@/components/recipe/RecipeRunnerSetupView";
import { RecipeRunnerActiveView } from "@/components/recipe/RecipeRunnerActiveView";
import { computeBulkFermentState } from "@/lib/bulkFermentEngine";

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
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});
  const [bakeNotes, setBakeNotes] = useState("");
  // FAB notepad overlay
  const [showNotesOverlay, setShowNotesOverlay] = useState(false);
  const [overlayDraft, setOverlayDraft] = useState("");

  // ── Nudge banner ───────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

// Replaces the manual setInterval useEffect — keyed on bake.id for stability
const elapsed = useActiveBakeTimer(bake);

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
  const { recipes: loadedRecipes, bake: loadedBake } = await loadAllData();
  if (loadedRecipes.length > 0) setRecipes(loadedRecipes);
  if (loadedBake) setBake(loadedBake);
};

const persistRecipes = async (updated: SavedRecipe[]) => {
  setRecipes(updated);
  await writeRecipesLocal(updated);
};

const persistBake = async (updated: ActiveBake) => {
  setBake(updated);
  await writeBakeLocal(updated);
  upsertBakeRemote(updated).catch(() => {});
};

const saveBakeToHistory = async (b: ActiveBake) => {
  await saveBakeToHistoryLib(b, { reportSyncStart, reportSyncSuccess, reportSyncFailure });
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

  // Receives the ordered keys confirmed in PhasePickerModal
  const handleConfirmPhases = (keysToAdd: string[]) => {
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
    setShowPhasePicker(false);
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
    upsertRecipeRemote(saved)
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

  const printRecipe = async (r: SavedRecipe) => {
    try { await printHtml(buildRecipeHtml(r)); }
    catch { Alert.alert("Could not print", "Something went wrong while printing. Please try again."); }
  };

  const shareAsPdf = async (r: SavedRecipe) => {
    try { await shareHtmlAsPdf(buildRecipeHtml(r), `Share ${r.name}`); }
    catch { Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again."); }
  };

  const sharePhaseAsPdf = async (phase: BakePhase) => {
    const recipeName = bake?.recipeName ?? "Bake";
    try { await shareHtmlAsPdf(buildPhaseHtml(phase, recipeName, scaleMultiplier), `Share ${phase.name} spec`); }
    catch { Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again."); }
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
    setShowReadingModal(true);
  };

const handleSaveReading = async (reading: Reading) => {
  if (!bake || !readingPhaseKey)
    return;
  const phases = bake.phases.map((p) => {
    if (p.key !== readingPhaseKey)
      return p;
    const updatedReadings = [...p.readings, reading];
      // ── Bulk ferment: run PD engine after every new reading ──────────────
    if (p.key === "bulk_fermenting") {
      // Cast readings to BulkFermentReading — the UI ensures the extra fields
      // are present when the modal is in bulk mode; safe to cast here.
      const bulkReadings = updatedReadings as import("@/lib/recipeTypes").BulkFermentReading[];
      const updatedState = computeBulkFermentState(
        bulkReadings,
        p.bulkFermentState ?? {}
      );
      return { ...p, readings: updatedReadings, bulkFermentState: updatedState };
    }
  return { ...p, readings: updatedReadings };
  });
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

  const printBake = async () => {
    if (!bake) return;
    try { await printHtml(buildBakeHtml(bake, bakeNotes, completedCount)); }
    catch {}
  };

  const shareBakePdf = async () => {
    if (!bake) return;
    try { await shareHtmlAsPdf(buildBakeHtml(bake, bakeNotes, completedCount), `Share ${bake.recipeName} bake summary`); }
    catch { Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again."); }
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const activePhase = bake?.phases.find((p) => p.startedAt && !p.completedAt);
  const completedCount = bake?.phases.filter((p) => p.completedAt).length ?? 0;
  const allDone = !!bake && completedCount === bake.phases.length && bake.phases.length > 0;
  const availablePhases = editingRecipe
    ? PHASE_DEFINITIONS.filter((d) => !editingRecipe.phases.find((p) => p.key === d.key))
    : [];

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
      {/* BUILDER LIST VIEW                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {section === "builder" && !editingRecipe && (
        <RecipeBuilderListView
          recipes={recipes}
          displayedRecipes={displayedRecipes}
          populatedLetters={populatedLetters}
          letterFilter={letterFilter}
          refreshing={refreshing}
          onNewRecipe={openNewRecipe}
          onEditRecipe={openEditRecipe}
          onPrintRecipe={printRecipe}
          onShareRecipe={shareAsPdf}
          onSetLetterFilter={setLetterFilter}
          onRefresh={refresh}
        />
      )}

    {/* ── Builder edit view ──────────────────────────────────────────────── */}
    {section === "builder" && !!editingRecipe && (
      <RecipeBuilderEditView
        editingRecipe={editingRecipe}
        isNewRecipe={isNewRecipe}
        availablePhaseCount={availablePhases.length}
        onChangeName={updateEditName}
        onChangeYield={(t) => setEditingRecipe({ ...editingRecipe, yieldValue: t })}
        onUpdatePhaseField={updatePhaseField}
        onRemovePhase={removePhaseFromEdit}
        onOpenPhasePicker={() => setShowPhasePicker(true)}
        onSave={saveRecipe}
        onCancel={cancelEdit}
        onDelete={deleteRecipe}
      />
    )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RUNNER SECTION                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

        {/* ── Runner: setup (no active bake) ───────────────────────────────── */}
        {section === "runner" && !bake && (
          <RecipeRunnerSetupView
            hasRecipes={recipes.length > 0}
            selectedRecipe={selectedRecipe}
            runPhaseEnabled={runPhaseEnabled}
            refreshing={refreshing}
            onOpenRecipePicker={() => setShowRecipePicker(true)}
            onGoToBuilder={() => setSection("builder")}
            onCreateRecipe={() => { setSection("builder"); openNewRecipe(); }}
            onChangeRecipe={() => setSelectedRecipe(null)}
            onTogglePhase={toggleRunPhase}
            onStartBake={startBake}
            onRefresh={refresh}
          />
        )}

        {/* ── Runner: active bake ───────────────────────────────────────────── */}
        {section === "runner" && !!bake && (
          <RecipeRunnerActiveView
            bake={bake}
            elapsed={elapsed}
            scaleMultiplier={scaleMultiplier}
            refreshing={refreshing}
            bakeNotes={bakeNotes}
            overlayDraft={overlayDraft}
            showNotesOverlay={showNotesOverlay}
            activePhase={activePhase}
            allDone={allDone}
            completedCount={completedCount}
            recipeStale={recipeStale}
            expandedDone={expandedDone}
            expandedRecipeInfo={expandedRecipeInfo}
            expandedPending={expandedPending}
            recentlyCompletedKey={recentlyCompletedKey}
            nextHighlightKey={nextHighlightKey}
            copiedIngredientsKey={copiedIngredientsKey}
            phaseStartVolumes={phaseStartVolumes}
            scrollRef={runnerScrollRef}
            phaseCardYOffsets={phaseCardYOffsets}
            phasesContainerY={phasesContainerY}
            onScaleChange={(m) => { setScaleMultiplier(m); Haptics.selectionAsync(); }}
            onStartPhase={startPhase}
            onCompletePhase={completePhase}
            onToggleExpandDone={toggleExpandDone}
            onToggleExpandRecipeInfo={toggleExpandRecipeInfo}
            onToggleExpandPending={toggleExpandPending}
            onOpenReadingModal={openReadingModal}
            onDeleteReading={deleteReading}
            onIncrementFold={toggleFold}
            onStartVolumeChange={(key, v) => setPhaseStartVolumes((prev) => ({ ...prev, [key]: v }))}
            onStartVolumeCommit={updatePhaseStartVolume}
            onCopyIngredients={async (key) => {
              const phase = bake.phases.find((p) => p.key === key);
              if (!phase) return;
              const text = scalePhaseText(phase.ingredients!, scaleMultiplier);
              await Clipboard.setStringAsync(text);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCopiedIngredientsKey(key);
              setTimeout(() => setCopiedIngredientsKey(null), 2000);
            }}
            onShareSpec={sharePhaseAsPdf}
            onAbandonBake={resetBake}
            onPrint={printBake}
            onSharePdf={shareBakePdf}
            onOpenNotesOverlay={openNotesOverlay}
            onSaveNotesOverlay={saveNotesOverlay}
            onCloseNotesOverlay={() => setShowNotesOverlay(false)}
            onOverlayDraftChange={setOverlayDraft}
            onRefresh={refresh}
          />
        )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE PICKER MODAL (builder "Add Phase")                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <PhasePickerModal
        visible={showPhasePicker}
        availableCategories={availableCategories}
        onConfirm={handleConfirmPhases}
        onClose={() => setShowPhasePicker(false)}
      />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RECIPE PICKER MODAL (runner "Select Recipe")                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <RecipePickerModal
        visible={showRecipePicker}
        recipes={recipes}
        onSelect={selectRecipeForRun}
        onClose={() => setShowRecipePicker(false)}
      />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* READING MODAL                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

  <ReadingModal
    visible={showReadingModal}
    phaseName={bake?.phases.find((p) => p.key === readingPhaseKey)?.name}
    showVolumeField={VOLUME_TRACKING_PHASE_KEYS.has(readingPhaseKey ?? "")}
    isBulkPhase={readingPhaseKey === "bulk_fermenting"}
    onSave={handleSaveReading}
    onClose={() => setShowReadingModal(false)}
  />

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