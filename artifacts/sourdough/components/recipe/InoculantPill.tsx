import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { fonts } from "@/constants/theme";
import type { InoculantIdentity } from "@/lib/inoculantIdentity";

const variants = {
  sourdough: { label: "Sourdough Starter", background: "#FDF0E6", border: "#F0CCB3", foreground: "#9A3F00", icon: "archive" },
  commercial: { label: "Commercial Yeast", background: "#FBF4DC", border: "#E9D696", foreground: "#805600", icon: "sun" },
  hybrid: { label: "Hybrid Culture", background: "#EEF3F0", border: "#C4D4CB", foreground: "#14513B", icon: "link-2" },
} as const;

export function InoculantPill({ identity }: { identity: InoculantIdentity | null }) {
  if (!identity) return null;
  const variant = variants[identity];
  return (
    <View testID="inoculant-pill" style={[styles.pill, { backgroundColor: variant.background, borderColor: variant.border }]}>
      <Feather name={variant.icon} size={11} color={variant.foreground} />
      <Text selectable style={[styles.label, { color: variant.foreground }]}>{variant.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, height: 25, marginBottom: 7 },
  label: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15 },
});
