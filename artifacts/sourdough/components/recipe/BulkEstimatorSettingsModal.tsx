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
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { BulkEstimatorState } from "@/lib/recipeTypes";
import { parseIngredientsForMetrics, calculateRecipeMetrics } from "@/lib/recipeUtils";

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
      style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted + '20' }]}
      value={value}
      onChangeText={onChange}
      keyboardType="numeric"
      placeholder="0"
      placeholderTextColor={colors.mutedForeground}
    />
  </View>
);

export function BulkEstimatorSettingsModal({
  visible,
  initialState,
  recipePhases,
  onSave,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;

  const [state, setState] = useState<BulkEstimatorState>(initialState);

  useEffect(() => {
    if (visible) setState(initialState);
  }, [visible, initialState]);

  const metrics = calculateRecipeMetrics([
    {
      ingredients: [
        { text: `${state.flourG || 0}g flour` },
        { text: `${state.waterG || 0}g water` },
        { text: `${state.starterG || 0}g starter` },
        { text: `${state.yeastG || 0}g yeast` },
        { text: `${state.saltG || 0}g salt` },
      ].map(i => i.text).join('\n')
    }
  ]);

  const handleSave = () => {
    onSave(state);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "padding"} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[s.header, { borderBottomColor: colors.border, paddingTop: insets.top + webTop + 20 }]}>
          <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>Estimator Formula</Text>
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
                <Text style={[s.metricValue, { color: colors.text, textTransform: 'capitalize' }]}>{state.yeastType || 'Wild'}</Text>
             </View>
          </View>

          <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>Weight Overrides (g)</Text>
          <View style={s.grid}>
            <FormulaInput label="FLOUR" value={state.flourG} onChange={(v: string) => setState(s => ({ ...s, flourG: v }))} colors={colors} />
            <FormulaInput label="WATER" value={state.waterG} onChange={(v: string) => setState(s => ({ ...s, waterG: v }))} colors={colors} />
          </View>
          <View style={s.grid}>
            <FormulaInput label="STARTER" value={state.starterG} onChange={(v: string) => setState(s => ({ ...s, starterG: v }))} colors={colors} />
            <FormulaInput label="YEAST" value={state.yeastG} onChange={(v: string) => setState(s => ({ ...s, yeastG: v }))} colors={colors} />
          </View>
          <View style={s.grid}>
            <FormulaInput label="SALT" value={state.saltG} onChange={(v: string) => setState(s => ({ ...s, saltG: v }))} colors={colors} />
            <View style={{ flex: 1 }} />
          </View>

          <View style={[s.infoBox, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[s.infoText, { color: colors.mutedForeground }]}>
              These weights are used to calculate the predicted duration. Changing them here does not modify your recipe ingredients.
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
  metricsCard: { flexDirection: 'row', padding: 20, borderRadius: radius.lg, borderWidth: 1, marginBottom: 24, justifyContent: 'space-around', alignItems: 'center' },
  metricItem: { alignItems: 'center', flex: 1 },
  metricLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  metricValue: { fontFamily: fonts.mono, fontSize: 18 },
  vDivider: { width: 1, height: 30, opacity: 0.2 },
  sectionLabel: { ...typography.sectionLabel, marginBottom: 16 },
  grid: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  inputGroup: { flex: 1 },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 10, marginBottom: 6, letterSpacing: 0.5 },
  input: { height: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, textAlign: 'center', fontFamily: fonts.mono, fontSize: 16 },
  infoBox: { flexDirection: 'row', gap: 10, padding: 16, borderRadius: radius.md, borderWidth: 1, marginTop: 12 },
  infoText: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, flex: 1 },
});
