// Shared pH chart computation helpers.
// Used by both PHChart (for local fallback), api.ts (for Supabase analytics updates),
// and the Acidification/Lifting Index longitudinal charts.

export interface SessionForAnalytics {
  savedAt: number;
  readings?: { pH: string; loggedAt: number }[];
  initialPH?: string;
}

export interface StarterAnalytics {
  deviceId: string;
  updatedAt: number;
  vitalitySessions: number;
  vitalityXMax: number;
  vitalityPoints: [number, number][];
  allTimeSessions: number;
  allTimeXMax: number;
  allTimePoints: [number, number][];
}

/** Number of evenly-spaced sample points stored per curve. */
const SAMPLE_COUNT = 13;

/** Convert a session into sorted [minutes-since-feed, pH] pairs. */
export function sessionPoints(s: SessionForAnalytics): [number, number][] {
  const pts: [number, number][] = (s.readings ?? [])
    .map((r): [number, number] => [(r.loggedAt - s.savedAt) / 60000, parseFloat(r.pH)])
    .filter(([, y]) => !isNaN(y))
    .sort(([a], [b]) => a - b);
  if (s.initialPH) {
    const initPH = parseFloat(s.initialPH);
    if (!isNaN(initPH)) return [[0, initPH], ...pts];
  }
  return pts;
}

/** Linearly interpolate y at position x within a sorted point list. */
export function lerp(pts: [number, number][], x: number): number | null {
  if (!pts.length) return null;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}

/** Build a mean-pH line across multiple sessions sampled at the given x positions. */
export function avgLine(
  sessions: SessionForAnalytics[],
  xs: number[]
): [number, number][] {
  const ptSets = sessions.map(sessionPoints).filter((p) => p.length >= 2);
  if (!ptSets.length) return [];
  const result: [number, number][] = [];
  for (const x of xs) {
    const ys = ptSets
      .map((p) => lerp(p, x))
      .filter((v): v is number => v !== null);
    if (ys.length) result.push([x, ys.reduce((a, b) => a + b, 0) / ys.length]);
  }
  return result;
}

/** Build evenly-spaced sample x-values up to xMax. */
export function sampleXs(xMax: number): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, i) =>
    (xMax / (SAMPLE_COUNT - 1)) * i
  );
}

/**
 * Compute the vitality analytics from the last ≤5 qualifying sessions.
 * Called after a new session is saved before upserting to starter_analytics.
 */
export function computeVitalityAnalytics(
  last5: SessionForAnalytics[]
): Pick<
  StarterAnalytics,
  "vitalitySessions" | "vitalityXMax" | "vitalityPoints"
> {
  const qualifying = last5
    .filter((s) => sessionPoints(s).length >= 2)
    .slice(0, 5);
  const allPts = qualifying.flatMap(sessionPoints);
  const xMax = allPts.length
    ? Math.max(...allPts.map(([x]) => x), 60)
    : 120;
  return {
    vitalitySessions: qualifying.length,
    vitalityXMax: xMax,
    vitalityPoints: avgLine(qualifying, sampleXs(xMax)),
  };
}

/**
 * Apply an incremental running-average update to the all-time analytics.
 * Formula: newAvg[x] = (oldAvg[x] * n + newY[x]) / (n + 1)
 * No full history fetch needed — only the single new session is required.
 */
export function updateAllTimeAnalytics(
  current: Pick<
    StarterAnalytics,
    "allTimeSessions" | "allTimeXMax" | "allTimePoints"
  >,
  newSession: SessionForAnalytics
): Pick<
  StarterAnalytics,
  "allTimeSessions" | "allTimeXMax" | "allTimePoints"
> {
  const newPts = sessionPoints(newSession);
  if (newPts.length < 2) return current;

  const n = current.allTimeSessions;
  const newN = n + 1;
  const lastX = newPts[newPts.length - 1][0];
  const newXMax = Math.max(current.allTimeXMax, lastX, 60);
  const xs = sampleXs(newXMax);

  const newPoints: [number, number][] = xs.map((x) => {
    const oldY =
      current.allTimePoints.length ? lerp(current.allTimePoints, x) : null;
    const newY = lerp(newPts, x);
    if (newY === null) return [x, oldY ?? 0] as [number, number];
    if (oldY === null || n === 0) return [x, newY] as [number, number];
    return [x, (oldY * n + newY) / newN] as [number, number];
  });

  return {
    allTimeSessions: newN,
    allTimeXMax: newXMax,
    allTimePoints: newPoints,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Longitudinal series helpers (Graph tab — Acidification + Lifting Index)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape of a history entry required for the two new series. */
export interface HistoryEntryForSeries {
  savedAt: number;
  initialPH?: string;
  readings?: { pH: string; loggedAt: number }[];
  peak?: { pH: string; timeToPeakMs: number; volumeIncreasePct: number };
  sugarWeight?: number;
  wwPercent?: number;
}

export type StarterType = "standard" | "sugar" | "ww";

export interface AcidificationPoint {
  feedNum: number;
  pHVelocity: number;
}

export interface LiftingPoint {
  feedNum: number;
  timeToPeakHrs: number;
  peakRisePct: number;
  starterType: StarterType;
}

/**
 * Minimal shape required by `computeSessionAcidVelocity`.
 * Compatible with both `HistoryEntry` (history screen) and `HistoryEntryForSeries`.
 */
export interface SessionForAcidVelocity {
  savedAt: number;
  initialPH?: string;
  readings?: { pH: string; loggedAt: number }[];
  peak?: { pH: string; timeToPeakMs: number };
}

/**
 * Compute ΔpH/hr (acidification velocity) for a single feed session.
 * Returns null when the session lacks sufficient data (needs initialPH + ≥1 reading,
 * or ≥2 readings, or a peak).
 * Positive value = acidifying (pH dropped over time).
 */
export function computeSessionAcidVelocity(
  s: SessionForAcidVelocity
): number | null {
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
  if (s.peak) {
    const v = parseFloat(s.peak.pH);
    if (!isNaN(v)) {
      endPH = v;
      endTime = s.savedAt + s.peak.timeToPeakMs;
    }
  }
  if (endPH === null && readings.length > 0) {
    const last = readings[readings.length - 1];
    const isDistinct = !isNaN(initV) || readings.length >= 2;
    if (isDistinct) {
      endPH = last.pH;
      endTime = last.loggedAt;
    }
  }

  if (startPH === null || endPH === null || endTime === null) return null;
  const elapsedHrs = (endTime - startTime) / 3_600_000;
  if (elapsedHrs <= 0) return null;
  return (startPH - endPH) / elapsedHrs;
}

/**
 * One point per qualifying feed session in chronological order.
 * pHVelocity = (startPH − endPH) / elapsedHours  [positive = acidifying]
 * feedNum counts every session including skipped ones, so the x-axis
 * position reflects the true chronological position in the user's history.
 */
export function computeAcidificationSeries(
  sessions: HistoryEntryForSeries[]
): AcidificationPoint[] {
  const sorted = [...sessions].sort((a, b) => a.savedAt - b.savedAt);
  const result: AcidificationPoint[] = [];
  let feedNum = 1;

  for (const s of sorted) {
    const readings = (s.readings ?? [])
      .map((r) => ({ pH: parseFloat(r.pH), loggedAt: r.loggedAt }))
      .filter((r) => !isNaN(r.pH))
      .sort((a, b) => a.loggedAt - b.loggedAt);

    // Determine start point
    let startPH: number | null = null;
    let startTime = s.savedAt;
    const initV = s.initialPH !== undefined ? parseFloat(s.initialPH) : NaN;
    if (!isNaN(initV)) {
      startPH = initV;
      // startTime stays at savedAt
    } else if (readings.length > 0) {
      startPH = readings[0].pH;
      startTime = readings[0].loggedAt;
    }

    // Determine end point (peak or last reading)
    let endPH: number | null = null;
    let endTime: number | null = null;
    if (s.peak) {
      const v = parseFloat(s.peak.pH);
      if (!isNaN(v)) {
        endPH = v;
        endTime = s.savedAt + s.peak.timeToPeakMs;
      }
    }
    if (endPH === null && readings.length > 0) {
      const last = readings[readings.length - 1];
      // Must be a different point than startPH (at least 2 total data points)
      const isDistinct = !isNaN(initV) || readings.length >= 2;
      if (isDistinct) {
        endPH = last.pH;
        endTime = last.loggedAt;
      }
    }

    if (startPH === null || endPH === null || endTime === null) {
      feedNum++;
      continue;
    }
    const elapsedHrs = (endTime - startTime) / 3_600_000;
    if (elapsedHrs <= 0) {
      feedNum++;
      continue;
    }

    result.push({ feedNum, pHVelocity: (startPH - endPH) / elapsedHrs });
    feedNum++;
  }

  return result;
}

/**
 * One point per feed session where a peak was logged, in chronological order.
 * feedNum counts every session (including those without a peak) so position
 * reflects true chronological order in history.
 */
export function computeLiftingSeries(
  sessions: HistoryEntryForSeries[]
): LiftingPoint[] {
  const sorted = [...sessions].sort((a, b) => a.savedAt - b.savedAt);
  const result: LiftingPoint[] = [];
  let feedNum = 1;

  for (const s of sorted) {
    if (s.peak) {
      const timeToPeakHrs = s.peak.timeToPeakMs / 3_600_000;
      const peakRisePct = s.peak.volumeIncreasePct;
      const starterType: StarterType =
        (s.sugarWeight ?? 0) > 0
          ? "sugar"
          : (s.wwPercent ?? 0) >= 50
          ? "ww"
          : "standard";
      result.push({ feedNum, timeToPeakHrs, peakRisePct, starterType });
    }
    feedNum++;
  }

  return result;
}
