// artifacts/sourdough/components/lab/labAnalyticsComponents.tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { fonts, radius, spacing, typography } from "@/constants/theme";
import { useColors } from "@/hooks/useColors";

export const ACIDIFICATION_HINT =
  "Each point is your starter's average pH drop per hour for that feed — " +
  "velocity = (startpH − endpH) ÷ hours. " +
  "For standard flour-and-water and whole wheat (WW) starters, a flattening or downward trend " +
  "over time indicates a maturing, well-balanced culture. " +
  "For a sweet starter, an upward trend confirms the culture successfully overcoming sugar pressure.";

export const LIFTING_HINT =
  "Bars show hours to peak (left axis); triangles (△) mark rise % at peak (right axis). " +
  "Bar fill varies by starter type: solid for standard, diagonal hatch for sugar, cross-hatch for whole wheat.\n\n" +
  "The vertical axes share a calibrated baseline: 4 hours = healthy time-to-peak; " +
  "100% volume expansion = healthy rise target. Both are locked at the same pixel height so a standard starter running 4h/100% lands exactly at the midline.";

export const METABOLIC_HINT =
  "Each dot represents a completed feed. The column it lands in is determined by that feed's flour workload; a 1:2:2 feed has more flour for the bacteria to work through than a 1:1:1 feed, and a 1:7:7 feed has even more.\n\n" +
  "Within each workload box, dots are organized horizontally by hydration: stiffer starters (i.e., feeds with less water than flour) sit on the left edge, while slacker starters (more water than flour) sit on the right.";

export function ReadingHint({
  body,
  onAbout,
  colors,
}: {
  body: string;
  onAbout: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[h.wrap, { borderColor: colors.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [h.row, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[h.label, { color: colors.mutedForeground }]}>
          How to read this graph
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={13}
          color={colors.mutedForeground}
        />
      </Pressable>

      {open && (
        <View style={h.body}>
          <Text style={[h.bodyText, { color: colors.foreground }]}>{body}</Text>
          <Pressable
            onPress={onAbout}
            style={({ pressed }) => [h.moreLink, pressed && { opacity: 0.6 }]}
            accessibilityRole="link"
          >
            <Text style={[h.moreLinkText, { color: colors.accent }]}>
              More in the Logbook Tab →
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: spacing.sm,
  },
  bodyText: {
    ...typography.bodySm,
  },
  moreLink: {
    alignSelf: "flex-start",
  },
  moreLinkText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
});