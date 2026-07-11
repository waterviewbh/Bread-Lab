// components/FCSScatterPlot.tsx
// ─── Feed Coordinate System — Metabolic Scatter Plot ─────────────────────────
//
// The bottom panel of the dual-panel dashboard on the Graphs tab.
// Placed directly below LiftingIndexChart; the two panels share selectedFeedNum
// state (owned by graph.tsx) to drive cross-panel highlight.
//
// X-axis: Categorical-Continuous Hybrid Grid
//   └── Macro columns  = Flour Workload Chapters  (1×, 2×, 5×, 10×+)
//   └── Micro columns  = Hydration Slices (Stiff | Standard | Slack)
// Y-axis: Hours to peak
// Dot fill: Artisan Hearth thermal gradient (ambient temp via feedCoordinate.ts)
// Opacity: Vivid (last 10) / Ghost (11–20, 35%) / Archived (21+, 0%)
//   └── Resurrection State: tapping an archived dot from the timeline forces
//       it back to full opacity with a selection ring until deselected.
// Season Compare toggle: This Week (filled) vs. 52 Weeks Ago (hollow outline)
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Rect,
  Text as SvgText,
} from "react-native-svg";import { useColors } from "@/hooks/useColors";
import type { HistoryEntryForSeries } from "@/lib/analytics";
import {
  flourChapter,
  hydrationSlice,
  tempToHeatFraction,
  heatFractionToColor,
  parseRatioStr,
  FLOUR_CHAPTERS,
  type FlourChapter,
  type HydrationSlice,
} from "@/lib/feedCoordinate";
import { fonts, radius } from "@/constants/theme";

// ─── Layout constants ─────────────────────────────────────────────────────────
const CHART_H = 220;
const PAD = { top: 16, right: 16, bottom: 56, left: 44 } as const;
// PAD.bottom = 56: accommodates three label rows below the x-axis baseline
//   Row 1 (+12px): Stiff / Std / Slack slice labels
//   Row 2 (+25px): 1× Flour / 2× Flour chapter labels
//   Row 3 (+38px): Acetic / Lactic flavor edge labels
const DOT_R      = 5;    // standard dot radius
const DOT_R_SEL  = 7;    // selected dot radius
const DOT_RING_R = 13;   // outer highlight ring radius (also pressable hit area)
const VIVID_COUNT   = 10;    // last N feeds rendered at full opacity
const GHOST_COUNT   = 10;    // next N feeds rendered at 35% opacity (feeds 11–20)
const GHOST_OPACITY = 0.35;

// Hydration slices always appear in this fixed left-to-right order within each chapter
const SLICE_ORDER: HydrationSlice[] = ["stiff", "standard", "slack"];
const SLICE_LABELS: Record<HydrationSlice, string> = {
  stiff:    "Stiff",
  standard: "Std",
  slack:    "Slack",
};
const CHAPTER_LABELS: Partial<Record<number, string>> = {
  1: "Low Workload",
  2: "Medium Workload",
  5: "High Workload",
  10: "Ultra Workload",
};

// ─── Internal types ───────────────────────────────────────────────────────────
interface FCSPoint {
  feedNum:         number;
  indexFromNewest: number;   // 0 = most recent peaked feed; drives opacity zones
  savedAt:         number;
  hoursToPeak:     number;
  didDouble:       boolean;  // false → hollow dot (sub-100% expansion)
  chapter:         FlourChapter | null;
  slice:           HydrationSlice | null;
  ambientTempF:    number | null;
  weekKey:         string;   // ISO "YYYY-Www" for seasonal comparison
}

// One sub-column in the categorical grid
interface GridColumn {
  chapter: FlourChapter;
  slice:   HydrationSlice;
  centerX: number;  // absolute pixel x within the SVG canvas
  width:   number;  // pixel width of this sub-column
}

// One chapter background band
interface ChapterBand {
  chapter: FlourChapter;
  x:       number;
  width:   number;
}

// Computed layout + geometry — derived in one memo to avoid cascading renders
interface ChartGeometry {
  iW:             number;
  iH:             number;
  maxHours:       number;
  yTicks:         number[];
  toY:            (h: number) => number;
  columns:        GridColumn[];
  chapterBands:   ChapterBand[];
  sliceW:         number;
  dotX:           Map<number, number>;   // feedNum → cx pixel
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  sessions:        HistoryEntryForSeries[];
  selectedFeedNum: number | null;
  onSelectFeedNum: (n: number | null) => void;
}

// ─── Pure helpers (no React) ──────────────────────────────────────────────────
function toFahrenheit(temp: number, unit: "F" | "C"): number {
  return unit === "C" ? (temp * 9) / 5 + 32 : temp;
}

/**
 * Returns an ISO calendar-week key ("YYYY-Www") for a given date.
 * Uses Monday-based ISO weeks so the same calendar week aligns year-to-year.
 */
function calendarWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;           // Mon = 1, Sun = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);   // shift to the Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum   = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Transforms raw HistoryEntryForSeries[] into enriched FCSPoint[].
 * Mirrors the sorting logic in computeLiftingSeries so feedNum values
 * match exactly — this is how cross-panel selection links the two charts.
 */
function deriveFCSPoints(sessions: HistoryEntryForSeries[]): FCSPoint[] {
  // Sort oldest-first to assign feedNum chronologically (same as computeLiftingSeries)
  const sorted = [...sessions].sort((a, b) => a.savedAt - b.savedAt);
  const points: FCSPoint[] = [];
  let feedNum = 1;  for (const s of sorted) {
    if (s.peak) {
      const parsed = s.ratioStr ? parseRatioStr(s.ratioStr) : null;      // Ambient temp — prefer initialTemp, fall back to first reading with a temp
      let ambientTempF: number | null = null;
      const unit: "F" | "C" = (s as any).initialTempUnit ?? "F";
      if (s.initialTemp && !isNaN(parseFloat(s.initialTemp))) {
        ambientTempF = toFahrenheit(parseFloat(s.initialTemp), unit);
      } else if (s.readings) {
        const firstWithTemp = s.readings.find((r) => r.temp && !isNaN(parseFloat(r.temp)));
        if (firstWithTemp) {
          ambientTempF = toFahrenheit(
            parseFloat(firstWithTemp.temp),
            (firstWithTemp as any).tempUnit ?? "F"
          );
        }
      }
      points.push({
        feedNum,
        indexFromNewest: 0,  // back-filled below
        savedAt:      s.savedAt,
        hoursToPeak:  s.peak.timeToPeakMs / 3_600_000,
        didDouble:    s.peak.volumeIncreasePct >= 100,
        chapter:      parsed ? flourChapter(parsed.flour) : null,
        slice:        parsed ? hydrationSlice(parsed.flour, parsed.water) : null,
        ambientTempF,
        weekKey:      calendarWeekKey(new Date(s.savedAt)),
      });
    }
    feedNum++;
  }
  // Back-fill indexFromNewest: i = 0 is the oldest peaked feed,
  // so its indexFromNewest = total - 1 (pushed deepest into the archive).
  const total = points.length;
  return points.map((p, i) => ({ ...p, indexFromNewest: total - 1 - i }));
}

/**
 * Builds the full chart geometry from the enriched points and the
 * measured container width. Kept in one memo to avoid cascading renders
 * when containerW settles after layout.
 */
function buildGeometry(
  fcsPoints: FCSPoint[],
  containerW: number
): ChartGeometry | null {
  const iW = containerW - PAD.left - PAD.right;
  const iH = CHART_H - PAD.top - PAD.bottom;
  if (iW <= 0 || iH <= 0 || fcsPoints.length === 0) return null;
  // ── Y scale ───────────────────────────────────────────────────────────────
  const rawMax   = Math.max(...fcsPoints.map((p) => p.hoursToPeak));
  const maxHours = Math.ceil(Math.max(rawMax, 4) / 2) * 2;  // round up to nearest even
  const yTicks   = [0, maxHours / 2, maxHours];
  const toY      = (h: number) => iH - (h / maxHours) * iH;
  // ── Present flour workload chapters regardless of data therein ─────────────────
  /*const presentChapters = [
    ...new Set(
      fcsPoints.filter((p) => p.chapter != null).map((p) => p.chapter!)
    ),
  ].sort((a, b) => a - b);  if (presentChapters.length === 0) return null;
  const chapterW = iW / presentChapters.length;*/
  const chapterW = iW / FLOUR_CHAPTERS.length; // Each band takes up exactly 25% of screen width
  const sliceW   = chapterW / SLICE_ORDER.length;
  // ── Column grid + chapter bands ───────────────────────────────────────────
  const columns:      GridColumn[]  = [];
  const chapterBands: ChapterBand[] = [];
  /*presentChapters.forEach((chapter, ci) => {*/
    FLOUR_CHAPTERS.forEach((chapter, ci) => {
      const chapterLeft = PAD.left + ci * chapterW;
      chapterBands.push({ chapter, x: chapterLeft, width: chapterW });
    SLICE_ORDER.forEach((slice, si) => {
      columns.push({
        chapter,
        slice,
        centerX: chapterLeft + (si + 0.5) * sliceW,
        width:   sliceW,
      });
    });
  });
  // ── Intra-column dot spreading (prevents total overlap) ───────────────────
  // Group by (chapter, slice), sort by savedAt within each group, then
  // spread dots evenly across 60% of the sub-column width.
  const colMap = new Map<string, FCSPoint[]>();
  for (const pt of fcsPoints) {
    if (pt.chapter == null || pt.slice == null) continue;
    const key = `${pt.chapter}|${pt.slice}`;
    if (!colMap.has(key)) colMap.set(key, []);
    colMap.get(key)!.push(pt);
  }  const dotX = new Map<number, number>(); // feedNum → pixel cx
  for (const [key, pts] of colMap) {
    const [chStr, slStr] = key.split("|");
    const col = columns.find(
      (c) => c.chapter === Number(chStr) && c.slice === slStr
    );
    if (!col) continue;
    const sorted    = [...pts].sort((a, b) => a.savedAt - b.savedAt);
    const n         = sorted.length;
    const maxSpread = col.width * 0.60;    sorted.forEach((pt, i) => {
      // Single dot: sit at center; multiple: spread symmetrically
      const offset = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * maxSpread;
      dotX.set(pt.feedNum, col.centerX + offset);
    });
  }  return { iW, iH, maxHours, yTicks, toY, columns, chapterBands, sliceW, dotX };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FCSScatterPlot({
  sessions,
  selectedFeedNum,
  onSelectFeedNum,
}: Props) {
  const colors = useColors();
  const [containerW, setContainerW] = useState(320);
  const [viewMode, setViewMode]     = useState<"default" | "compare">("default");
  // ── Seasonal week keys — stable, computed once per render cycle ────────────
  const { thisWeekKey, compareWeekKey } = useMemo(() => {
    const now         = new Date();
    const compareDate = new Date(now.getTime() - 52 * 7 * 86_400_000);
    return {
      thisWeekKey:    calendarWeekKey(now),
      compareWeekKey: calendarWeekKey(compareDate),
    };
  }, []);
  const fcsPoints = useMemo(() => deriveFCSPoints(sessions), [sessions]);  const chart = useMemo(
    () => buildGeometry(fcsPoints, containerW),
    [fcsPoints, containerW]
  );
  // Nothing to render until we have data and layout
  if (!chart || fcsPoints.length === 0) {
    return (
      // Reserve space so the onLayout callback can fire before first paint
      <View
        style={[s.box, { borderColor: colors.border, backgroundColor: colors.card, height: CHART_H }]}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      />
    );
  }  const { iW, iH, maxHours, yTicks, toY, columns, chapterBands, sliceW, dotX } = chart;
  // ── Build renderable dot list ──────────────────────────────────────────────
  const renderableDots = fcsPoints
    .filter((pt) => pt.chapter != null && pt.slice != null && dotX.has(pt.feedNum))
    .map((pt) => {
      const cx         = dotX.get(pt.feedNum)!;
      const cy         = PAD.top + toY(pt.hoursToPeak);
      const isSelected = pt.feedNum === selectedFeedNum;
      // ── Opacity ────────────────────────────────────────────────────────────
      let opacity: number;
      if (viewMode === "compare") {
        // Compare mode: only this-week and 52-weeks-ago dots are visible
        opacity = (pt.weekKey === thisWeekKey || pt.weekKey === compareWeekKey) ? 1 : 0;
      } else {
        // Default mode — three-zone opacity decay
        if (isSelected) {
          opacity = 1; // Resurrection State: always full brilliance
        } else if (pt.indexFromNewest < VIVID_COUNT) {
          opacity = 1;
        } else if (pt.indexFromNewest < VIVID_COUNT + GHOST_COUNT) {
          opacity = GHOST_OPACITY;
        } else {
          opacity = 0; // archived — invisible unless selected
        }
      }
      // ── Dot visual style ───────────────────────────────────────────────────
      // In compare mode, 52-weeks-ago dots render as hollow outline circles
      // in colors.foreground to stand apart from this week's filled dots.
      // The dotColor null-check is for cases when feeds were never temp'ed
      const isCompareTarget =
        viewMode === "compare" && pt.weekKey === compareWeekKey;
        const dotColor = pt.ambientTempF != null
          ? heatFractionToColor(tempToHeatFraction(pt.ambientTempF), colors)
          : colors.mutedForeground;
          return { pt, cx, cy, isSelected, opacity, dotColor, isCompareTarget };
    });
  // ── Selected column lane (drawn behind dots) ───────────────────────────────
  const selectedPt  = fcsPoints.find((p) => p.feedNum === selectedFeedNum);
  const selectedCol = selectedPt
    ? columns.find(
        (c) => c.chapter === selectedPt.chapter && c.slice === selectedPt.slice
      )
    : null;
  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View>
    {/* ── Compare-mode toggle ─────────────────────────────────────────────── */}
      <View style={s.toggleRow}>
        <Pressable
          onPress={() => setViewMode("default")}
          style={[
            s.toggleBtn,
            {
              backgroundColor:
                viewMode === "default" ? colors.primary : colors.secondary,
              borderColor: colors.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: viewMode === "default" }}
        >
          <Text
            style={[
              s.toggleLabel,
              {
                color:
                  viewMode === "default"
                    ? colors.primaryForeground
                    : colors.mutedForeground,
              },
            ]}
          >
            Default
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("compare")}
          style={[
            s.toggleBtn,
            {
              backgroundColor:
                viewMode === "compare" ? colors.primary : colors.secondary,
              borderColor: colors.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: viewMode === "compare" }}
        >
          <Text
            style={[
              s.toggleLabel,
              {
                color:
                  viewMode === "compare"
                    ? colors.primaryForeground
                    : colors.mutedForeground,
              },
            ]}
          >
            Season Compare
          </Text>
        </Pressable>
      </View>
      {/* ── Chart card ──────────────────────────────────────────────────────── */}
      <View
        style={[s.box, { borderColor: colors.border, backgroundColor: colors.card }]}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      >
        {/* position: relative wrapper so the hit-area overlay anchors correctly */}
        <View style={{ position: "relative" }}>
          <Svg width={containerW} height={CHART_H}>
          {/* Chapter background alternating bands */}
            {chapterBands.map((band, bi) => (
              <Rect
                key={`band-${band.chapter}`}
                x={band.x}    y={PAD.top}
                width={band.width} height={iH}
                fill={bi % 2 === 0 ? colors.card : colors.muted}
                fillOpacity={0.35}
              />
            ))}
            {/* Selected column lane highlight — drawn before dots */}
            {selectedCol && (
              <Rect
                x={selectedCol.centerX - selectedCol.width / 2}
                y={PAD.top}
                width={selectedCol.width}
                height={iH}
                fill={colors.accent}
                fillOpacity={0.12}
                rx={3}
              />
            )}
            {/* Y-axis grid lines + tick labels */}
            {yTicks.map((v) => {
              const y = PAD.top + toY(v);
              return (
                <G key={`ytick-${v}`}>
                  <Line
                    x1={PAD.left}        y1={y}
                    x2={PAD.left + iW}   y2={y}
                    stroke={colors.border} strokeWidth={1} opacity={0.4}
                  />
                  <SvgText
                    x={PAD.left - 6}  y={y + 4}
                    textAnchor="end"  fontSize={9}
                    fill={colors.mutedForeground}
                    fontFamily={fonts.mono}
                  >
                    {v < 1 ? "0" : `${v.toFixed(v >= 10 ? 0 : 1)}h`}
                  </SvgText>
                </G>
              );
            })}
            {/* Y-axis spine */}
            <Line
              x1={PAD.left} y1={PAD.top}
              x2={PAD.left} y2={PAD.top + iH}
              stroke={colors.border} strokeWidth={1}
            />
            {/* X-axis baseline */}
            <Line
              x1={PAD.left}        y1={PAD.top + iH}
              x2={PAD.left + iW}   y2={PAD.top + iH}
              stroke={colors.border} strokeWidth={1}
            />
            {/* Chapter dividers, slice labels, chapter labels, flavor labels */}
            {chapterBands.map((band, bi) => {
              const chapterCx = band.x + band.width / 2;
              const axisY     = PAD.top + iH;              return (
                <G key={`chapter-${band.chapter}`}>
                {/* Vertical divider between chapters (skip before first) */}
                  {bi > 0 && (
                    <Line
                      x1={band.x} y1={PAD.top}
                      x2={band.x} y2={PAD.top + iH}
                      stroke={colors.border}
                      strokeWidth={1}
                      opacity={0.4}
                    />
                  )}
                  {/* Row 2: Chapter label (centered) */}
                  <SvgText
                    x={chapterCx} y={axisY + 16}
                    textAnchor="middle" fontSize={9}
                    fill={colors.foreground}
                    fontFamily={fonts.mono}
                  >
                    {CHAPTER_LABELS[band.chapter] ?? `${band.chapter}× Flour`}
                  </SvgText>
                  {/* Row 3: Flavor edge labels — Acetic (left) Lactic (right) */}
                  <SvgText
                    x={band.x + 3} y={axisY + 41}
                    textAnchor="start" fontSize={7}
                    fill={colors.mutedForeground}
                    fontFamily={fonts.sans}
                    opacity={0.55}
                  >
                    Acetic
                  </SvgText>
                  <SvgText
                    x={band.x + band.width - 3} y={axisY + 41}
                    textAnchor="end" fontSize={7}
                    fill={colors.mutedForeground}
                    fontFamily={fonts.sans}
                    opacity={0.55}
                  >
                    Lactic
                  </SvgText>
                </G>
              );
            })}
            {/* ── Scatter dots ───────────────────────────────────────────────── */}
            {renderableDots.map(({ pt, cx, cy, isSelected, opacity, dotColor, isCompareTarget }) => {
              // Archived, non-selected dots are hidden — skip to avoid render cost
              if (opacity === 0 && !isSelected) return null;
              const r = isSelected ? DOT_R_SEL : DOT_R;
              return (
                <G key={`dot-${pt.feedNum}`} opacity={opacity}>
                {/* Outer selection ring — only on selected dot */}
                  {isSelected && (
                    <Circle
                      cx={cx} cy={cy} r={DOT_RING_R}
                      fill="transparent"
                      stroke={colors.accent}
                      strokeWidth={1.5}
                    />
                  )}
                  {/*
                    Dot rendering rules (three cases, mutually exclusive):
                    1. Compare target (52 weeks ago): hollow with foreground outline
                    2. Did not double (<100% rise): hollow with thermal color outline
                    3. Standard (doubled): filled with thermal color
                  */}
                  {isCompareTarget ? (
                    <Circle
                      cx={cx} cy={cy} r={r}
                      fill="transparent"
                      stroke={colors.foreground}
                      strokeWidth={1.5}
                    />
                  ) : !pt.didDouble ? (
                    <Circle
                      cx={cx} cy={cy} r={r}
                      fill="transparent"
                      stroke={dotColor}
                      strokeWidth={1.5}
                    />
                  ) : (
                    <Circle cx={cx} cy={cy} r={r} fill={dotColor} />
                  )}
                </G>
              );
            })}
          </Svg>
          {/* ── Pressable hit-area overlay ─────────────────────────────────── */}
          {/* Laid absolutely over the SVG canvas. box-none passes touches
              through the View but preserves the Pressable children as interactive.
              Each Pressable is sized to DOT_RING_R * 2 — generous tap target. */}
          <View
            style={{
              position: "absolute",
              top:      0,
              left:     0,
              width:    containerW,
              height:   CHART_H,
            }}
            pointerEvents="box-none"
          >
            {renderableDots.map(({ pt, cx, cy, opacity, isSelected }) => {
              if (opacity === 0 && !isSelected) return null;
              return (
                <Pressable
                  key={`hit-${pt.feedNum}`}
                  onPress={() =>
                    onSelectFeedNum(isSelected ? null : pt.feedNum)
                  }
                  style={{
                    position: "absolute",
                    left:     cx - DOT_RING_R,
                    top:      cy - DOT_RING_R,
                    width:    DOT_RING_R * 2,
                    height:   DOT_RING_R * 2,
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Feed ${pt.feedNum}, ${pt.hoursToPeak.toFixed(1)} hours to peak`}
                />
              );
            })}
          </View>
        </View>
      </View>
      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <View style={s.footer}>
      {/* Dot type legend */}
        <View style={s.legendRow}>
          <View style={s.li}>
            <Svg width={10} height={10}>
              <Circle cx={5} cy={5} r={4} fill={colors.primary} />
            </Svg>
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Doubled</Text>
          </View>
          <View style={s.li}>
            <Svg width={10} height={10}>
              <Circle
                cx={5} cy={5} r={4}
                fill="transparent"
                stroke={colors.primary}
                strokeWidth={1.5}
              />
            </Svg>
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Sub-100%</Text>
          </View>
          <View style={s.li}>
            <View style={[s.opacityDot, { backgroundColor: colors.primary }]} />
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Last 10</Text>
          </View>
          <View style={s.li}>
            <View
              style={[
                s.opacityDot,
                { backgroundColor: colors.primary, opacity: GHOST_OPACITY },
              ]}
            />
            <Text style={[s.lt, { color: colors.mutedForeground }]}>11–20</Text>
          </View>
        </View>
        {/* Thermal color ramp */}
        <View style={s.thermalRow}>
          <Text style={[s.lt, { color: colors.mutedForeground }]}>Cool</Text>
          <View style={[s.thermalSwatch, { backgroundColor: colors.tempZoneCool }]} />
          <View style={[s.thermalSwatch, { backgroundColor: colors.tempZoneBalanced }]} />
          <View style={[s.thermalSwatch, { backgroundColor: colors.tempZoneWarm }]} />
          <Text style={[s.lt, { color: colors.mutedForeground }]}>Warm = Ambient °</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  box: {
    borderRadius: radius.lg,
    borderWidth:  1,
    overflow:     "hidden",
  },
  toggleRow: {
    flexDirection: "row",
    gap:           8,
    marginBottom:  8,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      radius.md,
    borderWidth:       StyleSheet.hairlineWidth,
  },
  toggleLabel: {
    fontFamily: fonts.sansMedium,
    fontSize:   11,
  },
  footer: {
    marginTop: 6,
    gap:       4,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap:      "wrap",
    gap:           12,
    paddingHorizontal: 2,
  },
  thermalRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           4,
    paddingHorizontal: 2,
  },
  thermalSwatch: {
    width:        20,
    height:        6,
    borderRadius:  3,
  },
  li: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
  },
  lt: {
    fontSize:   10,
    fontFamily: fonts.sans,
  },
  opacityDot: {
    width:        8,
    height:        8,
    borderRadius:  4,
  },
});