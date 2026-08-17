// artifacts/sourdough/components/log/logDiagnostic.tsx
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert, Image } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BAKE_HISTORY_KEY, BakeHistoryItem, SavedRecipe, DefectSlug } from "@/lib/recipeTypes";
import { DEFECT_LIBRARY, getCorrelationAnalysis, CorrelationResult } from "@/lib/diagnosticLogic";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { writeRecipesLocal, purgeIntermediateIterations, loadAll } from "@/lib/recipeStorage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";

export function DiagnosticSection() {
  const colors = useColors();
  const router = useRouter();
  const [history, setHistory] = useState<BakeHistoryItem[]>([]);
  const [selectedBake, setSelectedBake] = useState<BakeHistoryItem | null>(null);

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
      if (parsed.length > 0 && !selectedBake) {
        setSelectedBake(parsed[0]);
      }
    }
  }, [selectedBake]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

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

  const StarRating = ({ label, score, onSet }: { label: string, score: number, onSet: (s: number) => void }) => (
    <View style={s.ratingRow}>
      <Text style={[s.ratingLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={s.starRow}>
        {[1, 2, 3, 4, 5].map(star => (
          <Pressable key={star} onPress={() => { onSet(star); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
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

  const handleIterate = async () => {
    if (!selectedBake) return;
    Alert.alert(
      "Commit Iteration?",
      "Create a new recipe version in Lab based on these notes?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Commit",
          onPress: async () => {
            try {
              const { recipes } = await loadAll();
              const sourceRecipe = recipes.find(r => r.id === selectedBake.recipeId);
              if (!sourceRecipe) throw new Error("Source recipe not found");

              const masterId = sourceRecipe.parentRecipeId || sourceRecipe.id;
              const deviceId = await getDeviceId();
              const token = await getStoredToken().catch(() => null);

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
                overview: `Iteration Notes: ${hypothesis}\n\nObserved Defects: ${selectedDefects.map(d => DEFECT_LIBRARY[d].displayName).join(', ')}`,
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
    <ScrollView contentContainerStyle={s.container}>
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

      {/* Iteration Hypothesis */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Iteration Hypothesis</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder={analysisResults[0]?.recommendation || "What will you change next time? (e.g., +3% hydration, +30min bulk)"}
          placeholderTextColor={colors.mutedForeground}
          multiline
          value={hypothesis}
          onChangeText={setHypothesis}
        />
      </View>

      <Pressable
        style={[s.iterateBtn, { backgroundColor: colors.primary }]}
        onPress={handleIterate}
      >
        <Text style={[s.iterateBtnText, { color: colors.primaryForeground }]}>COMMIT ITERATION</Text>
      </Pressable>

    </ScrollView>
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
  iterateBtn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: 'center', marginTop: 12 },
  iterateBtnText: { fontSize: 16, fontFamily: fonts.sansBold, letterSpacing: 1 },
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
});
