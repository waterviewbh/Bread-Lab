import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, ScrollView, TextInput, Platform } from "react-native";
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
import { fonts, spacing, radius, typography } from "@/constants/theme";
import LevainSlider from "./LevainSlider";

// Biological rails for the levain hydration slider.
// 44% ≈ 1:25:11 — stiffest workable dough (true floor is ~40%, buffered by 10%).
// 180% ≈ 1:5:9  — slackest pourable levain (true ceiling is ~200%, buffered by 10%).
const MIN_LEVAIN_HYDRATION = 44;
const MAX_LEVAIN_HYDRATION = 180;

interface Props {
  history: FeedSession[];
  onApplyRecipe: (recipe: PlannedRecipe) => void;
  defaultTemp?: string;
}

export default function PeakWindowAdvisor({ history, onApplyRecipe, defaultTemp }: Props) {
  const isWeb = Platform.OS === 'web';
  const colors = useColors();
  const { tempUnit } = usePreferences(); // Get the global unit

  // --- State ---
  const [totalMass, setTotalMass] = useState("");
  const unitDefault = tempUnit === "F" ? "74" : "23";
  const [temp, setTemp] = useState("");
  const [targetHours, setTargetHours] = useState(6); // Default 6 hour plan

   // ── Levain hydration slider state ──────────────────────────────────────────
  // Actual baker's hydration % of the levain's feed portion.
  // 44 = stiffest rail (≈ 1:25:11), 100 = standard equal-parts, 180 = slackest rail (≈ 1:5:9)
  const [levainHydration, setLevainHydration] = useState(100);

  // --- Logic ---
  const model = useMemo(() => trainModel(history), [history]);

  const currentPlan = useMemo(() => {
    const mass = parseFloat(totalMass) || 100;
    let t = parseFloat(temp) || parseFloat(unitDefault);

    // 4. Normalize to Fahrenheit for the prediction math if using Celsius
    if (tempUnit === "C") {
      t = (t * 9/5) + 32;
    }

    return solveForRecipe(targetHours, mass, t, levainHydration, model);
  }, [totalMass, temp, targetHours, model, tempUnit]);

     // ── Levain breakdown — depends on currentPlan, must follow it ──────────────
     // addedStarter is timing-driven (duration stepper → inoculation ratio via solveForRecipe).
     // The remaining feed portion is split flour/water by the stiffness slider.
    const levainBreakdown = useMemo(() => {
    const totalEffective = currentPlan.starter + currentPlan.flour + currentPlan.water;
    const addedStarter = currentPlan.starter;
    const feedPortion = totalEffective - addedStarter;  // Weight-based constraints: enforce a minimum of 10g each for flour and water.
    // Derived from: flour = feedPortion / (1 + h/100), water = feedPortion - flour
    //   flour >= 10g  →  h <= (feedPortion/10 - 1) * 100
    //   water >= 10g  →  h >= 1000 / (feedPortion - 10)
    const constraintMin = feedPortion > 20
      ? Math.ceil(1000 / (feedPortion - 10))
      : MIN_LEVAIN_HYDRATION;
    const constraintMax = feedPortion > 20
      ? Math.floor((feedPortion / 10 - 1) * 100)
      : MIN_LEVAIN_HYDRATION;  // Clamp to the tighter of weight constraints and biological rails.
    const minHydration = Math.max(MIN_LEVAIN_HYDRATION, constraintMin);
    const maxHydration = Math.min(MAX_LEVAIN_HYDRATION, constraintMax);
    const clampedHydration = Math.max(minHydration, Math.min(maxHydration, levainHydration));  // Split feedPortion into flour and water using actual baker's hydration %.
    // flour + water = feedPortion, water/flour = clampedHydration/100
    const addedFlour = Math.round((feedPortion / (1 + clampedHydration / 100)) * 10) / 10;
    const addedWater = Math.round((feedPortion - addedFlour) * 10) / 10;  // 1:X:Y where X = flour multiple, Y = water multiple relative to starter
    const ratioFlour = addedStarter > 0 ? (addedFlour / addedStarter).toFixed(1) : "—";
    const ratioWater = addedStarter > 0 ? (addedWater / addedStarter).toFixed(1) : "—";
    return {
      addedStarter,
      addedFlour,
      addedWater,
      ratioStr: `1 : ${ratioFlour} : ${ratioWater}`,
      clampedHydration,
      minHydration,
      maxHydration,
    };
  }, [currentPlan, levainHydration]);

  // Use targetHours here as it's the direct input to the nudge calculation
  const nudges = useMemo(() => {
    const mass = parseFloat(totalMass) || 200;
    const t = parseFloat(temp) || 74;
    return getPeakWindowNudges(targetHours, mass, t, levainHydration, model);
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
      <Animated.View entering={isWeb ? undefined : FadeIn.duration(400)} layout={isWeb ? undefined : Layout}>
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
            <Text style={{ fontFamily: fonts.serifBold, color: colors.foreground }}>Note: </Text>
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
                    placeholder="e.g., 100"
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
                    placeholder={`e.g., ${unitDefault}`}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </View>
            </View>

      {/* --- The Current Plan --- */}
      <Animated.View style={[styles.planCard, {
          backgroundColor: colors.primary + "08", borderColor: colors.primary + "20" }]}
          layout={isWeb ? undefined : Layout}>
        {/* Sleep zone / target peak header */}
        <View style={styles.planHeader}>
          <MaterialCommunityIcons
            name={isInSleepWindow ? "moon-waning-crescent" : "clock-outline"}
            size={20}
            color={isInSleepWindow ? "#f59e0b" : colors.primary}
          />
          <Text style={[styles.planTitle, { color: isInSleepWindow ? "#92400e" : colors.primary }]}>
            {isInSleepWindow ? "Peaks in the Sleep Zone" : "Target Peak"}
          </Text>
          <View style={[styles.timeBadge, { backgroundColor: isInSleepWindow ? "#f59e0b" : colors.primary }]}>
            <Text style={styles.timeBadgeText}>{formatTime(currentPlan.peakTime)}</Text>
          </View>
        </View>
        {/* Duration stepper */}
        <View style={styles.hoursRow}>
          <Pressable
            onPress={() => {
                setTargetHours(Math.max(2, targetHours - 0.5));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={styles.stepBtn}
          ><Feather name="minus" size={20} color={colors.primary} />
          </Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[styles.hoursValue, {
                color: colors.foreground }]}>
                {targetHours % 1 === 0 ? targetHours : targetHours.toFixed(1)}h</Text>
            <Text style={[styles.hoursLabel, { color: colors.mutedForeground }]}>duration</Text>
          </View>
          <Pressable
            onPress={() => {
                setTargetHours(Math.min(24, targetHours + 0.5));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={styles.stepBtn}
          ><Feather name="plus" size={20} color={colors.primary} /></Pressable>
        </View>
        {/* ── Levain Builder — stiffness slider + output tiles ─────────────── */}
        <View style={[styles.levainSection, { borderTopColor: colors.border + "40" }]}>
        <View style={styles.levainLabelRow}>
          <Text style={[styles.levainSectionLabel, { color: colors.mutedForeground }]}>
            Levain Hydration
          </Text>
          {/* Quick-reset to 100% hydration — standard 1:1:1 (equal flour and water) */}
          <Pressable
            onPress={() => {
              setLevainHydration(100);
              Haptics.selectionAsync();
            }}
            style={styles.resetBtn}
          >
            <Feather name="rotate-ccw" size={11} color={colors.mutedForeground} />
            <Text style={[styles.resetBtnText, { color: colors.mutedForeground }]}>Reset 1:1</Text>
          </Pressable>
        </View>
          <LevainSlider
            value={levainBreakdown.clampedHydration}
            onChange={setLevainHydration}
            ratioStr={levainBreakdown.ratioStr}
            minValue={levainBreakdown.minHydration}
            maxValue={levainBreakdown.maxHydration}
          />
          {/* Single set of output weights */}
          <View style={styles.breakdownRow}>
            <LevainTile label="Starter"  value={levainBreakdown.addedStarter} colors={colors} />
            <LevainTile label="+ Flour"  value={levainBreakdown.addedFlour}   colors={colors} />
            <LevainTile label="+ Water"  value={levainBreakdown.addedWater}   colors={colors} />
          </View>
        </View>
        {/* Apply button — passes hydration-adjusted weights to Track a Feed */}
        <Pressable
          onPress={() => onApplyRecipe({
            ...currentPlan,
            starter:  levainBreakdown.addedStarter,
            flour:    levainBreakdown.addedFlour,
            water:    levainBreakdown.addedWater,
            ratioStr: levainBreakdown.ratioStr,
          })}
          style={({ pressed }) => [styles.applyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.applyBtnText, { color: colors.primaryForeground }]}>Build this Levain</Text>
          <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
        </Pressable>
      </Animated.View>

      {/* --- Smart Nudges --- */}
      {nudges.length > 0 && (
        <Animated.View entering={isWeb ? undefined : FadeInDown.delay(200)} style={styles.nudgeSection} layout={isWeb ? undefined : Layout}>
          <View style={styles.nudgeHeader}>
            <Ionicons name="bulb-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.nudgeHeaderText, { color: colors.mutedForeground }]}>Better Option(s):</Text>
          </View>

          {nudges.map((nudge) => (
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
                  {'Peak by {formatTime(nudge.peakTime)} ({nudge.ratioStr})'}
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

// ── LevainTile ──────────────────────────────────────────────────────────────
// Small data tile for the Starter / Added Flour / Added Water breakdown.
function LevainTile({
  label,
  value,
  colors,
}: {
  label: string;
  value: number;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.levainTile, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.levainTileLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.levainTileValue, { color: colors.foreground }]}>{value}g</Text>
    </View>
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
  container: {
    paddingBottom: 100,
  },
  title: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — advisor title as editorial serif
    fontSize: 22,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 14,
    marginBottom: spacing.md,               // 16
  },
  usageTip: {
    padding: 12,
    borderRadius: radius.md,                 // 8
    marginBottom: spacing.md,               // 16
  },
  usageText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 13,
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: spacing.lg,               // 24
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 12,
    lineHeight: 16,
  },
  inputGroup: {
    padding: spacing.md,                     // 16
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    marginBottom: spacing.lg - 4,           // 20
  },
  inputRow: {
    flexDirection: "row",
  },
  label: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: 6,
  },
  input: {
    height: 46,
    paddingHorizontal: 10,                   // changed from 14 when added comma to e.g.
    fontSize: 15,                            // changed from 16 at the same time
    fontFamily: fonts.mono,                  // HankenGrotesk_400Regular
    borderWidth: 1,
    textAlign: "center",
  },
  planCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg - 4,               // 20
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg - 4,           // 20
  },
  planTitle: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 16,
    marginLeft: spacing.sm,                  // 8
    flex: 1,
  },
  timeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,               // pill shape
  },
  timeBadgeText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — formatted time string, not raw number
    color: "#fff",
    fontSize: 14,
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,               // 24
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  hoursValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — hour count is the key data point
    fontSize: 32,
    marginHorizontal: spacing.lg,           // 24
  },
  hoursLabel: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 10,
    textTransform: "uppercase",
    marginTop: -4,
  },
  applyBtn: {
    height: 48,
    borderRadius: radius.lg,                 // 12
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,                         // 8
  },
  applyBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — primary action
    fontSize: 16,
  },
  nudgeSection: {
    marginTop: spacing.lg,                   // 24
  },
  nudgeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  nudgeHeaderText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 11,
    letterSpacing: 1,
  },
  nudgeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,                     // 16
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    marginBottom: 10,
  },
  nudgeInfo: {
    flex: 1,
  },
  nudgeType: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 15,
  },
  nudgeDesc: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 13,
    marginTop: 2,
  },
  // ── Levain Builder ────────────────────────────────────────────────────────
  levainSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg - 4,              // 20 — breathing room below "Build this Levain" button
    paddingTop: spacing.md,                 // 16
  },
 levainSectionLabel: {
   ...typography.sectionLabel,             // HankenGrotesk_600SemiBold, uppercase, 11px
   // marginBottom moved to levainLabelRow
 },
 levainLabelRow: {
   flexDirection: "row",
   alignItems: "center",
   justifyContent: "space-between",
   marginBottom: spacing.sm,              // 8 — was on levainSectionLabel
 },
 resetBtn: {
   flexDirection: "row",
   alignItems: "center",
   gap: 4,
 },
 resetBtnText: {
   fontFamily: fonts.sansSemiBold,        // HankenGrotesk_600SemiBold — matches label weight
   fontSize: 11,
   textTransform: "uppercase",
   letterSpacing: 0.5,
 },
  breakdownRow: {
    flexDirection: "row",
    gap: spacing.sm,                        // 8
    marginTop: spacing.md,                  // 16
  },
  levainTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,            // 8
    borderRadius: radius.md,               // 8
    borderWidth: 1,
  },
  levainTileLabel: {
    fontFamily: fonts.sans,                // HankenGrotesk_400Regular
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  levainTileValue: {
    fontFamily: fonts.mono,                // JetBrainsMono_500Medium — gram weights are data
    fontSize: 16,
  },
});