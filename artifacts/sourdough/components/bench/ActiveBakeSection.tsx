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
  saveBakeToHistory,
} from "@/lib/recipeStorage";
import { computeBulkFermentState, estimateInoculationPercent } from "@/lib/bulkFermentEngine";
import { scalePhaseText } from "@/lib/recipeUtils";
import { printHtml, shareHtmlAsPdf, buildBakeHtml } from "@/lib/recipeHtml";
import { fonts } from "@/constants/theme";

export function ActiveBakeSection() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // Bench Optimization: Screen on during active bake
  useKeepAwake();

  // State
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [bake, setBake] = useState<ActiveBake | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<SavedRecipe | null>(null);
  const [runPhaseEnabled, setRunPhaseEnabled] = useState<Record<string, boolean>>({});
  const [phaseStartVolumes, setPhaseStartVolumes] = useState<Record<string, string>>({});

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
  // This finds the first phase that is started but not yet completed.
  const activePhase = bake?.phases.find((p) => p.startedAt && !p.completedAt);
  // Count how many phases are done for the progress bar
  const completedCount = bake?.phases.filter((p) => p.completedAt).length ?? 0;
  // True if every phase in the bake is finished
  const allDone = !!bake && completedCount === bake.phases.length && bake.phases.length > 0;

  // Active Timers
  const elapsed = useActiveBakeTimer(bake);

  // --- Data Loading ---
  const load = async () => {
    const data = await loadData();
    setRecipes(data.recipes);
    setBake(data.bake);
  };

  useEffect(() => { load(); }, []);

  // --- Handlers ---
  const handleStartBake = async () => {
    if (!selectedRecipe) return;
    const phases: BakePhase[] = selectedRecipe.phases
      .filter((p) => runPhaseEnabled[p.key])
      .map((p) => ({ ...p, startedAt: null, completedAt: null, readings: [] }));

    const newBake: ActiveBake = {
      id: Date.now().toString(),
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      startedAt: Date.now(),
      phases,
      yieldValue: selectedRecipe.yieldValue || "1",
    };

    setBake(newBake);
    await writeBakeLocal(newBake);
    upsertBakeRemote(newBake).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    setBake(updatedBake);
    await writeBakeLocal(updatedBake);
    setShowReadingModal(false);
  };

  const handleAbandonBake = () => {
    Alert.alert("New Bake?", "Clear the current bake? This will save a snapshot to your history.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: async () => {
          if (bake) await saveBakeToHistory(bake, { reportSyncStart, reportSyncSuccess, reportSyncFailure });
          setBake(null);
          await AsyncStorage.removeItem(BAKE_KEY);
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
    setBake(updatedBake);
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleCompletePhase = async (key: string) => {
    if (!bake) return;

    // Mark the specific phase as completed
    const phases = bake.phases.map((p) =>
      p.key === key ? { ...p, completedAt: Date.now() } : p
    );

    const updatedBake = { ...bake, phases };
    setBake(updatedBake);
    await writeBakeLocal(updatedBake);
    upsertBakeRemote(updatedBake).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      setBake(updatedBake);
      await writeBakeLocal(updatedBake);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

  // --- Render ---
  return (
    <View style={{ flex: 1 }}>
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
        expandedDone={new Set()}
        expandedRecipeInfo={new Set()}
        expandedPending={new Set()}
        recentlyCompletedKey={null}
        nextHighlightKey={null}
        copiedIngredientsKey={null}
        phaseStartVolumes={phaseStartVolumes}
        scrollRef={{ current: null } as any}
        phaseCardYOffsets={{ current: {} } as any}
        phasesContainerY={{ current: 0 } as any}
        onToggleExpandDone={() => {}}
        onToggleExpandRecipeInfo={() => {}}
        onToggleExpandPending={() => {}}
        onDeleteReading={() => {}}
        onIncrementFold={() => {}}
        onStartVolumeChange={handleStartVolumeChange}
        onStartVolumeCommit={handleStartVolumeCommit}
        onCopyIngredients={() => {}}
        onShareSpec={() => {}}
        onPrint={() => {}}
        onSharePdf={() => {}}
        onOpenNotesOverlay={() => setShowNotesOverlay(true)}
        onSaveNotesOverlay={() => setShowNotesOverlay(false)}
        onCloseNotesOverlay={() => setShowNotesOverlay(false)}
        onOverlayDraftChange={setOverlayDraft}
        sessionChecks={{}}
        onToggleLineCheck={() => {}}
      />
      ) : (
      <RecipeRunnerSetupView
        hasRecipes={recipes.length > 0}
        selectedRecipe={selectedRecipe}
        runPhaseEnabled={runPhaseEnabled}
        onOpenRecipePicker={() => setShowRecipePicker(true)}
        onStartBake={handleStartBake}
        onTogglePhase={(key) => setRunPhaseEnabled(prev => ({ ...prev, [key]: !prev[key] }))}
        // Add these required props
        refreshing={refreshing}
        onGoToBuilder={() => {}}
        onCreateRecipe={() => {}}
        onChangeRecipe={() => setSelectedRecipe(null)}
        onRefresh={load}
      />
      )}

      <RecipePickerModal
        visible={showRecipePicker}
        recipes={recipes}
        onSelect={(r) => { setSelectedRecipe(r); setShowRecipePicker(false); }}
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