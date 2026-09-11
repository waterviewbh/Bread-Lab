import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts, spacing, radius } from "@/constants/theme";
import type { ActiveBake } from "@/lib/recipeTypes";
import { formatTimer } from "@/lib/recipeUtils";

interface Props {
  bakes: ActiveBake[];
  activeBakeId: string | null;
  onSelectBake: (id: string) => void;
  onNewBake: (index: number) => void;
  elapsed1: Record<string, number>;
  elapsed2: Record<string, number>;
}

export function BakeSelectorTabs({ bakes, activeBakeId, onSelectBake, onNewBake, elapsed1, elapsed2 }: Props) {
  const colors = useColors();

  const renderTab = (index: number) => {
    // bakes is an array of 0, 1, or 2 active bakes.
    // However, the UI always shows two slots.
    const bake = bakes[index];
    const isActive = bake?.id === activeBakeId;
    const isSlotTaken = !!bake;

    const activePhase = bake?.phases.find(p => p.startedAt && !p.completedAt);
    const phaseLabel = activePhase
      ? activePhase.name
      : (bake?.completedAt ? "Bake complete" : (bake ? "Ready to start" : ""));

    const elapsed = index === 0 ? elapsed1 : elapsed2;
    const timerValue = activePhase ? elapsed[activePhase.key] : null;

    return (
      <Pressable
        key={index}
        onPress={() => isSlotTaken ? onSelectBake(bake.id) : onNewBake(index)}
        style={[
          s.tab,
          isActive && {
            backgroundColor: colors.card,
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          },
        ]}
      >
        {isSlotTaken ? (
          <View style={s.bakeInfo}>
            <Text
              style={[
                s.bakeName,
                {
                  color: isActive ? colors.foreground : colors.mutedForeground,
                  fontFamily: isActive ? fonts.sansSemiBold : fonts.sans,
                }
              ]}
              numberOfLines={1}
            >
              {bake.recipeName}
            </Text>
            <Text style={[s.bakeStatus, { color: colors.mutedForeground }]} numberOfLines={1}>
              {phaseLabel}
            </Text>
            {timerValue !== undefined && timerValue !== null && (
              <Text style={[s.bakeTimer, { color: colors.primary }]}>
                {formatTimer(timerValue)}
              </Text>
            )}
          </View>
        ) : (
          <Text style={[s.newBakeText, { color: colors.mutedForeground }]}>
            New Bake
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      {[0, 1].map(renderTab)}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    height: 76,
  },
  tab: {
    flex: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  bakeInfo: {
    alignItems: "center",
    justifyContent: "center",
    width: '100%',
  },
  bakeName: {
    fontSize: 13,
    textAlign: 'center',
  },
  bakeStatus: {
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 1,
    textAlign: 'center',
  },
  bakeTimer: {
    fontFamily: fonts.mono,
    fontSize: 10,
    marginTop: 1,
    textAlign: 'center',
  },
  newBakeText: {
    fontFamily: fonts.sans,
    fontSize: 13,
  },
});
