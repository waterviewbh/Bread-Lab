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
import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useFontSize } from "@/contexts/FontSizeContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useTour } from "@/contexts/TourContext";
//import { CopilotStep, walkthroughable } from "react-native-copilot"; red-tagged at web-0.1 to avoid crashes. removed after 3 revs
// const CopilotView = walkthroughable(View); red-tagged at web-0.1 to avoid crashes. removed after 3 revs
import { TourStep, CopilotView } from "@/components/TourStep";
import { typography, spacing, radius, fonts } from "@/constants/theme";

// import appConfig from "../../app.json";  red tagged 1.0.10-candidate remove after 3 revs
import { HELP, CHANGELOG, ACIDIFICATION_DATA, LIFTING_DATA } from "../../constants/aboutContents";

const SUPPORT_EMAIL = "waterviewbakehouse@gmail.com";
const WEB_TOP = Platform.OS === "web" ? 67 : 0;
const TAB_BAR_PAD = Platform.OS === "web" ? 84 : 49;

const logo = require("@/assets/images/waterview-bakehouse-logo.jpg");

// Pulls the 'candidate' info in Development Builds, the release info in EAS builds
const versionData = __DEV__
  ? require('../../version.local.json')
  : require('../../version.json');

// ── Help content ──────────────────────────────────────────────────────────────

interface HelpSection {
  heading: string;
  bullets: string[];
}

interface HelpTab {
  label: string;
  sections: HelpSection[];
}

// ── Changelog Data ────────────────────────────────────────────────────────────

interface ChangelogVersion {
  version: string;
  changes: {
    type: "Added" | "Changed" | "Fixed" | "Removed";
    content: string;
  }[];
}

// ── Collapsible help section ──────────────────────────────────────────────────

function HelpAccordion({ tab, colors }: { tab: HelpTab; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.accordionCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Header row — toggles open/closed */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.accordionHeader, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{tab.label}</Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </Pressable>

      {/* Expanded content */}
      {open && (
        <View style={[styles.accordionBody, { borderTopColor: colors.border }]}>
          {tab.sections.map((sec, si) => (
            <View key={si} style={si > 0 ? styles.subSectionGap : undefined}>
              {/* Sub-section heading */}
              <Text style={[styles.subHeading, { color: colors.mutedForeground }]}>
                {sec.heading.toUpperCase()}
              </Text>

              {/* Bullet list */}
              {sec.bullets.map((bullet, bi) => {
                // Split "Label: body" so the label renders bold
                const colonIdx = bullet.indexOf(": ");
                const hasLabel = colonIdx > 0 && colonIdx < 40;
                const label = hasLabel ? bullet.slice(0, colonIdx) : null;
                const body = hasLabel ? bullet.slice(colonIdx + 2) : bullet;

                return (
                  <View key={bi} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: colors.mutedForeground }]} />
                    <Text style={[styles.bulletText, { color: colors.foreground }]}>
                      {label ? (
                        <>
                          <Text style={styles.bulletLabel}>{label}:</Text>
                          {" "}{body}
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

// ── Screen ───────────────────────────────────────────────────────────────────

// ── Interpretation Card Component ─────────────────────────────────────────────

// Inside artifacts/sourdough/app/(tabs)/about.tsx

function InterpretationCard({ data, colors }: { data: any; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false); // Add toggle state

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      {/* Clickable Header for Interpretation Cards */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>
          {data.title}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </Pressable>

      {/* Collapsible Content */}
      {open && (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            <Text style={[styles.interpretBody, { color: colors.foreground }]}>
              {data.body}
            </Text>
          </View>

          {data.sections.map((sec: any, i: number) => (
            <View key={i} style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Text style={[styles.interpretBody, { color: colors.foreground }, styles.interpretSectionHeader]}>
                {sec.heading}
              </Text>

              <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                <Text style={styles.interpretLabel}>{"Visual: "}</Text>
                {sec.visual}
              </Text>

              {sec.diagnosticStandard && (
                <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text style={styles.interpretLabel}>{"Diagnostic [Standard]: "}</Text>
                  {sec.diagnosticStandard}
                </Text>
              )}

              {sec.diagnosticSweet && (
                <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text style={styles.interpretLabel}>{"[Sweet]: "}</Text>
                  {sec.italicLabel ? (
                    <>
                      {"With a low hydration, this is perfect for a "}
                      <Text style={{ fontStyle: "italic" }}>{sec.italicLabel}</Text>
                      {" style dough."}
                    </>
                  ) : sec.diagnosticSweet}
                </Text>
              )}

              {sec.diagnostic && (
                <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text style={styles.interpretLabel}>{"Diagnostic: "}</Text>
                  {sec.diagnostic}
                </Text>
              )}

              <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                <Text style={styles.interpretLabel}>{"Baker's Insight: "}</Text>
                {sec.insight}
              </Text>

              {sec.status && (
                <Text style={[styles.interpretBody, { color: colors.foreground }]}>
                  <Text style={styles.interpretLabel}>{"Status: "}</Text>
                  {sec.status}
                </Text>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// ── Changelog Accordion Component ─────────────────────────────────────────────

function ChangelogAccordion({ entries, colors }: { entries: ChangelogVersion[]; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.accordionHeader,
          { borderBottomWidth: open ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
          pressed && { opacity: 0.7 }
        ]}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>
          {open ? "Recent Updates" : "View Version History"}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </Pressable>

      {open && entries.map((entry, index) => (
        <View
          key={entry.version}
          style={[
            styles.changelogEntry,
            index === entries.length - 1 ? { borderBottomWidth: 0 } : { borderBottomColor: colors.border }
          ]}
        >
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>
            {entry.version}
          </Text>
          {entry.changes.map((change, ci) => (
            <Text
              key={ci}
              style={[
                styles.changelogBullet,
                { color: colors.foreground, marginTop: ci > 0 ? 6 : 4 }
              ]}
            >
              <Text style={styles.changelogLabel}>{change.type}: </Text>
              {change.content}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function AboutScreen() {
  const colors = useColors();
  const { fullFontSize, setFullFontSize } = useFontSize();
  const { startChapter } = useTour();
  const { tempUnit, setTempUnit, weightUnit, setWeightUnit, timeFormat, setTimeFormat } = usePreferences();

  const handleEmail = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: WEB_TOP + 32, paddingBottom: TAB_BAR_PAD + 56 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Logo ── */}
      <View style={styles.logoWrap}>
        <Image
          source={logo}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Waterview Bakehouse logo"
        />
      </View>

      {/* ── Settings ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Settings
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TourStep
          text="Toggle advanced accessibility settings here."
          order={22}
          name="font-setting-toggle"
        >
          <CopilotView style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>
                Respect full system font size
              </Text>
              <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>
                Allows the app to scale text beyond the default cap for improved accessibility.
              </Text>
            </View>
            <Switch
              value={fullFontSize}
              onValueChange={setFullFontSize}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.primaryForeground}
              accessibilityLabel="Respect full system font size"
              accessibilityRole="switch"
              accessibilityState={{ checked: fullFontSize }}
            />
          </CopilotView>
        </TourStep>
        <View style={[styles.settingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={styles.settingText}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>Temperature Unit</Text>
            <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>Default unit for lab readings.</Text>
          </View>
          <View style={[styles.unitToggle, { backgroundColor: colors.muted, borderRadius: 8 }]}>
            {(["F", "C"] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => setTempUnit(u)}
                style={[styles.unitBtn, tempUnit === u && { backgroundColor: colors.card, borderRadius: 6, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 }]}
              >
                <Text style={[styles.unitBtnText, { color: tempUnit === u ? colors.foreground : colors.mutedForeground }]}>°{u}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* ── Contact ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Contact
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={handleEmail}
          style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.6 }]}
          accessibilityLabel="Send email to Waterview Bakehouse"
          accessibilityRole="link"
        >
          <Feather name="mail" size={18} color={colors.primary} style={styles.contactIcon} />
          <Text style={[styles.contactText, { color: colors.primary }]}>
            {SUPPORT_EMAIL}
          </Text>
        </Pressable>
      </View>

      {/* ── Help ── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomColor: colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
            marginBottom: 10,
            paddingBottom: 6
          }}
        >
          <Text style={[styles.sectionLabel, { marginBottom: 0, borderBottomWidth: 0 }]}>
            Help
          </Text>
          <Pressable
            onPress={() => startChapter('feed')}
            disabled={true}  // disables the new user tour
            style={({ pressed }) => ({
              backgroundColor: colors.background,  // when disabled=false colors.primary here and the Text style for Take the Tour
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 12,
              opacity: pressed ? 0.7 : 1
            })}
          >
            <Text style={{ color: colors.background, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
              Take the Tour
            </Text>
          </Pressable>
        </View>

        <TourStep
          text="Detailed help for every tab in the Bread Lab."
          order={23}
          name="help-section"
        >
          <CopilotView>
            {HELP.map((tab, i) => (
              <HelpAccordion key={i} tab={tab} colors={colors} />
            ))}
          </CopilotView>
        </TourStep>

      {/* ── Interpreting Your Data ── */}
      <Text
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 },
        ]}
      >
        {"Interpreting Your Data"}
      </Text>
      <TourStep
        text="A deep dive into how to read your dough and the data you collect from it."
        order={24}
        name="interpreting-data-section"
      >
        <CopilotView>
          <InterpretationCard data={ACIDIFICATION_DATA} colors={colors} />
          <InterpretationCard data={LIFTING_DATA} colors={colors} />
        </CopilotView>
      </TourStep>

      <Text
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 },
        ]}
      >
        {"Changelog"}
      </Text>

      <ChangelogAccordion entries={CHANGELOG} colors={colors} />

      {/* ── Version ── */}
      <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>
        Version {versionData.version} ({versionData.versionCode})
      </Text>
    </ScrollView>
  );
}
// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.containerPadding,
  },  logoWrap: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    width: 260,
    height: 160,
    borderRadius: radius.sm,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: spacing.sm + 2,
    paddingBottom: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Simple non-accordion card (Contact)
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 28,
    overflow: "hidden",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  contactIcon: {
    marginRight: 12,
  },
  contactText: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
  },
  // Accordion card wrapping one tab's help content
  accordionCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm + 2,
    overflow: "hidden",
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  accordionTitle: {
    ...typography.cardTitle,
    flex: 1,
    marginRight: spacing.sm,
  },
  accordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: spacing.md,
  },
  // Sub-section heading inside an expanded accordion
  subHeading: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  subSectionGap: {
    marginTop: 18,
  },
  // Individual bullet row
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 9,
    opacity: 0.5,
    flexShrink: 0,
  },
  bulletText: {
    ...typography.bodySm,
    flex: 1,
  },
  bulletLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
  },
  changelogEntry: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  changelogVersion: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  changelogBullet: {
    ...typography.bodySm,
  },
  changelogLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
  },
  versionLabel: {
    ...typography.metaLabel,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: 12,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    marginBottom: 2,
  },
  settingDescription: {
    ...typography.metaLabel,
  },
  interpretEntry: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  interpretHeading: {
    ...typography.cardTitle,
    marginBottom: 2,
  },
  interpretBody: {
    ...typography.bodySm,
  },
  interpretLabel: {
    fontFamily: fonts.sansSemiBold,
  },
  interpretSectionHeader: {
    fontFamily: fonts.sansSemiBold,
    marginTop: 14,
  },
  interpretItalic: {
    fontStyle: "italic",
  },
  interpretPlaceholder: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: spacing.xs,
  },
  unitToggle: {
    flexDirection: "row",
    padding: 3,
    width: 90,
    height: 34,
  },
  unitBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  unitBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
});
