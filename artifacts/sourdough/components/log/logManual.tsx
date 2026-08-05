// artifacts/sourdough/components/log/logManual.tsx
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import React, { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useFontSize } from "@/contexts/FontSizeContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useTourSlideshow } from "@/contexts/TourSlideshowContext";
import { typography, spacing, radius, fonts } from "@/constants/theme";

// --- Data ---
import { HELP, CHANGELOG, ACIDIFICATION_DATA, LIFTING_DATA } from "@/constants/aboutContents";

const SUPPORT_EMAIL = "waterviewbakehouse@gmail.com";
const logo = require("@/assets/images/waterview-bakehouse-logo.jpg");

const versionData = __DEV__
  ? require('@/version.local.json')
  : require('@/version.json');

// --- Helper Components ---

function HelpAccordion({ tab, colors }: { tab: any; colors: any }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.accordionCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.accordionHeader}>
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{tab.label}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={[styles.accordionBody, { borderTopColor: colors.border }]}>
          {tab.sections.map((sec: any, si: number) => (
            <View key={si} style={si > 0 ? styles.subSectionGap : undefined}>
              <Text style={[styles.subHeading, { color: colors.mutedForeground }]}>{sec.heading.toUpperCase()}</Text>
              {sec.bullets.map((bullet: string, bi: number) => (
                <View key={bi} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: colors.mutedForeground }]} />
                  <Text style={[styles.bulletText, { color: colors.foreground }]}>{bullet}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function InterpretationCard({ data, colors }: { data: any; colors: any }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.accordionHeader}>
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{data.title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={{ padding: 16 }}>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>{data.body}</Text>
          {data.sections.map((sec: any, i: number) => (
            <View key={i} style={{ marginTop: 12 }}>
              <Text style={[styles.interpretBody, { color: colors.foreground, fontWeight: '700' }]}>{sec.heading}</Text>
              <Text style={[styles.interpretBody, { color: colors.foreground }]}><Text style={{ fontWeight: '600' }}>Visual: </Text>{sec.visual}</Text>
              <Text style={[styles.interpretBody, { color: colors.foreground }]}><Text style={{ fontWeight: '600' }}>Insight: </Text>{sec.insight}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function ResourcesSection() {
  const colors = useColors();
  const { fullFontSize, setFullFontSize } = useFontSize();
  const { showTour } = useTourSlideshow();
  const { tempUnit, setTempUnit } = usePreferences();

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.logoWrap}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
      </View>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>Settings</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>Accessibility Font Size</Text>
            <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>Allows text to scale beyond default caps.</Text>
          </View>
          <Switch value={fullFontSize} onValueChange={setFullFontSize} trackColor={{ false: colors.muted, true: colors.primary }} />
        </View>
        <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <Text style={[styles.settingTitle, { color: colors.foreground, flex: 1 }]}>Temperature Unit</Text>
          <View style={styles.unitToggle}>
            {(["F", "C"] as const).map((u) => (
              <Pressable key={u} onPress={() => setTempUnit(u)} style={[styles.unitBtn, tempUnit === u && { backgroundColor: colors.primary }]}>
                <Text style={{ color: tempUnit === u ? colors.primaryForeground : colors.mutedForeground }}>°{u}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>Help & Guides</Text>
      {HELP.map((tab, i) => <HelpAccordion key={i} tab={tab} colors={colors} />)}

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 24 }]}>Science Hub</Text>
      <InterpretationCard data={ACIDIFICATION_DATA} colors={colors} />
      <InterpretationCard data={LIFTING_DATA} colors={colors} />

      <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>Version {versionData.version} ({versionData.versionCode})</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 100 },
  logoWrap: { alignItems: "center", marginBottom: 32 },
  logo: { width: 200, height: 120, borderRadius: radius.sm },
  sectionLabel: { ...typography.sectionLabel, marginBottom: 12, borderBottomWidth: 1, paddingBottom: 4 },
  card: { borderRadius: radius.lg, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", padding: 16 },
  settingTitle: { fontFamily: fonts.sansMedium, fontSize: 15 },
  settingDescription: { fontSize: 12, marginTop: 2 },
  unitToggle: { flexDirection: "row", borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  accordionCard: { borderRadius: radius.lg, borderWidth: 1, marginBottom: 8, overflow: "hidden" },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  accordionTitle: { fontWeight: "700", fontSize: 15 },
  accordionBody: { padding: 16, borderTopWidth: 1 },
  subHeading: { fontSize: 10, letterSpacing: 1, marginBottom: 8 },
  subSectionGap: { marginTop: 16 },
  bulletRow: { flexDirection: "row", marginBottom: 6 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8, marginRight: 8 },
  bulletText: { fontSize: 13, lineHeight: 18 },
  interpretBody: { fontSize: 13, lineHeight: 19 },
  versionLabel: { textAlign: "center", fontSize: 11, marginTop: 32 },
});