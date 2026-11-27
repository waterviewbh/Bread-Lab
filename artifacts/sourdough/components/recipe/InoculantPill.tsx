import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { fonts } from "@/constants/theme";
import type { InoculantIdentity } from "@/lib/inoculantIdentity";

// Placeholder icons are mapped here so supplied SVGs can replace them later.
const variants = {
  sourdough: { label: "Sourdough Starter", icon: "archive", light: { background: "#FDF0E6", border: "#F0CCB3", foreground: "#9A3F00" }, dark: { background: "#543624", border: "#A66B45", foreground: "#FFD0AD" } },
  commercial: { label: "Commercial Yeast", icon: "sun", light: { background: "#FBF4DC", border: "#E9D696", foreground: "#805600" }, dark: { background: "#514321", border: "#9B8140", foreground: "#F8DE91" } },
  hybrid: { label: "Hybrid Culture", icon: "link-2", light: { background: "#EEF3F0", border: "#C4D4CB", foreground: "#14513B" }, dark: { background: "#243F33", border: "#5B8973", foreground: "#BCE8CF" } },
} as const;

export function InoculantPill({ identity, dark = false }: { identity: InoculantIdentity | null; dark?: boolean }) {
  if (!identity) return null;
  const variant = variants[identity];
  const palette = dark ? variant.dark : variant.light;
  return (
    <View testID="inoculant-pill" style={[styles.pill, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Feather name={variant.icon} size={11} color={palette.foreground} />
      <Text selectable style={[styles.label, { color: palette.foreground }]}>{variant.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, height: 25, marginBottom: 7 },
  label: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15 },
});
