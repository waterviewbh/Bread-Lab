// components/recipe/RecipeBuilderListView.tsx
import React from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/recipeUtils";
import { KeycapKey } from "@/components/recipe/KeycapKey";
import type { SavedRecipe } from "@/lib/recipeTypes";
interface Props {
  recipes: SavedRecipe[];
  displayedRecipes: SavedRecipe[];
  bakeHistory?: any[];
  populatedLetters: string[];
  letterFilter: string | null;
  refreshing: boolean;
  onNewRecipe: () => void;
  onEditRecipe: (r: SavedRecipe) => void;
  onPrintRecipe: (r: SavedRecipe) => void;
  onShareRecipe: (r: SavedRecipe) => void;
  onDuplicateRecipe: (r: SavedRecipe) => void;
  onSetLetterFilter: (letter: string | null) => void;
  onRefresh: () => void;
}
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { TourStep, CopilotView } from "@/components/TourStep";
import { RecipeDeck } from "@/components/recipe/RecipeDeck";

export function RecipeBuilderListView({
  recipes,
  displayedRecipes,
  bakeHistory = [],
  populatedLetters,
  letterFilter,
  refreshing,
  onNewRecipe,
  onEditRecipe,
  onPrintRecipe,
  onShareRecipe,
  onDuplicateRecipe,
  onSetLetterFilter,
  onRefresh,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  // Group recipes by lineage, filtering out archived ones for the main view
  const masterRecipes = displayedRecipes.filter(r => !r.parentRecipeId && !r.isArchived);
  const iterationsMap = new Map<string, SavedRecipe[]>();
  displayedRecipes.forEach(r => {
    if (r.parentRecipeId && !r.isArchived) {
      const list = iterationsMap.get(r.parentRecipeId) || [];
      list.push(r);
      iterationsMap.set(r.parentRecipeId, list);
    }
  });

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: 24,
        paddingBottom: insets.bottom + tabBarPad + 60,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets={true}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <Animated.View entering={FadeIn.duration(300)}>
      {/* Header row */}
        <View style={[s.listHeader, { paddingHorizontal: 20 }]}>
          <Text style={[s.sectionTitle, { color: colors.foreground }]}>
            Recipes
          </Text>
          <Pressable
            onPress={onNewRecipe}
            style={({ pressed }) => [
              s.addBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            testID="new-recipe-button"
          >
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[s.addBtnText, { color: colors.primaryForeground }]}>
              New Recipe
            </Text>
          </Pressable>
        </View>
        {/* A–Z index */}
        {recipes.length > 1 && populatedLetters.length > 1 && (
          <View style={{ marginBottom: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 0, paddingRight: 4 }}
            >
              <KeycapKey
                label="All"
                active={letterFilter === null}
                onPress={() => onSetLetterFilter(null)}
                faceFill={letterFilter === null ? colors.secondary : colors.card}
                ledgeFill={colors.muted}
                stroke={colors.border}
                textColor={letterFilter === null ? colors.foreground : colors.mutedForeground}
              />
              {populatedLetters.slice(0, 13).map((letter) => {
                const active = letterFilter === letter;
                return (
                  <KeycapKey
                    key={letter}
                    label={letter}
                    active={active}
                    onPress={() => onSetLetterFilter(active ? null : letter)}
                    faceFill={active ? colors.secondary : colors.card}
                    ledgeFill={colors.muted}
                    stroke={colors.border}
                    textColor={active ? colors.foreground : colors.mutedForeground}
                  />
                );
              })}
            </ScrollView>
            {populatedLetters.length > 13 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 0, paddingLeft: 14, paddingRight: 4 }}
              >
                {populatedLetters.slice(13).map((letter) => {
                  const active = letterFilter === letter;
                  return (
                    <KeycapKey
                      key={letter}
                      label={letter}
                      active={active}
                      onPress={() => onSetLetterFilter(active ? null : letter)}
                      faceFill={active ? colors.secondary : colors.card}
                      ledgeFill={colors.muted}
                      stroke={colors.border}
                      textColor={active ? colors.foreground : colors.mutedForeground}
                    />
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}
        {/* Empty state */}
        {recipes.length === 0 ? (
          <View style={[s.emptyCard, { borderColor: colors.border, backgroundColor: colors.card, marginHorizontal: 20 }]}>
            <Feather name="book-open" size={28} color={colors.mutedForeground} />
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>No recipes yet</Text>
            <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
              Tap "New Recipe" to define your first bake — add phases, ingredients, and instructions.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            {masterRecipes.map((master, i) => {
              const iterations = iterationsMap.get(master.id) || [];
              const sortedIterations = iterations.sort((a,b) => (Math.max(b.updatedAt || 0, b.createdAt)) - (Math.max(a.updatedAt || 0, a.createdAt)));

              return (
                <Animated.View key={master.id} entering={FadeInDown.delay(i * 40).duration(300)}>
                   <RecipeDeck
                     master={master}
                     iterations={sortedIterations}
                     onSelect={onEditRecipe}
                   />
                </Animated.View>
              );
            })}
          </View>
        )}
       {/* Tour transition anchor — zero-height, sits just above tab bar.
           Only the tooltip matters; no highlight hole needed here. */}
       <TourStep order={16} name="next-chapter-is-history">
         <CopilotView>
           <View style={{ height: 0 }} />
         </CopilotView>
       </TourStep>
      </Animated.View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,               // 16
  },
  sectionTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — "Recipes" page title in serif
    fontSize: 22,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,             // 8
    borderRadius: radius.md,                 // 8
  },
  addBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "New Recipe" button
    fontSize: 13,
  },
  recipeCard: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  recipeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recipeName: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — recipe card title
    fontSize: 16,
    flex: 1,
  },
  recipeCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recipeMeta: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — phase count + date
    fontSize: 12,
  },
  recipeOverview: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — overview blurb
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
    paddingHorizontal: spacing.sm,           // 8
    paddingVertical: 3,
    borderRadius: radius.full,               // pill shape
    borderWidth: 1,
  },
  phasePillText: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — phase tag label
    fontSize: 11,
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — empty state headline
    fontSize: 16,
  },
  emptyBody: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — empty state body
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
});