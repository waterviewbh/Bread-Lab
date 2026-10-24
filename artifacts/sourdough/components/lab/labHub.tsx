// artifacts/sourdough/components/lab/labHub.tsx
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing, typography } from "@/constants/theme";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";

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
import { sortRecipePhases, createEmptyPhase, resolveRootMasterId } from "@/lib/recipeUtils";
import { useSyncStatus } from "@/contexts/SyncContext";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import { PhasePickerModal } from "@/components/recipe/PhasePickerModal";
import { BakerReviewModal } from "@/components/recipe/BakerReviewModal";
import { CandidateReviewController, CandidateReviewControllerRef } from "@/components/recipe/CandidateReviewController";
import { PasteCandidateModal } from "@/components/recipe/PasteCandidateModal";
import { loadCandidates, removeCandidate, CandidateRecord, formatCandidateSharedAt, getCandidatesKey } from "@/lib/candidateStorage";
import { useShareCandidate } from "@/contexts/ShareCandidateContext";

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
  const [builderSubcard, setBuilderSubcard] = useState<"theories" | "candidates">("theories");

  // ── Candidates State ───────────────────────────────────────────────────────
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRecord | null>(null);
  const [showCandidateReviewModal, setShowCandidateReviewModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [openedFromQuickAction, setOpenedFromQuickAction] = useState(false);
  const [hasSuccessfullyImported, setHasSuccessfullyImported] = useState(false);
  const reviewControllerRef = useRef<CandidateReviewControllerRef>(null);
  const { subscribeCandidatesChanged } = useShareCandidate();

  const reloadCandidates = useCallback(async () => {
    try {
      const key = await getCandidatesKey();
      const raw = await AsyncStorage.getItem(key);
      if (raw === null) {
        // Initial fixture or empty
        await AsyncStorage.setItem(key, JSON.stringify([]));
      }
      const list = await loadCandidates();
      setCandidates(list);
    } catch (e) {
      console.error("[LabHub] reloadCandidates failed", e);
    }
  }, []);

  const handleOpenCandidateReview = (record: CandidateRecord) => {
    setSelectedCandidate(record);
    setShowCandidateReviewModal(true);
  };

  const handlePromptDiscardCard = (record: CandidateRecord) => {
    const candidateName =
      record.extractionResult.status === 'single_candidate'
        ? record.extractionResult.candidate.name
        : record.extractionResult.status === 'multiple_candidates'
        ? record.extractionResult.candidates[0]?.name
        : 'this candidate';

    Alert.alert(
      'Discard Candidate',
      `Are you sure you want to permanently discard "${candidateName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await removeCandidate(record.id);
            await reloadCandidates();
          },
        },
      ]
    );
  };

  const handleDiscardCandidate = () => {
    setShowCandidateReviewModal(false);
    setSelectedCandidate(null);
    reloadCandidates();
  };

  const handleSaveCandidateSuccess = async () => {
    setShowCandidateReviewModal(false);
    setSelectedCandidate(null);
    await Promise.all([
      reloadCandidates(),
      loadData(),
    ]);
  };

  useEffect(() => {
    reloadCandidates();
    const unsubscribe = subscribeCandidatesChanged(reloadCandidates);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [reloadCandidates, subscribeCandidatesChanged]);

  const handleSwitchBuilderSubcard = async (target: "theories" | "candidates") => {
    if (builderSubcard === target) return;
    if (builderSubcard === "candidates" && showCandidateReviewModal) {
      const success = await reviewControllerRef.current?.saveChanges();
      if (!success) {
        return;
      }
      setShowCandidateReviewModal(false);
      setSelectedCandidate(null);
      await Promise.all([
        reloadCandidates(),
        loadData(),
      ]);
    }
    setBuilderSubcard(target);
    Haptics.selectionAsync();
  };

  const [history, setHistory] = useState<any[]>([]);
  const [bakeHistory, setBakeHistory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [editingRecipe, setEditingRecipe] = useState<any | null>(null);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
        const sorted = Array.isArray(parsed)
          ? parsed.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))
          : [];
        setHistory(sorted);
      }
      if (bakeHistRaw) setBakeHistory(JSON.parse(bakeHistRaw));
      setRecipes(recipeData.recipes);
      await reloadCandidates();
    } catch (e) {
      console.error("[LabHub] Load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, [reloadCandidates]);

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
      router.setParams({ action: undefined });
    }
    if (params.action === 'import' && params.subcard === 'candidates') {
      setSection("recipe builder");
      setBuilderSubcard("candidates");
      setShowPasteModal(true);
      setOpenedFromQuickAction(true);
      setHasSuccessfullyImported(false);
      router.setParams({ action: undefined, subcard: undefined });
    }
  }, [params.section, params.action, params.subcard, editingRecipe, router]);

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
    if (!editingRecipe.name || !editingRecipe.name.trim()) {
      Alert.alert("Name required", "Give your recipe a name before saving.");
      return;
    }
    const now = Date.now();
    const saved = {
      ...editingRecipe,
      name: editingRecipe.name.trim(),
      updatedAt: isNewRecipe ? undefined : now,
      isUneditedIteration: false
    };
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
          token ?? undefined,
          true
        );

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
          parentRecipeId: undefined,
          versionLabel: duplicatedApi.version_label || "Master"
        };

        const updated = [newSaved, ...recipes];
        setRecipes(updated);
        await writeRecipesLocal(updated);
        await upsertRecipeRemote(newSaved);
        reportSyncSuccess();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        setEditingRecipe(newSaved);
        setIsNewRecipe(false);
      } catch (e) {
        console.error("[LabHub] Duplicate failed", e);
        reportSyncFailure();
        Alert.alert("Error", "Failed to duplicate recipe.");
      }
    };

    doDuplicate(`Copy of ${recipe.name}`);
  };

  const handleConfirmPhases = (keys: string[]) => {
    setEditingRecipe((prev: any) => {
      if (!prev) return null;
      const existingKeys = new Set((prev.phases || []).map((p: any) => p.key));
      const filteredKeys = keys.filter(k => !existingKeys.has(k));
      const newPhases = filteredKeys.map(k => {
        const def = PHASE_DEFINITIONS.find(d => d.key === k);
        return createEmptyPhase(k, def?.name || k);
      });
      return { ...prev, phases: sortRecipePhases([...(prev.phases || []), ...newPhases]) };
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
              <Pressable
                key={sec}
                onPress={() => { setSection(sec); Haptics.selectionAsync(); }}
                style={[s.toggleBtn, section === sec && { backgroundColor: colors.card }]}
                testID={`${sec.replace(' ', '-')}-tab-toggle`}
              >
                <Text style={[s.toggleText, { color: section === sec ? colors.foreground : colors.mutedForeground }]}>{sec.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Candidates / Theories Subcard Toggle when in Recipe Builder ── */}
      {section === "recipe builder" && !editingRecipe && (
        <View style={{ marginTop: 12, paddingHorizontal: 20 }}>
          <View style={[s.subcardContainer, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Pressable
              onPress={() => handleSwitchBuilderSubcard("candidates")}
              style={[
                s.subcardTab,
                builderSubcard === "candidates" && {
                  backgroundColor: colors.card,
                  shadowColor: "#000",
                  shadowOpacity: 0.06,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 2,
                },
              ]}
              testID="candidates-subcard-tab"
            >
              <Text style={[s.subcardTitle, { color: builderSubcard === "candidates" ? colors.foreground : colors.mutedForeground, fontFamily: builderSubcard === "candidates" ? fonts.sansSemiBold : fonts.sans }]}>
                Candidates {candidates.length > 0 ? `(${candidates.length})` : ""}
              </Text>
              <Text style={[s.subcardSubtitle, { color: colors.mutedForeground }]}>
                Awaiting review
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSwitchBuilderSubcard("theories")}
              style={[
                s.subcardTab,
                builderSubcard === "theories" && {
                  backgroundColor: colors.card,
                  shadowColor: "#000",
                  shadowOpacity: 0.06,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 2,
                },
              ]}
              testID="theories-subcard-tab"
            >
              <Text style={[s.subcardTitle, { color: builderSubcard === "theories" ? colors.foreground : colors.mutedForeground, fontFamily: builderSubcard === "theories" ? fonts.sansSemiBold : fonts.sans }]}>
                Theories
              </Text>
              <Text style={[s.subcardSubtitle, { color: colors.mutedForeground }]}>
                Working recipes
              </Text>
            </Pressable>
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
        <View style={{ flex: 1 }}>
          {section === "analytics" && (
            <ScrollView contentContainerStyle={s.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.mutedForeground} />}>
              <View style={{ paddingHorizontal: 20 }}>
                <Text style={s.hubTitle}>Vitality Analytics</Text>
                <ReadingHint body={ACIDIFICATION_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
                <AcidificationChart data={acidSeries} hasLivePoint={false} />
                <ReadingHint body={LIFTING_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
                <LiftingIndexChart data={liftSeries} selectedFeedNum={null} onSelectFeedNum={() => {}} />
                <ReadingHint body={METABOLIC_HINT} onAbout={() => router.navigate("/log")} colors={colors} />
                <FCSScatterPlot sessions={history} selectedFeedNum={null} onSelectFeedNum={() => {}} />
              </View>
            </ScrollView>
          )}

          {section === "recipe builder" && builderSubcard === "theories" && (
            <RecipeBuilderListView
              recipes={recipes}
              displayedRecipes={displayedRecipes}
              bakeHistory={bakeHistory}
              populatedLetters={populatedLetters}
              letterFilter={letterFilter}
              refreshing={refreshing}
              onNewRecipe={() => { setEditingRecipe({ id: Date.now().toString(), name: "", createdAt: Date.now(), phases: [] }); setIsNewRecipe(true); }}
              onEditRecipe={(r) => { setEditingRecipe({ ...r, phases: sortRecipePhases(r.phases || []) }); setIsNewRecipe(false); }}
              onPrintRecipe={(r) => printHtml(buildRecipeHtml(r))}
              onShareRecipe={(r) => shareHtmlAsPdf(buildRecipeHtml(r), r.name)}
              onDuplicateRecipe={handleDuplicateRecipe}
              onSetLetterFilter={setLetterFilter}
              onRefresh={loadData}
            />
          )}

          {section === "recipe builder" && builderSubcard === "candidates" && (
            <ScrollView
              contentContainerStyle={{
                paddingTop: 24,
                paddingBottom: 120,
                paddingHorizontal: 20,
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.mutedForeground} />}
            >
              <Animated.View entering={FadeIn.duration(300)}>
                <View style={[s.listHeader, { marginBottom: 16 }]}>
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                    Candidates
                  </Text>
                  <Pressable
                    onPress={() => setShowPasteModal(true)}
                    style={({ pressed }) => [
                      s.addBtn,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                    ]}
                    testID="paste-recipe-candidate-btn"
                  >
                    <Feather name="plus" size={14} color={colors.primaryForeground} />
                    <Text style={[s.addBtnText, { color: colors.primaryForeground }]}>
                      Paste Recipe Candidate
                    </Text>
                  </Pressable>
                </View>

                {candidates.length === 0 ? (
                  <View style={[s.emptyCard, { borderColor: colors.border, backgroundColor: colors.card, padding: 32, alignItems: 'center', borderRadius: radius.lg }]}>
                    <Feather name="check-circle" size={28} color={colors.mutedForeground} />
                    <Text style={[s.emptyTitle, { color: colors.foreground, marginTop: 12, ...typography.titleMd }]}>All caught up.</Text>
                    <Text style={[s.emptyBody, { color: colors.mutedForeground, textAlign: 'center', marginTop: 4, ...typography.bodySm }]}>
                      No pending candidates awaiting review.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    {candidates.map((item, idx) => {
                      const candidateObj =
                        item.extractionResult.status === 'single_candidate'
                          ? item.extractionResult.candidate
                          : item.extractionResult.status === 'multiple_candidates'
                          ? item.extractionResult.candidates[0]
                          : null;

                      if (!candidateObj) return null;
                      const sharedAtText = formatCandidateSharedAt(item.sharedAt);

                      return (
                        <View
                          key={item.id || `candidate-${idx}`}
                          style={[s.candidateCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center' }]}
                          testID={idx === 0 ? "candidate-card" : `candidate-card-${idx}`}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[s.candidateName, { color: colors.foreground, ...typography.cardTitle }]}>
                              {candidateObj.name}
                            </Text>
                            {sharedAtText ? (
                              <Text style={[s.candidateSharedAt, { color: colors.mutedForeground, marginTop: 2, ...typography.metaLabel }]} testID="candidate-shared-at">
                                {sharedAtText}
                              </Text>
                            ) : null}
                          </View>

                          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <Pressable
                              style={[s.discardCardBtn, { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.muted }]}
                              onPress={() => handlePromptDiscardCard(item)}
                              testID={idx === 0 ? "discard-candidate-card-btn" : `discard-candidate-card-btn-${idx}`}
                            >
                              <Text style={[s.discardCardBtnText, { color: colors.foreground, fontSize: 12 }]}>Discard</Text>
                            </Pressable>

                            <Pressable
                              style={[s.reviewBtn, { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.primary }]}
                              onPress={() => handleOpenCandidateReview(item)}
                              testID={idx === 0 ? "review-candidate-btn" : `review-candidate-btn-${idx}`}
                            >
                              <Text style={[s.reviewBtnText, { color: colors.primaryForeground, fontSize: 12 }]}>Review</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                <CandidateReviewController
                  ref={reviewControllerRef}
                  visible={showCandidateReviewModal}
                  candidateId={selectedCandidate?.id}
                  extractionResult={selectedCandidate ? selectedCandidate.extractionResult : null}
                  onSaveSuccess={handleSaveCandidateSuccess}
                  onDiscard={handleDiscardCandidate}
                />

                <PasteCandidateModal
                  visible={showPasteModal}
                  onClose={() => {
                    setShowPasteModal(false);
                    if (openedFromQuickAction && !hasSuccessfullyImported) {
                      setOpenedFromQuickAction(false);
                      router.replace('/');
                    } else {
                      setOpenedFromQuickAction(false);
                      setHasSuccessfullyImported(false);
                    }
                  }}
                  onExtractSuccess={async () => {
                    setHasSuccessfullyImported(true);
                    setShowPasteModal(false);
                    await reloadCandidates();
                  }}
                />
              </Animated.View>
            </ScrollView>
          )}

          {section === "feed planner" && (
            <ScrollView contentContainerStyle={s.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.mutedForeground} />}>
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
            </ScrollView>
          )}
        </View>
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
  subcardContainer: {
    flexDirection: "row",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    height: 64,
  },
  subcardTab: {
    flex: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  subcardTitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  subcardSubtitle: {
    fontSize: 11,
    marginTop: 1,
    textAlign: 'center',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { ...typography.titleMd },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  addBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: { ...typography.titleMd, marginTop: 12 },
  emptyBody: { ...typography.bodySm, textAlign: 'center', marginTop: 4 },
  candidateCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  candidateName: { ...typography.cardTitle },
  candidateSharedAt: { ...typography.metaLabel, marginTop: 2 },
  discardCardBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  discardCardBtnText: { fontSize: 12 },
  reviewBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  reviewBtnText: { fontSize: 12 },
});
