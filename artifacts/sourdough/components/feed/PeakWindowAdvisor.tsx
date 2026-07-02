import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, ScrollView, TextInput } from "react-native";
import Animated, { FadeIn, FadeInDown, Layout } from "react-native-reanimated";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { usePreferences } from "@/contexts/PreferencesContext";

import { useColors } from "@/hooks/useColors";
import { FeedSession } from "@/types/feed";
import {
  trainModel,
  solveForRecipe,
  getPeakWindowNudges,
  isInDeadZone,
  PlannedRecipe
} from "@/lib/predictions";

interface Props {
  history: FeedSession[];
  onApplyRecipe: (recipe: PlannedRecipe) => void;
  defaultTemp?: string;
}

export default function PeakWindowAdvisor({ history, onApplyRecipe, defaultTemp }: Props) {
  const colors = useColors();
  const { tempUnit } = usePreferences(); // Get the global unit

  // --- State ---
  const [totalMass, setTotalMass] = useState("");
  const unitDefault = tempUnit === "F" ? "74" : "23";
  const [temp, setTemp] = useState("");
  const [targetHours, setTargetHours] = useState(6); // Default 6 hour plan

  // --- Logic ---
  const model = useMemo(() => trainModel(history), [history]);

  const currentPlan = useMemo(() => {
    const mass = parseFloat(totalMass) || 100;
    let t = parseFloat(temp) || parseFloat(unitDefault);

    // 4. Normalize to Fahrenheit for the prediction math if using Celsius
    if (tempUnit === "C") {
      t = (t * 9/5) + 32;
    }

    return solveForRecipe(targetHours, mass, t, 100, model);
  }, [totalMass, temp, targetHours, model, tempUnit]);

  // Use targetHours here as it's the direct input to the nudge calculation
  const nudges = useMemo(() => {
    const mass = parseFloat(totalMass) || 200;
    const t = parseFloat(temp) || 74;
    return getPeakWindowNudges(targetHours, mass, t, 100, model);
  }, [targetHours, totalMass, temp, model]);

  const isInSleepWindow = useMemo(() => isInDeadZone(currentPlan.peakTime), [currentPlan.peakTime]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View entering={FadeIn.duration(400)}>
        <Text style={[styles.title, { color: colors.foreground }]}>Peak Window Advisor</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {model.isHeuristic
            ? "Using standard sourdough curves. Log more feeds to personalize."
            : "Calibrated to your starter's history."}
        </Text>

        <View style={[styles.usageTip, { backgroundColor: colors.muted + "30" }]}>
          <Text style={[styles.usageText, { color: colors.foreground }]}>
            Calculate the exact weights needed to make your levain peak exactly when you're ready to mix.
          </Text>
        </View>

        <View style={[styles.warningBox, { borderColor: colors.border }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.warningText, { color: colors.mutedForeground }]}>
            <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>Note: </Text>
            This tool is for building <Text style={{ fontStyle: "italic" }}>levains</Text>. Ensure you have reserved your mother starter separately before mixing these amounts.
          </Text>
        </View>
      </Animated.View>

            {/* --- Inputs --- */}
            <View style={[styles.inputGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.inputRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground, textAlign: 'center' }]}>Total Mass (g)</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius }]}
                    value={totalMass}
                    onChangeText={setTotalMass}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 100"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground, textAlign: 'center' }]}>Temp (°{tempUnit})</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius }]}
                    value={temp}
                    onChangeText={setTemp}
                    keyboardType="decimal-pad"
                    placeholder={`e.g. ${unitDefault}`}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </View>
            </View>

      {/* --- The Current Plan --- */}
      <Animated.View layout={Layout} style={[styles.planCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "20" }]}>
        <View style={styles.planHeader}>
                  <MaterialCommunityIcons
                    name={isInSleepWindow ? "moon-waning-crescent" : "clock-outline"}
                    size={20}
                    color={isInSleepWindow ? "#f59e0b" : colors.primary}
                  />
                  <Text style={[styles.planTitle, { color: isInSleepWindow ? "#92400e" : colors.primary }]}>
                    {isInSleepWindow ? "Peaks in the Sleep Zone" : "Target Peak"}
                  </Text>
                  <View style={[
                    styles.timeBadge,
                    { backgroundColor: isInSleepWindow ? "#f59e0b" : colors.primary }
                  ]}>
                    <Text style={styles.timeBadgeText}>{formatTime(currentPlan.peakTime)}</Text>
                  </View>
                </View>

        <View style={styles.hoursRow}>
          <Pressable
            onPress={() => { setTargetHours(Math.max(2, targetHours - 0.5)); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={styles.stepBtn}
          ><Feather name="minus" size={20} color={colors.primary} /></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[styles.hoursValue, { color: colors.foreground }]}>{targetHours % 1 === 0 ? targetHours : targetHours.toFixed(1)}h</Text>
            <Text style={[styles.hoursLabel, { color: colors.mutedForeground }]}>duration</Text>
          </View>
          <Pressable
            onPress={() => { setTargetHours(Math.min(24, targetHours + 0.5)); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={styles.stepBtn}
          ><Feather name="plus" size={20} color={colors.primary} /></Pressable>
        </View>

        <View style={[styles.recipeRow, { borderTopColor: colors.border + "40" }]}>
          <RecipeItem label="Starter" value={currentPlan.starter} />
          <RecipeItem label="Flour" value={currentPlan.flour} />
          <RecipeItem label="Water" value={currentPlan.water} />
          <View style={styles.ratioItem}>
            <Text style={[styles.ratioLabel, { color: colors.mutedForeground }]}>Ratio</Text>
            <Text style={[styles.ratioValue, { color: colors.primary }]}>{currentPlan.ratioStr}</Text>
          </View>
        </View>
        {/* When the minimum starter floor is hit, effective total exceeds the user's target.
            Show the actual total so they aren't surprised by the weights. */}
        {(currentPlan.starter + currentPlan.flour + currentPlan.water) > (parseFloat(totalMass) || 100) + 2 && (
          <Text style={[styles.massOverageNote, { color: colors.mutedForeground }]}>
            Total levain: {currentPlan.starter + currentPlan.flour + currentPlan.water}g
            {" "}(expanded from {parseFloat(totalMass) || 100}g to reach minimum starter amount)
          </Text>
        )}

        <Pressable
          onPress={() => onApplyRecipe(currentPlan)}
          style={({ pressed }) => [styles.applyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.applyBtnText, { color: colors.primaryForeground }]}>Build this Levain</Text>
          <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
        </Pressable>
      </Animated.View>

      {/* --- Smart Nudges --- */}
      {nudges.length > 0 && (
        <Animated.View entering={FadeInDown.delay(200)} style={styles.nudgeSection}>
          <View style={styles.nudgeHeader}>
            <Ionicons name="bulb-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.nudgeHeaderText, { color: colors.mutedForeground }]}>Better Options:</Text>
          </View>

          {nudges.map((nudge, i) => (
            <Pressable
              key={nudge.type}
              onPress={() => { setTargetHours(nudge.estimatedHours); Haptics.selectionAsync(); }}
              style={({ pressed }) => [
                styles.nudgeCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }
              ]}
            >
              <View style={styles.nudgeInfo}>
                <Text style={[styles.nudgeType, { color: colors.foreground }]}>
                  {nudge.type === "early" ? "Early Bird" : "Morning Fresh"}
                </Text>
                <Text style={[styles.nudgeDesc, { color: colors.mutedForeground }]}>
                  Peak by {formatTime(nudge.peakTime)} ({nudge.ratioStr})
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </Animated.View>
      )}
    </ScrollView>
  );
}

function RecipeItem({ label, value }: { label: string, value: number }) {
  const colors = useColors();
  return (
    <View style={styles.recipeItem}>
      <Text style={[styles.recipeValue, { color: colors.foreground }]}>{value}g</Text>
      <Text style={[styles.recipeLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 100 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 16 },
  usageTip: { padding: 12, borderRadius: 8, marginBottom: 16 },
  usageText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  warningBox: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", marginBottom: 24 },
  warningText: { flex: 1, fontSize: 12, lineHeight: 16 },
  inputGroup: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  inputRow: { flexDirection: "row" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginBottom: 6 },
    input: {
      height: 46, // Matching FeedSetupView height
      paddingHorizontal: 14,
      fontSize: 16, // Matching FeedSetupView font size
      borderWidth: 1,
      textAlign: 'center',
      fontFamily: "Inter_400Regular", // Matching FeedSetupView font
    },
  planCard: { borderRadius: 16, borderWidth: 1, padding: 20 },
  planHeader: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  planTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginLeft: 8, flex: 1 },
  timeBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  timeBadgeText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  hoursRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 24 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "white", alignItems: "center", justifyContent: "center", elevation: 1, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  hoursValue: { fontSize: 32, fontFamily: "Inter_700Bold", marginHorizontal: 24 },
  hoursLabel: { fontSize: 10, textTransform: "uppercase", fontFamily: "Inter_600SemiBold", marginTop: -4 },
  recipeRow: { flexDirection: "row", borderTopWidth: 1, paddingTop: 20, marginBottom: 20 },
  recipeItem: { flex: 1, alignItems: "center" },
  recipeValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  recipeLabel: { fontSize: 12, marginTop: 2 },
  ratioItem: { flex: 1.2, alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: "#ddd" },
  ratioLabel: { fontSize: 10, textTransform: "uppercase", fontFamily: "Inter_600SemiBold" },
  ratioValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 2 },
  applyBtn: { height: 48, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  applyBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  nudgeSection: { marginTop: 24 },
  nudgeHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  nudgeHeaderText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  nudgeCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  nudgeInfo: { flex: 1 },
  nudgeType: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  nudgeDesc: { fontSize: 13, marginTop: 2 },
});