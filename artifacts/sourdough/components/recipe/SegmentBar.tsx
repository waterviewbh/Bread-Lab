// components/recipe/SegmentBar.tsx
// ─── Progress strip shown above the phase list in the active bake tracker ─────
// Each phase gets one segment: filled (done), accent (active), or border (pending).
import React from "react";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { type BakePhase } from "@/lib/recipeTypes";export function SegmentBar({ phases }: { phases: BakePhase[] }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {phases.map((p) => {
        const done = !!p.completedAt;
        const active = !!p.startedAt && !p.completedAt;
        return (
          <View
            key={p.key}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              backgroundColor: done ? colors.primary : active ? colors.accent : colors.border,
            }}
          />
        );
      })}
    </View>
  );
}