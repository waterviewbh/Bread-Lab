// PHChart.tsx
// pH-over-time line chart for a sourdough feed session.
// Renders two modes:
//
//   Normal mode (no filteredSessions prop):
//     1. Terracotta solid line  — current session readings
//     2. Blue-grey line         — temperature overlay (right y-axis, optional)
//
//   Isolate mode (filteredSessions prop provided):
//     1. Faint terracotta lines — one per matching session
//     2. Muted dashed line      — all-time average (always shown as reference)
//
// Long-press anywhere on the chart to activate a crosshair; drag to scrub.
// The crosshair shows the time, pH, and temperature at the finger position.

import React, { useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { sessionPoints } from "@/lib/analytics";
import type { SessionForAnalytics } from "@/lib/analytics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionForChart extends SessionForAnalytics {
  initialPH?: string;
  wwPercent?: number;
  sugarWeight?: number;
}

export interface TempReading {
  elapsedMin: number;
  temp: number;
  tempUnit: "F" | "C";
}

interface PHChartProps {
  session: SessionForChart | null;
  history: SessionForChart[];
  vitalityPoints?: [number, number][];
  vitalitySessions?: number;
  allTimePoints?: [number, number][];
  /** When provided, activates isolate mode: shows individual lines for each session. */
  filteredSessions?: SessionForChart[];
  /** Legend label for the filtered set, e.g. "Sugar sessions". */
  filteredLabel?: string;
  /** Temperature readings from the current session for the right y-axis overlay. */
  tempReadings?: TempReading[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_H = 180;
const PAD = { top: 16, right: 44, bottom: 32, left: 40 };
const DEFAULT_Y_MIN = 3.5;
const DEFAULT_Y_MAX = 5.7;
const DEFAULT_X_MAX = 120;

// Temperature axis bounds by unit
const TEMP_BOUNDS = {
  F: { min: 60, max: 95 },
  C: { min: 15, max: 35 },
};

// Fermentation temperature band ranges (low, high) per unit — colors resolved at render time
const TEMP_BAND_RANGES_F = [
  { lo: 83, hi: 95, key: "tempBandWarm" as const },     // Warm
  { lo: 75, hi: 82, key: "tempBandBalanced" as const },  // Balanced
  { lo: 60, hi: 74, key: "tempBandCool" as const },      // Cool
];
const TEMP_BAND_RANGES_C = [
  { lo: 28, hi: 35, key: "tempBandWarm" as const },     // Warm
  { lo: 24, hi: 28, key: "tempBandBalanced" as const },  // Balanced
  { lo: 15, hi: 23, key: "tempBandCool" as const },      // Cool
];

// ── Zone label helper ─────────────────────────────────────────────────────────

type TempZoneKey = "tempZoneWarm" | "tempZoneBalanced" | "tempZoneCool";

interface TempZone {
  label: "Warm" | "Balanced" | "Cool";
  colorKey: TempZoneKey;
}

function getTempZone(temp: number, unit: "F" | "C"): TempZone | null {
  const ranges = unit === "C" ? TEMP_BAND_RANGES_C : TEMP_BAND_RANGES_F;
  const zoneColorMap: Record<string, TempZoneKey> = {
    tempBandWarm: "tempZoneWarm",
    tempBandBalanced: "tempZoneBalanced",
    tempBandCool: "tempZoneCool",
  };
  const zoneNameMap: Record<string, TempZone["label"]> = {
    tempBandWarm: "Warm",
    tempBandBalanced: "Balanced",
    tempBandCool: "Cool",
  };
  for (const range of ranges) {
    if (temp >= range.lo && temp <= range.hi) {
      return { label: zoneNameMap[range.key], colorKey: zoneColorMap[range.key] };
    }
  }
  return null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toPath(
  pts: [number, number][],
  xMax: number,
  yMin: number,
  yMax: number,
  W: number,
  H: number
): string {
  if (pts.length < 2) return "";
  const sx = (x: number) => (x / (xMax || 1)) * W;
  const sy = (y: number) => H - ((y - yMin) / ((yMax - yMin) || 0.1)) * H;
  return pts
    .map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`)
    .join(" ");
}

function interpolateY(pts: [number, number][], x: number): number | null {
  if (pts.length < 2) return null;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x1 - x0) === 0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PHChart({
  session,
  history,
  vitalityPoints: preVitalityPts,
  vitalitySessions: preVitalityCount,
  allTimePoints: preAllTimePts,
  filteredSessions,
  filteredLabel,
  tempReadings,
}: PHChartProps) {
  const colors = useColors();

  const [W, setW] = useState(320);

  // Crosshair state
  const [crosshairX, setCrosshairX] = useState<number | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crosshairActiveRef = useRef(false);

  // Isolate mode: filteredSessions prop is provided (even if empty array)
  const isolateMode = filteredSessions !== undefined;

  // In isolate mode the current session line is hidden; vitality is hidden too.
  const curPts = !isolateMode && session ? sessionPoints(session) : [];
  // Inner drawing dimensions
  const iW = W - PAD.left - PAD.right;
  const iH = CHART_H - PAD.top - PAD.bottom;

  // Isolate mode: per-session point arrays (only sessions with ≥2 points)
  const isolatedLinePts: [number, number][][] = isolateMode
    ? (filteredSessions ?? []).map(sessionPoints).filter((p) => p.length >= 2)
    : [];

  // Union of all visible raw points for axis auto-ranging.
  // Normal mode: only the current session; isolate mode: filtered lines + all-time ref.
  const allVisible: [number, number][] = [
    ...(isolateMode ? isolatedLinePts.flat() : curPts),
    ...(isolateMode ? (preAllTimePts ?? []) : []),
  ];

  const xMax = allVisible.length
    ? Math.max(...allVisible.map(([x]) => x), 60)
    : DEFAULT_X_MAX;
  const rawYMin = allVisible.length
    ? Math.min(...allVisible.map(([, y]) => y))
    : DEFAULT_Y_MIN;
  const rawYMax = allVisible.length
    ? Math.max(...allVisible.map(([, y]) => y))
    : DEFAULT_Y_MAX;
  const yPad = Math.max((rawYMax - rawYMin) * 0.15, 0.3);
  const yMin = Math.max(0, rawYMin - yPad);
  const yMax = rawYMax + yPad;

  // Final curve data — isolate mode shows all-time avg as reference; normal mode is current session only.
  const aPts: [number, number][] = isolateMode ? (preAllTimePts ?? []) : [];

  // SVG coordinate mappers (left pH axis)
  const sx = (x: number) => (x / (xMax || 1)) * iW;
  const sy = (y: number) => iH - ((y - yMin) / ((yMax - yMin) || 0.1)) * iH;

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);
  const useHours = xMax > 90;
  const fmtX = (v: number) =>
    useHours ? `${(v / 60).toFixed(1)}h` : `${Math.round(v)}m`;

  // ── Temperature overlay derived state ────────────────────────────────────────

  const hasTempData = !!(tempReadings && tempReadings.length > 0);
  const tempUnit: "F" | "C" | null = hasTempData ? tempReadings![0].tempUnit : null;
  const { min: tempMin, max: tempMax } = tempUnit
    ? TEMP_BOUNDS[tempUnit]
    : { min: 60, max: 95 };

  // Right y-axis coordinate mapper — inverts SVG y so high temp → top
  const syTemp = (t: number) =>
    iH - ((t - tempMin) / ((tempMax - tempMin) || 1)) * iH;

  // Build a lookup from elapsedMin → temp value for dumbbell markers
  const tempByElapsed = new Map<number, number>();
  if (hasTempData) {
    tempReadings!.forEach((r) => tempByElapsed.set(r.elapsedMin, r.temp));
  }

  // Sorted [elapsedMin, temp] pairs for the temp line path
  const tempLinePts: [number, number][] = hasTempData
    ? [...tempReadings!]
        .sort((a, b) => a.elapsedMin - b.elapsedMin)
        .map((r) => [r.elapsedMin, r.temp])
    : [];

  // Temperature bands for the active unit — colors resolved from the current scheme
  const tempBandRanges = tempUnit === "C" ? TEMP_BAND_RANGES_C : TEMP_BAND_RANGES_F;
  const tempBands = tempBandRanges.map((b) => ({ lo: b.lo, hi: b.hi, color: colors[b.key] }));

  // Right y-axis ticks (only shown when temp data present)
  const tempTicks = hasTempData ? [tempMin, Math.round((tempMin + tempMax) / 2), tempMax] : [];

  // ── Crosshair computed values ─────────────────────────────────────────────────

  const crosshairInnerX =
    crosshairX !== null ? Math.max(0, Math.min(crosshairX - PAD.left, iW)) : null;
  const crosshairDataX =
    crosshairInnerX !== null ? (crosshairInnerX / (iW || 1)) * xMax : null;
  const crosshairCurY =
    crosshairDataX !== null && curPts.length >= 2
      ? interpolateY(curPts, crosshairDataX)
      : null;
  const crosshairTempVal =
    crosshairDataX !== null && tempLinePts.length >= 2
      ? interpolateY(tempLinePts, crosshairDataX)
      : null;

  // Long-press touch handlers on the chart box
  const chartHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => crosshairActiveRef.current,
    onResponderGrant: (e: GestureResponderEvent) => {
      const x = e.nativeEvent.locationX;
      longPressRef.current = setTimeout(() => {
        crosshairActiveRef.current = true;
        setCrosshairX(x);
      }, 350);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      if (crosshairActiveRef.current) {
        setCrosshairX(e.nativeEvent.locationX);
      }
    },
    onResponderRelease: () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      crosshairActiveRef.current = false;
      setCrosshairX(null);
    },
    onResponderTerminate: () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      crosshairActiveRef.current = false;
      setCrosshairX(null);
    },
  };

  return (
    <View>
      {/* Header row */}
      <View style={s.headerRow}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>LIVE VITALITY CURVE</Text>
      </View>

      {/* Chart box */}
      <View
        style={[s.box, { borderColor: colors.border, backgroundColor: colors.card }]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...chartHandlers}
      >
        {/* Crosshair tooltip — absolutely positioned inside chart box */}
        {crosshairX !== null && crosshairInnerX !== null && crosshairDataX !== null && (
          <View
            pointerEvents="none"
            style={[
              s.tooltip,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                top: PAD.top + 2,
                right: PAD.right + 4,
              },
            ]}
          >
            <Text style={[s.tooltipTime, { color: colors.mutedForeground }]}>
              {useHours
                ? `${(crosshairDataX / 60).toFixed(1)}h`
                : `${Math.round(crosshairDataX)}m`}
            </Text>
            {crosshairCurY !== null && (
              <Text style={[s.tooltipPH, { color: colors.accent }]}>
                pH {crosshairCurY.toFixed(2)}
              </Text>
            )}
            {crosshairTempVal !== null && tempUnit !== null && (() => {
              const zone = getTempZone(crosshairTempVal, tempUnit);
              return (
                <Text style={[s.tooltipTemp, { color: colors.tempLine }]}>
                  {zone ? (
                    <Text style={{ color: colors[zone.colorKey] }}>
                      {zone.label}{" "}
                    </Text>
                  ) : null}
                  {crosshairTempVal.toFixed(0)}°{tempUnit}
                </Text>
              );
            })()}
          </View>
        )}

        <Svg width={W} height={CHART_H}>
          <G x={PAD.left} y={PAD.top}>

            {/* ── Temperature bands (rendered first, behind everything) ── */}
            {hasTempData && tempBands.map((band, i) => {
              const y = syTemp(band.hi);
              const height = syTemp(band.lo) - syTemp(band.hi);
              const clampedY = Math.max(0, y);
              const clampedBot = Math.min(iH, y + height);
              const clampedH = Math.max(0, clampedBot - clampedY);
              if (clampedH <= 0) return null;
              return (
                <Rect
                  key={i}
                  x={0}
                  y={clampedY}
                  width={iW}
                  height={clampedH}
                  fill={band.color}
                />
              );
            })}

            {/* Horizontal grid lines + left y-axis pH labels */}
            {yTicks.map((v, i) => (
              <G key={i}>
                <Line
                  x1={0} y1={sy(v)} x2={iW} y2={sy(v)}
                  stroke={colors.border} strokeWidth={1} opacity={0.5}
                />
                <SvgText
                  x={-6} y={sy(v) + 4} textAnchor="end"
                  fontSize={9} fill={colors.mutedForeground}
                >
                  {v.toFixed(1)}
                </SvgText>
              </G>
            ))}

            {/* Right y-axis temperature labels */}
            {hasTempData && tempTicks.map((v, i) => (
              <SvgText
                key={i}
                x={iW + 6}
                y={syTemp(v) + 4}
                textAnchor="start"
                fontSize={9}
                fill={colors.tempLine}
                opacity={0.8}
              >
                {Math.round(v)}°
              </SvgText>
            ))}

            {/* X-axis time labels */}
            {xTicks.map((v, i) => (
              <SvgText
                key={i} x={sx(v)} y={iH + 20}
                textAnchor="middle" fontSize={9} fill={colors.mutedForeground}
              >
                {fmtX(v)}
              </SvgText>
            ))}

            {/* All-time average.
                Normal mode: walnut dashed line (toggled on).
                Isolate mode: thin connector + open circles in muted grey —
                  visually distinct from the solid terracotta session lines. */}
            {isolateMode && aPts.length >= 2 && (
              isolateMode ? (
                <G>
                  {/* Faint connector */}
                  <Path
                    d={toPath(aPts, xMax, yMin, yMax, iW, iH)}
                    stroke={colors.mutedForeground} strokeWidth={1}
                    fill="none" opacity={0.3}
                  />
                  {/* Open circles at each point */}
                  {aPts.map(([x, y], i) => (
                    <Circle
                      key={i}
                      cx={sx(x)} cy={sy(y)}
                      r={3} fill="none"
                      stroke={colors.mutedForeground} strokeWidth={1.5}
                      opacity={0.65}
                    />
                  ))}
                </G>
              ) : (
                <Path
                  d={toPath(aPts, xMax, yMin, yMax, iW, iH)}
                  stroke={colors.primary} strokeWidth={1.5}
                  strokeDasharray="5 3" fill="none" opacity={0.5}
                />
              )
            )}

            {/* Isolate mode: individual solid lines per filtered session */}
            {isolateMode &&
              isolatedLinePts.map((pts, i) => (
                <Path
                  key={i}
                  d={toPath(pts, xMax, yMin, yMax, iW, iH)}
                  stroke={colors.accent} strokeWidth={2}
                  fill="none" opacity={0.45}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              ))}

            {/* Normal mode: current session solid terracotta pH line */}
            {!isolateMode && curPts.length >= 2 && (
              <Path
                d={toPath(curPts, xMax, yMin, yMax, iW, iH)}
                stroke={colors.accent} strokeWidth={2.5}
                fill="none" strokeLinecap="round" strokeLinejoin="round"
              />
            )}

            {/* Temperature line overlay (right y-axis scale) */}
            {!isolateMode && hasTempData && tempLinePts.length >= 2 && (
              <Path
                d={toPath(tempLinePts, xMax, tempMin, tempMax, iW, iH)}
                stroke={colors.tempLine} strokeWidth={1.5}
                fill="none" strokeLinecap="round" strokeLinejoin="round"
                opacity={0.7}
              />
            )}

            {/* Normal mode: dumbbell markers for each reading
                - Both pH + temp: connector line + open pH circle + filled temp circle
                - pH only: open circle at pH position (terracotta)
                - Temp only: filled circle at temp position (blue-grey)            */}
            {!isolateMode && session && (
              <G>
                {/* initialPH at t=0 — no temp pairing; open circle if any temp data exists */}
                {session.initialPH && !isNaN(parseFloat(session.initialPH)) && (
                  <Circle
                    cx={sx(0)}
                    cy={sy(parseFloat(session.initialPH))}
                    r={3.5}
                    fill={hasTempData ? "none" : colors.accent}
                    stroke={hasTempData ? colors.accent : "none"}
                    strokeWidth={hasTempData ? 1.5 : 0}
                  />
                )}

                {/* Per-reading markers */}
                {(session.readings ?? []).map((r, i) => {
                  const elapsedMin = (r.loggedAt - session.savedAt) / 60000;
                  const pHVal = parseFloat(r.pH);
                  const tempVal = tempByElapsed.get(elapsedMin) ?? NaN;
                  const hasPH = !isNaN(pHVal);
                  const hasTemp = !isNaN(tempVal) && hasTempData;
                  const pHy = hasPH ? sy(pHVal) : null;
                  const ty = hasTemp ? syTemp(tempVal) : null;
                  const xPos = sx(elapsedMin);

                  return (
                    <G key={i}>
                      {/* Vertical connector when both values present */}
                      {hasPH && hasTemp && pHy !== null && ty !== null && (
                        <Line
                          x1={xPos} y1={pHy}
                          x2={xPos} y2={ty}
                          stroke={colors.tempLine} strokeWidth={1} opacity={0.5}
                        />
                      )}
                      {/* pH marker: open when temp present, filled terracotta when pH-only */}
                      {hasPH && pHy !== null && (
                        <Circle
                          cx={xPos} cy={pHy} r={3.5}
                          fill={hasTemp ? "none" : colors.accent}
                          stroke={hasTemp ? colors.tempLine : "none"}
                          strokeWidth={hasTemp ? 1.5 : 0}
                        />
                      )}
                      {/* Temp marker: filled blue-grey circle */}
                      {hasTemp && ty !== null && (
                        <Circle
                          cx={xPos} cy={ty} r={3}
                          fill={colors.tempLine}
                        />
                      )}
                    </G>
                  );
                })}
              </G>
            )}

            {/* Placeholder when no data */}
            {!isolateMode && curPts.length === 0 && (
              <SvgText
                x={iW / 2} y={iH / 2 + 4}
                textAnchor="middle" fontSize={12}
                fill={colors.mutedForeground} opacity={0.45}
              >
                No readings yet
              </SvgText>
            )}
            {isolateMode && isolatedLinePts.length === 0 && (
              <SvgText
                x={iW / 2} y={iH / 2 + 4}
                textAnchor="middle" fontSize={12}
                fill={colors.mutedForeground} opacity={0.45}
              >
                No sessions yet
              </SvgText>
            )}

            {/* Crosshair vertical line + dot on current curve */}
            {crosshairInnerX !== null && crosshairDataX !== null && (
              <G>
                <Line
                  x1={crosshairInnerX} y1={0}
                  x2={crosshairInnerX} y2={iH}
                  stroke={colors.foreground} strokeWidth={1}
                  opacity={0.2} strokeDasharray="2 2"
                />
                {crosshairCurY !== null && (
                  <Circle
                    cx={crosshairInnerX} cy={sy(crosshairCurY)}
                    r={4} fill={colors.accent}
                  />
                )}
                {crosshairTempVal !== null && (
                  <Circle
                    cx={crosshairInnerX} cy={syTemp(crosshairTempVal)}
                    r={3} fill={colors.tempLine}
                  />
                )}
              </G>
            )}
          </G>
        </Svg>

        {/* Legend */}
        <View style={s.legend}>
          {isolateMode ? (
            <>
              <View style={s.li}>
                <View style={[s.solidStroke, { backgroundColor: colors.accent, opacity: 0.55 }]} />
                <Text style={[s.lt, { color: colors.mutedForeground }]}>
                  {filteredLabel ?? "Filtered sessions"}
                </Text>
              </View>
              <View style={s.li}>
                <View style={[s.openCircle, { borderColor: colors.mutedForeground }]} />
                <Text style={[s.lt, { color: colors.mutedForeground }]}>All-time avg</Text>
              </View>
            </>
          ) : (
            <>
              <View style={s.li}>
                {hasTempData ? (
                  <View style={[s.openCircle, { borderColor: colors.accent }]} />
                ) : (
                  <View style={[s.dot, { backgroundColor: colors.accent }]} />
                )}
                <Text style={[s.lt, { color: colors.mutedForeground }]}>This refresh</Text>
              </View>
              {hasTempData && (
                <View style={s.li}>
                  <View style={[s.dot, { backgroundColor: colors.tempLine }]} />
                  <Text style={[s.lt, { color: colors.mutedForeground }]}>
                    Temp (°{tempUnit})
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  box: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  tooltip: {
    position: "absolute",
    zIndex: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 72,
  },
  tooltipTime: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  tooltipPH: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  tooltipTemp: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
  },
  li: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dash: { width: 14, height: 2, borderRadius: 1 },
  solidStroke: { width: 14, height: 2.5, borderRadius: 1 },
  openCircle: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, backgroundColor: "transparent" },
  lt: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
