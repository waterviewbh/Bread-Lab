// artifacts/sourdough/components/log/logManual.tsx
import {
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import React, { useState } from "react";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useFontSize } from "@/contexts/FontSizeContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useTourSlideshow } from "@/contexts/TourSlideshowContext";
import { typography, spacing, radius, fonts } from "@/constants/theme";
import { useRouter } from "expo-router";
import { DIAGNOSTIC_SCIENCE } from "@/constants/diagnosticContents";
import { DEFECT_LIBRARY, GlossaryCategory, DefectSlug } from "@/lib/diagnosticLogic";
import { Ionicons } from "@expo/vector-icons";
import { useScienceArticles } from "@/hooks/useScienceArticle";
import { getArticleSummary } from "@/lib/scienceArticles";
import { useQueryClient } from "@tanstack/react-query";

// --- Data ---
import { HELP, CHANGELOG, ACIDIFICATION_DATA, LIFTING_DATA, BULK_ENGINE_DATA } from "@/constants/aboutContents";

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
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.accordionHeader, pressed && { opacity: 0.7 }]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{tab.label}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={[styles.accordionBody, { borderTopColor: colors.border }]}>
          {tab.sections.map((sec: any, si: number) => (
            <View key={si} style={si > 0 ? styles.subSectionGap : undefined}>
              <Text style={[styles.subHeading, { color: colors.mutedForeground }]}>{sec.heading.toUpperCase()}</Text>
              {sec.bullets.map((bullet: string, bi: number) => {
                const colonIdx = bullet.indexOf(": ");
                const hasLabel = colonIdx > 0 && colonIdx < 40;
                const label = hasLabel ? bullet.slice(0, colonIdx) : null;
                const body = hasLabel ? bullet.slice(colonIdx + 2) : bullet;

                return (
                  <View key={bi} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: colors.mutedForeground }]} />
                    <Text selectable={true} style={[styles.bulletText, { color: colors.foreground }]}>
                      {label ? (
                        <>
                          <Text selectable={true} style={styles.bulletLabel}>{label}:</Text>{" "}
                          {body.startsWith("http") ? (
                            <Text selectable={true} style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(body)}>{body}</Text>
                          ) : body}
                        </>
                      ) : body}
                    </Text>
                  </View>
                );
              })}
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
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{data.title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={{ padding: 16 }}>
          <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground, marginBottom: 12 }]}>{data.body}</Text>
          {data.sections.map((sec: any, i: number) => (
            <View key={i} style={{ marginTop: 16 }}>
              <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground, fontFamily: fonts.sansSemiBold, fontSize: 14, marginBottom: 4 }]}>{sec.heading}</Text>
              <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                <Text selectable={true} style={styles.interpretLabel}>Visual: </Text>{sec.visual}
              </Text>
              {sec.diagnosticStandard && (
                <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text selectable={true} style={styles.interpretLabel}>Diagnostic [Standard]: </Text>{sec.diagnosticStandard}
                </Text>
              )}
              {sec.diagnosticSweet && (
                <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text selectable={true} style={styles.interpretLabel}>[Sweet]: </Text>{sec.diagnosticSweet}
                </Text>
              )}
              {sec.diagnostic && (
                <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text selectable={true} style={styles.interpretLabel}>Diagnostic: </Text>{sec.diagnostic}
                </Text>
              )}
              <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                <Text selectable={true} style={styles.interpretLabel}>Baker's Insight: </Text>{sec.insight}
              </Text>
              {sec.status && (
                <Text selectable={true} style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text selectable={true} style={styles.interpretLabel}>Status: </Text>{sec.status}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function TroubleshootingDeepDivesCard({ colors, router }: { colors: any; router: any }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>Troubleshooting Deep Dives</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={{ padding: 12 }}>
          <Text selectable={true} style={[styles.interpretBody, { color: colors.mutedForeground, marginBottom: 16, paddingHorizontal: 4 }]}>
            Detailed analysis of bake defects, mechanics, and targeted interventions.
          </Text>
          {Object.entries(DIAGNOSTIC_SCIENCE).map(([slug, article]) => (
            <Pressable
              key={slug}
              onPress={() => router.setParams({ slug })}
              style={({ pressed }) => [
                styles.deepDiveItem,
                { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }
              ]}
            >
              <View style={{ flex: 1 }}>
                 <Text style={[styles.deepDiveTitle, { color: colors.foreground }]}>{article.title.replace('The Science of ', '')}</Text>
                 <Text style={[styles.deepDiveSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{article.primaryDriver}</Text>
              </View>
              <Feather name="arrow-right" size={14} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ScienceDeepDivesCard({ colors, router }: { colors: any; router: any }) {
  const [open, setOpen] = useState(false);
  const { data: articles } = useScienceArticles();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>Science Deep Dives</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={{ padding: 12 }}>
          <Text selectable={true} style={[styles.interpretBody, { color: colors.mutedForeground, marginBottom: 16, paddingHorizontal: 4 }]}>
            Scholarly mini-articles exploring the physical, biological, and mathematical models behind fermentation.
          </Text>
          {articles?.map((article) => (
            <Pressable
              key={article.slug}
              onPress={() => router.setParams({ slug: article.slug })}
              style={({ pressed }) => [
                styles.deepDiveItem,
                { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }
              ]}
            >
              <View style={{ flex: 1 }}>
                 <Text style={[styles.deepDiveTitle, { color: colors.foreground }]}>{article.title}</Text>
                 <Text style={[styles.deepDiveSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                   {getArticleSummary(article)}
                 </Text>
              </View>
              <Feather name="arrow-right" size={14} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const CATEGORY_ORDER: GlossaryCategory[] = ['crumb', 'shape', 'crust', 'volume'];

function TraitGlossaryCard({ colors }: { colors: any }) {
  const [open, setOpen] = useState(false);

  const grouped = React.useMemo(() => {
    const groups: Record<GlossaryCategory, DefectSlug[]> = {
      crust: [], crumb: [], shape: [], volume: []
    };
    (Object.keys(DEFECT_LIBRARY) as DefectSlug[]).forEach(slug => {
      groups[DEFECT_LIBRARY[slug].category].push(slug);
    });
    return groups;
  }, []);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>Trait Glossary</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={{ padding: 12 }}>
          {CATEGORY_ORDER.map(cat => (
            <View key={cat} style={{ marginBottom: 16 }}>
              <Text style={[styles.subHeading, { color: colors.mutedForeground, marginBottom: 8 }]}>{cat.toUpperCase()}</Text>
              {grouped[cat].map(slug => {
                const term = DEFECT_LIBRARY[slug];
                const isTarget = term.type === 'target';
                return (
                  <View key={slug} style={styles.glossaryItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text selectable={true} style={[styles.glossaryTitle, { color: colors.foreground }]}>{term.label}</Text>
                      {isTarget && <Ionicons name="sparkles" size={10} color={colors.accent} />}
                    </View>
                    <Text selectable={true} style={[styles.glossaryText, { color: colors.mutedForeground }]}>{term.shortDefinition}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function ResourcesSection() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { fullFontSize, setFullFontSize } = useFontSize();
  const { showTour } = useTourSlideshow();
  const { tempUnit, setTempUnit, starterTutorialMode, setStarterTutorialMode } = usePreferences();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["scienceArticles"] });
    await queryClient.invalidateQueries({ queryKey: ["scienceArticle"] });
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Animated.View entering={FadeIn.duration(400)}>
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Resources</Text>
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Guides, Settings, and Science</Text>
        </View>

        <Pressable
          onPress={() => router.replace('/')}
          style={({ pressed }) => [styles.logoWrap, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>Settings</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>Accessibility Font Size</Text>
              <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>Allows text to scale beyond default caps.</Text>
            </View>
            <Switch
              value={fullFontSize}
              onValueChange={setFullFontSize}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
          <View style={[styles.settingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>Temperature Unit</Text>
              <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>Default unit for lab readings.</Text>
            </View>
            <View style={[styles.unitToggle, { backgroundColor: colors.muted }]}>
              {(["F", "C"] as const).map((u) => (
                <Pressable
                  key={u}
                  onPress={() => setTempUnit(u)}
                  style={[styles.unitBtn, tempUnit === u && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 }]}
                >
                  <Text style={{ color: tempUnit === u ? colors.foreground : colors.mutedForeground, fontFamily: fonts.sansSemiBold, fontSize: 12 }}>°{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={[styles.settingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>Starter Tutorial Mode</Text>
              <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>Guided 14-day path for new cultures.</Text>
            </View>
            <Switch
              value={starterTutorialMode}
              onValueChange={setStarterTutorialMode}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>Help & Guides</Text>
        {HELP.map((tab, i) => <HelpAccordion key={i} tab={tab} colors={colors} />)}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 24 }]}>Science Hub</Text>
        <TraitGlossaryCard colors={colors} />
        <TroubleshootingDeepDivesCard colors={colors} router={router} />
        <ScienceDeepDivesCard colors={colors} router={router} />
        <InterpretationCard data={ACIDIFICATION_DATA} colors={colors} />
        <InterpretationCard data={LIFTING_DATA} colors={colors} />
        <InterpretationCard data={BULK_ENGINE_DATA} colors={colors} />

        <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>Version {versionData.version} ({versionData.versionCode})</Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 100 },
  pageHeader: { marginBottom: 24 },
  pageTitle: { ...typography.headlineLgMobile, letterSpacing: -0.5 },
  pageSubtitle: { fontFamily: fonts.sans, fontSize: 14, marginTop: 2, letterSpacing: 0.2 },
  logoWrap: { alignItems: "center", marginBottom: 32 },
  logo: { width: 260, height: 160, borderRadius: radius.sm },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6
  },
  card: { borderRadius: radius.lg, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  settingTitle: { fontFamily: fonts.sansMedium, fontSize: 15 },
  settingDescription: { ...typography.metaLabel, marginTop: 2 },
  unitToggle: { flexDirection: "row", borderRadius: 8, padding: 3, width: 90, height: 34 },
  unitBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  accordionCard: { borderRadius: radius.lg, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  accordionTitle: { fontFamily: fonts.serifBold, fontSize: 16, flex: 1 },
  accordionBody: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  subHeading: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, marginBottom: 8 },
  subSectionGap: { marginTop: 18 },
  bulletRow: { flexDirection: "row", marginBottom: 8, gap: 8 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8, opacity: 0.5 },
  bulletText: { ...typography.bodySm, flex: 1 },
  bulletLabel: { fontFamily: fonts.sansSemiBold },
  interpretBody: { ...typography.bodySm },
  interpretLabel: { fontFamily: fonts.sansSemiBold },
  versionLabel: { ...typography.metaLabel, textAlign: "center", marginTop: 32 },
  deepDiveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deepDiveTitle: {
    fontSize: 15,
    fontFamily: fonts.sansSemiBold,
    marginBottom: 2,
  },
  deepDiveSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  glossaryItem: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  glossaryTitle: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  glossaryText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    lineHeight: 16,
  },
});
