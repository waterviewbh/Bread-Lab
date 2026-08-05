// artifacts/sourdough/components/lab/labHub.tsx
import React, { useCallback, useMemo, useState, useEffect } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl } from "react-native";
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
import { PHASE_DEFINITIONS, PHASE_CATEGORIES } from "@/lib/recipeTypes";
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
  const [recipes, setRecipes] = useState<any[]>([]);
  const [editingRecipe, setEditingRecipe] = useState<any | null>(null);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // FIXED: Added missing refreshing state

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [histRaw, recipeData] = await Promise.all([AsyncStorage.getItem(HISTORY_KEY), loadRecipeData()]);
      if (histRaw) setHistory(JSON.parse(histRaw));
      setRecipes(recipeData.recipes);
    } catch (e) {
      console.error("[LabHub] Load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (params.section) setSection(params.section as any);
    if (params.action === 'new') {
      setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] });
      setIsNewRecipe(true);
    }
  }, [params.section, params.action]);

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
    setEditingRecipe(null);
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
      setEditingRecipe(null);
      const [deviceId, token] = await Promise.all([getDeviceId().catch(() => ""), getStoredToken().catch(() => null)]);
      api.recipes.delete(id, deviceId || undefined, token ?? undefined)
      .then(d => { if (d) removeFromRecipeTombstone(id); });
    };
    Alert.alert("Delete Recipe?", "Cannot be undone.", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
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
            {(["feed planner", "recipe builder", "analytics"] as const).map((sec) => (
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
          onCancel={() => setEditingRecipe(null)}
          onDelete={handleDeleteRecipe}
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.mutedForeground} />}
        >
          {section === "analytics" && (
            <View>
              <Text style={s.hubTitle}>Vitality Analytics</Text>
              <ReadingHint body={ACIDIFICATION_HINT} onAbout={() => router.navigate("/logbook")} colors={colors} />
              <AcidificationChart data={acidSeries} hasLivePoint={false} />
              <ReadingHint body={LIFTING_HINT} onAbout={() => router.navigate("/logbook")} colors={colors} />
              <LiftingIndexChart data={liftSeries} selectedFeedNum={null} onSelectFeedNum={() => {}} />
              <ReadingHint body={METABOLIC_HINT} onAbout={() => router.navigate("/logbook")} colors={colors} />
              <FCSScatterPlot sessions={history} selectedFeedNum={null} onSelectFeedNum={() => {}} />
            </View>
          )}

          {section === "recipe builder" && (
            <RecipeBuilderListView
              recipes={recipes}
              displayedRecipes={displayedRecipes}
              populatedLetters={populatedLetters}
              letterFilter={letterFilter}
              refreshing={refreshing}
              onNewRecipe={() => { setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] }); setIsNewRecipe(true); }}
              onEditRecipe={(r) => { setEditingRecipe(r); setIsNewRecipe(false); }}
              onPrintRecipe={(r) => printHtml(buildRecipeHtml(r))}
              onShareRecipe={(r) => shareHtmlAsPdf(buildRecipeHtml(r), r.name)}
              onSetLetterFilter={setLetterFilter}
              onRefresh={loadData}
            />
          )}

          {section === "feed planner" && (
            <PeakWindowAdvisor
              history={history}
              onApplyRecipe={(recipe) => {
                router.push({
                  pathname: "/",
                  params: {
                    starter: recipe.starter.toString(),
                    flour: recipe.flour.toString(),
                    water: recipe.water.toString(),
                    autoStart: "true"
                  }
                });
              }}
            />
          )}
        </ScrollView>
      )}

      <PhasePickerModal visible={showPhasePicker} availableCategories={PHASE_CATEGORIES} onConfirm={handleConfirmPhases} onClose={() => setShowPhasePicker(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  toggleWrap: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  toggle: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 3, gap: 3 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: "center" },
  toggleText: { fontSize: 11, fontFamily: fonts.sansSemiBold, letterSpacing: 0.5 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  hubTitle: { ...typography.headlineLgMobile, marginBottom: 12 },
});