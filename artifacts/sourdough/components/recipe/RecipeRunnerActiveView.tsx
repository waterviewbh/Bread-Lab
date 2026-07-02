// components/recipe/RecipeRunnerActiveView.tsx
import React, { RefObject } from "react";
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SegmentBar } from "@/components/recipe/SegmentBar";
import SegmentedNotepad from "@/components/SegmentedNotepad"; // erased the naming {} around SegmentedNotepad
import {
  PendingPhaseCard,
  DonePhaseCard,
  ActivePhaseCard,
} from "@/components/recipe/PhaseCard";
import { formatTimer } from "@/lib/recipeUtils";
import type { ActiveBake, BakePhase } from "@/lib/recipeTypes";interface Props {
  bake: ActiveBake;
  // Elapsed ms per phase key — from useActiveBakeTimer
  elapsed: Record<string, number>;
  scaleMultiplier: number;
  refreshing: boolean;
  bakeNotes: string;
  overlayDraft: string;
  showNotesOverlay: boolean;
  // Derived values computed in recipe.tsx
  activePhase: BakePhase | undefined;
  allDone: boolean;
  completedCount: number;
  recipeStale: boolean;
  // Per-phase UI state
  expandedDone: Set<string>;
  expandedRecipeInfo: Set<string>;
  expandedPending: Set<string>;
  recentlyCompletedKey: string | null;
  nextHighlightKey: string | null;
  copiedIngredientsKey: string | null;
  phaseStartVolumes: Record<string, string>;
  // ScrollView ref — owned by recipe.tsx, passed down for auto-scroll
  scrollRef: RefObject<ScrollView>;
  // Layout offset refs — written by onLayout callbacks in this view,
  // read by completePhase in recipe.tsx for auto-scroll targeting
  phaseCardYOffsets: React.MutableRefObject<Record<string, number>>;
  phasesContainerY: React.MutableRefObject<number>;
  // Callbacks
  onScaleChange: (m: number) => void;
  onStartPhase: (key: string) => void;
  onCompletePhase: (key: string) => void;
  onToggleExpandDone: (key: string) => void;
  onToggleExpandRecipeInfo: (key: string) => void;
  onToggleExpandPending: (key: string) => void;
  onOpenReadingModal: (key: string) => void;
  onDeleteReading: (phaseKey: string, readingId: string) => void;
  onIncrementFold: (key: string, idx: number) => void;
  onStartVolumeChange: (key: string, value: string) => void;
  onStartVolumeCommit: (key: string, value: string) => void;
  onCopyIngredients: (key: string) => void;
  onShareSpec: (phase: BakePhase) => void;
  onAbandonBake: () => void;
  onPrint: () => void;
  onSharePdf: () => void;
  onOpenNotesOverlay: () => void;
  onSaveNotesOverlay: () => void;
  onCloseNotesOverlay: () => void;
  onOverlayDraftChange: (text: string) => void;
  onRefresh: () => void;
}

export function RecipeRunnerActiveView({
  bake,
  elapsed,
  scaleMultiplier,
  refreshing,
  bakeNotes,
  overlayDraft,
  showNotesOverlay,
  activePhase,
  allDone,
  completedCount,
  recipeStale,
  expandedDone,
  expandedRecipeInfo,
  expandedPending,
  recentlyCompletedKey,
  nextHighlightKey,
  copiedIngredientsKey,
  phaseStartVolumes,
  scrollRef,
  phaseCardYOffsets,
  phasesContainerY,
  onScaleChange,
  onStartPhase,
  onCompletePhase,
  onToggleExpandDone,
  onToggleExpandRecipeInfo,
  onToggleExpandPending,
  onOpenReadingModal,
  onDeleteReading,
  onIncrementFold,
  onStartVolumeChange,
  onStartVolumeCommit,
  onCopyIngredients,
  onShareSpec,
  onAbandonBake,
  onPrint,
  onSharePdf,
  onOpenNotesOverlay,
  onSaveNotesOverlay,
  onCloseNotesOverlay,
  onOverlayDraftChange,
  onRefresh,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarPad = Platform.OS === "web" ? 84 : 49;
  return (
    <>
      {/* ── Active bake ScrollView ──────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingTop: 20,
          // Extra 96px so the last phase card clears the FAB
          paddingBottom: insets.bottom + tabBarPad + 128,
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
        {/* ── Compact header: recipe name + status + actions ───────────── */}
        <View style={s.trackerHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[s.trackerRecipeName, { color: colors.mutedForeground }]}>
              {bake.recipeName}
            </Text>
            <View style={s.statusRow}>
              {activePhase ? (
                <>
                  <View style={[s.activeDot, { backgroundColor: colors.accent }]} />
                  <Text style={[s.statusText, { color: colors.foreground }]}>
                    {activePhase.name}
                  </Text>
                  <Text style={[s.timerInline, { color: colors.accent }]}>
                    {formatTimer(elapsed[activePhase.key] ?? 0)}
                  </Text>
                </>
              ) : allDone ? (
                <Text style={[s.statusText, { color: colors.accent }]}>Bake complete</Text>
              ) : (
                <Text style={[s.statusText, { color: colors.mutedForeground }]}>
                  Start a phase below
                </Text>
              )}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Pressable
              onPress={onSharePdf}
              style={({ pressed }) => [
                s.newBakeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
              ]}
              accessibilityLabel="Share bake summary as PDF"
              accessibilityRole="button"
            >
              <Feather name="share" size={13} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={onPrint}
              style={({ pressed }) => [
                s.newBakeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <Feather name="printer" size={13} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={onAbandonBake}
              style={({ pressed }) => [
                s.newBakeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <Text style={[s.newBakeBtnText, { color: colors.mutedForeground }]}>New Bake</Text>
            </Pressable>
          </View>
        </View>
        {/* ── Recipe version stale warning ─────────────────────────────── */}
        {recipeStale && (
          <View style={[s.staleWarning, { backgroundColor: "#FFF3CD", borderColor: "#FBBF24" }]}>
            <Feather name="alert-triangle" size={13} color="#92400E" />
            <Text style={[s.staleWarningText, { color: "#92400E" }]}>
              This recipe was updated after the bake started. Phases shown are from the original version.
            </Text>
          </View>
        )}
    {/* ── Scale factor selector ─────────────────────────────────────── */}
        <View style={[s.scaleRow, { borderColor: colors.border }]}>
          <Text style={[s.scaleLabel, { color: colors.mutedForeground }]}>Scale</Text>
          <View style={s.scalePills}>
            {[0.5, 0.75, 1, 1.5, 2, 3].map((m) => (
              <Pressable
                key={m}
                onPress={() => onScaleChange(m)}
                style={[
                  s.scalePill,
                  {
                    backgroundColor: scaleMultiplier === m ? colors.primary : colors.muted,
                    borderColor: scaleMultiplier === m ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    s.scalePillText,
                    { color: scaleMultiplier === m ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {m === 1 ? "1×" : `${m}×`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {/* ── Segment progress bar ─────────────────────────────────────── */}
        <View style={{ marginBottom: 24 }}>
          <SegmentBar phases={bake.phases} />
          <Text style={[s.segmentCount, { color: colors.mutedForeground }]}>
            {completedCount} / {bake.phases.length} phases
          </Text>
        </View>
        {/* ── Phase cards ──────────────────────────────────────────────── */}
        <View
          style={{ gap: 8 }}
          onLayout={(e) => { phasesContainerY.current = e.nativeEvent.layout.y; }}
        >
          {bake.phases.map((phase) => {
            const isDone = !!phase.completedAt;
            if (!phase.startedAt) {
              return (
                <PendingPhaseCard
                  key={`${phase.key}-pending`}
                  phase={phase}
                  colors={colors}
                  isNextHighlight={nextHighlightKey === phase.key}
                  isExpanded={expandedPending.has(phase.key)}
                  onToggleExpand={() => onToggleExpandPending(phase.key)}
                  onStart={() => onStartPhase(phase.key)}
                  onLayout={(y) => { phaseCardYOffsets.current[phase.key] = y; }}
                  scaleMultiplier={scaleMultiplier}
                />
              );
            }
            if (isDone) {
              return (
                <DonePhaseCard
                  key={`${phase.key}-done`}
                  phase={phase}
                  colors={colors}
                  isRecentlyCompleted={recentlyCompletedKey === phase.key}
                  isExpanded={expandedDone.has(phase.key)}
                  onToggleExpand={() => onToggleExpandDone(phase.key)}
                  onOpenReadingModal={() => onOpenReadingModal(phase.key)}
                  onDeleteReading={(readingId) => onDeleteReading(phase.key, readingId)}
                  onLayout={(y) => { phaseCardYOffsets.current[phase.key] = y; }}
                  scaleMultiplier={scaleMultiplier}
                />
              );
            }
            // Active phase
            return (
              <ActivePhaseCard
                key={`${phase.key}-active`}
                phase={phase}
                colors={colors}
                elapsedMs={elapsed[phase.key] ?? 0}
                scaleMultiplier={scaleMultiplier}
                startVolumeInput={phaseStartVolumes[phase.key] ?? ""}
                onStartVolumeChange={(v) => onStartVolumeChange(phase.key, v)}
                onStartVolumeCommit={(v) => onStartVolumeCommit(phase.key, v)}
                copiedIngredientsKey={copiedIngredientsKey}
                onCopyIngredients={() => onCopyIngredients(phase.key)}
                isSpecExpanded={expandedRecipeInfo.has(phase.key)}
                onToggleSpec={() => onToggleExpandRecipeInfo(phase.key)}
                onToggleFold={(idx) => onIncrementFold(phase.key, idx)}
                onLogReading={() => onOpenReadingModal(phase.key)}
                onComplete={() => onCompletePhase(phase.key)}
                onShareSpec={() => onShareSpec(phase)}
                onLayout={(y) => { phaseCardYOffsets.current[phase.key] = y; }}
              />
            );
          })}
        </View>
        {/* ── All-done completion card ──────────────────────────────────── */}
        {allDone && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={[s.allDoneCard, { backgroundColor: colors.accent + "14", borderColor: colors.accent + "35" }]}
          >
            <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
            <Text style={[s.allDoneTitle, { color: colors.foreground }]}>Bake complete</Text>
            <Text style={[s.allDoneBody, { color: colors.mutedForeground }]}>
              All phases logged. Tap New Bake to start fresh.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={onSharePdf}
                style={({ pressed }) => [
                  s.printBakeBtn,
                  { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10", opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityLabel="Share bake summary as PDF"
                accessibilityRole="button"
              >
                <Feather name="share" size={14} color={colors.primary} />
                <Text style={[s.printBakeBtnText, { color: colors.primary }]}>Share PDF</Text>
              </Pressable>
              <Pressable
                onPress={onPrint}
                style={({ pressed }) => [
                  s.printBakeBtn,
                  { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10", opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="printer" size={14} color={colors.primary} />
                <Text style={[s.printBakeBtnText, { color: colors.primary }]}>Print</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </ScrollView>
      {/* ── Floating Action Button: bake notepad ─────────────────────────── */}
      <Pressable
        onPress={onOpenNotesOverlay}
        style={({ pressed }) => [
          s.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + tabBarPad + 16,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        accessibilityLabel="Open bake notes"
        accessibilityRole="button"
      >
        <Feather name="edit-3" size={22} color={colors.primaryForeground} />
        {/* Dot indicator when notes have been written */}
        {bakeNotes.length > 0 && (
          <View style={[s.fabDot, { backgroundColor: colors.accent }]} />
        )}
      </Pressable>
      {/* ── Notes overlay modal ───────────────────────────────────────────── */}
      <Modal
        visible={showNotesOverlay}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onCloseNotesOverlay}
      >
        {/* Header */}
        <View style={[s.sheetHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
          <Text style={[s.sheetTitle, { color: colors.foreground }]}>Bake Notes</Text>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Pressable
              onPress={onSaveNotesOverlay}
              style={({ pressed }) => [
                s.notesSaveBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
              accessibilityLabel="Save notes"
            >
              <Text style={[s.notesSaveBtnText, { color: colors.primaryForeground }]}>Save</Text>
            </Pressable>
            <Pressable
              onPress={onCloseNotesOverlay}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
        {/* Segmented notepad: handles its own text/chip segments + tag dock */}
        <SegmentedNotepad
          initialValue={overlayDraft}
          onChange={onOverlayDraftChange}
          phases={bake.phases}
          colors={colors}
          bottomInset={insets.bottom}
        />
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trackerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  trackerRecipeName: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  timerInline: { fontSize: 15, fontFamily: "Inter_600SemiBold", letterSpacing: -0.3 },
  newBakeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  newBakeBtnText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  segmentCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  allDoneCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  allDoneTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  allDoneBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  staleWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  staleWarningText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scaleLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, minWidth: 38 },
  scalePills: { flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 },
  scalePill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  scalePillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  printBakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  printBakeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fab: {
    position: "absolute",
    right: 20,
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
  fabDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  notesSaveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  notesSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});