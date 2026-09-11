// artifacts/sourdough/components/bench/ActiveBakeSection.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, View, ScrollView, StyleSheet, Text, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

// --- Libs & Types ---
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import {
  type ActiveBake,
  type BakePhase,
  type Reading,
  type SavedRecipe,
  BAKE_KEY,
  VOLUME_TRACKING_PHASE_KEYS,
} from "@/lib/recipeTypes";
import {
  loadAll as loadData,
  writeBakeLocal,
  upsertBakeRemote,
  archiveBakeWithDiagnostics,
} from "@/lib/recipeStorage";
import { computeBulkFermentState, estimateInoculationPercent } from "@/lib/bulkFermentEngine";
import { scalePhaseText } from "@/lib/recipeUtils";
import { printHtml, shareHtmlAsPdf, buildBakeHtml, buildPhaseHtml } from "@/lib/recipeHtml";
import { fonts } from "@/constants/theme";

import { BakeSelectorTabs } from "@/components/recipe/BakeSelectorTabs";

export function ActiveBakeSection() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // Bench Optimization: Screen on during active bake
  useKeepAwake();

  // State
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [bakes, setBakes] = useState<ActiveBake[]>([]);
  const [activeBakeId, setActiveBakeId] = useState<string | null>(null);
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});

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
  const [isLargeTextMode, setIsLargeTextMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bakeNotes, setBakeNotes] = useState("");
  const [overlayDraft, setOverlayDraft] = useState("");
  const [showNotesOverlay, setShowNotesOverlay] = useState(false);

  // --- Derived Values (The Brain) ---
  const bake = useMemo(() => bakes.find(b => b.id === activeBakeId) || null, [bakes, activeBakeId]);

  // This finds the first phase that is started but not yet completed.
  const activePhase = bake?.phases.find((p) => p.startedAt && !p.completedAt);
  // Count how many phases are done for the progress bar
  const completedCount = bake?.phases.filter((p) => p.completedAt).length ?? 0;
  // True if every phase in the bake is finished
  const allDone = !!bake && completedCount === bake.phases.length && bake.phases.length > 0;

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
  const load = async () => {
    console.log("[ActiveBakeSection] Loading data...");
    const data = await loadData();
    setRecipes(data.recipes);
    setBakes(data.bakes);

    if (data.bakes.length > 0) {
      // Restore active slot or default to first
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
      console.log("[ActiveBakeSection] No active bake found in storage");
    }
  };

  useEffect(() => { load(); }, []);

  // --- Handlers ---
  const handleStartBakeWithRecipe = async (recipe: SavedRecipe) => {
    const phases: BakePhase[] = recipe.phases
      .map((p) => ({ ...p, startedAt: null, completedAt: null, readings: [] }));

    const newBake: ActiveBake = {
      id: Date.now().toString(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      startedAt: Date.now(),
      status: 'active',
      phases,
      yieldValue: recipe.yieldValue || "1",
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

    // Auto-expand the first phase of a new bake
    if (phases.length > 0) {
      setExpandedPending(new Set([phases[0].key]));
    }
  };

  const handleSaveReading = async (reading: Reading) => {
    if (!bake || !readingPhaseKey) return;
    const phases = bake.phases.map((p) => {
      if (p.key !== readingPhaseKey) return p;
      const updatedReadings = [...p.readings, reading];

      // Integrate PD Engine for Bulk Ferment
      if (p.key === "bulk_fermenting") {
        const updatedState = computeBulkFermentState(
          updatedReadings as any,
          p.bulkFermentState ?? {},
          bake.phases,
          p.startedAt,
          p.startVolume
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

              const { writeBakesLocal } = await import("@/lib/recipeStorage");
              await writeBakesLocal(nextBakes);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  const handleStartPhase = async (key: string) => {
    if (!bake) return;

    // Update timestamps: start the new one, stop any currently running one
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

    // Auto-expand the specs of the phase we just started
    setExpandedRecipeInfo(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleCompletePhase = async (key: string) => {
    if (!bake) return;

    // Mark the specific phase as completed
    const phases = bake.phases.map((p) =>
      p.key === key ? { ...p, completedAt: Date.now() } : p
    );

    const updatedBake = { ...bake, phases };
    setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Auto-expand the NEXT unstarted phase instead of looking back
    const currentIndex = bake.phases.findIndex(p => p.key === key);
    const nextPhase = bake.phases.slice(currentIndex + 1).find(p => !p.startedAt);

    if (nextPhase) {
      setExpandedPending(prev => {
        const next = new Set(prev);
        next.add(nextPhase.key);
        return next;
      });
    }

    // Collapse the done card (removed looking back logic)
    setRecentlyCompletedKey(null);
  };

  const handleToggleExpandDone = (key: string) => {
    setExpandedDone(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggleExpandRecipeInfo = (key: string) => {
    setExpandedRecipeInfo(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggleExpandPending = (key: string) => {
    setExpandedPending(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

    const handleStartVolumeChange = (key: string, value: string) => {
      setPhaseStartVolumes(prev => ({ ...prev, [key]: value }));
    };

    const handleStartVolumeCommit = async (key: string, value: string) => {
      if (!bake) return;
      const phases = bake.phases.map(p =>
        p.key === key ? { ...p, startVolume: value } : p
      );
      const updatedBake = { ...bake, phases };
      setBakes(bakes.map(b => b.id === updatedBake.id ? updatedBake : b));
      await writeBakeLocal(updatedBake);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

  const handleToggleFold = async (key: string, idx: number) => {
    if (!bake) return;
    const phases = bake.phases.map((p) => {
      if (p.key !== key) return p;
      const current = p.foldCount ?? 0;
      const next = current === idx + 1 ? idx : idx + 1;
      return { ...p, foldCount: next };
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

  const handleOverlayDraftChange = (text: string) => {
    setOverlayDraft(text);
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

  // --- Render ---
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
        inoculationAnchorKey={null}
        inoculationPercent={null}
        expandedDone={expandedDone}
        expandedRecipeInfo={expandedRecipeInfo}
        expandedPending={expandedPending}
        recentlyCompletedKey={recentlyCompletedKey}
        nextHighlightKey={null}
        copiedIngredientsKey={null}
        phaseStartVolumes={phaseStartVolumes}
        scrollRef={{ current: null } as any}
        phaseCardYOffsets={{ current: {} } as any}
        phasesContainerY={{ current: 0 } as any}
        onToggleExpandDone={handleToggleExpandDone}
        onToggleExpandRecipeInfo={handleToggleExpandRecipeInfo}
        onToggleExpandPending={handleToggleExpandPending}
        onDeleteReading={handleDeleteReading}
        onIncrementFold={handleToggleFold}
        onStartVolumeChange={handleStartVolumeChange}
        onStartVolumeCommit={handleStartVolumeCommit}
        onCopyIngredients={async (key) => {
          const phase = bake?.phases.find(p => p.key === key);
          if (!phase) return;
          console.log("[ActiveBakeSection] onCopyIngredients triggered for phase:", phase.name);
          const ingredients = phase.ingredients.map(i => i.text).join("\n");
          await Clipboard.setStringAsync(ingredients);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
        onShareSpec={(phase) => {
          console.log("[ActiveBakeSection] onShareSpec triggered for phase:", phase.name);
          try {
            if (!bake) return;
            const html = buildPhaseHtml(phase, bake.recipeName, scaleMultiplier);
            console.log("[ActiveBakeSection] onShareSpec: HTML generated, sharing PDF...");
            shareHtmlAsPdf(html, `${bake.recipeName} - ${phase.name}`);
          } catch (error) {
            console.error("[ActiveBakeSection] onShareSpec error:", error);
          }
        }}
        onPrint={() => {
          console.log("[ActiveBakeSection] onPrint triggered");
          try {
            if (!bake) {
              console.warn("[ActiveBakeSection] onPrint: No active bake found in state");
              return;
            }
            console.log("[ActiveBakeSection] onPrint: Preparing HTML for bake:", bake.recipeName, "(ID:", bake.id, ")");
            console.log("[ActiveBakeSection] onPrint: Phase status:", completedCount, "/", bake.phases?.length || 0);

            const html = buildBakeHtml(bake, bakeNotes, completedCount);
            console.log("[ActiveBakeSection] onPrint: HTML generation successful, length:", html.length);

            printHtml(html);
          } catch (error) {
            console.error("[ActiveBakeSection] onPrint error:", error);
            Alert.alert("Print Error", "Failed to generate print document. Check console for details.");
          }
        }}
        onSharePdf={() => {
          console.log("[ActiveBakeSection] onSharePdf triggered");
          try {
            if (!bake) {
              console.warn("[ActiveBakeSection] onSharePdf: No active bake found in state");
              return;
            }
            console.log("[ActiveBakeSection] onSharePdf: Preparing PDF for bake:", bake.recipeName, "(ID:", bake.id, ")");

            const html = buildBakeHtml(bake, bakeNotes, completedCount);
            console.log("[ActiveBakeSection] onSharePdf: HTML generation successful, length:", html.length);

            shareHtmlAsPdf(html, bake.recipeName);
          } catch (error) {
            console.error("[ActiveBakeSection] onSharePdf error:", error);
            Alert.alert("Share Error", "Failed to generate PDF. Check console for details.");
          }
        }}
        onOpenNotesOverlay={() => { setOverlayDraft(bakeNotes); setShowNotesOverlay(true); }}
        onSaveNotesOverlay={handleSaveNotesOverlay}
        onCloseNotesOverlay={() => setShowNotesOverlay(false)}
        onOverlayDraftChange={handleOverlayDraftChange}
        sessionChecks={sessionChecks}
        onToggleLineCheck={handleToggleLineCheck}
      />
      ) : (
      <RecipeRunnerSetupView
        hasRecipes={recipes.length > 0}
        onOpenRecipePicker={() => setShowRecipePicker(true)}
        refreshing={refreshing}
        onGoToBuilder={() => {}}
        onCreateRecipe={() => {}}
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