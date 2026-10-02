// artifacts/sourdough/components/bench/ActiveBakeSection.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";
import { useActiveBakeTimer } from "@/hooks/useActiveBakeTimer";

// --- Components ---
import { RecipeRunnerSetupView } from "@/components/recipe/RecipeRunnerSetupView";
import { RecipeRunnerActiveView } from "@/components/recipe/RecipeRunnerActiveView";
import { RecipePickerModal } from "@/components/recipe/RecipePickerModal";
import { ReadingModal } from "@/components/recipe/ReadingModal";
import { BakeSelectorTabs } from "@/components/recipe/BakeSelectorTabs";

// --- Libs & Types ---
import {
  type ActiveBake,
  type BakePhase,
  type Reading,
  type SavedRecipe,
  VOLUME_TRACKING_PHASE_KEYS,
} from "@/lib/recipeTypes";
import {
  loadAll as loadData,
  writeBakeLocal,
  upsertBakeRemote,
  archiveBakeWithDiagnostics,
  writeBakesLocal,
} from "@/lib/recipeStorage";
import { computeBulkFermentState, estimateInoculationPercent } from "@/lib/bulkFermentEngine";
import { shareHtmlAsPdf, buildBakeHtml, buildPhaseHtml, printHtml } from "@/lib/recipeHtml";
import { parseIngredientsForMetrics, detectYeastType } from "@/lib/recipeUtils";

export function ActiveBakeSection() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // Bench Optimization: Screen on during active bake
  useKeepAwake();

  // State
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [bakes, setBakes] = useState<ActiveBake[]>([]);
  const [activeBakeId, setActiveBakeId] = useState<string | null>(null);
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});
  const [phaseTargetTemps, setPhaseTargetTemps] = useState<Record<string, string>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  // Expansion States
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());
  const [expandedRecipeInfo, setExpandedRecipeInfo] = useState<Set<string>>(new Set());
  const [expandedPending, setExpandedPending] = useState<Set<string>>(new Set());
  const [recentlyCompletedKey, setRecentlyCompletedKey] = useState<string | null>(null);

  // Modals
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [showReadingModal, setShowReadingModal] = useState(false);
  const [readingPhaseKey, setReadingPhaseKey] = useState<string | null>(null);

  // Display Prefs
  const [scaleMultiplier, setScaleMultiplier] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [bakeNotes, setBakeNotes] = useState("");
  const [overlayDraft, setOverlayDraft] = useState("");
  const [showNotesOverlay, setShowNotesOverlay] = useState(false);

  // Refs for Auto-scroll
  const runnerScrollRef = useRef<ScrollView>(null);
  const phaseCardYOffsets = useRef<Record<string, number>>({});
  const phasesContainerY = useRef(0);

  // --- Derived Values ---
  const bake = useMemo(() => bakes.find(b => b.id === activeBakeId) || null, [bakes, activeBakeId]);
  const activePhase = bake?.phases.find((p) => p.startedAt && !p.completedAt);
  const completedCount = bake?.phases.filter((p) => p.completedAt).length ?? 0;
  const allDone = !!bake && completedCount === bake.phases.length && bake.phases.length > 0;

  const INOCULATION_ANCHOR_PRIORITY = ["fermentolysing", "incorporating", "building_levain"] as const;
  const inoculationAnchorKey: string | null = useMemo(() => {
    if (!bake) return null;
    const bakePhaseKeys = new Set(bake.phases.filter(p => !!p).map((p) => p.key));
    return INOCULATION_ANCHOR_PRIORITY.find((k) => bakePhaseKeys.has(k)) ?? null;
  }, [bake]);

  const inoculationPercent: 10 | 20 | 30 | null = useMemo(() => {
    return bake ? estimateInoculationPercent(bake.phases) : null;
  }, [bake]);

  // Active Timers
  const elapsed1 = useActiveBakeTimer(bakes[0] || null);
  const elapsed2 = useActiveBakeTimer(bakes[1] || null);
  const elapsed = activeBakeId === bakes[0]?.id ? elapsed1 : elapsed2;

  const sessionChecks = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!bake) return map;
    bake.phases.forEach(p => {
      p.ingredients.forEach(i => { if (i.is_checked) map[i.id] = true; });
      p.instructions.forEach(i => { if (i.is_checked) map[i.id] = true; });
    });
    return map;
  }, [bake]);

  // --- Data Loading ---
  const load = useCallback(async () => {
    console.log("[ActiveBakeSection] Loading data...");
    try {
      const data = await loadData();
      setRecipes(data.recipes);
      setBakes(data.bakes);

      if (data.bakes.length > 0) {
        if (!activeBakeId || !data.bakes.find(b => b.id === activeBakeId)) {
          setActiveBakeId(data.bakes[0].id);
        }

        const currentBake = data.bakes.find(b => b.id === (activeBakeId || data.bakes[0].id));
        if (currentBake) {
            setBakeNotes(currentBake.notes ?? "");
            const active = currentBake.phases.find(p => p.startedAt && !p.completedAt);
            if (active) {
              setExpandedRecipeInfo(new Set([active.key]));
            } else {
              const firstPending = currentBake.phases.find(p => !p.startedAt);
              if (firstPending) {
                setExpandedPending(new Set([firstPending.key]));
              }
            }
        }
      } else {
        setActiveBakeId(null);
      }
    } finally {
      setIsLoaded(true);
    }
  }, [activeBakeId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (bake) {
      const vols: Record<string, string> = {};
      const temps: Record<string, string> = {};
      bake.phases.forEach((p) => {
        vols[p.key] = p.startVolume ?? bake.estimatorState?.startVolume_ml ?? "";
        if (p.key === 'bulk_fermenting') {
          temps[p.key] = bake.estimatorState?.targetTemp ?? "";
        }
      });
      setPhaseStartVolumes(vols);
      setPhaseTargetTemps(temps);
      setBakeNotes(bake.notes ?? "");
    }
  }, [bake]);

  // --- Handlers ---
  const handleStartBakeWithRecipe = async (recipe: SavedRecipe) => {
    const phases: BakePhase[] = recipe.phases
      .map((p) => ({ ...p, startedAt: null, completedAt: null, readings: [] }));

    const { flour, water, starter, yeast, salt } = parseIngredientsForMetrics(phases);

    const newBake: ActiveBake = {
      id: Date.now().toString(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      startedAt: Date.now(),
      status: 'active',
      phases,
      yieldValue: recipe.yieldValue || "1",
      estimatorState: {
        flourG: flour.toString(),
        waterG: water.toString(),
        starterG: starter.toString(),
        yeastG: yeast.toString(),
        saltG: salt.toString(),
        yeastType: detectYeastType(phases),
        targetTemp: "76",
        startVolume_ml: "",
      }
    };

    const nextBakes = [...bakes];
    if (nextBakes.length < 2) nextBakes.push(newBake);
    else {
        const idx = nextBakes.findIndex(b => b.id === activeBakeId);
        if (idx !== -1) nextBakes[idx] = newBake;
        else nextBakes[0] = newBake;
    }

    setBakes(nextBakes);
    setActiveBakeId(newBake.id);
    await writeBakeLocal(newBake);
    upsertBakeRemote(newBake).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (phases.length > 0) {
      setExpandedPending(new Set([phases[0].key]));
    }
  };

  const handleSaveReading = async (reading: Reading) => {
    if (!bake || !readingPhaseKey) return;
    const phases = bake.phases.map((p) => {
      if (p.key !== readingPhaseKey) return p;
      const updatedReadings = [...p.readings, reading];

      if (p.key === "bulk_fermenting") {
        const updatedState = computeBulkFermentState(
          updatedReadings as any,
          p.bulkFermentState ?? {},
          bake.phases,
          p.startedAt,
          p.startVolume,
          bake.estimatorState?.targetTemp,
          bake.estimatorState
        );
        return { ...p, readings: updatedReadings, bulkFermentState: updatedState };
      }
      return { ...p, readings: updatedReadings };
    });

    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    setShowReadingModal(false);
  };

  const handleAbandonBake = () => {
    Alert.alert("New Bake?", "Clear the current bake? This will save a snapshot to your history.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: async () => {
          if (bake) {
              await archiveBakeWithDiagnostics(bake, { reportSyncStart, reportSyncSuccess, reportSyncFailure });
              const nextBakes = bakes.filter(b => b.id !== activeBakeId);
              setBakes(nextBakes);
              if (nextBakes.length > 0) setActiveBakeId(nextBakes[0].id);
              else setActiveBakeId(null);
              await writeBakesLocal(nextBakes);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  const handleStartPhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) => {
      if (p.key === key) return { ...p, startedAt: Date.now() };
      if (p.startedAt && !p.completedAt) return { ...p, completedAt: Date.now() };
      return p;
    });
    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedRecipeInfo(prev => new Set(prev).add(key));
  };

  const handleCompletePhase = async (key: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) =>
      p.key === key ? { ...p, completedAt: Date.now() } : p
    );

    const isLastPhase = phases.every(p => !!p.completedAt);
    const updatedBake: ActiveBake = {
        ...bake,
        phases,
        status: isLastPhase ? 'completed' : 'active',
        completedAt: isLastPhase ? Date.now() : undefined
    };

    setRecentlyCompletedKey(key);
    setTimeout(() => setRecentlyCompletedKey(null), 800);

    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const nextPhase = phases.find(p => !p.completedAt);
    if (nextPhase) {
      setExpandedPending(prev => new Set(prev).add(nextPhase.key));

      // Auto-scroll logic
      setTimeout(() => {
        const cardY = phaseCardYOffsets.current[nextPhase.key];
        if (cardY !== undefined && runnerScrollRef.current) {
          const scrollY = phasesContainerY.current + cardY - 16;
          runnerScrollRef.current.scrollTo({ y: Math.max(0, scrollY), animated: true });
        }
      }, 320);
    }
  };

  const handleToggleExpandDone = (key: string) => {
    setExpandedDone(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleToggleExpandRecipeInfo = (key: string) => {
    setExpandedRecipeInfo(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleToggleExpandPending = (key: string) => {
    setExpandedPending(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleStartVolumeChange = (key: string, value: string) => {
    setPhaseStartVolumes(prev => ({ ...prev, [key]: value }));
  };

  const handleStartVolumeCommit = async (key: string, value: string) => {
    if (!bake) return;
    const phases = bake.phases.map(p => {
      if (p.key !== key) return p;
      let nextP = { ...p, startVolume: value };
      if (p.key === "bulk_fermenting") {
        const bulkReadings = p.readings as import("@/lib/recipeTypes").BulkFermentReading[];
        nextP.bulkFermentState = computeBulkFermentState(
          bulkReadings,
          p.bulkFermentState ?? {},
          bake.phases,
          p.startedAt,
          value,
          bake.estimatorState?.targetTemp,
          bake.estimatorState
        );
      }
      return nextP;
    });
    const nextEstimator = { ...bake.estimatorState, startVolume_ml: value };
    const updatedBake = { ...bake, phases, estimatorState: nextEstimator };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleTargetTempChange = (key: string, value: string) => {
    setPhaseTargetTemps(prev => ({ ...prev, [key]: value }));
  };

  const handleTargetTempCommit = async (key: string, value: string) => {
    if (!bake || key !== 'bulk_fermenting') return;

    const phases = bake.phases.map(p => {
      if (p.key !== 'bulk_fermenting') return p;
      const bulkReadings = p.readings as import("@/lib/recipeTypes").BulkFermentReading[];
      const updatedState = computeBulkFermentState(
        bulkReadings,
        p.bulkFermentState ?? {},
        bake.phases,
        p.startedAt,
        p.startVolume,
        value,
        bake.estimatorState
      );
      return { ...p, bulkFermentState: updatedState };
    });

    const nextEstimator = { ...bake.estimatorState, targetTemp: value };
    const updatedBake = { ...bake, phases, estimatorState: nextEstimator };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
  };

  const handleSaveEstimatorFormula = async (state: import("@/lib/recipeTypes").BulkEstimatorState) => {
    if (!bake) return;

    const phases = bake.phases.map(p => {
        if (p.key !== 'bulk_fermenting') return p;
        const bulkReadings = p.readings as import("@/lib/recipeTypes").BulkFermentReading[];
        const updatedState = computeBulkFermentState(
          bulkReadings,
          p.bulkFermentState ?? {},
          bake.phases,
          p.startedAt,
          p.startVolume,
          state.targetTemp,
          state
        );
        return { ...p, bulkFermentState: updatedState };
      });

    const updatedBake = { ...bake, phases, estimatorState: state };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
  };

  const handleToggleFold = async (key: string, idx: number) => {
    if (!bake) return;
    const now = Date.now();
    const phases = bake.phases.map((p) => {
      if (p.key !== key) return p;
      const current = p.foldCount ?? 0;
      const next = current === idx + 1 ? idx : idx + 1;

      // Handle timing chits (elapsed minutes since phase start)
      let timestamps = [...(p.foldTimestamps || [])];
      if (next > current) {
        const elapsed = p.startedAt ? Math.max(0, Math.floor((now - p.startedAt) / 60000)) : 0;
        for (let i = 0; i < next; i++) {
          if (timestamps[i] === null || timestamps[i] === undefined) {
            timestamps[i] = elapsed;
          }
        }
      } else {
        for (let i = next; i < (p.foldTimestamps?.length || 0); i++) {
          timestamps[i] = null;
        }
      }

      return { ...p, foldCount: next, foldTimestamps: timestamps };
    });
    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.selectionAsync();
  };

  const handleDeleteReading = async (phaseKey: string, readingId: string) => {
    if (!bake) return;
    const phases = bake.phases.map((p) =>
      p.key === phaseKey
        ? { ...p, readings: p.readings.filter((r) => r.id !== readingId) }
        : p
    );
    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleToggleLineCheck = async (id: string) => {
    if (!bake) return;
    const phases = bake.phases.map(p => ({
      ...p,
      ingredients: p.ingredients.map(i => i.id === id ? { ...i, is_checked: !i.is_checked } : i),
      instructions: p.instructions.map(i => i.id === id ? { ...i, is_checked: !i.is_checked } : i),
    }));
    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSaveNotesOverlay = async () => {
    if (!bake) return;
    const updatedBake = { ...bake, notes: overlayDraft };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    setBakeNotes(overlayDraft);
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    setShowNotesOverlay(false);
  };

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
        <BakeSelectorTabs
          bakes={bakes}
          activeBakeId={activeBakeId}
          onSelectBake={setActiveBakeId}
          onNewBake={() => {
              setActiveBakeId(null);
              setShowRecipePicker(true);
          }}
          elapsed1={elapsed1}
          elapsed2={elapsed2}
        />
      </View>

      {bake ? (
      <RecipeRunnerActiveView
        bake={bake}
        elapsed={elapsed}
        scaleMultiplier={scaleMultiplier}
        onScaleChange={setScaleMultiplier}
        onStartPhase={handleStartPhase}
        onCompletePhase={handleCompletePhase}
        onOpenReadingModal={(key) => { setReadingPhaseKey(key); setShowReadingModal(true); }}
        onAbandonBake={handleAbandonBake}
        refreshing={refreshing}
        onRefresh={load}
        bakeNotes={bakeNotes}
        overlayDraft={overlayDraft}
        showNotesOverlay={showNotesOverlay}
        activePhase={activePhase}
        allDone={allDone}
        completedCount={completedCount}
        recipeStale={false}
        inoculationAnchorKey={inoculationAnchorKey}
        inoculationPercent={inoculationPercent}
        expandedDone={expandedDone}
        expandedRecipeInfo={expandedRecipeInfo}
        expandedPending={expandedPending}
        recentlyCompletedKey={recentlyCompletedKey}
        nextHighlightKey={null}
        copiedIngredientsKey={null}
        phaseStartVolumes={phaseStartVolumes}
        phaseTargetTemps={phaseTargetTemps}
        scrollRef={runnerScrollRef}
        phaseCardYOffsets={phaseCardYOffsets}
        phasesContainerY={phasesContainerY}
        onToggleExpandDone={handleToggleExpandDone}
        onToggleExpandRecipeInfo={handleToggleExpandRecipeInfo}
        onToggleExpandPending={handleToggleExpandPending}
        onDeleteReading={handleDeleteReading}
        onIncrementFold={handleToggleFold}
        onStartVolumeChange={handleStartVolumeChange}
        onStartVolumeCommit={handleStartVolumeCommit}
        onTargetTempChange={handleTargetTempChange}
        onTargetTempCommit={handleTargetTempCommit}
        onSaveEstimatorFormula={handleSaveEstimatorFormula}
        onCopyIngredients={async (key) => {
          const phase = bake?.phases.find(p => p.key === key);
          if (!phase) return;
          const ingredients = phase.ingredients.map(i => i.text).join("\n");
          await Clipboard.setStringAsync(ingredients);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
        onShareSpec={(phase) => {
          if (!bake) return;
          const html = buildPhaseHtml(phase, bake.recipeName, scaleMultiplier);
          shareHtmlAsPdf(html, `${bake.recipeName} - ${phase.name}`);
        }}
        onPrint={() => {
          if (!bake) return;
          const html = buildBakeHtml(bake, bakeNotes, completedCount);
          printHtml(html);
        }}
        onSharePdf={() => {
          if (!bake) return;
          const html = buildBakeHtml(bake, bakeNotes, completedCount);
          shareHtmlAsPdf(html, bake.recipeName);
        }}
        onOpenNotesOverlay={() => { setOverlayDraft(bakeNotes); setShowNotesOverlay(true); }}
        onSaveNotesOverlay={handleSaveNotesOverlay}
        onCloseNotesOverlay={() => setShowNotesOverlay(false)}
        onOverlayDraftChange={(text) => setOverlayDraft(text)}
        sessionChecks={sessionChecks}
        onToggleLineCheck={handleToggleLineCheck}
      />
      ) : (
      <RecipeRunnerSetupView
        hasRecipes={recipes.length > 0}
        onOpenRecipePicker={() => setShowRecipePicker(true)}
        refreshing={refreshing}
        onGoToBuilder={() => router.push({ pathname: "/lab", params: { section: "recipe builder" } })}
        onCreateRecipe={() => router.push({ pathname: "/lab", params: { section: "recipe builder", action: "new" } })}
        onRefresh={load}
      />
      )}

      <RecipePickerModal
        visible={showRecipePicker}
        recipes={recipes}
        onSelect={(r) => { handleStartBakeWithRecipe(r); setShowRecipePicker(false); }}
        onClose={() => setShowRecipePicker(false)}
      />

      <ReadingModal
        visible={showReadingModal}
        phaseName={bake?.phases.find(p => p.key === readingPhaseKey)?.name}
        showVolumeField={VOLUME_TRACKING_PHASE_KEYS.has(readingPhaseKey ?? "")}
        isBulkPhase={readingPhaseKey === "bulk_fermenting"}
        onSave={handleSaveReading}
        onClose={() => setShowReadingModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({});
