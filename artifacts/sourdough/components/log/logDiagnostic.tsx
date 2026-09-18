// artifacts/sourdough/components/log/logDiagnostic.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BAKE_HISTORY_KEY, BAKE_KEY, BakeHistoryItem, SavedRecipe, DefectSlug } from "@/lib/recipeTypes";
import { DEFECT_LIBRARY, generateDiagnosticSummary, DiagnosticPayload, GlossaryCategory } from "@/lib/diagnosticLogic";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { writeRecipesLocal, archiveIntermediateIterations, loadAll, updateBakeOutcomeInHistory, upsertRecipeRemote } from "@/lib/recipeStorage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken } from "@/lib/auth";
import { resolveRootMasterId } from "@/lib/recipeUtils";

const CATEGORY_ORDER: GlossaryCategory[] = ['crumb', 'shape', 'crust', 'volume'];

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
  const [isDirty, setIsDirty] = useState(false);
  const [summary, setSummary] = useState<DiagnosticPayload | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const [historyRaw, activeRaw] = await Promise.all([
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        AsyncStorage.getItem(BAKE_KEY),
      ]);

      let combined: BakeHistoryItem[] = [];
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed)) combined = [...parsed];
      }

      if (activeRaw) {
        const parsedActive = JSON.parse(activeRaw);
        const activeBakes: BakeHistoryItem[] = Array.isArray(parsedActive) ? parsedActive : [parsedActive];
        activeBakes.forEach(ab => {
          if (ab && ab.id && !combined.some(h => h.id === ab.id)) {
            combined.push(ab);
          }
        });
      }

      setHistory(combined);

      // 1. Try to find the specific bake requested via params
      if (bakeId) {
        const found = combined.find(b => b.id === bakeId);
        if (found) {
          setSelectedBake(found);
          return;
        }
      }

      // 2. If no specific bake or it was deleted, look for the first unrated bake
      const unrated = combined.find(b => !b.outcome?.overallScore);
      if (unrated) {
        setSelectedBake(unrated);
        return;
      }

      // 3. Fallback: stay on current if valid, or take the most recent
      if (selectedBake?.id) {
        const stillExists = combined.find(b => b.id === selectedBake.id);
        if (stillExists) {
          setSelectedBake(stillExists);
          return;
        }
      }

      if (combined.length > 0) {
        setSelectedBake(combined[0]);
      } else {
        setSelectedBake(null);
      }
    } catch (e) {
      console.error("[Diagnostic] loadHistory failed", e);
      setHistory([]);
      setSelectedBake(null);
    }
  }, [selectedBake?.id, bakeId]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  useEffect(() => {
    if (selectedBake) {
      setCrumbScore(selectedBake.outcome?.crumbScore || 0);
      setCrustScore(selectedBake.outcome?.crustScore || 0);
      setFlavorScore(selectedBake.outcome?.flavorScore || 0);
      setSelectedDefects(selectedBake.outcome?.defects || []);

      const existingNotes = selectedBake.outcome?.reflectionNotes || selectedBake.outcome?.iterationHypothesis || "";
      setHypothesis(existingNotes);
      if (existingNotes) setIsDirty(true);
    }
  }, [selectedBake]);

  // Determine if telemetry is authentic (user logged readings or set specific times)
  const isTelemetryAuthentic = useMemo(() => {
    if (!selectedBake) return false;
    const bulk = selectedBake.phases?.find(p => p.key === 'bulk_fermenting');
    if (!bulk) return false;
    // Authentic if readings exist OR startedAt/completedAt were actually set (not null)
    const hasReadings = Array.isArray(bulk.readings) && bulk.readings.length > 0;
    return hasReadings || (!!bulk.startedAt && !!bulk.completedAt);
  }, [selectedBake]);

  useEffect(() => {
    if (selectedBake) {
      const payload = generateDiagnosticSummary(selectedBake as any, selectedDefects, isTelemetryAuthentic);
      setSummary(payload);

      // Pre-fill hypothesis if user hasn't typed anything yet
      if (!isDirty && payload.suggestedHypothesis) {
        setHypothesis(payload.suggestedHypothesis);
      }
    }
  }, [selectedDefects, selectedBake, isTelemetryAuthentic, isDirty]);

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

              const masterId = resolveRootMasterId(sourceRecipe, recipes);
              const deviceId = await getDeviceId();
              const token = await getStoredToken().catch(() => null);

              const outcome = {
                crumbScore: crumbScore as any,
                crustScore: crustScore as any,
                flavorScore: flavorScore as any,
                overallScore: overallScore as any,
                defects: selectedDefects as any,
                reflectionNotes: hypothesis,
              };
              await updateBakeOutcomeInHistory(selectedBake.id, outcome);

              const newName = sourceRecipe.name.includes('(Iterated)') ? sourceRecipe.name : `${sourceRecipe.name} (Iterated)`;
              const duplicated = await api.recipes.duplicate(
                sourceRecipe.id,
                newName,
                deviceId,
                token ?? undefined
              );

              const iterations = recipes.filter(r => resolveRootMasterId(r, recipes) === masterId);
              const versionNumber = iterations.length + 2;

              const newSaved: SavedRecipe = {
                id: duplicated.id,
                name: duplicated.name,
                overview: `Iteration Notes: ${hypothesis}${selectedBake.notes ? `\n\nBench Journal: ${selectedBake.notes}` : ''}\n\nObserved Traits: ${selectedDefects.map(d => DEFECT_LIBRARY[d].label).join(', ')}`,
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
                isUneditedIteration: true,
                clonedFromBakeName: selectedBake.recipeName,
                diagnosticHypothesis: hypothesis,
              };

              const updated = [newSaved, ...recipes];
              await writeRecipesLocal(updated);
              await upsertRecipeRemote(newSaved);
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

  const groupedDefects = useMemo(() => {
    const groups: Record<GlossaryCategory, DefectSlug[]> = {
      crust: [], crumb: [], shape: [], volume: []
    };
    (Object.keys(DEFECT_LIBRARY) as DefectSlug[]).forEach(slug => {
      groups[DEFECT_LIBRARY[slug].category].push(slug);
    });
    return groups;
  }, []);

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
        <Text style={[s.title, { color: colors.foreground }]}>Diagnostic Review</Text>

      {/* Bake Selector / Summary */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
        <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>{new Date(selectedBake.startedAt).toLocaleDateString()}</Text>
        <Text style={[s.bakeName, { color: colors.foreground }]}>{selectedBake.recipeName}</Text>
      </View>

      {/* Bench Notes Integration */}
      <View style={s.section}>
        <Text selectable={true} style={[s.sectionTitle, { color: colors.mutedForeground }]}>Bench Notes</Text>
        <View style={[s.notesBox, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          {selectedBake.notes ? (
            <Text selectable={true} style={{ color: colors.foreground, fontFamily: fonts.sans }}>{selectedBake.notes}</Text>
          ) : (
            <Text selectable={true} style={{ color: colors.mutedForeground, fontFamily: fonts.sans, fontStyle: 'italic', fontSize: 13 }}>
              No bench notes recorded for this session.
            </Text>
          )}
        </View>
      </View>

      {/* Trait Tagging (Grouped) */}
      {CATEGORY_ORDER.map(cat => {
        const categorySelected = groupedDefects[cat].filter(slug => selectedDefects.includes(slug));
        const categoryTargets = groupedDefects[cat].filter(slug => DEFECT_LIBRARY[slug].type === 'target');
        const categoryDefects = groupedDefects[cat].filter(slug => DEFECT_LIBRARY[slug].type === 'defect');

        const renderChip = (slug: DefectSlug) => {
          const term = DEFECT_LIBRARY[slug];
          const isSelected = selectedDefects.includes(slug);
          const isTarget = term.type === 'target';

          return (
            <Pressable
              key={slug}
              onPress={() => !isGraded && toggleDefect(slug)}
              disabled={isGraded}
              style={[
                s.defectChip,
                {
                  backgroundColor: isSelected ? (isTarget ? colors.accent : colors.primary) : colors.muted,
                  borderColor: isSelected ? (isTarget ? colors.accent : colors.primary) : (isTarget ? colors.accent + '40' : colors.border),
                  borderWidth: isTarget ? 1.5 : 1,
                }
              ]}
            >
              <Text style={[
                s.defectChipText,
                { color: isSelected ? (isTarget ? colors.accentForeground : colors.primaryForeground) : colors.foreground }
              ]}>
                {term.label}
              </Text>
              {isTarget && !isSelected && <Ionicons name="sparkles" size={10} color={colors.accent} style={{ marginLeft: 4 }} />}
            </Pressable>
          );
        };

        return (
          <View key={cat} style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>{cat.toUpperCase()}</Text>

            <View style={s.cardStack}>
              {/* Targets Segment */}
              <View style={s.defectGrid}>
                {categoryTargets.map(renderChip)}
              </View>

              {/* Visual Divider */}
              <View style={[s.divider, { backgroundColor: colors.border }]} />

              {/* Defects Segment */}
              <View style={s.defectGrid}>
                {categoryDefects.map(renderChip)}
              </View>
            </View>

            {/* Field Notes Stack for Category */}
            {categorySelected.length > 0 && (
              <Animated.View entering={FadeIn.duration(300)} style={s.fieldNotesStack}>
                {categorySelected.map(slug => (
                  <View key={slug} style={s.fieldNoteItem}>
                    <Text selectable={true} style={[s.fieldNoteBullet, { color: DEFECT_LIBRARY[slug].type === 'target' ? colors.accent : colors.primary }]}>—</Text>
                    <Text selectable={true} style={[s.fieldNoteText, { color: colors.mutedForeground }]}>
                      <Text selectable={true} style={s.fieldNoteName}>{DEFECT_LIBRARY[slug].label}:</Text>{" "}
                      {DEFECT_LIBRARY[slug].shortDefinition}
                    </Text>
                  </View>
                ))}
              </Animated.View>
            )}
          </View>
        );
      })}

      {/* Unified Diagnostic Summary */}
      {summary && (
        <View style={s.section}>
          <Text selectable={true} style={[s.sectionTitle, { color: colors.mutedForeground }]}>Analysis Results</Text>
          <View style={[s.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
            <View style={s.summaryHeader}>
              <Text selectable={true} style={[s.summaryHeaderText, { color: colors.foreground }]}>─── DIAGNOSTIC SUMMARY ───</Text>
            </View>

            <View style={s.statusRowWrap}>
              <View style={[s.statusBadge, { backgroundColor: summary.bulkStatus.includes('OPTIMAL') ? colors.accent : colors.primary }]}>
                <Text selectable={true} style={[s.statusBadgeText, { color: colors.primaryForeground }]}>{summary.bulkStatus.replace('FERMENTATION', 'FERM')}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: summary.proofStatus.includes('OPTIMAL') ? colors.accent : colors.primary }]}>
                <Text selectable={true} style={[s.statusBadgeText, { color: colors.primaryForeground }]}>{summary.proofStatus}</Text>
              </View>
              {summary.iterationStatus === 'LOCK' && (
                 <View style={[s.statusBadge, { backgroundColor: colors.accent }]}>
                   <Text selectable={true} style={[s.statusBadgeText, { color: colors.accentForeground }]}>LOCK BASELINE</Text>
                 </View>
              )}
            </View>

            <Text selectable={true} style={[s.summarySectionTitle, { color: colors.foreground }]}>1. ROOT CAUSE ANALYSIS</Text>
            <Text selectable={true} style={[s.summaryBody, { color: colors.foreground }]}>{summary.rootCause}</Text>

            <Text selectable={true} style={[s.summarySectionTitle, { color: colors.foreground }]}>2. TRIGGERING SYMPTOMS</Text>
            {summary.triggeringSymptoms.length > 0 ? (
              summary.triggeringSymptoms.map((symptom, i) => (
                <View key={i} style={s.symptomItem}>
                  <Text selectable={true} style={[s.symptomBullet, { color: colors.primary }]}>•</Text>
                  <Text selectable={true} style={[s.summaryBody, { color: colors.mutedForeground }]}>{symptom}</Text>
                </View>
              ))
            ) : (
              <Text selectable={true} style={[s.summaryBody, { color: colors.mutedForeground, fontStyle: 'italic' }]}>No specific traits tagged.</Text>
            )}

            <Text selectable={true} style={[s.summarySectionTitle, { color: colors.foreground }]}>3. ACTIONS FOR NEXT BAKE</Text>
            {summary.actions.map((action, i) => (
              <View key={i} style={s.actionItem}>
                <Text selectable={true} style={[s.actionBullet, { color: colors.accent }]}>•</Text>
                <Text selectable={true} style={[s.summaryBody, { color: colors.foreground }]}>{action}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Scoring Section */}
      <View style={s.section}>
        <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>Outcome Scoring</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <StarRating label="Crumb Structure" score={crumbScore} onSet={setCrumbScore} />
          <StarRating label="Crust & Volume" score={crustScore} onSet={setCrustScore} />
          <StarRating label="Flavor Profile" score={flavorScore} onSet={setFlavorScore} />
        </View>
      </View>

      {/* Iteration Hypothesis / Final Notes */}
      <View style={s.section}>
        <View style={s.hypothesisHeader}>
          <Text style={[s.sectionTitle, { color: colors.mutedForeground, marginBottom: 0 }]}>
            {isGraded ? "Bake Review" : (isSuccessful ? "Final Notes (Optional)" : "Iteration Hypothesis")}
          </Text>
          {(!isDirty && !!summary?.suggestedHypothesis && !isGraded) && (
            <View style={[s.draftBadge, { backgroundColor: colors.accent + '15' }]}>
               <Text style={[s.draftBadgeText, { color: colors.accent }]}>✨ Smart Draft</Text>
            </View>
          )}
        </View>

        <View style={s.inputContainer}>
          <TextInput
            style={[
              s.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: (!isDirty && !!summary?.suggestedHypothesis) ? colors.mutedForeground : colors.foreground,
                borderWidth: 1,
                paddingRight: 40
              }
            ]}
            placeholder={isGraded ? "No notes recorded." : (isSuccessful ? "Any final thoughts on this successful bake?" : "What will you change next time?") }
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={hypothesis}
            onChangeText={(text) => {
              setHypothesis(text);
              setIsDirty(true);
            }}
            editable={!isGraded}
          />

          {(!isGraded && hypothesis.length > 0) && (
             <Pressable
               style={s.clearBtn}
               onPress={() => {
                 setHypothesis("");
                 setIsDirty(true);
                 Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
               }}
             >
               <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
             </Pressable>
          )}
        </View>

        {(!isGraded) && (
          <View style={s.hypothesisFooter}>
             {(!isDirty && !!summary?.suggestedHypothesis) ? (
               <Text style={[s.subLabel, { color: colors.mutedForeground }]}>
                 Edit, clear, or accept this hypothesis for your next bake.
               </Text>
             ) : (
               (isDirty && !!summary?.suggestedHypothesis) && (
                 <Pressable
                   onPress={() => {
                     setHypothesis(summary.suggestedHypothesis);
                     setIsDirty(false);
                     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                   }}
                 >
                   <Text style={[s.resetLink, { color: colors.accent }]}>Reset to Suggestion</Text>
                 </Pressable>
               )
             )}
          </View>
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
        <View style={[s.gradedBadge, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30', borderWidth: 1 }]}>
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
  sectionTitle: { fontSize: 11, fontFamily: fonts.sansSemiBold, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  notesBox: { padding: 16, borderRadius: radius.md, borderWidth: 1 },
  starRow: { flexDirection: 'row', gap: 12 },
  cardStack: { gap: 12 },
  divider: { height: 1, marginVertical: 4, opacity: 0.3 },
  defectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defectChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  defectChipText: { fontSize: 13, fontFamily: fonts.sansMedium },
  hypothesisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  draftBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs },
  draftBadgeText: { fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 0.5, textTransform: 'uppercase' },
  inputContainer: { position: 'relative' },
  input: { padding: 16, borderRadius: radius.md, minHeight: 100, textAlignVertical: 'top' },
  clearBtn: { position: 'absolute', right: 12, top: 12, padding: 4 },
  hypothesisFooter: { marginTop: 8, minHeight: 20 },
  subLabel: { fontSize: 12, fontFamily: fonts.sans, fontStyle: 'italic' },
  resetLink: { fontSize: 12, fontFamily: fonts.sansSemiBold, textDecorationLine: 'underline' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  logBtn: { flex: 1, paddingVertical: 18, borderRadius: radius.lg, alignItems: 'center' },
  logBtnText: { fontSize: 16, fontFamily: fonts.sansBold, letterSpacing: 1 },
  iterateBtn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: 'center' },
  iterateBtnText: { fontSize: 16, fontFamily: fonts.sansBold, letterSpacing: 1 },
  gradedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: radius.lg, marginTop: 12 },
  gradedBadgeText: { fontSize: 14, fontFamily: fonts.sansBold, letterSpacing: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  ratingLabel: { fontSize: 13, fontFamily: fonts.sansMedium, textTransform: 'uppercase' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs, marginRight: 8 },
  statusBadgeText: { fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 0.5 },
  fieldNotesStack: {
    marginTop: 12,
    gap: 6,
    paddingLeft: 4,
  },
  fieldNoteItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  fieldNoteBullet: {
    fontSize: 14,
    lineHeight: 18,
    marginTop: -1,
  },
  fieldNoteText: {
    fontSize: 13,
    fontFamily: fonts.sans,
    lineHeight: 18,
    flex: 1,
  },
  fieldNoteName: {
    fontFamily: fonts.sansSemiBold,
  },
  summaryCard: {
    padding: 20,
    borderRadius: radius.lg,
    gap: 16,
  },
  summaryHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  summaryHeaderText: {
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 1,
  },
  statusRowWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summarySectionTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },
  summaryBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  symptomItem: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  symptomBullet: {
    fontSize: 16,
    lineHeight: 22,
  },
  actionItem: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionBullet: {
    fontSize: 16,
    lineHeight: 22,
  },
});
