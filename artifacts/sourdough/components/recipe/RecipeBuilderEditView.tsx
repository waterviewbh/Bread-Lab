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
import type { SavedRecipe } from "@/lib/recipeTypes";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { ContinuousListInput } from "./ContinuousListInput";
import { CheckableLine } from "@/types/recipe";

interface Props {
  editingRecipe: SavedRecipe;
  isNewRecipe: boolean;
  availablePhaseCount: number;
  onChangeName: (name: string) => void;
  onChangeOverview: (overview: string) => void;
  onChangeYield: (value: string) => void;
  onUpdatePhaseField: (key: string, field: "ingredients" | "instructions", value: CheckableLine[]) => void;
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
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 100, // Extra padding for FAB
            paddingHorizontal: 20,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeIn.duration(300)}>
            {/* Header row */}
            <View style={s.editHeader}>
              <Pressable onPress={onCancel} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
              <Text style={[s.editTitle, { color: colors.foreground }]}>
                {isNewRecipe ? "New Recipe" : "Edit Recipe"}
              </Text>
              <Pressable onPress={onSave} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={[s.saveLink, { color: colors.accent }]}>Save</Text>
              </Pressable>
            </View>

            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Recipe Name</Text>
            <TextInput
              style={[s.nameInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: fonts.sansMedium }]}
              placeholder="e.g., Saturday Country Loaf"
              placeholderTextColor={colors.mutedForeground}
              value={editingRecipe.name}
              onChangeText={onChangeName}
            />

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Overview</Text>
            <TextInput
              style={[s.overviewInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: fonts.sans }]}
              placeholder="Notes..."
              placeholderTextColor={colors.mutedForeground}
              value={editingRecipe.overview ?? ""}
              onChangeText={onChangeOverview}
              multiline
            />

            <YieldPill isBuilder={true} value={editingRecipe.yieldValue || ""} onChangeValue={onChangeYield} />

            <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 24 }]}>Phases</Text>

            <View style={{ gap: 12 }}>
              {editingRecipe.phases.map((phase, pi) => (
                <View key={phase.key} style={[s.editPhaseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={s.editPhaseHeader}>
                    <Text style={[s.editPhaseName, { color: colors.foreground }]}>{pi + 1}. {phase.name}</Text>
                    <Pressable onPress={() => onRemovePhase(phase.key)} hitSlop={8}>
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  <ContinuousListInput lines={phase.ingredients} onUpdateLines={(l) => onUpdatePhaseField(phase.key, "ingredients", l)} placeholder="Ingredients..." />
                  <ContinuousListInput lines={phase.instructions} onUpdateLines={(l) => onUpdatePhaseField(phase.key, "instructions", l)} placeholder="Instructions..." />
                </View>
              ))}
            </View>

            <Pressable onPress={onOpenPhasePicker} style={s.addPhaseBtn}>
              <Feather name="plus" size={14} color={colors.accent} />
              <Text style={[s.addPhaseBtnText, { color: colors.accent }]}>Add Phase</Text>
              <Text style={[s.addPhaseHint, { color: colors.mutedForeground }]}>{availablePhaseCount} remaining</Text>
            </Pressable>

            {!isNewRecipe && (
              <Pressable onPress={() => onDelete(editingRecipe.id)} style={s.deleteLinkRow}>
                <Feather name="trash-2" size={14} color="#C0392B" />
                <Text style={[s.deleteLink, { color: "#C0392B" }]}>Delete Recipe</Text>
              </Pressable>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* FIXED: This button is now absolutely positioned relative to the screen-sized container */}
      <Pressable
        onPress={onSave}
        style={({ pressed }) => [
          s.fab,
          {
            bottom: insets.bottom + tabBarPad + 16,
            backgroundColor: colors.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="save" size={24} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  editHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  editTitle: { fontFamily: fonts.sansSemiBold, fontSize: 18 },
  saveLink: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  fieldLabel: { ...typography.sectionLabel, marginBottom: 8 },
  nameInput: { height: 50, paddingHorizontal: 14, fontSize: 16, borderWidth: 1, borderRadius: radius.md },
  overviewInput: { borderWidth: 1, borderRadius: radius.md, padding: 14, fontSize: 15, minHeight: 72, textAlignVertical: "top" },
  editPhaseCard: { borderRadius: radius.lg, borderWidth: 1, padding: 14 },
  editPhaseHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  editPhaseName: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  addPhaseBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", marginTop: 14 },
  addPhaseBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 14, flex: 1 },
  addPhaseHint: { fontFamily: fonts.sans, fontSize: 12 },
  deleteLinkRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 28, paddingVertical: 12 },
  deleteLink: { fontFamily: fonts.sansMedium, fontSize: 14 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99, // Ensure it stays on top
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
});