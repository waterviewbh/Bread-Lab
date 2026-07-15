import AsyncStorage from "@react-native-async-storage/async-storage";
import AcidificationChart from "@/components/AcidificationChart";
import LiftingIndexChart from "@/components/LiftingIndexChart";
import {
  computeAcidificationSeries,
  computeLiftingSeries,
} from "@/lib/analytics";
import type {
  AcidificationPoint,
  HistoryEntryForSeries,
  LiftingPoint,
} from "@/lib/analytics";
import { useColors } from "@/hooks/useColors";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { TourStep, CopilotView } from "@/components/TourStep"; // red-tagged for webapp-0.1 rmv in 3 revs
import { typography, spacing, radius, fonts } from "@/constants/theme";
import FCSScatterPlot from "@/components/FCSScatterPlot";

const HISTORY_KEY = "sourdough_feed_history_v1";
const STORAGE_KEY = "sourdough_feed_session_v1";

/** Attempt to compute a single acidification velocity for the live active session.
 *  Returns null when the session lacks sufficient data for a meaningful calculation. */
function tryLiveAcidPoint(
  s: HistoryEntryForSeries,
  feedNum: number
): AcidificationPoint | null {
  const readings = (s.readings ?? [])
    .map((r) => ({ pH: parseFloat(r.pH), loggedAt: r.loggedAt }))
    .filter((r) => !isNaN(r.pH))
    .sort((a, b) => a.loggedAt - b.loggedAt);

  let startPH: number | null = null;
  let startTime = s.savedAt;
  const initV = s.initialPH !== undefined ? parseFloat(s.initialPH) : NaN;
  if (!isNaN(initV)) {
    startPH = initV;
  } else if (readings.length > 0) {
    startPH = readings[0].pH;
    startTime = readings[0].loggedAt;
  }

  let endPH: number | null = null;
  let endTime: number | null = null;
  // Peak (unlikely mid-session, but handle it)
  if (s.peak) {
    const v = parseFloat(s.peak.pH);
    if (!isNaN(v)) {
      endPH = v;
      endTime = s.savedAt + s.peak.timeToPeakMs;
    }
  }
  // Fall back to last reading
  if (endPH === null && readings.length > 0) {
    const isDistinct = !isNaN(initV) || readings.length >= 2;
    if (isDistinct) {
      endPH = readings[readings.length - 1].pH;
      endTime = readings[readings.length - 1].loggedAt;
    }
  }

  if (startPH === null || endPH === null || endTime === null) return null;
  const elapsedHrs = (endTime - startTime) / 3_600_000;
  if (elapsedHrs <= 0) return null;
  return { feedNum, pHVelocity: (startPH - endPH) / elapsedHrs };
}

// ── Expandable "How to read this" hint ────────────────────────────────────────

function ReadingHint({
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
              More in the About Tab →
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,             // 12 — consistent with card radius
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
    gap: spacing.sm,                     // 8
  },
  label: {
    fontFamily: fonts.sansMedium,        // HankenGrotesk_500Medium
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: spacing.sm,                     // 8
  },
  bodyText: {
    ...typography.bodySm,                // HankenGrotesk_400Regular, 13px, lh 20
  },
  moreLink: {
    alignSelf: "flex-start",
  },
  moreLinkText: {
    fontFamily: fonts.sansMedium,        // HankenGrotesk_500Medium
    fontSize: 12,
  },
});

// ── Hint copy ─────────────────────────────────────────────────────────────────

const ACID_HINT =
  "Each point is your starter's average pH drop per hour for that feed — " +
  "velocity = (startpH − endpH) ÷ hours. " +
  "For standard flour-and-water and whole wheat (WW) starters, a flattening or downward trend " +
  "over time indicates a maturing, well-balanced culture. " +
  "For a sweet starter, an upward trend confirms the culture successfully overcoming sugar pressure.";

const LIFT_HINT =
  "Bars show hours to peak (left axis); triangles (△) mark rise % at peak (right axis). " +
  "Bar fill varies by starter type: solid for standard, diagonal hatch for sugar, cross-hatch for whole wheat.\n\n" +
  "The vertical axes share a calibrated baseline: 4 hours = healthy time-to-peak; " +
  "100% volume expansion = healthy rise target. Both are locked at the same pixel height so a standard starter running 4h/100% lands exactly at the midline.\n\n" +
  "Standard Starter: A healthy, un-shocked standard white or whole wheat starter can hit 150\u2013200% volume expansion in 3\u20134 hours.\n\n" +
  "Sweet Starter: Because of osmotic pressure slowing down the yeast, a healthy sweet starter might demonstrate a 100\u2013125% expansion in 5\u20137 hours.\n\n" +
  "The vertical axes are locked into a calibrated baseline of 100% expansion in 4 hours \u2014 so a healthy sweet starter will naturally sit lower on the graph than a standard one. " +
  "It\u2019s the metabolic \u201Ctax\u201D that sugar imposes on the culture.";

const FCS_HINT =
  "Each dot represents a completed feed. The column it lands in is determined by that feed's flour workload; a 1:2:2 feed has more flour for the bacteria to work through than a 1:1:1 feed, and a 1:7:7 feed has even more.\n\n" +
  "Within each workload box, dots are organized horizontally by hydration: stiffer starters (i.e., feeds with less water than flour) sit on the left edge, while slacker starters (more water than flour) sit on the right. Read more about stiff and slack starters in About.\n\n" +
  "Dot height tracks hours to peak, while dot color mirrors ambient temperature: cool tones for lower room temperatures and deep, warm hues for accelerated, warm ferments.\n\n" +
  "Filled dots represent a robust feed that successfully doubled or better (≥ 100% rise), while hollow dots indicate sub-100% expansion.\n\n" +
  "Opacity naturally drops as feeds age: your last 10 feeds remain vivid, feeds 11–20 fade to a 35% ghost state, and anything older is hidden.\n\n" +
  "Use the Season Compare button to overlay the current week against the exact same calendar week from 1 year ago. This normalized view can help clear away the noise that comes from temperature and humidity changes, etc.";

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GraphScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  const [selectedFeedNum, setSelectedFeedNum] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntryForSeries[]>([]);
  const [activeSession, setActiveSession] = useState<HistoryEntryForSeries | null>(null);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(STORAGE_KEY),
      ])
        .then(([histRaw, activeRaw]) => {
          setHistory(histRaw ? JSON.parse(histRaw) : []);
          setActiveSession(activeRaw ? JSON.parse(activeRaw) : null);
        })
        .catch(() => {});
    }, [])
  );

  const acidSeries: AcidificationPoint[] = useMemo(() => {
    const series = computeAcidificationSeries(history);
    if (!activeSession) return series;
    const livePoint = tryLiveAcidPoint(activeSession, history.length + 1);
    return livePoint ? [...series, livePoint] : series;
  }, [history, activeSession]);

  const hasLiveAcidPoint = useMemo(() => {
    if (!activeSession) return false;
    return tryLiveAcidPoint(activeSession, history.length + 1) !== null;
  }, [history, activeSession]);

  const liftSeries: LiftingPoint[] = useMemo(
    () => computeLiftingSeries(history),
    [history]
  );

  const goToAbout = () => {
    router.navigate("/(tabs)/about" as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + webTop + 24,
          paddingBottom: insets.bottom + tabBarPad + 32,
          paddingHorizontal: spacing.containerPadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page heading ── */}
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>
          Feed Analytics
        </Text>

        {/* ── Acidification Index ── */}
        <TourStep order={11} name="acidification-index">
          <CopilotView>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Acidification Index
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Bacterial Vitality
              </Text>
            </View>

            <ReadingHint body={ACID_HINT} onAbout={goToAbout} colors={colors} />
            <AcidificationChart data={acidSeries} hasLivePoint={hasLiveAcidPoint} />
          </CopilotView>
        </TourStep>

        {/* ── Lifting Index ── */}
        <TourStep order={12} name="lifting-index">
          <CopilotView style={{ marginTop: 32 }}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Lifting Index
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Yeast Velocity & Capacity
              </Text>
            </View>

            <ReadingHint body={LIFT_HINT} onAbout={goToAbout} colors={colors} />
            <LiftingIndexChart
              data={liftSeries}
              selectedFeedNum={selectedFeedNum}
              onSelectFeedNum={setSelectedFeedNum}
            />
          </CopilotView>
        </TourStep>

        {/* ── Feed Coordinate System — Metabolic Map ── */}
        <TourStep order={13} name="fcs-scatter">
          <CopilotView style={{ marginTop: 32 }}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Metabolic Map
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Feed Ratios × Temperature
              </Text>
            </View>
            <FCSScatterPlot
              sessions={history}
              selectedFeedNum={selectedFeedNum}
              onSelectFeedNum={setSelectedFeedNum}
            />
            <ReadingHint body={FCS_HINT} onAbout={goToAbout} colors={colors} />
          </CopilotView>
        </TourStep>
        {/* Tour transition anchor — zero-height, sits just above tab bar.
            Only the tooltip matters; no highlight hole needed here. */}
        <TourStep order={14} name="next-chapter-is-recipe">
          <CopilotView>
            <View style={{ height: 0 }} />
          </CopilotView>
        </TourStep>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Page title ───────────────────────────────────────────────────────────
  pageTitle: {
    ...typography.headlineLgMobile,      // LibreCaslonText_700Bold, 28px — serif headline
    letterSpacing: -0.5,
    marginBottom: 28,
  },
  // ── Chart section headers ─────────────────────────────────────────────────
  sectionHeader: {
    marginBottom: spacing.sm + 2,        // 10
  },
  sectionTitle: {
    ...typography.titleMd,               // LibreCaslonText_700Bold, 20px — serif section title
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    ...typography.metaLabel,             // HankenGrotesk_400Regular, 12px
    marginTop: 2,
  },
});
