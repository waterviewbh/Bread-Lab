// artifacts/sourdough/components/log/logDiagnostic.tsx
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert, Image, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BAKE_HISTORY_KEY, BakeHistoryItem, SavedRecipe, DefectSlug } from "@/lib/recipeTypes";
import { DEFECT_LIBRARY, getCorrelationAnalysis, CorrelationResult } from "@/lib/diagnosticLogic";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { writeRecipesLocal, archiveIntermediateIterations, loadAll, updateBakeOutcomeInHistory } from "@/lib/recipeStorage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";

export function DiagnosticSection({ bakeId }: { bakeId?: string }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<BakeHistoryItem[]>([]);
  const [selectedBake, setSelectedBake] = useState<BakeHistoryItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Evaluation State
  const [crumbScore, setCrumbScore] = useState<number>(0);
  const [crustScore, setCrustScore] = useState<number>(0);
  const [flavorScore, setFlavorScore] = useState<number>(0);
  const [selectedDefects, setSelectedDefects] = useState<DefectSlug[]>([]);
  const [hypothesis, setHypothesis] = useState("");
  const [analysisResults, setAnalysisResults] = useState<CorrelationResult[]>([]);

  const loadHistory = useCallback(async () => {
    const raw = await AsyncStorage.getItem(BAKE_HISTORY_KEY);
    if (raw) {
      const parsed: BakeHistoryItem[] = JSON.parse(raw);
      setHistory(parsed);

      // If we have a bakeId, find it. Otherwise refresh the currently selected bake from history.
      const targetId = bakeId || selectedBake?.id;
      if (targetId) {
        const found = parsed.find(b => b.id === targetId);
        if (found) {
            setSelectedBake(found);
            return;
        }
      }

      if (parsed.length > 0 && !selectedBake) {
        setSelectedBake(parsed[0]);
      }
    }
  }, [selectedBake?.id, bakeId]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  // Sync evaluation state with selectedBake outcome when selection changes
  useEffect(() => {
    if (selectedBake) {
      setCrumbScore(selectedBake.outcome?.crumbScore || 0);
      setCrustScore(selectedBake.outcome?.crustScore || 0);
      setFlavorScore(selectedBake.outcome?.flavorScore || 0);
      setSelectedDefects(selectedBake.outcome?.defects || []);
      setHypothesis(selectedBake.outcome?.reflectionNotes || selectedBake.outcome?.iterationHypothesis || "");
    }
  }, [selectedBake]);

  // Update analysis whenever scores, defects or selected bake changes
  useEffect(() => {
    if (selectedBake) {
      // Find previous bake in history for delta calculation
      const idx = history.findIndex(h => h.id === selectedBake.id);
      const previousBake = history[idx + 1];

      // Merge current local evaluation state into the selectedBake object for analysis
      const bakeWithOutcome = {
          ...selectedBake,
          outcome: {
              ...selectedBake.outcome,
              crumbScore,
              crustScore,
              flavorScore,
              overallScore: Math.round((crumbScore + crustScore + flavorScore) / 3) as any
          }
      };

      setAnalysisResults(getCorrelationAnalysis(bakeWithOutcome as any, selectedDefects, previousBake as any));
    }
  }, [selectedDefects, selectedBake, crumbScore, crustScore, flavorScore, history]);

  const toggleDefect = (key: DefectSlug) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDefects(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const overallScore = Math.round((crumbScore + crustScore + flavorScore) / 3);
  const isSuccessful = overallScore >= 4 && selectedDefects.length <= 1;
  const isGraded = !!selectedBake?.outcome?.overallScore;

  const StarRating = ({ label, score, onSet }: { label: string, score: number, onSet: (s: number) => void }) => (
    <View style={s.ratingRow}>
      <Text style={[s.ratingLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={s.starRow}>
        {[1, 2, 3, 4, 5].map(star => (
          <Pressable
            key={star}
            onPress={() => {
              if (isGraded) return;
              onSet(star);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            disabled={isGraded}
          >
            <Ionicons
              name={score >= star ? "star" : "star-outline"}
              size={24}
              color={score >= star ? "#F59E0B" : colors.mutedForeground}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );

  const handleLogOnly = async () => {
    if (!selectedBake || isSaving) return;
    setIsSaving(true);
    Keyboard.dismiss();

    try {
      const outcome = {
        crumbScore: crumbScore as any,
        crustScore: crustScore as any,
        flavorScore: flavorScore as any,
        overallScore: overallScore as any,
        defects: selectedDefects as any,
        reflectionNotes: hypothesis,
      };

      await updateBakeOutcomeInHistory(selectedBake.id, outcome);

      // OPTIMISTIC UI: Lock the screen immediately by updating local state
      setSelectedBake(prev => prev ? { ...prev, outcome } : null);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Bake Logged", "Great work on this bake! It has been recorded in your history.", [
        { text: "Done", onPress: () => router.push("/log") }
      ]);
    } catch (e) {
      console.error("[Diagnostic] LogOnly failed", e);
      Alert.alert("Error", "Failed to save bake log.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleIterate = async () => {
    if (!selectedBake || isSaving) return;
    Alert.alert(
      "Commit Iteration?",
      "Create a new recipe version in Lab based on these notes?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Commit",
          onPress: async () => {
            setIsSaving(true);
            Keyboard.dismiss();
            try {
              const { recipes } = await loadAll();
              const sourceRecipe = recipes.find(r => r.id === selectedBake.recipeId);
              if (!sourceRecipe) throw new Error("Source recipe not found");

              const masterId = sourceRecipe.parentRecipeId || sourceRecipe.id;
              const deviceId = await getDeviceId();
              const token = await getStoredToken().catch(() => null);

              // 0. Update source bake outcome in history
              const outcome = {
                crumbScore: crumbScore as any,
                crustScore: crustScore as any,
                flavorScore: flavorScore as any,
                overallScore: overallScore as any,
                defects: selectedDefects as any,
                reflectionNotes: hypothesis,
              };
              await updateBakeOutcomeInHistory(selectedBake.id, outcome);

              // 1. Duplicate via API
              const newName = sourceRecipe.parentRecipeId ? sourceRecipe.name : `${sourceRecipe.name} (Iterated)`;
              const duplicated = await api.recipes.duplicate(
                sourceRecipe.id,
                newName,
                deviceId,
                token ?? undefined
              );

              // 2. Map to SavedRecipe and apply metadata
              const iterations = recipes.filter(r => r.parentRecipeId === masterId);
              const versionNumber = iterations.length + 2; // +1 for new, +1 for Master vs Iteration start

              const currentAnalysis = analysisResults.find(r => r.defect === selectedDefects[0]); // Using prioritized first

              const newSaved: SavedRecipe = {
                id: duplicated.id,
                name: duplicated.name,
                overview: `Iteration Notes: ${hypothesis}${selectedBake.notes ? `\n\nBench Journal: ${selectedBake.notes}` : ''}\n\nObserved Defects: ${selectedDefects.map(d => DEFECT_LIBRARY[d].displayName).join(', ')}`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                phases: duplicated.phases.map((p: any) => ({
                  key: p.key,
                  name: p.name,
                  ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
                  instructions: Array.isArray(p.instructions) ? p.instructions : [],
                })),
                parentRecipeId: masterId,
                versionLabel: `v1.${versionNumber}`,
                yieldValue: sourceRecipe.yieldValue,
              };

              // Persist the recommendation context if any
              if (currentAnalysis?.appliedDelta) {
                  // We store this in the bake outcome when the NEXT bake is saved
                  // But for now, we just pass the info to Lab
              }

              // 3. Update Local
              const updated = [newSaved, ...recipes];
              await writeRecipesLocal(updated);

              // 4. Archive intermediate versions (Stack of 3 logic)
              await archiveIntermediateIterations(masterId);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.push({ pathname: "/lab", params: { section: "recipe builder" } });
            } catch (e) {
              console.error("[Diagnostic] Iterate failed", e);
              Alert.alert("Error", "Failed to create iteration.");
            } finally {
              setIsSaving(false);
            }
          }
        }
      ]
    );
  };

  if (!selectedBake) {
    return (
      <View style={s.empty}>
        <Text style={{ color: colors.mutedForeground }}>No bakes found to evaluate.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 140 : 20}
    >
      <ScrollView
        contentContainerStyle={[s.container, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.title}>Diagnostic Review</Text>

      {/* Bake Selector / Summary */}
      <View style={[s.card, { backgroundColor: colors.muted }]}>
        <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>{new Date(selectedBake.startedAt).toLocaleDateString()}</Text>
        <Text style={s.bakeName}>{selectedBake.recipeName}</Text>
      </View>

      {/* Bench Notes Integration */}
      {selectedBake.notes && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Bench Notes (Overlay Journal)</Text>
          <View style={[s.notesBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.foreground, fontFamily: fonts.sans }}>{selectedBake.notes}</Text>
          </View>
        </View>
      )}

      {/* Defect Tagging */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Structural Defects</Text>
        <View style={s.defectGrid}>
          {(Object.keys(DEFECT_LIBRARY) as DefectSlug[]).map(key => (
            <Pressable
              key={key}
              onPress={() => toggleDefect(key)}
              style={[
                s.defectChip,
                {
                  backgroundColor: selectedDefects.includes(key) ? colors.primary : colors.muted,
                  borderColor: selectedDefects.includes(key) ? colors.primary : colors.border
                }
              ]}
            >
              <Text style={[
                s.defectChipText,
                { color: selectedDefects.includes(key) ? colors.primaryForeground : colors.foreground }
              ]}>
                {DEFECT_LIBRARY[key].displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Analysis Insights & Recommendation */}
      {analysisResults.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Diagnostic Analysis</Text>
          {analysisResults.map((res, i) => (
            <View key={i} style={[
              s.analysisCard,
              {
                backgroundColor: res.confirmed ? colors.accent + '10' : colors.card,
                borderColor: res.confirmed ? colors.accent : colors.border,
                marginBottom: 12
              }
            ]}>
              <View style={s.analysisHeader}>
                <Feather name={res.confirmed ? "activity" : "search"} size={16} color={res.confirmed ? colors.accent : colors.mutedForeground} />
                <Text style={[s.analysisTitle, { color: res.confirmed ? colors.accent : colors.foreground }]}>
                  {DEFECT_LIBRARY[res.defect].displayName}
                </Text>
                {res.terminationStatus && res.terminationStatus !== 'CONTINUE' && (
                  <View style={[s.statusBadge, { backgroundColor: res.terminationStatus === 'OVERSHOOT' ? colors.accent : colors.primary }]}>
                    <Text style={[s.statusBadgeText, { color: colors.primaryForeground }]}>{res.terminationStatus}</Text>
                  </View>
                )}
              </View>

              <Text style={[s.analysisText, { color: colors.foreground }]}>{res.insight}</Text>

              {res.assumptionWarning && (
                <View style={[s.warningBox, { backgroundColor: colors.primary + '10' }]}>
                   <Feather name="info" size={14} color={colors.primary} />
                   <Text style={[s.warningText, { color: colors.primary }]}>
                     {res.assumptionWarning} {res.recommendation ? "Analysis relies on these baselines for the recommendation." : ""}
                   </Text>
                </View>
              )}

              {res.recommendation && (
                <View style={[s.recommendationBox, { backgroundColor: colors.muted }]}>
                   <Feather name="zap" size={14} color={colors.accent} />
                   <View style={{ flex: 1 }}>
                     <Text style={[s.recommendationLabel, { color: colors.mutedForeground }]}>RECOMMENDED INTERVENTION</Text>
                     <Text style={[s.recommendationText, { color: colors.foreground }]}>{res.recommendation}</Text>
                   </View>
                </View>
              )}

              {res.contributingFactors.map((factor, j) => (
                <View key={j} style={s.factorRow}>
                  <View style={[s.factorDot, { backgroundColor: colors.accent }]} />
                  <Text style={[s.factorText, { color: colors.mutedForeground }]}>{factor}</Text>
                </View>
              ))}
              <Pressable style={s.learnMore} onPress={() => router.push({ pathname: "/log", params: { section: "resources", slug: res.defect } })}>
                <Text style={[s.learnMoreText, { color: colors.accent }]}>Science Deep Dive →</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Scoring Section */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Outcome Scoring</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StarRating label="Crumb Structure" score={crumbScore} onSet={setCrumbScore} />
          <StarRating label="Crust & Volume" score={crustScore} onSet={setCrustScore} />
          <StarRating label="Flavor Profile" score={flavorScore} onSet={setFlavorScore} />
        </View>
      </View>

      {/* Iteration Hypothesis / Final Notes */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{isGraded ? "Bake Review" : (isSuccessful ? "Final Notes (Optional)" : "Iteration Hypothesis")}</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder={isGraded ? "No notes recorded." : (isSuccessful ? "Any final thoughts on this successful bake?" : (analysisResults.map(r => r.recommendation).filter(Boolean).join(' | ') || "What will you change next time?"))}
          placeholderTextColor={colors.mutedForeground}
          multiline
          value={hypothesis}
          onChangeText={setHypothesis}
          editable={!isGraded}
        />
        {!isGraded && !isSuccessful && analysisResults.some(r => r.recommendation) && (
          <Text style={[s.hypothesisHint, { color: colors.mutedForeground }]}>
            Hint: {analysisResults.find(r => r.recommendation)?.recommendation}
          </Text>
        )}
      </View>

      {!isGraded && (
        <View style={s.actionRow}>
          {isSuccessful && (
            <Pressable
              style={[s.logBtn, { borderColor: colors.primary, borderWidth: 1, opacity: isSaving ? 0.5 : 1 }]}
              onPress={handleLogOnly}
              disabled={isSaving}
            >
              <Text style={[s.logBtnText, { color: colors.primary }]}>{isSaving ? "SAVING..." : "LOG & FINISH"}</Text>
            </Pressable>
          )}
          <Pressable
            style={[s.iterateBtn, { backgroundColor: colors.primary, flex: isSuccessful ? 1.5 : 1, opacity: isSaving ? 0.5 : 1 }]}
            onPress={handleIterate}
            disabled={isSaving}
          >
            <Text style={[s.iterateBtnText, { color: colors.primaryForeground }]}>
              {isSaving ? "SAVING..." : (isSuccessful ? "ITERATE ANYWAY" : "COMMIT ITERATION")}
            </Text>
          </Pressable>
        </View>
      )}

      {isGraded && (
        <View style={[s.gradedBadge, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
            <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
            <Text style={[s.gradedBadgeText, { color: colors.primary }]}>DIAGNOSTIC COMPLETE</Text>
        </View>
      )}

    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { padding: 20, paddingBottom: 100 },
  title: { ...typography.headlineLgMobile, marginBottom: 20 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: radius.lg, marginBottom: 20 },
  eyebrow: { fontSize: 12, fontFamily: fonts.sans, textTransform: 'uppercase', marginBottom: 4 },
  bakeName: { fontSize: 20, fontFamily: fonts.serifBold },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontFamily: fonts.sansSemiBold, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestionBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.md, borderWidth: 1, marginBottom: 24 },
  suggestionText: { fontSize: 13, fontFamily: fonts.sansMedium, lineHeight: 18 },
  notesBox: { padding: 16, borderRadius: radius.md, borderWidth: 1 },
  starRow: { flexDirection: 'row', gap: 12 },
  defectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defectChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1 },
  defectChipText: { fontSize: 13, fontFamily: fonts.sansMedium },
  input: { padding: 16, borderRadius: radius.md, borderWidth: 1, minHeight: 100, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  logBtn: { flex: 1, paddingVertical: 18, borderRadius: radius.lg, alignItems: 'center' },
  logBtnText: { fontSize: 16, fontFamily: fonts.sansBold, letterSpacing: 1 },
  iterateBtn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: 'center' },
  iterateBtnText: { fontSize: 16, fontFamily: fonts.sansBold, letterSpacing: 1 },
  gradedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: radius.lg, borderWidth: 1, marginTop: 12 },
  gradedBadgeText: { fontSize: 14, fontFamily: fonts.sansBold, letterSpacing: 1 },
  analysisCard: { padding: 16, borderRadius: radius.md, borderWidth: 1, gap: 8 },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  analysisTitle: { fontSize: 12, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  analysisText: { fontSize: 14, fontFamily: fonts.sans, lineHeight: 20 },
  factorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 },
  factorDot: { width: 4, height: 4, borderRadius: 2 },
  factorText: { fontSize: 12, fontFamily: fonts.mono },
  learnMore: { marginTop: 4 },
  learnMoreText: { fontSize: 13, fontFamily: fonts.sansSemiBold },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  ratingLabel: { fontSize: 13, fontFamily: fonts.sansMedium, textTransform: 'uppercase' },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs },
  statusBadgeText: { fontSize: 9, fontFamily: fonts.sansBold },
  recommendationBox: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, marginTop: 8, alignItems: 'center' },
  recommendationLabel: { fontSize: 9, fontFamily: fonts.sansBold, letterSpacing: 0.5, marginBottom: 2 },
  recommendationText: { fontSize: 13, fontFamily: fonts.sansSemiBold, flex: 1, lineHeight: 18 },
  warningBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: radius.sm, marginTop: 4, alignItems: 'center' },
  warningText: { fontSize: 11, fontFamily: fonts.sansMedium, flex: 1 },
  hypothesisHint: { fontSize: 12, fontFamily: fonts.sansMedium, marginTop: 8, fontStyle: 'italic' },
});
