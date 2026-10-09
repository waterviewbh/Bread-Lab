// components/recipe/BulkEstimatorSettingsModal.tsx
import React, { useState, useEffect } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { usePreferences } from "@/contexts/PreferencesContext";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { BulkEstimatorState, PlannedProofMode } from "@/lib/recipeTypes";
import { calculateRecipeMetrics } from "@/lib/recipeUtils";

interface Props {
  visible: boolean;
  initialState: BulkEstimatorState;
  recipePhases: any[];
  onSave: (state: BulkEstimatorState) => void;
  onClose: () => void;
}

const FormulaInput = ({ label, value, onChange, colors }: any) => (
  <View style={s.inputGroup}>
    <Text style={[s.label, { color: colors.mutedForeground }]}>{label}</Text>
    <TextInput
      style={[
        s.input,
        { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted + "20" },
      ]}
      value={value}
      onChangeText={onChange}
      keyboardType="numeric"
      placeholder="0"
      placeholderTextColor={colors.mutedForeground}
    />
  </View>
);

function toDisplayTemp(tempF: number, unit: "F" | "C"): number {
  if (unit === "C") return Math.round(((tempF - 32) * 5) / 9);
  return Math.round(tempF);
}

function fromDisplayTemp(displayVal: number, unit: "F" | "C"): number {
  if (unit === "C") return Math.round((displayVal * 9) / 5 + 32);
  return Math.round(displayVal);
}

export function BulkEstimatorSettingsModal({
  visible,
  initialState,
  recipePhases,
  onSave,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { tempUnit } = usePreferences();
  const webTop = Platform.OS === "web" ? 67 : 0;

  const [state, setState] = useState<BulkEstimatorState>(initialState);

  useEffect(() => {
    if (visible) {
      setState({
        ...initialState,
        plannedProofMode: initialState.plannedProofMode ?? "undecided",
      });
    }
  }, [visible, initialState]);

  const metrics = calculateRecipeMetrics([
    {
      ingredients: [
        { text: `${state.flourG || 0}g flour` },
        { text: `${state.waterG || 0}g water` },
        { text: `${state.starterG || 0}g starter` },
        { text: `${state.yeastG || 0}g yeast` },
        { text: `${state.saltG || 0}g salt` },
      ]
        .map((i) => i.text)
        .join("\n"),
    },
  ]);

  const handleModeSelect = (mode: PlannedProofMode) => {
    let defaultTempF: number | null = null;
    if (mode === "bench") defaultTempF = 72;
    else if (mode === "cold_retard") defaultTempF = 39;

    setState((prev) => ({
      ...prev,
      plannedProofMode: mode,
      plannedProofTempF: mode === "undecided" ? null : (prev.plannedProofTempF ?? defaultTempF),
    }));
  };

  const handleTempAdjust = (deltaDisplay: number) => {
    const currentF = state.plannedProofTempF ?? (state.plannedProofMode === "bench" ? 72 : 39);
    const mode = state.plannedProofMode ?? "bench";

    const minF = mode === "bench" ? 65 : 38;
    const maxF = mode === "bench" ? 85 : 55;

    const currentDisplay = toDisplayTemp(currentF, tempUnit);
    const newDisplay = currentDisplay + deltaDisplay;
    const newF = fromDisplayTemp(newDisplay, tempUnit);

    const clampedF = Math.max(minF, Math.min(maxF, newF));
    setState((prev) => ({ ...prev, plannedProofTempF: clampedF }));
  };

  const handleSave = () => {
    onSave(state);
    onClose();
  };

  const mode = state.plannedProofMode ?? "undecided";
  const currentTempF = state.plannedProofTempF ?? (mode === "bench" ? 72 : mode === "cold_retard" ? 39 : 72);
  const displayTemp = toDisplayTemp(currentTempF, tempUnit);

  const minF = mode === "bench" ? 65 : 38;
  const maxF = mode === "bench" ? 85 : 55;
  const minDisplay = toDisplayTemp(minF, tempUnit);
  const maxDisplay = toDisplayTemp(maxF, tempUnit);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "padding"} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[s.header, { borderBottomColor: colors.border, paddingTop: insets.top + webTop + 20 }]}>
          <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>Estimator Settings</Text>
          <Pressable onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Text style={[s.saveText, { color: colors.primary }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          <View style={[s.metricsCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <View style={s.metricItem}>
              <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>HYDRATION</Text>
              <Text style={[s.metricValue, { color: colors.text }]}>{metrics.hydrationPct}%</Text>
            </View>
            <View style={[s.vDivider, { backgroundColor: colors.border }]} />
            <View style={s.metricItem}>
              <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>YEAST TYPE</Text>
              <Text style={[s.metricValue, { color: colors.text, textTransform: "capitalize" }]}>{state.yeastType || "Wild"}</Text>
            </View>
          </View>

          {/* ── Post-Bulk Proof Condition Declaration ─────────────────────────── */}
          <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>Planned Post-Bulk Condition</Text>
          <Text style={[s.sectionHint, { color: colors.mutedForeground }]}>What will you do after bulk fermentation?</Text>

          <View style={[s.segmentedGroup, { borderColor: colors.border, backgroundColor: colors.muted + "20" }]}>
            {(
              [
                { id: "bench", label: "Bench proof" },
                { id: "cold_retard", label: "Cold retard" },
                { id: "undecided", label: "I haven't decided yet" },
              ] as const
            ).map((item) => {
              const isSelected = mode === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => handleModeSelect(item.id)}
                  style={[
                    s.segmentBtn,
                    isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      s.segmentBtnText,
                      { color: isSelected ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Conditional Temperature Slider / Stepper */}
          {mode !== "undecided" && (
            <View style={[s.tempControlCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.tempCardLabel, { color: colors.mutedForeground }]}>
                {mode === "bench" ? "INTENDED BENCH PROOF TEMP" : "INTENDED COLD RETARD TEMP"}
              </Text>

              <View style={s.stepperRow}>
                <Pressable
                  onPress={() => handleTempAdjust(-1)}
                  disabled={currentTempF <= minF}
                  style={({ pressed }) => [
                    s.stepperBtn,
                    { borderColor: colors.border, backgroundColor: colors.muted + "30", opacity: pressed || currentTempF <= minF ? 0.4 : 1 },
                  ]}
                >
                  <Feather name="minus" size={18} color={colors.foreground} />
                </Pressable>

                <View style={s.tempDisplayWrap}>
                  <Text style={[s.tempDisplayVal, { color: colors.foreground }]}>
                    {displayTemp}°{tempUnit}
                  </Text>
                  <Text style={[s.tempRangeText, { color: colors.mutedForeground }]}>
                    Range: {minDisplay}°{tempUnit} – {maxDisplay}°{tempUnit}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleTempAdjust(1)}
                  disabled={currentTempF >= maxF}
                  style={({ pressed }) => [
                    s.stepperBtn,
                    { borderColor: colors.border, backgroundColor: colors.muted + "30", opacity: pressed || currentTempF >= maxF ? 0.4 : 1 },
                  ]}
                >
                  <Feather name="plus" size={18} color={colors.foreground} />
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>Weight Overrides (g)</Text>
          <View style={s.grid}>
            <FormulaInput label="FLOUR" value={state.flourG} onChange={(v: string) => setState((s) => ({ ...s, flourG: v }))} colors={colors} />
            <FormulaInput label="WATER" value={state.waterG} onChange={(v: string) => setState((s) => ({ ...s, waterG: v }))} colors={colors} />
          </View>
          <View style={s.grid}>
            <FormulaInput label="STARTER" value={state.starterG} onChange={(v: string) => setState((s) => ({ ...s, starterG: v }))} colors={colors} />
            <FormulaInput label="YEAST" value={state.yeastG} onChange={(v: string) => setState((s) => ({ ...s, yeastG: v }))} colors={colors} />
          </View>
          <View style={s.grid}>
            <FormulaInput label="SALT" value={state.saltG} onChange={(v: string) => setState((s) => ({ ...s, saltG: v }))} colors={colors} />
            <View style={{ flex: 1 }} />
          </View>

          <View style={[s.infoBox, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "20" }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[s.infoText, { color: colors.mutedForeground }]}>
              These settings refine the recommended bulk-fermentation endpoint and duration. Changing them here does not modify your recipe.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.serifBold, fontSize: 18 },
  saveText: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  content: { padding: 20 },
  metricsCard: { flexDirection: "row", padding: 20, borderRadius: radius.lg, borderWidth: 1, marginBottom: 24, justifyContent: "space-around", alignItems: "center" },
  metricItem: { alignItems: "center", flex: 1 },
  metricLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  metricValue: { fontFamily: fonts.mono, fontSize: 18 },
  vDivider: { width: 1, height: 30, opacity: 0.2 },
  sectionLabel: { ...typography.sectionLabel, marginBottom: 4 },
  sectionHint: { fontFamily: fonts.sans, fontSize: 12, marginBottom: 12 },
  segmentedGroup: { flexDirection: "column", gap: 6, padding: 6, borderRadius: radius.md, borderWidth: 1, marginBottom: 16 },
  segmentBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", alignItems: "center" },
  segmentBtnText: { fontFamily: fonts.sansMedium, fontSize: 13 },
  tempControlCard: { padding: 16, borderRadius: radius.md, borderWidth: 1, marginBottom: 16 },
  tempCardLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, marginBottom: 12, textAlign: "center" },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepperBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tempDisplayWrap: { alignItems: "center" },
  tempDisplayVal: { fontFamily: fonts.mono, fontSize: 24, letterSpacing: -0.5 },
  tempRangeText: { fontFamily: fonts.sans, fontSize: 11, marginTop: 2 },
  grid: { flexDirection: "row", gap: 16, marginBottom: 16 },
  inputGroup: { flex: 1 },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 10, marginBottom: 6, letterSpacing: 0.5 },
  input: { height: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, textAlign: "center", fontFamily: fonts.mono, fontSize: 16 },
  infoBox: { flexDirection: "row", gap: 10, padding: 16, borderRadius: radius.md, borderWidth: 1, marginTop: 12 },
  infoText: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, flex: 1 },
});
