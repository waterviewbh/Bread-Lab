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

// const CopilotView = walkthroughable(View); red-tagged for webapp-0.1 rmv in 3 revs

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
          How to read this
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
              More in About →
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  wrap: {
    borderRadius: 10,
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
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  bodyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  moreLink: {
    alignSelf: "flex-start",
  },
  moreLinkText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
  "Standard Starter: A healthy, un-shocked standard white or whole wheat starter can hit 150\u2013200% volume expansion in 3\u20134 hours.\n\n" +
  "Sweet Starter: Because of osmotic pressure slowing down the yeast, a healthy sweet starter might demonstrate a 100\u2013125% expansion in 5\u20137 hours.\n\n" +
  "The vertical axes are locked into a calibrated baseline of 100% expansion in 4 hours \u2014 so a healthy sweet starter will naturally sit lower on the graph than a standard one. " +
  "It\u2019s the metabolic \u201Ctax\u201D that sugar imposes on the culture.";

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GraphScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

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
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page heading ── */}
        <Text
          style={{
            fontSize: 24,
            fontFamily: "Inter_700Bold",
            color: colors.foreground,
            letterSpacing: -0.5,
            marginBottom: 28,
          }}
        >
          Feed Analytics
        </Text>

        {/* ── Acidification Index ── */}
        <TourStep
          text="Monitor your bacterial vitality with the Acidification Index."
          order={9}
          name="acidification-index"
        >
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
        <TourStep
          text="Track your yeast velocity and rise capacity here."
          order={10}
          name="lifting-index"
        >
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
            <LiftingIndexChart data={liftSeries} />
          </CopilotView>
        </TourStep>

        {/* ── 3rd graph ── */}
        <TourStep
          text="More data analysis and visualization coming soon."
          order={11}
          name="3rd-graph"
        >
          <CopilotView style={{ height: 1 }} />
        </TourStep>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
});
