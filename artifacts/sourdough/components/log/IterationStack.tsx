import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing } from "@/constants/theme";
import { SavedRecipe } from "@/lib/recipeTypes";
import { Feather, Ionicons } from "@expo/vector-icons";
import { getRecipeDelta, RecipeDelta } from "@/lib/recipeDiff";
import { calculateRecipeMetrics } from "@/lib/recipeUtils";

const CARD_GAP = 12;

interface Props {
  master: SavedRecipe;
  iterations: SavedRecipe[]; // Assumed sorted by date desc
  bakeHistory?: any[];
  onSelect: (recipe: SavedRecipe) => void;
}

/**
 * Renders a "Horizontal Gallery" for a recipe lineage.
 * Allows swiping through the timeline of science.
 */
export function IterationStack({ master, iterations, bakeHistory = [], onSelect }: Props) {
  const colors = useColors();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const CARD_WIDTH = SCREEN_WIDTH * 0.8; // Reverted to 80% per request
  const HORIZONTAL_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;

  const [activeIndex, setActiveIndex] = useState(0);

  // Lineage: Master first, then chronological iterations
  const lineage = [master, ...iterations.slice().reverse()];

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / (CARD_WIDTH + CARD_GAP));
    if (index >= 0 && index < lineage.length && index !== activeIndex) {
      setActiveIndex(index);
    }
  };

  const getScoreForRecipe = (recipeId: string) => {
      const bakes = bakeHistory.filter(h => h.recipeId === recipeId && h.outcome);
      if (bakes.length === 0) return 0;
      return bakes[0].outcome?.overallScore || 0;
  };

  const getLatestLineageScore = (lineageRecipes: SavedRecipe[]) => {
      for (const r of lineageRecipes) {
          const score = getScoreForRecipe(r.id);
          if (score > 0) return score;
      }
      return 0;
  };

  const masterScore = getScoreForRecipe(master.id);
  const progressScore = getLatestLineageScore(iterations);

  const DeltaSummary = ({ recipe, deltas }: { recipe: SavedRecipe, deltas: RecipeDelta[] }) => {
    if (deltas.length === 0) {
      // Show Scientific Baseline
      const metrics = calculateRecipeMetrics(recipe.phases);
      const bulkPhase = recipe.phases.find(p => p.key === 'bulk_fermenting');
      const retardPhase = recipe.phases.find(p => p.key === 'cold_retarding');
      const timeRegex = /(\d+(?:\.\d+)?)\s*(?:min|minute|hour|hr|h)/i;

      const getDuration = (phase?: any) => {
        if (!phase) return null;
        const match = phase.instructions.map((l: any) => l.text).join(' ').match(timeRegex);
        return match ? match[0] : null;
      };

      const bulkTime = getDuration(bulkPhase);
      const retardTime = getDuration(retardPhase);

      return (
        <View style={s.summaryBox}>
          <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>SCIENTIFIC BASELINE (v1.6)</Text>
          <View style={s.deltaGrid}>
            <View style={s.deltaItem}>
               <Text style={[s.deltaItemText, { color: colors.mutedForeground, fontSize: 11 }]}>
                 Hydration: {metrics.hydrationPct}%
               </Text>
            </View>
            <View style={s.deltaItem}>
               <Text style={[s.deltaItemText, { color: colors.mutedForeground, fontSize: 11 }]}>
                 Starter: {Math.round(metrics.inoculationPct)}%
               </Text>
            </View>
            {bulkTime && (
              <View style={s.deltaItem}>
                <Text style={[s.deltaItemText, { color: colors.mutedForeground, fontSize: 11 }]}>
                  Bulk: {bulkTime}
                </Text>
              </View>
            )}
            {retardTime && (
              <View style={s.deltaItem}>
                <Text style={[s.deltaItemText, { color: colors.mutedForeground, fontSize: 11 }]}>
                  Retard: {retardTime}
                </Text>
              </View>
            )}
          </View>
        </View>
      );
    }
    return (
      <View style={s.summaryBox}>
        <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>WHAT CHANGED</Text>
        <View style={s.deltaGrid}>
          {deltas.map((d, i) => (
            <View key={i} style={s.deltaItem}>
              <Feather
                name={d.direction === 'increase' ? 'arrow-up-right' : 'arrow-down-right'}
                size={10}
                color={colors.accent}
              />
              <Text style={[s.deltaItemText, { color: colors.foreground }]}>
                {d.label}: <Text style={{ fontFamily: fonts.monoBold }}>{d.value}</Text>
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: HORIZONTAL_PADDING,
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        disableIntervalMomentum={true}
      >
        {lineage.map((recipe, index) => {
          const isMaster = recipe.id === master.id;
          const deltas = isMaster ? [] : getRecipeDelta(master, recipe);
          const recipeScore = getScoreForRecipe(recipe.id);

          return (
            <Pressable
              key={recipe.id}
              style={[
                s.card,
                {
                  backgroundColor: colors.card,
                  borderColor: isMaster ? colors.primary : colors.border,
                  borderWidth: isMaster ? 2 : 1,
                  width: CARD_WIDTH,
                  marginRight: index === lineage.length - 1 ? 0 : CARD_GAP
                }
              ]}
              onPress={() => onSelect(recipe)}
            >
              <View style={s.cardTop}>
                <View style={s.cardHeader}>
                  {isMaster ? (
                    <View style={s.masterRow}>
                      <View style={[s.masterBadgeBg, { backgroundColor: colors.primary }]}>
                        <Text style={[s.masterBadge, { color: colors.primaryForeground }]}>MASTER</Text>
                      </View>
                      <Feather name="shield" size={12} color={colors.primary} />
                    </View>
                  ) : (
                    <View style={s.versionRow}>
                      <Text style={[s.versionBadge, { color: colors.mutedForeground }]}>
                        {recipe.versionLabel || `Iter #${index}`}
                      </Text>
                      {recipeScore > 0 && (
                         <View style={s.miniScore}>
                            {[1, 2, 3, 4, 5].map(star => (
                               <Ionicons
                                 key={star}
                                 name={recipeScore >= star ? "star" : "star-outline"}
                                 size={10}
                                 color={recipeScore >= star ? "#F59E0B" : colors.muted}
                               />
                            ))}
                            <Text style={s.miniScoreText}>{recipeScore}/5</Text>
                         </View>
                      )}
                    </View>
                  )}
                </View>

                <Text style={s.recipeName} numberOfLines={1}>{recipe.name}</Text>

                {isMaster ? (
                  <View style={s.scoreRow}>
                    {(masterScore > 0 || progressScore > 0) && (
                      <View style={[s.deltaBadge, { backgroundColor: colors.accent + '15' }]}>
                         <Text style={[s.deltaText, { color: colors.accent }]}>
                           Quality Improvement: {masterScore || '—'} → {progressScore || '—'}
                         </Text>
                      </View>
                    )}
                    <Text style={[s.iterCount, { color: colors.mutedForeground }]}>
                      {iterations.length} iterations tracked
                    </Text>
                  </View>
                ) : (
                  <>
                    <DeltaSummary recipe={recipe} deltas={deltas} />
                    {recipe.overview ? (
                       <Text style={[s.iterNote, { color: colors.mutedForeground }]} numberOfLines={2}>
                          {recipe.overview}
                       </Text>
                    ) : null}
                  </>
                )}
              </View>

              <View style={s.cardFooter}>
                 <Text style={[s.dateText, { color: colors.mutedForeground }]}>
                    {new Date(recipe.createdAt).toLocaleDateString()}
                 </Text>
                 <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Lineage Indicator Dots */}
      <View style={s.indicatorRow}>
         {lineage.map((_, i) => (
           <View key={i} style={[s.dot, { backgroundColor: i === activeIndex ? colors.primary : colors.muted }]} />
         ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  scrollContent: { },
  card: {
    padding: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    minHeight: 180,
    justifyContent: 'space-between'
  },
  cardTop: { flex: 1 },
  cardHeader: { height: 24, marginBottom: 8 },
  masterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  masterBadgeBg: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs },
  masterBadge: { fontSize: 9, fontFamily: fonts.sansBold, letterSpacing: 1 },
  versionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  versionBadge: { fontSize: 10, fontFamily: fonts.sansMedium },
  recipeName: { fontSize: 22, fontFamily: fonts.serifBold },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  iterCount: { fontSize: 11, fontFamily: fonts.sans },
  deltaBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  deltaText: { fontSize: 10, fontFamily: fonts.sansBold },
  summaryBox: { marginTop: 12, marginBottom: 8 },
  summaryLabel: { fontSize: 9, fontFamily: fonts.sansBold, letterSpacing: 1, marginBottom: 6 },
  deltaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  deltaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deltaItemText: { fontSize: 12, fontFamily: fonts.sansMedium },
  iterNote: { fontSize: 12, fontFamily: fonts.sans, marginTop: 8, lineHeight: 18 },
  miniScore: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  miniScoreText: { fontSize: 9, fontFamily: fonts.monoBold, color: '#92400E' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  dateText: { fontSize: 10, fontFamily: fonts.sans },
  indicatorRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
