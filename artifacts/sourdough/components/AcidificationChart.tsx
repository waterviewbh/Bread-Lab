// AcidificationChart.tsx
// Bacterial Vitality longitudinal chart.
// X-axis: chronological feed number across all history.
// Y-axis: pH velocity (ΔpH ÷ hours elapsed) — one point per qualifying feed.
// Trend: downward/flattening = maturing standard/WW starter.
//        upward = sweet starter overcoming sugar pressure.
//
// When data.length > SCROLL_THRESHOLD the chart canvas expands horizontally
// and becomes scrollable. A sticky left y-axis overlay keeps the labels
// visible at all times. A gradient fade at the inner-left edge of the
// scrollable area hints that older bakes are to the left. The view defaults
// to the far-right (latest bakes).

import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import type { AcidificationPoint } from "@/lib/analytics";

const CHART_H = 180;
const PAD = { top: 18, right: 16, bottom: 38, left: 46 };

/** Width of the edge-fade gradient hint (px). */
const FADE_W = 24;

/** Data-point count at which the chart switches to horizontal-scroll mode. */
const SCROLL_THRESHOLD = 20;
/** Minimum pixels per data-point slot when scrolling. */
const MIN_SLOT_PX = 20;

interface Props {
  data: AcidificationPoint[];
  /** When true, the rightmost data point is the live active session — rendered as an open circle. */
  hasLivePoint?: boolean;
}

export default function AcidificationChart({ data, hasLivePoint = false }: Props) {
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

  const hasLine = data.length >= 2;
  const hasDots = data.length >= 1;

  const yValues = data.map((d) => d.pHVelocity);

  // Hard floor at 0; median-based ceiling to resist outlier spikes.
  const yMin = 0;
  const sortedVals = [...yValues].sort((a, b) => a - b);
  const median =
    sortedVals.length >= 2
      ? sortedVals.length % 2 !== 0
        ? sortedVals[Math.floor(sortedVals.length / 2)]
        : (sortedVals[sortedVals.length / 2 - 1] + sortedVals[sortedVals.length / 2]) / 2
      : sortedVals.length === 1
      ? sortedVals[0]
      : 0;
  const yMax = yValues.length >= 2 ? (3 * median || 0.5) : 0.5;

  // In normal (non-scroll) mode, x is mapped by feedNum span so historical gaps
  // are preserved. In scroll mode, x is mapped by point index so every slot is
  // exactly iW/(n-1) wide — guaranteeing MIN_SLOT_PX spacing regardless of gaps
  // in feedNum (e.g. non-qualifying sessions that were skipped).
  const xMax = data.length > 0 ? data[data.length - 1].feedNum : 1;
  const sx = (feedNum: number, idx: number) => {
    if (data.length <= 1) return iW / 2;
    if (isScrollMode) return (idx / (data.length - 1)) * iW;
    return ((feedNum - 1) / Math.max(xMax - 1, 1)) * iW;
  };
  const sy = (v: number) =>
    iH - ((v - yMin) / ((yMax - yMin) || 0.1)) * iH;

  const yTicks = [0, yMax / 2, yMax];

  // Clamp values to ceiling for rendering; outlier indices get pill badges.
  const clampV = (v: number) => Math.min(v, yMax);
  const outlierIdxs = data
    .map((d, i) => (d.pHVelocity > yMax ? i : -1))
    .filter((i) => i !== -1);

  const pathD = data
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"}${sx(d.feedNum, i).toFixed(1)} ${sy(clampV(d.pHVelocity)).toFixed(1)}`
    )
    .join(" ");

  // Scroll to the far right (latest bakes) whenever data or layout settles.
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
        {/* Sticky left y-axis overlay — renders on top of the scrollable body */}
        {isScrollMode && (
          <View style={[s.axisOverlayLeft, { backgroundColor: colors.card }]}>
            <Svg width={PAD.left} height={CHART_H}>
              <G x={PAD.left} y={PAD.top}>
                {yTicks.map((v, i) => (
                  <SvgText
                    key={i}
                    x={-6} y={sy(v) + 4}
                    textAnchor="end" fontSize={9} fill={colors.mutedForeground}
                  >
                    {v.toFixed(2)}
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
          <View style={{ position: "relative", width: canvasW, height: CHART_H }}>
          <Svg width={canvasW} height={CHART_H}>
            <G x={PAD.left} y={PAD.top}>
              {/* Horizontal grid + Y-axis labels (hidden by overlay in scroll mode) */}
              {yTicks.map((v, i) => (
                <G key={i}>
                  <Line
                    x1={0} y1={sy(v)} x2={iW} y2={sy(v)}
                    stroke={colors.border} strokeWidth={1} opacity={0.5}
                  />
                  <SvgText
                    x={-6} y={sy(v) + 4}
                    textAnchor="end" fontSize={9} fill={colors.mutedForeground}
                  >
                    {v.toFixed(2)}
                  </SvgText>
                </G>
              ))}

              {/* X-axis feed number labels.
                  Scroll mode: render one label per point (every 2nd beyond 50).
                  Normal mode: up to 6 evenly sampled labels. */}
              {isScrollMode
                ? data.map((d, i) => {
                    const show =
                      data.length <= 50 || i % 2 === 0 || i === data.length - 1;
                    return show ? (
                      <SvgText
                        key={i}
                        x={sx(d.feedNum, i)} y={iH + 22}
                        textAnchor="middle" fontSize={9} fill={colors.mutedForeground}
                      >
                        {d.feedNum}
                      </SvgText>
                    ) : null;
                  })
                : (data.length <= 6
                    ? data.map((d, i) => ({ feedNum: d.feedNum, i }))
                    : Array.from({ length: 6 }, (_, j) => {
                        const origIdx = Math.round((j / 5) * (data.length - 1));
                        return { feedNum: data[origIdx].feedNum, i: origIdx };
                      })
                  ).map(({ feedNum, i }, j) => (
                    <SvgText
                      key={j}
                      x={sx(feedNum, i)} y={iH + 22}
                      textAnchor="middle" fontSize={9} fill={colors.mutedForeground}
                    >
                      {feedNum}
                    </SvgText>
                  ))}

              {/* Connecting line */}
              {hasLine && (
                <Path
                  d={pathD}
                  stroke={colors.accent} strokeWidth={2}
                  fill="none" strokeLinecap="round" strokeLinejoin="round"
                />
              )}

              {/* Data point dots — live point (rightmost) rendered as open circle */}
              {hasDots &&
                data.map((d, i) => {
                  const isLive = hasLivePoint && i === data.length - 1;
                  return isLive ? (
                    <Circle
                      key={i}
                      cx={sx(d.feedNum, i)} cy={sy(clampV(d.pHVelocity))}
                      r={4.5} fill="none" stroke={colors.accent} strokeWidth={2}
                    />
                  ) : (
                    <Circle
                      key={i}
                      cx={sx(d.feedNum, i)} cy={sy(clampV(d.pHVelocity))}
                      r={3.5} fill={colors.accent}
                    />
                  );
                })}


              {/* Empty state */}
              {!hasDots && (
                <SvgText
                  x={iW / 2} y={iH / 2 + 4}
                  textAnchor="middle" fontSize={12}
                  fill={colors.mutedForeground} opacity={0.45}
                >
                  No session data yet
                </SvgText>
              )}
              {hasDots && !hasLine && (
                <SvgText
                  x={iW / 2} y={iH + 10}
                  textAnchor="middle" fontSize={10}
                  fill={colors.mutedForeground} opacity={0.5}
                >
                  Need 2+ sessions to show trend
                </SvgText>
              )}
            </G>
          </Svg>
          {/* Outlier pill badges — absolute RN Views that scroll with chart content */}
          {outlierIdxs.length > 0 &&
            (() => {
              const PILL_W = 76;
              const PILL_H = 16;
              const nextXByLane: number[] = [];
              return outlierIdxs.map((i) => {
                const d = data[i];
                const centerX = PAD.left + sx(d.feedNum, i);
                const leftX = Math.max(PAD.left + 2, centerX - PILL_W / 2);
                let lane = nextXByLane.findIndex((nx) => centerX - PILL_W / 2 >= nx);
                if (lane === -1) lane = nextXByLane.length;
                nextXByLane[lane] = leftX + PILL_W + 4;
                return (
                  <View
                    key={`pill-${i}`}
                    pointerEvents="none"
                    style={[
                      s.pill,
                      {
                        left: leftX,
                        top: 2 + lane * (PILL_H + 2),
                        backgroundColor: colors.accent + "15",
                        borderColor: colors.accent,
                      },
                    ]}
                  >
                    <Text style={[s.pillText, { color: colors.accent }]}>
                      {d.pHVelocity.toFixed(2)} pH/hr
                    </Text>
                  </View>
                );
              });
            })()}
          </View>
        </ScrollView>
      </View>

      {/* Axis labels */}
      <View style={s.axisRow}>
        <Text style={[s.axisLabel, { color: colors.mutedForeground }]}>ΔpH/hr</Text>
        <Text style={[s.axisLabel, { color: colors.mutedForeground }]}>Feed #</Text>
      </View>
      {isScrollMode && (
        <Text style={[s.scrollHint, { color: colors.mutedForeground }]}>
          ← swipe for older bakes
        </Text>
      )}
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
  fadeLeft: {
    position: "absolute",
    top: 0,
    width: FADE_W,
    height: CHART_H,
    zIndex: 1,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginTop: 4,
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
  pill: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pillText: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
  },
});
