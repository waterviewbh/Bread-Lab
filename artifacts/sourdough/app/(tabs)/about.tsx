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

function InterpretationCard({ data, colors }: { data: any; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
      {/* Title Header */}
      <View style={[styles.interpretEntry, { borderBottomColor: colors.border }]}>
        <Text style={[styles.interpretHeading, { color: colors.foreground }]}>
          {data.title}
        </Text>
      </View>

      {/* Intro Text */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
        <Text style={[styles.interpretBody, { color: colors.foreground }]}>
          {data.body}
        </Text>
      </View>

      {/* Diagnostic Sections */}
      {data.sections.map((sec: any, i: number) => (
        <View key={i} style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <Text style={[styles.interpretBody, { color: colors.foreground }, styles.interpretSectionHeader]}>
            {sec.heading}
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={styles.interpretLabel}>{"Visual: "}</Text>
            {sec.visual}
          </Text>

          {/* Standard Diagnostic */}
          {sec.diagnosticStandard && (
            <Text style={[styles.interpretBody, { color: colors.foreground }]}>
              <Text style={styles.interpretLabel}>{"Diagnostic [Standard]: "}</Text>
              {sec.diagnosticStandard}
            </Text>
          )}

          {/* Sweet Diagnostic (Handles the italic 'pasta madre' case) */}
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

          {/* Simple Diagnostic (for Lifting Index) */}
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
    </View>
  );
}

export default function AboutScreen() {
  const colors = useColors();
  const { fullFontSize, setFullFontSize } = useFontSize();

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
        <View style={styles.settingRow}>
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
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Help
      </Text>

      {HELP.map((tab, i) => (
        <HelpAccordion key={i} tab={tab} colors={colors} />
      ))}

      {/* ── Interpreting Your Data ── */}
<Text
  style={[
    styles.sectionLabel,
    { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 },
  ]}
>
  {"Interpreting Your Data"}
</Text>

<InterpretationCard data={ACIDIFICATION_DATA} colors={colors} />
<InterpretationCard data={LIFTING_DATA} colors={colors} />

<Text
  style={[
    styles.sectionLabel,
    { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 },
  ]}
>
  {"Changelog"}
</Text>

<View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

  {/* Render the changelog from the data array above */}
  {CHANGELOG.map((entry, index) => (
    <View
      key={entry.version}
      style={[
        styles.changelogEntry,
        // Hide the border on the very last item in the list
        index === CHANGELOG.length - 1 ? { borderBottomWidth: 0 } : { borderBottomColor: colors.border }
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
    paddingHorizontal: 20,
  },

  logoWrap: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    width: 260,
    height: 160,
    borderRadius: 4,
  },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // Simple non-accordion card (Contact)
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 28,
    overflow: "hidden",
  },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  contactIcon: {
    marginRight: 12,
  },
  contactText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },

  // Accordion card wrapping one tab's help content
  accordionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  accordionTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  accordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },

  // Sub-section heading inside an expanded accordion
  subHeading: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  subSectionGap: {
    marginTop: 18,
  },

  // Individual bullet row
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 8,
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
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  bulletLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },

  changelogEntry: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  changelogVersion: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  changelogBullet: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  changelogLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },

  versionLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },

  interpretEntry: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  interpretHeading: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  interpretBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  interpretLabel: {
    fontFamily: "Inter_600SemiBold",
  },
  interpretSectionHeader: {
    fontFamily: "Inter_600SemiBold",
    marginTop: 14,
  },
  interpretItalic: {
    fontStyle: "italic",
  },
  interpretPlaceholder: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    marginTop: 4,
  },
});
