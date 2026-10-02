import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/recipeUtils";
import type { SavedRecipe } from "@/lib/recipeTypes";
import { fonts, radius, spacing } from "@/constants/theme";

export interface RecipeCardProps {
  recipe: SavedRecipe;
  onPress: () => void;
  showChevron?: boolean;
}

export function RecipeCard({
  recipe,
  onPress,
  showChevron = true,
}: RecipeCardProps) {
  const colors = useColors();

  const phaseCount = recipe.phases?.length || 0;
  const displayDate =
    recipe.updatedAt && recipe.updatedAt > recipe.createdAt
      ? `Updated ${formatDate(recipe.updatedAt)}`
      : `Created ${formatDate(recipe.createdAt)}`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.recipeCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
      testID={`recipe-card-${recipe.id}`}
    >
      {/* Top row: Name + Version badge + Chevron */}
      <View style={s.recipeCardTop}>
        <View style={s.titleRow}>
          <Text
            selectable={true}
            style={[s.recipeName, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {recipe.name}
          </Text>
          {recipe.versionLabel && (
            <View style={[s.versionBadge, { backgroundColor: colors.muted }]}>
              <Text style={[s.versionText, { color: colors.mutedForeground }]}>
                {recipe.versionLabel}
              </Text>
            </View>
          )}
        </View>
        {showChevron && (
          <Feather
            name="chevron-right"
            size={16}
            color={colors.mutedForeground}
            style={s.chevron}
          />
        )}
      </View>

      {/* Meta row: Phase count, Date, Yield */}
      <View style={s.recipeCardMeta}>
        <Text style={[s.recipeMeta, { color: colors.mutedForeground }]}>
          {phaseCount} phase{phaseCount !== 1 ? "s" : ""} · {displayDate}
        </Text>
        {recipe.yieldValue && (
          <Text style={[s.recipeMeta, { color: colors.mutedForeground }]}>
            {recipe.yieldValue}
          </Text>
        )}
      </View>

      {/* Overview blurb preview if present */}
      {recipe.overview ? (
        <Text
          selectable={true}
          style={[s.recipeOverview, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {recipe.overview}
        </Text>
      ) : null}

      {/* Phase pills row */}
      {recipe.phases && recipe.phases.length > 0 && (
        <View style={s.phasePillRow}>
          {recipe.phases.map((p, idx) => (
            <View
              key={`${p.key || p.name}-${idx}`}
              style={[
                s.phasePill,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[s.phasePillText, { color: colors.mutedForeground }]}
              >
                {p.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  recipeCard: {
    borderRadius: radius.lg, // 12
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  recipeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 8,
  },
  recipeName: {
    fontFamily: fonts.sansSemiBold, // HankenGrotesk_600SemiBold
    fontSize: 16,
    flexShrink: 1,
  },
  chevron: {
    marginLeft: 4,
  },
  versionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  versionText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "600",
  },
  recipeCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recipeMeta: {
    fontFamily: fonts.sans, // HankenGrotesk_400Regular
    fontSize: 12,
  },
  recipeOverview: {
    fontFamily: fonts.sans, // HankenGrotesk_400Regular
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  phasePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 2,
  },
  phasePill: {
    paddingHorizontal: spacing.sm, // 8
    paddingVertical: 3,
    borderRadius: radius.full, // pill shape
    borderWidth: 1,
  },
  phasePillText: {
    fontFamily: fonts.sansMedium, // HankenGrotesk_500Medium
    fontSize: 11,
  },
});
