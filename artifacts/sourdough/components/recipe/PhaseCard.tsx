// components/recipe/PhaseCard.tsx
// ─── Three phase card variants for the Recipe Runner active bake tracker ──────
// Pending: not started yet — shows Start button, optional spec preview.
// Done:    completed — collapsible summary with readings and duration.
// Active:  currently running — timer, fold tracker, spec panel, actions.
//
// All three are in one file because they share a StyleSheet and are only ever
// used together in the same map() in RecipeRunnerActiveView / recipe.tsx.
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { type BakePhase, type BulkFermentReading, VOLUME_TRACKING_PHASE_KEYS } from "@/lib/recipeTypes";
import { formatDone, formatTimer, scalePhaseText } from "@/lib/recipeUtils";
import { useBulkFermentTimer } from "@/hooks/useBulkFermentTimer";
import { getBulkTargetLabel, getBulkRisePercent } from "@/lib/bulkFermentUtils";
import { PhaseHighlight } from "@/components/recipe/PhaseHighlight";
import { ReadingRow } from "@/components/recipe/ReadingRow";
import { fonts, spacing, radius, typography } from "@/constants/theme";

// ─── Shared Component ────────────────────────────────────────────────────────
const CheckRow = ({
  line,
  isChecked,
  onToggle,
  colors,
  scaleMultiplier
}: any) => {
  const textStyle = {
    ...s.specText,
    color: isChecked ? colors.mutedForeground : colors.foreground,
    textDecorationLine: (isChecked ? 'line-through' : 'none') as any,
    opacity: isChecked ? 0.8 : 1, // Slight opacity boost for visibility on Android
  };

  return (
    <Pressable onPress={onToggle} style={s.checkRow}>
      <Feather
        name={isChecked ? "check-square" : "square"}
        size={16}
        color={isChecked ? colors.accent : colors.mutedForeground}
        style={{ marginTop: 2 }}
      />
      <Text style={textStyle}>
        {scalePhaseText(line.text, scaleMultiplier)}
      </Text>
    </Pressable>
  );
};

// ─── PendingPhaseCard ─────────────────────────────────────────────────────────
export interface PendingPhaseCardProps {
  phase: BakePhase;
  colors: ReturnType<typeof useColors>;
  isNextHighlight: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStart: () => void;
  onLayout: (y: number) => void;
  scaleMultiplier: number;
  sessionChecks: Record<string, boolean>;
  onToggleLineCheck: (id: string) => void;
}

export function PendingPhaseCard({
  phase,
  colors,
  isNextHighlight,
  isExpanded,
  onToggleExpand,
  onStart,
  onLayout,
  scaleMultiplier,
  sessionChecks,
  onToggleLineCheck,
}: PendingPhaseCardProps) {
  const hasPendingInfo = phase.ingredients.length > 0 || phase.instructions.length > 0;
  return (
    <PhaseHighlight active={isNextHighlight} accentColor={colors.accent}>
      <View
        style={[s.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
      >
        <Pressable onPress={() => hasPendingInfo && onToggleExpand()} style={s.compactRow}>
          <Ionicons name="ellipse-outline" size={18} color={colors.border} />
          <Text style={[s.compactName, { color: colors.mutedForeground, fontFamily: fonts.sans, flex: 1 }]}>
            {phase.name}
          </Text>
          {hasPendingInfo && (
            <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} style={{ marginRight: 6 }} />
          )}
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onStart(); }}
            style={({ pressed }) => [s.startBtn, { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[s.startBtnText, { color: colors.foreground }]}>Start</Text>
            <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
          </Pressable>
        </Pressable>
        {isExpanded && hasPendingInfo && (
          <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
            {phase.ingredients.length > 0 && (
              <>
                <Text style={s.recipeInfoLabel}>Ingredients</Text>
                {phase.ingredients.map(line => (
                  <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
                ))}
              </>
            )}
            {phase.instructions.length > 0 && (
              <>
                <Text style={[s.recipeInfoLabel, { marginTop: 8 }]}>Instructions</Text>
                {phase.instructions.map(line => (
                  <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
                ))}
              </>
            )}
          </View>
        )}
      </View>
    </PhaseHighlight>
  );
}

// ─── DonePhaseCard ────────────────────────────────────────────────────────────
export interface DonePhaseCardProps {
  phase: BakePhase;
  colors: ReturnType<typeof useColors>;
  isRecentlyCompleted: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenReadingModal: () => void;
  onDeleteReading: (readingId: string) => void;
  onLayout: (y: number) => void;
  scaleMultiplier: number;
  sessionChecks: Record<string, boolean>;
  onToggleLineCheck: (id: string) => void;
}

export function DonePhaseCard({
  phase,
  colors,
  isRecentlyCompleted,
  isExpanded,
  onToggleExpand,
  onOpenReadingModal,
  onDeleteReading,
  onLayout,
  scaleMultiplier,
  sessionChecks,
  onToggleLineCheck,
}: DonePhaseCardProps) {
  const hasSpec = phase.ingredients.length > 0 || phase.instructions.length > 0;
  return (
    <Animated.View
      entering={isRecentlyCompleted ? FadeIn.duration(300) : undefined}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
    >
      <Pressable onPress={onToggleExpand} style={({ pressed }) => [s.compactCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
        <View style={s.compactRow}>
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Text style={[s.compactName, { color: colors.foreground, fontFamily: fonts.sansMedium, flex: 1 }]}>{phase.name}</Text>
          <Text style={[s.doneTime, { color: colors.mutedForeground }]}>
            {phase.startedAt && phase.completedAt ? formatDone(phase.completedAt - phase.startedAt) : ""}
          </Text>
          <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </View>
        {isExpanded && (
          <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
            {VOLUME_TRACKING_PHASE_KEYS.has(phase.key) && (!!phase.startVolume || phase.readings.some(r => r.volume)) && (
              <View style={[s.volRangeRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                <Text style={s.volRangeLabel}>Volume</Text>
                <Text style={s.volRangeValue}>{phase.startVolume || "—"} → {phase.readings.filter(r => r.volume).at(-1)?.volume || "—"}</Text>
              </View>
            )}
            {phase.readings.length > 0 ? phase.readings.map(r => <ReadingRow key={r.id} reading={r} colors={colors} onDelete={() => onDeleteReading(r.id)} />) : <Text style={s.sectionLabel}>No readings logged</Text>}
            <Pressable onPress={(e) => { e.stopPropagation?.(); onOpenReadingModal(); }} style={s.addReadingBtn}>
              <Feather name="plus" size={12} color={colors.mutedForeground} />
              <Text style={s.addReadingText}>Add reading</Text>
            </Pressable>
            {hasSpec && (
              <View style={{ marginTop: 12 }}>
                {phase.ingredients.length > 0 && (
                  <>
                    <Text style={s.recipeInfoLabel}>Ingredients</Text>
                    {phase.ingredients.map(line => (
                      <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
                    ))}
                  </>
                )}
                {phase.instructions.length > 0 && (
                  <>
                    <Text style={[s.recipeInfoLabel, { marginTop: 8 }]}>Instructions</Text>
                    {phase.instructions.map(line => (
                      <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
                    ))}
                  </>
                )}
              </View>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── ActivePhaseCard ──────────────────────────────────────────────────────────
export interface ActivePhaseCardProps {
  phase: BakePhase;
  colors: ReturnType<typeof useColors>;
  elapsedMs: number;
  scaleMultiplier: number;
  startVolumeInput: string;
  onStartVolumeChange: (value: string) => void;
  onStartVolumeCommit: (value: string) => void;
  copiedIngredientsKey: string | null;
  onCopyIngredients: () => void;
  isSpecExpanded: boolean;
  onToggleSpec: () => void;
  onToggleFold: (idx: number) => void;
  onLogReading: () => void;
  onComplete: () => void;
  onShareSpec: () => void;
  onLayout: (y: number) => void;
  inoculationPercent?: 10 | 20 | 30 | null;
  sessionChecks: Record<string, boolean>;
  onToggleLineCheck: (id: string) => void;
}

export function ActivePhaseCard({
  phase,
  colors,
  elapsedMs,
  scaleMultiplier,
  startVolumeInput,
  onStartVolumeChange,
  onStartVolumeCommit,
  copiedIngredientsKey,
  onCopyIngredients,
  isSpecExpanded,
  onToggleSpec,
  onToggleFold,
  onLogReading,
  onComplete,
  onShareSpec,
  onLayout,
  inoculationPercent,
  sessionChecks,
  onToggleLineCheck,
}: ActivePhaseCardProps) {
    const hasRecipeInfo = phase.ingredients.length > 0 || phase.instructions.length > 0;
    const isBulk = phase.key === "bulk_fermenting";
    const bulkTimer = useBulkFermentTimer(isBulk ? phase.bulkFermentState : undefined);
    const bulkTargetLabel = getBulkTargetLabel(phase.bulkFermentState);

  return (
    <View style={[s.activeCard, { backgroundColor: colors.card, borderColor: colors.accent }]} onLayout={(e) => onLayout(e.nativeEvent.layout.y)}>
      <View style={[s.activeStrip, { backgroundColor: colors.accent }]} />

      <View style={s.activeHeader}>
        <View style={s.compactRow}>
          <Ionicons name="radio-button-on" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[s.compactName, { color: colors.foreground, fontFamily: fonts.sansSemiBold }]}>{phase.name}</Text>
          </View>
          {!isBulk && <Text style={[s.timerLarge, { color: colors.accent }]}>{formatTimer(elapsedMs)}</Text>}
        </View>
      </View>

      {isBulk && (
        <View style={s.bulkDashboard}>
          {/* Hero Timer & Target */}
          <View style={s.heroTimerSection}>
            <Text style={[s.heroTimerLabel, { color: colors.mutedForeground }]}>
              {bulkTimer.mode === "countdown" ? "EST. REMAINING" : bulkTimer.mode === "overtime" ? "PAST TARGET" : "TIME IN BULK"}
            </Text>
            <Text style={[s.heroTimerText, { color: bulkTimer.mode === "overtime" ? "#C8862A" : colors.foreground }]}>
              {bulkTimer.label || formatTimer(elapsedMs)}
            </Text>
            {bulkTargetLabel && <Text style={[s.heroTargetText, { color: colors.foreground }]}>{bulkTargetLabel}</Text>}
          </View>

          <View style={s.dashboardGrid}>
            {/* Start Volume Column */}
            <View style={s.dashboardCol}>
              <Text style={s.colLabel}>STARTING VOLUME{"\n"}(ML)</Text>
              <TextInput
                style={[s.dashboardInput, { color: colors.foreground, borderColor: colors.border }]}
                value={startVolumeInput}
                onChangeText={onStartVolumeChange}
                onBlur={() => onStartVolumeCommit(startVolumeInput)}
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
              />
            </View>

            <View style={[s.vDivider, { backgroundColor: colors.border }]} />

            {/* Rise Progress Column */}
            <View style={s.dashboardCol}>
              <Text style={s.colLabel}>RISE</Text>
              <View style={s.riseDisplayCenter}>
                <Text style={[s.riseValueHero, { color: colors.accent }]}>
                  {(() => {
                    const lastReading = phase.readings.filter(r => (r as any).volume_ml).at(-1) as any;
                    const pct = getBulkRisePercent(phase.bulkFermentState, lastReading?.volume_ml);
                    return pct !== null ? `${pct}%` : "0%";
                  })()}
                </Text>
                <Text style={[s.riseLabelSmall, { color: colors.mutedForeground }]}>of target</Text>
              </View>
            </View>
          </View>

          <Pressable onPress={onLogReading} style={({ pressed }) => [s.bulkActionBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}>
            <MaterialCommunityIcons name="timer-cog-outline" size={20} color="#fff" />
            <Text style={s.bulkActionBtnText}>Bulk Check-In</Text>
          </Pressable>

          {!phase.readings.some(r => (r as any).volume_ml) && (
            <Text style={s.bulkHint}>Log your first volume reading to start the estimator.</Text>
          )}
        </View>
      )}

      {/* Existing Phase Specs & Actions */}
      {hasRecipeInfo && (
        <Pressable onPress={onToggleSpec} style={s.recipeInfoToggle}>
          <Feather name="book-open" size={12} color={isSpecExpanded ? colors.accent : colors.mutedForeground} />
          <Text style={[s.recipeInfoToggleText, { color: isSpecExpanded ? colors.accent : colors.mutedForeground }]}>Phase specs</Text>
          <Feather name={isSpecExpanded ? "chevron-up" : "chevron-down"} size={12} color={colors.mutedForeground} />
        </Pressable>
      )}

      {isSpecExpanded && (
        <View style={[s.recipeInfoSection, { borderTopColor: colors.border }]}>
          {phase.ingredients.length > 0 && (
            <>
              <View style={s.ingredientsLabelRow}>
                <Text style={s.recipeInfoLabel}>Ingredients</Text>
                <Pressable onPress={onCopyIngredients} style={s.copyBtn}>
                  <Feather name={copiedIngredientsKey === phase.key ? "check" : "copy"} size={11} color={colors.mutedForeground} />
                  <Text style={s.copyBtnText}>{copiedIngredientsKey === phase.key ? "Copied ✓" : "Copy"}</Text>
                </Pressable>
              </View>
              {phase.ingredients.map(line => (
                <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
              ))}
            </>
          )}
          {phase.instructions.length > 0 && (
            <>
              <Text style={[s.recipeInfoLabel, { marginTop: 12 }]}>Instructions</Text>
              {phase.instructions.map(line => (
                <CheckRow key={line.id} line={line} isChecked={sessionChecks[line.id]} onToggle={() => onToggleLineCheck(line.id)} colors={colors} scaleMultiplier={scaleMultiplier} />
              ))}
            </>
          )}
        </View>
      )}

      <View style={s.activeActions}>
        <Pressable onPress={onComplete} style={[s.actionBtn, { borderColor: colors.primary + "50", backgroundColor: colors.primary + "12", flex: 1 }]}>
          <Ionicons name="checkmark" size={13} color={colors.primary} />
          <Text style={[s.actionBtnText, { color: colors.primary }]}>Complete Phase</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  compactCard: { borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  compactName: { fontSize: 15 },
  expandedSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6 },
  specText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20 },
  sectionLabel: { fontFamily: fonts.sans, fontSize: 13, paddingVertical: 4 },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1 },
  startBtnText: { fontFamily: fonts.sansMedium, fontSize: 13 },
  doneTime: { fontFamily: fonts.sans, fontSize: 12, marginRight: 4 },
  addReadingBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, alignSelf: "flex-start" },
  addReadingText: { fontFamily: fonts.sans, fontSize: 12 },
  volRangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, marginBottom: 2 },
  volRangeLabel: { fontFamily: fonts.sansMedium, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, minWidth: 52 },
  volRangeValue: { fontFamily: fonts.mono, fontSize: 13, flex: 1 },
  activeCard: { borderRadius: radius.md, borderWidth: 1.5, overflow: "hidden", position: "relative" },
  activeStrip: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  activeHeader: { paddingLeft: 3 },
  timerLarge: { fontFamily: fonts.mono, fontSize: 16, letterSpacing: -0.5 },
  recipeInfoToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 17, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  recipeInfoToggleText: { fontFamily: fonts.sansMedium, fontSize: 12, flex: 1 },
  recipeInfoSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 17, paddingTop: 12, paddingBottom: 12 },
  recipeInfoLabel: { ...typography.sectionLabel, marginBottom: 4 },
  recipeInfoText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  ingredientsLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 2, paddingHorizontal: 6 },
  copyBtnText: { fontFamily: fonts.sansMedium, fontSize: 10 },
  activeActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: 14, paddingLeft: 17, paddingBottom: 12, paddingTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1 },
  actionBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  bulkTimerSub: { fontFamily: fonts.sansMedium, fontSize: 11, marginTop: 1 },
  bulkDashboard: {
    paddingHorizontal: 17,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.05)",
    gap: 12,
  },
  heroTimerSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  heroTimerLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTimerText: {
    fontFamily: fonts.serifBold, // Editorial Serif like the Feed Tab
    fontSize: 48,
    letterSpacing: -1,
  },
  heroTargetText: {
      fontFamily: fonts.serif,
      fontSize: 18,
      marginTop: 8,
  },
  dashboardGrid: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  dashboardCol: {
    flex: 1,
    alignItems: "center",
  },
  colLabel: {
    ...typography.sectionLabel,
    fontSize: 10,
    textAlign: "center",
    lineHeight: 14,
    marginBottom: 10,
    height: 28,
  },
  dashboardInput: {
    width: 80,
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 18,
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  vDivider: {
    width: 1,
    height: 60,
    opacity: 0.3,
  },
  riseDisplayCenter: {
    alignItems: "center",
  },
  riseValueHero: {
    fontFamily: fonts.mono,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -1,
  },
  riseLabelSmall: {
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: -2,
  },
  bulkActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    gap: 10,
  },
  bulkActionBtnText: {
    fontFamily: fonts.sansSemiBold,
    color: "#fff",
    fontSize: 16,
  },
  bulkHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
  },
  bulkMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  inocPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  inocPillText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    textTransform: "uppercase",
  },
  bulkTargetText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
  },
  bulkProgressRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  volInputWrap: {
    flex: 1,
  },
  volInputLabel: {
    ...typography.sectionLabel,
    fontSize: 9,
    marginBottom: 4,
    opacity: 0.8,
  },
  volInput: {
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontFamily: fonts.mono,
    fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  riseProgressWrap: {
    flex: 1.2,
    justifyContent: "center",
  },
  riseDisplay: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingTop: 4,
  },
  riseValue: {
    fontFamily: fonts.mono,
    fontSize: 26,
    letterSpacing: -1,
  },
  riseLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  bulkCheckInBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 10,
    gap: 8,
    marginTop: 4,
  },
  bulkCheckInBtnText: {
    fontFamily: fonts.sansSemiBold,
    color: "#fff",
    fontSize: 15,
  },
});