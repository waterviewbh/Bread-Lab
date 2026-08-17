// artifacts/sourdough/components/log/IterationStack.tsx
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing } from "@/constants/theme";
import { SavedRecipe } from "@/lib/recipeTypes";
import { Feather } from "@expo/vector-icons";

interface Props {
  master: SavedRecipe;
  iterations: SavedRecipe[]; // Assumed sorted by date desc
  onSelect: (recipe: SavedRecipe) => void;
}

/**
 * Renders a "Stack of Cards" for a recipe lineage.
 * Master on top, then 2nd most recent, then most recent on bottom.
 */
export function IterationStack({ master, iterations, onSelect }: Props) {
  const colors = useColors();

  // The user wants: Master on top, 2nd most recent in middle, most recent on bottom.
  // Visual z-index / offset logic:
  // Card 1 (Bottom): Most Recent (iterations[0])
  // Card 2 (Middle): 2nd Most Recent (iterations[1])
  // Card 3 (Top): Master

  const mostRecent = iterations[0];
  const secondRecent = iterations[1];

  return (
    <View style={s.container}>
      {/* Bottom Card (Most Recent) */}
      {mostRecent && (
        <Pressable
          style={[s.card, s.bottomCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => onSelect(mostRecent)}
        >
          <Text style={[s.versionBadge, { color: colors.mutedForeground }]}>{mostRecent.versionLabel || 'vLatest'}</Text>
          <Text style={s.recipeName}>{mostRecent.name}</Text>
        </Pressable>
      )}

      {/* Middle Card (2nd Most Recent) */}
      {secondRecent && (
        <Pressable
          style={[s.card, s.middleCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => onSelect(secondRecent)}
        >
          <Text style={[s.versionBadge, { color: colors.mutedForeground }]}>{secondRecent.versionLabel || 'vPrev'}</Text>
          <Text style={s.recipeName}>{secondRecent.name}</Text>
        </Pressable>
      )}

      {/* Top Card (Master) */}
      <Pressable
        style={[s.card, s.topCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => onSelect(master)}
      >
        <View style={s.header}>
           <Text style={[s.masterBadge, { color: colors.primary }]}>MASTER RECIPE</Text>
           <Feather name="shield" size={14} color={colors.primary} />
        </View>
        <Text style={s.recipeName}>{master.name}</Text>
        <View style={s.scoreRow}>
          {iterations.length > 0 && (
            <View style={[s.deltaBadge, { backgroundColor: colors.accent + '20' }]}>
               <Text style={[s.deltaText, { color: colors.accent }]}>
                 Progress: {iterations[iterations.length - 1].outcome?.overallScore || 0} → {iterations[0].outcome?.overallScore || 0}
               </Text>
            </View>
          )}
          <Text style={[s.iterCount, { color: colors.mutedForeground }]}>
            {iterations.length} iterations
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { height: 180, marginBottom: 24, paddingHorizontal: 10 },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    padding: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  bottomCard: {
    top: 40,
    zIndex: 1,
    transform: [{ scale: 0.9 }],
    opacity: 0.6,
  },
  middleCard: {
    top: 20,
    zIndex: 2,
    transform: [{ scale: 0.95 }],
    opacity: 0.85,
  },
  topCard: {
    top: 0,
    zIndex: 3,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  masterBadge: { fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 1 },
  versionBadge: { fontSize: 10, fontFamily: fonts.sansMedium, marginBottom: 4 },
  recipeName: { fontSize: 22, fontFamily: fonts.serifBold },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  iterCount: { fontSize: 12, fontFamily: fonts.sans },
  deltaBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  deltaText: { fontSize: 10, fontFamily: fonts.sansBold },
});
