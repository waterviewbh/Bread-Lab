// artifacts/sourdough/components/lab/labHub.tsx
import React, { useCallback, useMemo, useState, useEffect } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing, typography } from "@/constants/theme";

import AcidificationChart from "@/components/AcidificationChart";
import LiftingIndexChart from "@/components/LiftingIndexChart";
import FCSScatterPlot from "@/components/FCSScatterPlot";
import { RecipeBuilderListView } from "@/components/recipe/RecipeBuilderListView";
import { RecipeBuilderEditView } from "@/components/recipe/RecipeBuilderEditView";
import PeakWindowAdvisor from "@/components/feed/PeakWindowAdvisor";
import { ReadingHint, ACIDIFICATION_HINT, LIFTING_HINT, METABOLIC_HINT } from "./labAnalyticsComponents";

import { api } from "@/lib/api";
import { computeAcidificationSeries, computeLiftingSeries } from "@/lib/analytics";
import { loadAll as loadRecipeData, writeRecipesLocal, upsertRecipeRemote, addToRecipeTombstone, removeFromRecipeTombstone } from "@/lib/recipeStorage";
import { buildRecipeHtml, printHtml, shareHtmlAsPdf } from "@/lib/recipeHtml";
import { PHASE_DEFINITIONS, PHASE_CATEGORIES, BAKE_HISTORY_KEY } from "@/lib/recipeTypes";
import { useSyncStatus } from "@/contexts/SyncContext";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import { PhasePickerModal } from "@/components/recipe/PhasePickerModal";

const HISTORY_KEY = "sourdough_feed_history_v1";

export function LabHub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();
  const params = useLocalSearchParams();

  const [section, setSection] = useState<"feed planner" | "recipe builder" | "analytics">(
    (params.section as any) || "analytics"
  );

  const [history, setHistory] = useState<any[]>([]);
  const [bakeHistory, setBakeHistory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [editingRecipe, setEditingRecipe] = useState<any | null>(null);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // FIXED: Added missing refreshing state

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [histRaw, bakeHistRaw, recipeData] = await Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        loadRecipeData()
      ]);
      if (histRaw) {
        const parsed = JSON.parse(histRaw);
        // Ascending sort (Oldest First) ensures charts scroll to latest data naturally
        const sorted = Array.isArray(parsed)
          ? parsed.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))
          : [];
        setHistory(sorted);
      }
      if (bakeHistRaw) setBakeHistory(JSON.parse(bakeHistRaw));
      setRecipes(recipeData.recipes);
    } catch (e) {
      console.error("[LabHub] Load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditingRecipe(null);
    if (params.action === 'new') {
      router.setParams({ action: undefined });
    }
  }, [params.action, router]);

  useEffect(() => {
    if (params.section) setSection(params.section as any);
    if (params.action === 'new' && !editingRecipe) {
      setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] });
      setIsNewRecipe(true);
    }
  }, [params.section, params.action, editingRecipe]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const acidSeries = useMemo(() => computeAcidificationSeries(history), [history]);
  const liftSeries = useMemo(() => computeLiftingSeries(history), [history]);

  const populatedLetters = useMemo(() => {
    const letters = new Set(recipes.map(r => r.name[0]?.toUpperCase() || "#"));
    return Array.from(letters).sort();
  }, [recipes]);

  const displayedRecipes = useMemo(() => {
    if (!letterFilter) return recipes;
    return recipes.filter(r => (r.name[0]?.toUpperCase() || "#") === letterFilter);
  }, [recipes, letterFilter]);

  const handleUpdatePhaseField = (key: string, field: string, value: any) => {
    setEditingRecipe((prev: any) => prev ? { ...prev, phases: prev.phases.map((p: any) => p.key === key ? { ...p, [field]: value } : p) } : null);
  };

  const removePhaseFromEdit = (key: string) => {
    setEditingRecipe((prev: any) => prev ? { ...prev, phases: prev.phases.filter((p: any) => p.key !== key) } : null);
  };

  const handleSaveRecipe = async () => {
    if (!editingRecipe) return;
    const now = Date.now();
    const saved = { ...editingRecipe, updatedAt: isNewRecipe ? undefined : now };
    const updated = isNewRecipe ? [saved, ...recipes] : recipes.map(r => r.id === saved.id ? saved : r);
    setRecipes(updated);
    await writeRecipesLocal(updated);
    handleCloseEdit();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    reportSyncStart();
    upsertRecipeRemote(saved).then(() => reportSyncSuccess()).catch(() => reportSyncFailure());
  };

  const handleDeleteRecipe = (id: string) => {
    const doDelete = async () => {
      const updated = recipes.filter(r => r.id !== id);
      setRecipes(updated);
      await writeRecipesLocal(updated);
      await addToRecipeTombstone(id);
      handleCloseEdit();
      const [deviceId, token] = await Promise.all([getDeviceId().catch(() => ""), getStoredToken().catch(() => null)]);
      api.recipes.delete(id, deviceId || undefined, token ?? undefined)
      .then(d => { if (d) removeFromRecipeTombstone(id); });
    };
    Alert.alert("Delete Recipe?", "Cannot be undone.", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const handleDuplicateRecipe = async (recipe: any) => {
    const doDuplicate = async (newName: string) => {
      reportSyncStart();
      try {
        const deviceId = await getDeviceId();
        const token = await getStoredToken().catch(() => null);
        const duplicatedApi = await api.recipes.duplicate(
          recipe.id,
          newName,
          deviceId,
          token ?? undefined
        );

        // Map ApiRecipe back to SavedRecipe shape
        const newSaved = {
          id: duplicatedApi.id,
          name: duplicatedApi.name,
          overview: duplicatedApi.overview,
          createdAt: new Date(duplicatedApi.createdAt).getTime(),
          updatedAt: new Date(duplicatedApi.updatedAt).getTime(),
          yieldValue: duplicatedApi.yield_value > 0 ? duplicatedApi.yield_value.toString() : "",
          phases: duplicatedApi.phases.map((p: any) => ({
            key: p.key,
            name: p.name,
            ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
            instructions: Array.isArray(p.instructions) ? p.instructions : [],
          })),
          parentRecipeId: duplicatedApi.parent_recipe_id,
          versionLabel: duplicatedApi.version_label
        };

        const updated = [newSaved, ...recipes];
        setRecipes(updated);
        await writeRecipesLocal(updated);
        reportSyncSuccess();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Optionally navigate to the new recipe
        setEditingRecipe(newSaved);
        setIsNewRecipe(false);
      } catch (e) {
        console.error("[LabHub] Duplicate failed", e);
        reportSyncFailure();
        Alert.alert("Error", "Failed to duplicate recipe.");
      }
    };

    // Android-first duplication flow: Duplicate immediately and navigate to editor.
    doDuplicate(`Copy of ${recipe.name}`);
  };

  const handleConfirmPhases = (keys: string[]) => {
    setEditingRecipe((prev: any) => {
      if (!prev) return null;
      const newPhases = keys.map(k => ({ key: k, name: PHASE_DEFINITIONS.find(d => d.key === k)?.name || k, ingredients: [], instructions: [] }));
      return { ...prev, phases: [...prev.phases, ...newPhases] };
    });
    setShowPhasePicker(false);
  };

  const isEditing = section === "recipe builder" && !!editingRecipe;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {!isEditing && (
        <View style={[s.toggleWrap, { paddingTop: insets.top + 16 }]}>
          <View style={[s.toggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            {(["analytics", "feed planner", "recipe builder"] as const).map((sec) => (
              <Pressable key={sec} onPress={() => { setSection(sec); Haptics.selectionAsync(); }} style={[s.toggleBtn, section === sec && { backgroundColor: colors.card }]}>
                <Text style={[s.toggleText, { color: section === sec ? colors.foreground : colors.mutedForeground }]}>{sec.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {isEditing ? (
        <RecipeBuilderEditView
          editingRecipe={editingRecipe}
          isNewRecipe={isNewRecipe}
          availablePhaseCount={PHASE_DEFINITIONS.length}
          onChangeName={(n: string) => setEditingRecipe({ ...editingRecipe, name: n })}
          onChangeOverview={(v: string) => setEditingRecipe((prev: any) => prev ? { ...prev, overview: v } : null)}
          onChangeYield={(v: string) => setEditingRecipe((prev: any) => prev ? { ...prev, yieldValue: v } : null)}
          onUpdatePhaseField={handleUpdatePhaseField}
          onRemovePhase={removePhaseFromEdit}
          onOpenPhasePicker={() => setShowPhasePicker(true)}
          onSave={handleSaveRecipe}
          onCancel={handleCloseEdit}
          onDuplicate={() => handleDuplicateRecipe(editingRecipe)}
          onDelete={handleDeleteRecipe}
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.mutedForeground} />}
        >
          {section === "analytics" && (
            <View style={{ paddingHorizontal: 20 }}>
              <Text style={s.hubTitle}>Vitality Analytics</Text>
              <ReadingHint body={ACIDIFICATION_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
              <AcidificationChart data={acidSeries} hasLivePoint={false} />
              <ReadingHint body={LIFTING_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
              <LiftingIndexChart data={liftSeries} selectedFeedNum={null} onSelectFeedNum={() => {}} />
              <ReadingHint body={METABOLIC_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
              <FCSScatterPlot sessions={history} selectedFeedNum={null} onSelectFeedNum={() => {}} />
            </View>
          )}

          {section === "recipe builder" && (
            <RecipeBuilderListView
              recipes={recipes}
              displayedRecipes={displayedRecipes}
              bakeHistory={bakeHistory}
              populatedLetters={populatedLetters}
              letterFilter={letterFilter}
              refreshing={refreshing}
              onNewRecipe={() => { setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] }); setIsNewRecipe(true); }}
              onEditRecipe={(r) => { setEditingRecipe(r); setIsNewRecipe(false); }}
              onPrintRecipe={(r) => printHtml(buildRecipeHtml(r))}
              onShareRecipe={(r) => shareHtmlAsPdf(buildRecipeHtml(r), r.name)}
              onDuplicateRecipe={handleDuplicateRecipe}
              onSetLetterFilter={setLetterFilter}
              onRefresh={loadData}
            />
          )}

          {section === "feed planner" && (
            <View style={{ paddingHorizontal: 20 }}>
              <PeakWindowAdvisor
                history={history}
                onApplyRecipe={(recipe) => {
                  router.push({
                    pathname: "/bench",
                    params: {
                      section: "feed",
                      starter: recipe.starter.toString(),
                      flour: recipe.flour.toString(),
                      water: recipe.water.toString(),
                      autoStart: "false"
                    }
                  });
                }}
              />
            </View>
          )}
        </ScrollView>
      )}

      <PhasePickerModal
        visible={showPhasePicker}
        availableCategories={PHASE_CATEGORIES}
        onConfirm={handleConfirmPhases}
        onClose={() => setShowPhasePicker(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  toggleWrap: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  toggle: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 3, gap: 3 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: "center" },
  toggleText: { fontSize: 11, fontFamily: fonts.sansSemiBold, letterSpacing: 0.5 },
  scrollContent: { paddingBottom: 120 },
  hubTitle: { ...typography.headlineLgMobile, marginBottom: 12 },
});