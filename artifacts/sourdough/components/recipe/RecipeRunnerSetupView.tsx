// components/recipe/RecipeRunnerSetupView.tsx
import React from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { TourStep, CopilotView } from "@/components/TourStep";
import { YieldPill } from "@/components/YieldPill";
import type { SavedRecipe } from "@/lib/recipeTypes";interface Props {
  // Whether any recipes exist at all (drives empty-state vs. select-button)
  hasRecipes: boolean;
  // The recipe the user has tapped to confirm — null means "nothing selected yet"
  selectedRecipe: SavedRecipe | null;
  // Per-phase enabled toggle map (only relevant when selectedRecipe != null)
  runPhaseEnabled: Record<string, boolean>;
  refreshing: boolean;
  onOpenRecipePicker: () => void;
  onGoToBuilder: () => void;
  onCreateRecipe: () => void;
  onChangeRecipe: () => void;   // clears selectedRecipe back to landing
  onTogglePhase: (key: string) => void;
  onStartBake: () => void;
  onRefresh: () => void;
}
import { fonts, spacing, radius, typography } from "@/constants/theme";

export function RecipeRunnerSetupView({
  hasRecipes,
  selectedRecipe,
  runPhaseEnabled,
  refreshing,
  onOpenRecipePicker,
  onGoToBuilder,
  onCreateRecipe,
  onChangeRecipe,
  onTogglePhase,
  onStartBake,
  onRefresh,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarPad = Platform.OS === "web" ? 84 : 49;
  // ── Pre-start confirm: recipe has been selected ───────────────────────────
  if (selectedRecipe) {
    return (
      <ScrollView
        contentContainerStyle={{
          paddingTop: 24,
          paddingBottom: insets.bottom + tabBarPad + 60,
          paddingHorizontal: 20,
        }}
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
          {/* ── Recipe name + Change button ──────────────────────────────── */}
          <View style={s.preStartHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[s.preStartLabel, { color: colors.mutedForeground }]}>Baking from</Text>
              <Text style={[s.preStartName, { color: colors.foreground }]} numberOfLines={2}>
                {selectedRecipe.name}
              </Text>
            </View>
            <Pressable
              onPress={onChangeRecipe}
              style={({ pressed }) => [
                s.changeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[s.changeBtnText, { color: colors.mutedForeground }]}>Change</Text>
            </Pressable>
          </View>

          {/* Always show yield — default to "1" when not explicitly set, matching startBake behaviour */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 16
          }}>
            <YieldPill isBuilder={false} value={selectedRecipe.yieldValue || "1"} />
            {/* Sub-caption microcopy inline with the pill */}
            <Text style={{
              fontSize: 13,
              fontStyle: 'italic',
              color: colors.mutedForeground,
              marginLeft: 10 // Pushes the text slightly away from the right edge of the pill
            }}>
              You may scale ingredients on the next screen
            </Text>
          </View>

          <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginBottom: 10 }]}>
            Confirm phases for this bake below
          </Text>
          <Text style={[s.preStartHint, { color: colors.mutedForeground, marginBottom: 14 }]}>
            Toggle off any phases you want to skip today.
          </Text>
          {/* ── Phase toggle rows ────────────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            {selectedRecipe.phases.map((phase) => {
              const enabled = !!runPhaseEnabled[phase.key];
              return (
                <Pressable
                  key={phase.key}
                  onPress={() => onTogglePhase(phase.key)}
                  style={({ pressed }) => [
                    s.confirmPhaseRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: enabled ? colors.primary + "40" : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  {/* Checkbox circle */}
                  <View
                    style={[
                      s.confirmCheck,
                      {
                        borderColor: enabled ? colors.primary : colors.border,
                        backgroundColor: enabled ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    {enabled && (
                      <Ionicons name="checkmark" size={12} color={colors.primaryForeground} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        s.confirmPhaseName,
                        {
                          color: enabled ? colors.foreground : colors.mutedForeground,
                          fontFamily: enabled ? fonts.sansMedium : fonts.sans,
                        },
                      ]}
                    >
                      {phase.name}
                    </Text>
                    {!!phase.ingredients && (
                      <Text
                        style={[s.confirmPhaseSub, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {phase.ingredients}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {/* ── Start Bake button ────────────────────────────────────────── */}
          <Pressable
            onPress={onStartBake}
            style={({ pressed }) => [
              s.primaryBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: 12,
                opacity: pressed ? 0.85 : 1,
                marginTop: 24,
              },
            ]}
          >
            <Feather name="play" size={16} color={colors.primaryForeground} />
            <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
              Start Bake
            </Text>
          </Pressable>
        </Animated.View>
        {/* Tour transition anchor — zero-height, end of recipe chapter */}
        <TourStep order={16} name="next-chapter-is-history">
          <CopilotView>
            <View style={{ height: 0 }} />
          </CopilotView>
        </TourStep>
      </ScrollView>
    );
  }
  // ── Landing: no recipe selected yet ──────────────────────────────────────
  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: 24,
        paddingBottom: insets.bottom + tabBarPad + 40,
        paddingHorizontal: 20,
        flex: 1,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
        <Text style={[s.sectionTitle, { color: colors.foreground, marginBottom: 4 }]}>
          Recipe Runner
        </Text>
        <Text style={[s.pageSubtitle, { color: colors.mutedForeground, marginBottom: 32 }]}>
          pick a recipe and track your bake
        </Text>
        {/* ── Empty state: no recipes exist yet ───────────────────────────── */}
        {!hasRecipes ? (
          <View
            style={[s.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="book-open" size={28} color={colors.mutedForeground} />
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>No recipes saved</Text>
            <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
              Build a recipe first — then you can run it and track your bake here.
            </Text>
            <Pressable
              onPress={onCreateRecipe}
              style={({ pressed }) => [
                s.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 10,
                  opacity: pressed ? 0.8 : 1,
                  marginTop: 8,
                  paddingHorizontal: 20,
                },
              ]}
            >
              <Feather name="plus" size={15} color={colors.primaryForeground} />
              <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
                Create Recipe
              </Text>
            </Pressable>
          </View>
        ) : (
          /* ── Recipes exist: offer select + builder shortcut ─────────────── */
          <>
            <Pressable
              onPress={onOpenRecipePicker}
              style={({ pressed }) => [
                s.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: 16,
                },
              ]}
            >
              <Feather name="list" size={16} color={colors.primaryForeground} />
              <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>
                Select Recipe
              </Text>
            </Pressable>
            <Pressable
              onPress={onGoToBuilder}
              style={({ pressed }) => [
                s.ghostBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[s.ghostBtnText, { color: colors.mutedForeground }]}>
                Go to Recipe Builder
              </Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </Pressable>
          </>
        )}
      </Animated.View>
      {/* Tour transition anchor — zero-height, end of recipe chapter */}
      <TourStep order={16} name="next-chapter-is-history">
        <CopilotView>
          <View style={{ height: 0 }} />
        </CopilotView>
      </TourStep>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  // ── Landing screen ───────────────────────────────────────────────────────
  sectionTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — "Recipe Runner" page title
    fontSize: 24,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — page subtitle
    fontSize: 14,
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
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    gap: 10,
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — primary action
    fontSize: 16,
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    gap: 4,
  },
  ghostBtnText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — ghost action
    fontSize: 14,
  },
  // ── Pre-start confirm screen ─────────────────────────────────────────────
  preStartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  preStartLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "Baking from" eyebrow
    fontSize: 12,
    marginBottom: 2,
  },
  preStartName: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — recipe name display
    fontSize: 22,
    letterSpacing: -0.4,
  },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
    marginTop: 6,
  },
  changeBtnText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "Change" minor action
    fontSize: 13,
  },
  fieldLabel: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: spacing.sm,               // 8
  },
  preStartHint: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — helper copy
    fontSize: 13,
    lineHeight: 18,
  },
  confirmPhaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
  },
  confirmCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmPhaseName: {
    fontSize: 15,
    // fontFamily set inline — fonts.sansMedium when enabled, fonts.sans when disabled
  },
  confirmPhaseSub: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — ingredient preview
    fontSize: 12,
    marginTop: 2,
  },
});