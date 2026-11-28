import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { fonts } from "@/constants/theme";
import type { InoculantIdentity } from "@/lib/inoculantIdentity";
import {
  WildYeastIcon,
  CommercialYeastIcon,
  HybridCultureIcon,
  PrefermentIcon,
} from "@/components/recipe/InoculationIcons";

const variants = {
  sourdough: { label: "Sourdough Starter", Icon: WildYeastIcon, light: { background: "#FDF0E6", border: "#F0CCB3", foreground: "#9A3F00" }, dark: { background: "#543624", border: "#A66B45", foreground: "#FFD0AD" } },
  commercial: { label: "Commercial Yeast", Icon: CommercialYeastIcon, light: { background: "#FBF4DC", border: "#E9D696", foreground: "#805600" }, dark: { background: "#514321", border: "#9B8140", foreground: "#F8DE91" } },
  hybrid: { label: "Hybrid Culture", Icon: HybridCultureIcon, light: { background: "#EEF3F0", border: "#C4D4CB", foreground: "#14513B" }, dark: { background: "#243F33", border: "#5B8973", foreground: "#BCE8CF" } },
  preferment: { label: "Preferment / Poolish", Icon: PrefermentIcon, light: { background: "#F6F1EB", border: "#DDD0C3", foreground: "#5D3A26" }, dark: { background: "#46372D", border: "#927966", foreground: "#F1D8C5" } },
} as const;

export function InoculantPill({ identity, dark = false }: { identity: InoculantIdentity | null; dark?: boolean }) {
  if (!identity) return null;
  const variant = variants[identity];
  const palette = dark ? variant.dark : variant.light;
  const fillProps = identity === "commercial"
    ? { fillSurface: palette.background }
    : identity === "preferment"
      ? { fillDough: palette.background }
      : { fillDough: palette.background, fillSurface: palette.background };
  return (
    <View testID="inoculant-pill" style={[styles.pill, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <variant.Icon size={16} color={palette.foreground} accent={palette.border} {...fillProps} />
      <Text selectable style={[styles.label, { color: palette.foreground }]}>{variant.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, height: 25, marginBottom: 7 },
  label: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15 },
});
