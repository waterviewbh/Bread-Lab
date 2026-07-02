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
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { type BakePhase, type BulkFermentReading, VOLUME_TRACKING_PHASE_KEYS } from "@/lib/recipeTypes";
import { formatDone, formatTimer, scalePhaseText } from "@/lib/recipeUtils";
import { useBulkFermentTimer } from "@/hooks/useBulkFermentTimer";
import { getBulkTargetLabel, getBulkRisePercent } from "@/lib/bulkFermentUtils";
import { PhaseHighlight } from "@/components/recipe/PhaseHighlight";
import { ReadingRow } from "@/components/recipe/ReadingRow";

// ─── PendingPhaseCard ─────────────────────────────────────────────────────────
export interface PendingPhaseCardProps {
  phase: BakePhase;
  colors: ReturnType<typeof useColors>;
  // True when this card should pulse the next-phase highlight glow.
  isNextHighlight: boolean;
  // True when the user has tapped the card open to preview recipe info.
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStart: () => void;
  // Ref callback so the runner scroll-to can read this card's y-offset.
  onLayout: (y: number) => void;
  // Multiplier for display-time quantity scaling — passed from the runner's scale selector.
  scaleMultiplier: number;
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
}: PendingPhaseCardProps) {
  const hasPendingInfo = !!(phase.ingredients || phase.instructions);
  return (
    // PhaseHighlight wraps the card to pulse a glow when this becomes the next phase
    <PhaseHighlight active={isNextHighlight} accentColor={colors.accent}>
      <View
        style={[s.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
      >
        {/* Tap the name/chevron area to preview spec; Start is a separate pressable. */}
        <Pressable
          onPress={() => hasPendingInfo && onToggleExpand()}
          style={s.compactRow}
        >
          <Ionicons name="ellipse-outline" size={18} color={colors.border} />
          <Text
            style={[s.compactName, { color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1 }]}
          >
            {phase.name}
          </Text>
          {hasPendingInfo && (
            <Feather
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.mutedForeground}
              style={{ marginRight: 6 }}
            />
          )}
          {/* Start button — stopPropagation prevents the expand toggle from also firing */}
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onStart(); }}
            style={({ pressed }) => [
              s.startBtn,
              { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[s.startBtnText, { color: colors.foreground }]}>Start</Text>
            <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
          </Pressable>
        </Pressable>
        {/* Collapsible recipe info preview — only shown when user taps to expand */}
        {isExpanded && hasPendingInfo && (
          <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
            {!!phase.ingredients && (
              <>
                <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginBottom: 4 }]}>
                  Ingredients
                </Text>
                <Text style={[s.specText, { color: colors.foreground }]}>
                  {scalePhaseText(phase.ingredients, scaleMultiplier)}
                </Text>
              </>
            )}
            {!!phase.instructions && (
              <>
                <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginTop: phase.ingredients ? 10 : 0, marginBottom: 4 }]}>
                  Instructions
                </Text>
                <Text style={[s.specText, { color: colors.foreground }]}>
                  {scalePhaseText(phase.instructions, scaleMultiplier)}
                </Text>
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
  // True on the render immediately after this phase was completed — drives FadeIn.
  isRecentlyCompleted: boolean;
  // True when the card body is expanded to show readings and spec.
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenReadingModal: () => void;
  onDeleteReading: (readingId: string) => void;
  onLayout: (y: number) => void;
  // Multiplier for display-time quantity scaling — passed from the runner's scale selector.
  scaleMultiplier: number;
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
}: DonePhaseCardProps) {
  return (
    // FadeIn only fires on the first mount of the done card (when the key changes
    // from "-active" to "-done"). Passing undefined skips the animation for cards
    // that were already done when the screen mounted.
    <Animated.View
      entering={isRecentlyCompleted ? FadeIn.duration(300) : undefined}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
    >
      <Pressable
        onPress={onToggleExpand}
        style={({ pressed }) => [
          s.compactCard,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={s.compactRow}>
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Text style={[s.compactName, { color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }]}>
            {phase.name}
          </Text>
          <Text style={[s.doneTime, { color: colors.mutedForeground }]}>
            {phase.startedAt && phase.completedAt
              ? formatDone(phase.completedAt - phase.startedAt)
              : ""}
          </Text>
          {/* Reading count badge — visible even when collapsed */}
          {phase.readings.length > 0 && (
            <View style={[s.readingCountBadge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[s.readingCountText, { color: colors.mutedForeground }]}>
                {phase.readings.length}
              </Text>
            </View>
          )}
          <Feather
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.mutedForeground}
          />
        </View>
        {isExpanded && (
          <View style={[s.expandedSection, { borderTopColor: colors.border }]}>
            {/* Volume rise range — only for phases that track fermentation volume */}
            {VOLUME_TRACKING_PHASE_KEYS.has(phase.key) &&
              (!!phase.startVolume || phase.readings.some((r) => r.volume)) && (
              <View style={[s.volRangeRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                <Text style={[s.volRangeLabel, { color: colors.mutedForeground }]}>Volume</Text>
                <Text style={[s.volRangeValue, { color: colors.foreground }]}>
                  {phase.startVolume || "—"} → {phase.readings.filter((r) => r.volume).at(-1)?.volume || "—"}
                </Text>
              </View>
            )}
        {/* Readings list or empty state */}
            {phase.readings.length > 0
              ? phase.readings.map((r) => (
                  <ReadingRow
                    key={r.id}
                    reading={r}
                    colors={colors}
                    onDelete={() => onDeleteReading(r.id)}
                  />
                ))
              : <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>No readings logged</Text>
            }
        <Pressable
              onPress={(e) => { e.stopPropagation?.(); onOpenReadingModal(); }}
              style={({ pressed }) => [s.addReadingBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="plus" size={12} color={colors.mutedForeground} />
              <Text style={[s.addReadingText, { color: colors.mutedForeground }]}>Add reading</Text>
            </Pressable>
            {/* Recipe spec — shown at the bottom of an expanded done card */}
            {(!!phase.ingredients || !!phase.instructions) && (
              <View style={{ marginTop: 12 }}>
                {!!phase.ingredients && (
                  <>
                    <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginBottom: 4 }]}>
                      Ingredients
                    </Text>
                    <Text style={[s.specText, { color: colors.foreground }]}>
                      {scalePhaseText(phase.ingredients, scaleMultiplier)}
                    </Text>
                  </>
                )}
                {!!phase.instructions && (
                  <>
                    <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginTop: phase.ingredients ? 10 : 0, marginBottom: 4 }]}>
                      Instructions
                    </Text>
                    <Text style={[s.specText, { color: colors.foreground }]}>
                      {scalePhaseText(phase.instructions, scaleMultiplier)}
                    </Text>
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
  // Milliseconds elapsed since this phase started — driven by the parent's timer interval.
  elapsedMs: number;
  scaleMultiplier: number;
  // Current value of the start-volume text input for this phase (controlled from parent).
  startVolumeInput: string;
  onStartVolumeChange: (value: string) => void;
  onStartVolumeCommit: (value: string) => void;
  // The phase key whose ingredients were most recently copied — drives the copy button checkmark.
  copiedIngredientsKey: string | null;
  onCopyIngredients: () => void;
  // True when the recipe spec panel is expanded.
  isSpecExpanded: boolean;
  onToggleSpec: () => void;
  onToggleFold: (idx: number) => void;
  onLogReading: () => void;
  onComplete: () => void;
  onShareSpec: () => void;
  onLayout: (y: number) => void;
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
}: ActivePhaseCardProps) {
    const hasRecipeInfo = !!(phase.ingredients || phase.instructions);
    // ── Bulk ferment derived display values ──────────────────────────────────
    // isBulk gates all bulk-specific UI — keeps non-bulk phases completely unaffected
    const isBulk = phase.key === "bulk_fermenting";
    // Latest numeric volume reading — drives the rise progress bar
    const lastVolMl = isBulk
      ? (phase.readings as BulkFermentReading[])
          .filter((r) => typeof r.volume_ml === "number")
          .at(-1)?.volume_ml
      : undefined;
    // Self-contained reactive ticker — only ticks when projection or overtime is active
    const bulkTimer = useBulkFermentTimer(isBulk ? phase.bulkFermentState : undefined);
    const bulkTargetLabel = getBulkTargetLabel(phase.bulkFermentState);
    const bulkRisePercent = getBulkRisePercent(phase.bulkFermentState, lastVolMl);
  return (
    <View
      style={[s.activeCard, { backgroundColor: colors.card, borderColor: colors.accent }]}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
    >
      {/* Accent left-edge strip */}
      <View style={[s.activeStrip, { backgroundColor: colors.accent }]} />
        {/* Header row: icon, name, elapsed timer */}
        <View style={s.activeHeader}>
          <View style={s.compactRow}>
            <Ionicons name="radio-button-on" size={18} color={colors.accent} />
            {/* Name + optional bulk smart-timer subtitle stacked in a column */}
            <View style={{ flex: 1 }}>
              <Text style={[s.compactName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {phase.name}
              </Text>
              {/* Countdown: shown once the PD engine has enough data to project */}
              {isBulk && bulkTimer.mode === "countdown" && (
                <Text style={[s.bulkTimerSub, { color: colors.accent }]}>
                  Est. {bulkTimer.label} remaining
                </Text>
              )}
              {/* Overtime: shown after the target volume has been reached */}
              {isBulk && bulkTimer.mode === "overtime" && (
                <Text style={[s.bulkTimerSub, { color: "#C8862A" }]}>
                  {bulkTimer.label} past target
                </Text>
              )}
            </View>
            <Text style={[s.timerLarge, { color: colors.accent }]}>
              {formatTimer(elapsedMs)}
            </Text>
          </View>
        </View>
      {/* ── Bulk ferment status panel ─────────────────────────────────────
           Visible only during bulk_fermenting. Shows target volume, rise
           progress bar, and a reading count. Hidden for all other phases. */}
      {isBulk && (
        <View style={[s.bulkStatusPanel, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
          {/* Target label + reading count on the same row */}
          <View style={s.bulkStatusRow}>
            <Text style={[s.bulkStatusLabel, { color: colors.mutedForeground }]}>
              {bulkTargetLabel ?? "Waiting for first check-in…"}
            </Text>
            {phase.readings.length > 0 && (
              <Text style={[s.bulkReadingCount, { color: colors.mutedForeground }]}>
                {phase.readings.length} {phase.readings.length === 1 ? "reading" : "readings"}
              </Text>
            )}
          </View>
          {/* Rise progress bar — only once engine has a start and current volume */}
          {bulkRisePercent !== null && (
            <View style={[s.bulkProgressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  s.bulkProgressFill,
                  {
                    // Turns amber when the target has been reached (overtime)
                    backgroundColor: bulkRisePercent >= 100 ? "#C8862A" : colors.accent,
                    width: `${Math.min(100, bulkRisePercent)}%` as `${number}%`,
                  },
                ]}
              />
            </View>
          )}
        </View>
      )}
      {/* Start volume input — only for fermentation/proofing phases that track rise */}
      {VOLUME_TRACKING_PHASE_KEYS.has(phase.key) && phase.key !== "bulk_fermenting" && (
        <View style={[s.startVolRow, { borderTopColor: colors.border }]}>
          <Text style={[s.startVolLabel, { color: colors.mutedForeground }]}>Start vol.</Text>
          <TextInput
            style={[s.startVolInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="—"
            placeholderTextColor={colors.mutedForeground}
            value={startVolumeInput}
            onChangeText={onStartVolumeChange}
            onEndEditing={() => onStartVolumeCommit(startVolumeInput)}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
        </View>
      )}
      {/* Fold tracker — stretching & folding phase only */}
      {phase.key === "stretching_folding" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16, marginTop: -4, paddingLeft: 12 }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Folds:</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = (phase.foldCount || 0) > idx;
              return (
                <Pressable
                  key={idx}
                  onPress={() => onToggleFold(idx)}
                  style={{
                    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                    borderColor: isFilled ? "#6E7558" : colors.border,
                    backgroundColor: isFilled ? "#6E7558" : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}
                />
              );
            })}
          </View>
        </View>
      )}
        {/* Recipe spec toggle — only when phase has ingredients or instructions */}
        {hasRecipeInfo && (
          <Pressable
            onPress={onToggleSpec}
            style={({ pressed }) => [
              s.recipeInfoToggle,
              { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="book-open" size={12} color={isSpecExpanded ? colors.accent : colors.mutedForeground} />
            <Text style={[s.recipeInfoToggleText, { color: isSpecExpanded ? colors.accent : colors.mutedForeground }]}>
              Phase specs
            </Text>
            <Feather name={isSpecExpanded ? "chevron-up" : "chevron-down"} size={12} color={colors.mutedForeground} />
          </Pressable>
        )}
        {/* Expanded spec panel — ingredients + instructions with copy/share actions */}
        {isSpecExpanded && (
          <View style={[s.recipeInfoSection, { borderTopColor: colors.border }]}>
            {!!phase.ingredients && (
              <>
                <View style={s.ingredientsLabelRow}>
                  <Text style={[s.recipeInfoLabel, { color: colors.mutedForeground }]}>Ingredients</Text>
                  <Pressable
                    onPress={onCopyIngredients}
                    style={({ pressed }) => [s.copyBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Feather
                      name={copiedIngredientsKey === phase.key ? "check" : "copy"}
                      size={11}
                      color={colors.mutedForeground}
                    />
                    <Text style={[s.copyBtnText, { color: colors.mutedForeground }]}>
                      {copiedIngredientsKey === phase.key ? "Copied ✓" : "Copy"}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[s.recipeInfoText, { color: colors.foreground }]}>
                  {scalePhaseText(phase.ingredients, scaleMultiplier)}
                </Text>
              </>
            )}
            {!!phase.instructions && (
              <>
                <Text style={[s.recipeInfoLabel, { color: colors.mutedForeground, marginTop: phase.ingredients ? 12 : 0 }]}>
                  Instructions
                </Text>
                <Text style={[s.recipeInfoText, { color: colors.foreground }]}>
                  {scalePhaseText(phase.instructions, scaleMultiplier)}
                </Text>
              </>
            )}
            <Pressable
              onPress={onShareSpec}
              style={({ pressed }) => [s.sharePhaseBtn, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="share" size={12} color={colors.mutedForeground} />
              <Text style={[s.sharePhaseText, { color: colors.mutedForeground }]}>Share spec</Text>
            </Pressable>
          </View>
        )}
        {/* Action buttons — Log Reading (skipped for the oven bake) + Complete */}
        <View style={[s.activeActions, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          {phase.key !== "the_bake" && (
            <Pressable
              onPress={onLogReading}
              style={({ pressed }) => [
                s.actionBtn,
                { borderColor: colors.accent + "50", backgroundColor: colors.accent + "12", flex: 1, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="thermometer" size={13} color={colors.accent} />
              <Text style={[s.actionBtnText, { color: colors.accent }]}>Log Reading</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onComplete}
            style={({ pressed }) => [
              s.actionBtn,
              { borderColor: colors.primary + "50", backgroundColor: colors.primary + "12", flex: 1, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="checkmark" size={13} color={colors.primary} />
            <Text style={[s.actionBtnText, { color: colors.primary }]}>Complete</Text>
          </Pressable>
        </View>
    </View>
  );
}
// ─── End of ActivePhaseCard function ──────────────────────────────────────────

// ─── Styles ───────────────────────────────────────────────────────────────────
// Moved from recipe.tsx s StyleSheet. All keys below are used only by the
// three phase card variants above.
const s = StyleSheet.create({
  // ── Shared ──────────────────────────────────────────────────────────────────
  compactCard: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compactName: { fontSize: 15 },
  expandedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },

  // Generic spec text — ingredients, instructions body copy
  specText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  // Generic section label — "Ingredients", "Instructions", "No readings logged"
  sectionLabel: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 4 },

  // ── Pending ──────────────────────────────────────────────────────────────────
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  startBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // ── Done ─────────────────────────────────────────────────────────────────────
  doneTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginRight: 4 },
  readingCountBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  readingCountText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  addReadingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  addReadingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  volRangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 2,
  },
  volRangeLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    minWidth: 52,
  },
  volRangeValue: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  // ── Active ───────────────────────────────────────────────────────────────────
  activeCard: { borderRadius: 10, borderWidth: 1.5, overflow: "hidden", position: "relative" },
  activeStrip: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  activeHeader: { paddingLeft: 3 },
  timerLarge: { fontSize: 16, fontFamily: "Inter_600SemiBold", letterSpacing: -0.5 },
  startVolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 17,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  startVolLabel: { fontSize: 12, fontFamily: "Inter_500Medium", minWidth: 68 },
  startVolInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    height: 34,
  },
  recipeInfoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recipeInfoToggleText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  recipeInfoSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 17,
    paddingTop: 12,
    paddingBottom: 12,
  },
  recipeInfoLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  recipeInfoText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  ingredientsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  copyBtnText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  sharePhaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sharePhaseText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  activeActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingLeft: 17,
    paddingBottom: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeReadings: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingLeft: 17,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  scaleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 10,
  },
    scaleBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },  // ── Bulk ferment status panel ─────────────────────────────────────────────
    bulkStatusPanel: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 17,
      paddingVertical: 10,
      gap: 8,
    },
    bulkStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    bulkStatusLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      flex: 1,
    },
    bulkReadingCount: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
    },
    bulkProgressTrack: {
      height: 4,
      borderRadius: 2,
      overflow: "hidden",
    },
    bulkProgressFill: {
      height: 4,
      borderRadius: 2,
    },
    // ── Smart timer subtitle (bulk countdown / overtime) ─────────────────────
    bulkTimerSub: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      marginTop: 1,
    },
});