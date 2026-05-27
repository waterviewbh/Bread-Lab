// LiftingIndexChart.tsx
// Yeast Velocity & Capacity longitudinal chart.
// X-axis: feed number (only sessions where a peak was logged).
// Left Y-axis (bars): time-to-peak in hours.
// Right Y-axis (triangles): peak rise percentage.
// Bar fill varies by starter type: solid / diagonal hatch / cross-hatch.
//
// When data.length > SCROLL_THRESHOLD the chart canvas expands horizontally
// and becomes scrollable. Sticky overlay panels keep both y-axes visible.
// A gradient fade at the inner-left edge hints that older bakes are to the left.
// The view defaults to the far-right (most recent peaks) on load.

import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, {
  Defs,
  G,
  Line,
  Path,
  Pattern,
  Polygon,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import type { LiftingPoint } from "@/lib/analytics";

const CHART_H = 200;
const PAD = { top: 20, right: 52, bottom: 38, left: 44 };

/** Width of the edge-fade gradient hint (px). */
const FADE_W = 24;

/** Data-point count at which the chart switches to horizontal-scroll mode. */
const SCROLL_THRESHOLD = 20;
/** Minimum pixels per bar slot when scrolling (bar + gutter). */
const MIN_SLOT_PX = 28;

interface Props {
  data: LiftingPoint[];
}

export default function LiftingIndexChart({ data }: Props) {
  const colors = useColors();
  const [containerW, setContainerW] = useState(320);
  const scrollRef = useRef<ScrollView>(null);

  const isScrollMode = data.length > SCROLL_THRESHOLD;

  // Canvas grows to fit all slots at minimum spacing; never shrinks below container width.
  const canvasW = isScrollMode
    ? Math.max(containerW, PAD.left + data.length * MIN_SLOT_PX + PAD.right)
    : containerW;

  const iW = canvasW - PAD.left - PAD.right;
  const iH = CHART_H - PAD.top - PAD.bottom;

  const hasData = data.length >= 1;

  // Locked axes: 4 h and 100 % always sit at the same pixel height (baseline ratio = 25).
  // Both axes scale up together when either value exceeds its baseline target.
  const rawLeftMax = hasData ? Math.max(...data.map((d) => d.timeToPeakHrs)) : 0;
  const rawRightMax = hasData ? Math.max(...data.map((d) => d.peakRisePct)) : 0;
  // No-data default: yLeftMax=8 so midline tick lands exactly on 4h (the baseline).
  const yLeftMax = hasData ? Math.max(rawLeftMax, rawRightMax / 25, 4) * 1.25 : 8;
  const yRightMax = yLeftMax * 25; // keeps 4h ↔ 100% aligned at all scales

  const syLeft = (h: number) => iH - (h / yLeftMax) * iH;
  const syRight = (p: number) => iH - (p / yRightMax) * iH;

  // Slot layout — evenly divide inner width. Bars are index-based so spacing
  // is always uniform regardless of feedNum gaps.
  const n = Math.max(data.length, 1);
  const slotW = iW / n;
  const barW = Math.min(22, Math.max(8, slotW * 0.5));
  const cx = (i: number) => (i + 0.5) * slotW;

  // Y-axis ticks
  const leftTicks = [0, yLeftMax / 2, yLeftMax];
  const rightTicks = [0, yRightMax / 2, yRightMax];

  // Bar color base
  const barColor = colors.primary;

  // X-axis labels: show all in scroll mode; otherwise thin out to ≤8 labels.
  const showLabel = (i: number) =>
    isScrollMode ||
    data.length <= 8 ||
    i % Math.ceil(data.length / 8) === 0 ||
    i === data.length - 1;

  // Scroll to the far right (latest peaks) whenever data or layout settles.
  // Depend on the full data reference so any data change (not just length)
  // triggers a re-scroll.
  useEffect(() => {
    if (!isScrollMode) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [data, isScrollMode, containerW]);

  return (
    <View>
      <View
        style={[s.box, { borderColor: colors.border, backgroundColor: colors.card }]}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      >
        {/* Sticky left y-axis overlay (hours) */}
        {isScrollMode && (
          <View style={[s.axisOverlayLeft, { backgroundColor: colors.card }]}>
            <Svg width={PAD.left} height={CHART_H}>
              <G x={PAD.left} y={PAD.top}>
                {leftTicks.map((v, i) => (
                  <SvgText
                    key={i}
                    x={-6} y={syLeft(v) + 4}
                    textAnchor="end" fontSize={9} fill={colors.mutedForeground}
                  >
                    {v < 1 ? "0" : `${v.toFixed(v >= 10 ? 0 : 1)}h`}
                  </SvgText>
                ))}
              </G>
            </Svg>
          </View>
        )}

        {/* Sticky right y-axis overlay (rise %) */}
        {isScrollMode && (
          <View style={[s.axisOverlayRight, { backgroundColor: colors.card }]}>
            <Svg width={PAD.right} height={CHART_H}>
              <G x={6} y={PAD.top}>
                {rightTicks.map((v, i) => (
                  <SvgText
                    key={i}
                    x={0} y={syRight(v) + 4}
                    textAnchor="start" fontSize={9} fill={colors.accent}
                  >
                    {v < 1 ? "0" : `${Math.round(v)}%`}
                  </SvgText>
                ))}
              </G>
            </Svg>
          </View>
        )}

        {/* Left-edge fade gradient — visible when scrolled right, hints older data exists */}
        {isScrollMode && (
          <LinearGradient
            colors={[colors.card, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[s.fadeLeft, { left: PAD.left }]}
            pointerEvents="none"
          />
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={isScrollMode}
          showsHorizontalScrollIndicator={false}
          bounces={false}
        >
          <Svg width={canvasW} height={CHART_H}>
            <Defs>
              {/* Sugar: diagonal hatch at 45° */}
              <Pattern
                id="sugarHatch"
                x={0} y={0} width={7} height={7}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <Line x1={0} y1={0} x2={0} y2={7}
                  stroke={barColor} strokeWidth={2} />
              </Pattern>
              {/* WW: cross-hatch (two diagonals) */}
              <Pattern
                id="wwHatch"
                x={0} y={0} width={8} height={8}
                patternUnits="userSpaceOnUse"
              >
                <Path d="M 0,0 L 8,8" stroke={barColor} strokeWidth={1} opacity={0.8} />
                <Path d="M 8,0 L 0,8" stroke={barColor} strokeWidth={1} opacity={0.8} />
              </Pattern>
            </Defs>

            <G x={PAD.left} y={PAD.top}>
              {/* Horizontal grid lines */}
              {leftTicks.map((v, i) => (
                <G key={i}>
                  <Line
                    x1={0} y1={syLeft(v)} x2={iW} y2={syLeft(v)}
                    stroke={colors.border} strokeWidth={1} opacity={0.5}
                  />
                </G>
              ))}

              {/* Left Y-axis labels (hours) — hidden by overlay in scroll mode */}
              {leftTicks.map((v, i) => (
                <SvgText
                  key={i}
                  x={-6} y={syLeft(v) + 4}
                  textAnchor="end" fontSize={9} fill={colors.mutedForeground}
                >
                  {v < 1 ? "0" : `${v.toFixed(v >= 10 ? 0 : 1)}h`}
                </SvgText>
              ))}

              {/* Right Y-axis labels (%) — hidden by overlay in scroll mode */}
              {rightTicks.map((v, i) => (
                <SvgText
                  key={i}
                  x={iW + 6} y={syRight(v) + 4}
                  textAnchor="start" fontSize={9} fill={colors.accent}
                >
                  {v < 1 ? "0" : `${Math.round(v)}%`}
                </SvgText>
              ))}

              {/* Bars + triangle markers */}
              {hasData &&
                data.map((d, i) => {
                  const barH = Math.max(2, (d.timeToPeakHrs / yLeftMax) * iH);
                  const barX = cx(i) - barW / 2;
                  const barY = iH - barH;
                  const fillAttr =
                    d.starterType === "sugar"
                      ? "url(#sugarHatch)"
                      : d.starterType === "ww"
                      ? "url(#wwHatch)"
                      : undefined;

                  const triCy = syRight(d.peakRisePct);
                  const triSize = 5;
                  const triPts = [
                    `${cx(i)},${triCy - triSize}`,
                    `${cx(i) - triSize},${triCy + triSize}`,
                    `${cx(i) + triSize},${triCy + triSize}`,
                  ].join(" ");

                  return (
                    <G key={i}>
                      {/* Bar */}
                      <Rect
                        x={barX} y={barY} width={barW} height={barH}
                        fill={fillAttr ?? barColor}
                        fillOpacity={fillAttr ? 1 : 0.65}
                        stroke={barColor}
                        strokeWidth={1}
                      />
                      {/* Triangle marker */}
                      <Polygon
                        points={triPts}
                        fill="none"
                        stroke={colors.accent}
                        strokeWidth={1.5}
                      />
                      {/* X-axis feed number label */}
                      {showLabel(i) && (
                        <SvgText
                          x={cx(i)} y={iH + 22}
                          textAnchor="middle" fontSize={9} fill={colors.mutedForeground}
                        >
                          {d.feedNum}
                        </SvgText>
                      )}
                    </G>
                  );
                })}

              {/* Empty state */}
              {!hasData && (
                <SvgText
                  x={iW / 2} y={iH / 2 + 4}
                  textAnchor="middle" fontSize={12}
                  fill={colors.mutedForeground} opacity={0.45}
                >
                  Log a peak to see your lifting data
                </SvgText>
              )}
            </G>
          </Svg>
        </ScrollView>
      </View>

      {/* Legend + axis labels */}
      <View style={s.footer}>
        <View style={s.legendRow}>
          <View style={s.li}>
            <View style={[s.barSwatch, { backgroundColor: colors.primary, opacity: 0.65 }]} />
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Standard</Text>
          </View>
          <View style={s.li}>
            <View style={[s.barSwatchBordered, { borderColor: colors.primary }]}>
              <View style={[s.hatchLine, { backgroundColor: colors.primary, transform: [{ rotate: "-45deg" }] }]} />
            </View>
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Sugar</Text>
          </View>
          <View style={s.li}>
            <View style={[s.barSwatchBordered, { borderColor: colors.primary }]}>
              <View style={[s.hatchLine, { backgroundColor: colors.primary, transform: [{ rotate: "45deg" }] }]} />
              <View style={[s.hatchLine, { backgroundColor: colors.primary, transform: [{ rotate: "-45deg" }], position: "absolute" }]} />
            </View>
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Whole Wheat</Text>
          </View>
          <View style={s.li}>
            <Svg width={10} height={10} viewBox="0 0 10 10">
              <Polygon
                points="5,1 0,9 10,9"
                fill="none"
                stroke={colors.accent}
                strokeWidth={1.5}
              />
            </Svg>
            <Text style={[s.lt, { color: colors.mutedForeground }]}>Rise %</Text>
          </View>
        </View>
        <View style={s.axisRow}>
          <Text style={[s.axisLabel, { color: colors.mutedForeground }]}>Hours (4h = baseline)</Text>
          <Text style={[s.axisLabel, { color: colors.mutedForeground }]}>Feed #</Text>
          <Text style={[s.axisLabel, { color: colors.accent }]}>Rise % (100% = baseline)</Text>
        </View>
        {isScrollMode && (
          <Text style={[s.scrollHint, { color: colors.mutedForeground }]}>
            ← swipe for older bakes
          </Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  axisOverlayLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    width: PAD.left,
    height: CHART_H,
    zIndex: 2,
  },
  axisOverlayRight: {
    position: "absolute",
    right: 0,
    top: 0,
    width: PAD.right,
    height: CHART_H,
    zIndex: 2,
  },
  fadeLeft: {
    position: "absolute",
    top: 0,
    width: FADE_W,
    height: CHART_H,
    zIndex: 1,
  },
  footer: {
    marginTop: 6,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  li: { flexDirection: "row", alignItems: "center", gap: 5 },
  barSwatch: { width: 14, height: 10, borderRadius: 2 },
  barSwatchBordered: {
    width: 14,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  hatchLine: { width: 20, height: 1.5 },
  lt: { fontSize: 10, fontFamily: "Inter_400Regular" },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  axisLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    opacity: 0.7,
  },
  scrollHint: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    opacity: 0.5,
    textAlign: "center",
    marginTop: 2,
  },
});
