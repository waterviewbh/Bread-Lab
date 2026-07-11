// components/recipe/RecipeBuilderEditView.tsx
import React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { YieldPill } from "@/components/YieldPill";
import type { SavedRecipe, RecipePhaseConfig } from "@/lib/recipeTypes";
import { fonts, spacing, radius, typography } from "@/constants/theme";

interface Props {
  editingRecipe: SavedRecipe;
  isNewRecipe: boolean;
  // availablePhases is only needed for the "Add Phase" button hint count
  availablePhaseCount: number;
  onChangeName: (name: string) => void;
  onChangeOverview: (overview: string) => void;
  onChangeYield: (value: string) => void;
  onUpdatePhaseField: (key: string, field: "ingredients" | "instructions", value: string) => void;
  onRemovePhase: (key: string) => void;
  onOpenPhasePicker: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}

export function RecipeBuilderEditView({
  editingRecipe,
  isNewRecipe,
  availablePhaseCount,
  onChangeName,
  onChangeOverview,
  onChangeYield,
  onUpdatePhaseField,
  onRemovePhase,
  onOpenPhasePicker,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarPad = Platform.OS === "web" ? 84 : 49;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: 24,
          paddingBottom: insets.bottom + tabBarPad + 60,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={FadeIn.duration(300)}>
        {/* ── Header row: cancel / title / save ───────────────────────── */}
          <View style={s.editHeader}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
            <Text style={[s.editTitle, { color: colors.foreground }]}>
              {isNewRecipe ? "New Recipe" : "Edit Recipe"}
            </Text>
            <Pressable
              onPress={onSave}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[s.saveLink, { color: colors.accent }]}>Save</Text>
            </Pressable>
          </View>
          {/* ── Recipe name input ────────────────────────────────────────── */}
          <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Recipe Name</Text>
          <TextInput
            style={[
              s.nameInput,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: fonts.sansMedium,
              },
            ]}
            placeholder="e.g., Saturday Country Loaf"
            placeholderTextColor={colors.mutedForeground}
            value={editingRecipe.name}
            onChangeText={onChangeName}
            returnKeyType="done"
          />
          {/* ── Overview textarea ───────────────────────────────────────── */}
          <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
            Overview
          </Text>
          <TextInput
            style={[
              s.overviewInput,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: fonts.sans,
              },
            ]}
            placeholder="e.g., Great for snow days — quick levain, bold crust."
            placeholderTextColor={colors.mutedForeground}
            value={editingRecipe.overview ?? ""}
            onChangeText={onChangeOverview}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            scrollEnabled={true}
          />
          {/* ── Yield pill ───────────────────────────────────────────────── */}
          <YieldPill
            isBuilder={true}
            value={editingRecipe.yieldValue || ""}
            onChangeValue={onChangeYield}
          />
          {/* ── Phases label ─────────────────────────────────────────────── */}
          <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 24 }]}>
            Phases
          </Text>
          {/* ── Empty phases hint ────────────────────────────────────────── */}
          {editingRecipe.phases.length === 0 && (
            <View
              style={[
                s.emptyPhasesHint,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Text style={[s.emptyPhasesText, { color: colors.mutedForeground }]}>
                Tap "Add Phase" below to start building your recipe. Each phase can hold its own
                ingredients and instructions.
              </Text>
            </View>
          )}
          {/* ── Phase cards ──────────────────────────────────────────────── */}
          <View style={{ gap: 12, marginTop: editingRecipe.phases.length > 0 ? 0 : 12 }}>
            {editingRecipe.phases.map((phase, pi) => (
              <Animated.View
                key={phase.key}
                entering={FadeInDown.delay(pi * 30).duration(300)}
                style={[
                  s.editPhaseCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {/* Phase header: number badge + name + remove button */}
                <View style={s.editPhaseHeader}>
                  <View style={s.editPhaseHeaderLeft}>
                    <View style={[s.phaseNumBadge, { backgroundColor: colors.primary + "18" }]}>
                      <Text style={[s.phaseNumText, { color: colors.primary }]}>{pi + 1}</Text>
                    </View>
                    <Text style={[s.editPhaseName, { color: colors.foreground }]}>
                      {phase.name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === "web") {
                        onRemovePhase(phase.key);
                      } else {
                        Alert.alert(
                          "Remove Phase",
                          `Remove "${phase.name}" from this recipe?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () => onRemovePhase(phase.key),
                            },
                          ]
                        );
                      }
                    }}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                {/* Ingredients textarea */}
                <Text style={[s.subFieldLabel, { color: colors.mutedForeground }]}>
                  Ingredients
                </Text>
                <TextInput
                  style={[
                    s.phaseTextarea,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                      fontFamily: fonts.sans,
                    },
                  ]}
                  placeholder="e.g., 500 g bread flour, 350 g water, 100 g levain…"
                  placeholderTextColor={colors.mutedForeground}
                  value={phase.ingredients}
                  onChangeText={(v) => onUpdatePhaseField(phase.key, "ingredients", v)}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  scrollEnabled={true} // Allow internal scroll once content exceeds maxHeight
                />
                {/* Instructions textarea */}
                <Text style={[s.subFieldLabel, { color: colors.mutedForeground, marginTop: 10 }]}>
                  Instructions
                </Text>
                <TextInput
                  style={[
                    s.phaseTextarea,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                      fontFamily: fonts.sans,
                    },
                  ]}
                  placeholder="e.g., Mix until shaggy, autolyse 30 min, then add salt…"
                  placeholderTextColor={colors.mutedForeground}
                  value={phase.instructions}
                  onChangeText={(v) => onUpdatePhaseField(phase.key, "instructions", v)}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  scrollEnabled={true} // Allow internal scroll once content exceeds maxHeight
                />
              </Animated.View>
            ))}
          </View>
          {/* ── Add Phase button (only if phases remain available) ───────── */}
          {availablePhaseCount > 0 && (
            <Pressable
              onPress={onOpenPhasePicker}
              style={({ pressed }) => [
                s.addPhaseBtn,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.7 : 1,
                  marginTop: 14,
                },
              ]}
            >
              <Feather name="plus" size={14} color={colors.accent} />
              <Text style={[s.addPhaseBtnText, { color: colors.accent }]}>Add Phase</Text>
              <Text style={[s.addPhaseHint, { color: colors.mutedForeground }]}>
                {availablePhaseCount} remaining
              </Text>
            </Pressable>
          )}
          {/* ── Delete link (existing recipes only) ─────────────────────── */}
          {!isNewRecipe && (
            <Pressable
              onPress={() => onDelete(editingRecipe.id)}
              style={({ pressed }) => [s.deleteLinkRow, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Feather name="trash-2" size={14} color={colors.destructive ?? "#C0392B"} />
              <Text style={[s.deleteLink, { color: colors.destructive ?? "#C0392B" }]}>
                Delete Recipe
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </ScrollView>
      {/* ── Floating save FAB ────────────────────────────────────────────── */}
      <Pressable
        onPress={onSave}
        style={[
          s.fab,
          {
            bottom: insets.bottom + tabBarPad + 16,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Feather name="save" size={24} color={colors.primaryForeground} />
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  editTitle: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — edit screen title
    fontSize: 18,
  },
  saveLink: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Save" tappable link
    fontSize: 16,
  },
  fieldLabel: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: spacing.sm,               // 8
  },
  nameInput: {
    height: 50,
    paddingHorizontal: 14,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: radius.md,                 // 8
    // fontFamily set inline — driven by TextInput's fontFamily prop
  },
  overviewInput: {
    borderWidth: 1,
    borderRadius: radius.md,                 // 8
    padding: 14,
    fontSize: 15,
    minHeight: 72,                           // ~3 rows
    maxHeight: 160,
    textAlignVertical: "top",               // Android multiline alignment
  },
  emptyPhasesHint: {
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
    padding: spacing.md,                     // 16
  },
  emptyPhasesText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — helper copy
    fontSize: 13,
    lineHeight: 19,
  },
  editPhaseCard: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: 14,
  },
  editPhaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  editPhaseHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  phaseNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  phaseNumText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
  editPhaseName: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — phase card title
    fontSize: 15,
  },
  subFieldLabel: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    fontSize: 11,
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  phaseTextarea: {
    borderWidth: 1,
    borderRadius: radius.md,                 // 8
    padding: 12,
    fontSize: 15,
    marginTop: spacing.sm,                   // 8
    textAlignVertical: "top",               // Critical for multiline alignment on Android
    minHeight: 44,                           // ~1 row with padding
    maxHeight: 220,                          // ~10 rows
    // fontFamily set inline — driven by TextInput's fontFamily prop
  },
  addPhaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,                         // 8
    paddingVertical: 14,
    paddingHorizontal: spacing.md,           // 16
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addPhaseBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Add Phase"
    fontSize: 14,
    flex: 1,
  },
  addPhaseHint: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "X remaining"
    fontSize: 12,
  },
  deleteLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,                         // 8
    justifyContent: "center",
    marginTop: 28,
    paddingVertical: 12,
  },
  deleteLink: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — destructive action
    fontSize: 14,
  },
  fab: {
    position: "absolute",
    right: spacing.lg - 4,                  // 20
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
});