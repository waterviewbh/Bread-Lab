// lib/bulkFermentEngine.ts
// ─── Proportional-Derivative engine for Bulk Ferment volume tracking ──────────
// Pure TypeScript — no React, no UI. Called from recipe.tsx after each
// BulkFermentReading is saved. Returns an updated BulkFermentState for
// persistence. Never mutates inputs.
import {
  type BulkFermentReading,
  type BulkFermentState,
  BULK_TEMP_RISE_TABLE,
  BULK_MIN_DERIVATIVE_GAP_MS,
  BULK_NEGATIVE_DERIVATIVE_CAP,
} from "@/lib/recipeTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Celsius to Fahrenheit. */
function toF(temp: number, unit: "F" | "C"): number {
  return unit === "C" ? temp * 9 / 5 + 32 : temp;
}

/**
 * Look up the target rise fraction from the temp table.
 * Returns the fraction for the first row where doughTempF <= maxTempF.
 * Falls back to the warmest entry if the temp is above all thresholds.
 */
export function lookupTargetFraction(doughTempF: number): number {
  for (const row of BULK_TEMP_RISE_TABLE) {
    if (doughTempF <= row.maxTempF) return row.targetFraction;
  }
  // Above the highest threshold — use the warmest (lowest) target fraction
  return BULK_TEMP_RISE_TABLE[BULK_TEMP_RISE_TABLE.length - 1].targetFraction;
}

// ─── Main engine function ─────────────────────────────────────────────────────

/**
 * Recompute BulkFermentState from the full reading list.
 *
 * Rules:
 *  1. The first reading with a volume_ml establishes startVolume_ml.
 *  2. The first reading with a doughTemp resolves targetRiseFraction.
 *  3. Derivative (velocity) is only trusted when two consecutive volume
 *     readings are separated by >= BULK_MIN_DERIVATIVE_GAP_MS.
 *  4. Negative derivative swings are capped at BULK_NEGATIVE_DERIVATIVE_CAP
 *     (or zeroed out when postIntervention === true on the later reading).
 *  5. projectedTargetAt is set once velocity > 0 and target > currentVolume.
 *  6. targetReachedAt is set (and never overwritten) when currentVolume
 *     first crosses targetVolume_ml.
 *  7. inOvertime becomes true after targetReachedAt is set and the baker
 *     has not yet confirmed Complete.
 */
export function computeBulkFermentState(
  readings: BulkFermentReading[],
  existing: BulkFermentState
): BulkFermentState {
  // Work with a shallow copy — we never mutate the caller's state
  const state: BulkFermentState = { ...existing };
  // Filter to readings that actually have a numeric volume_ml
  const volReadings = readings.filter(
    (r): r is BulkFermentReading & { volume_ml: number } =>
      typeof r.volume_ml === "number" && isFinite(r.volume_ml)
  );

  // ── 1. Baseline volume ───────────────────────────────────────────────────
  if (volReadings.length > 0 && !state.startVolume_ml) {
    // Only set the baseline once; never overwrite it
    state.startVolume_ml = volReadings[0].volume_ml;
  }
  if (!state.startVolume_ml) {
    // Not enough data yet — bail out with what we have
    return state;
  }
  // ── 2. Target rise fraction from the first dough-temp reading ────────────
  if (!state.targetRiseFraction) {
    const firstWithTemp = readings.find(
      (r) => typeof r.doughTemp === "number" && isFinite(r.doughTemp)
    );
    if (firstWithTemp && typeof firstWithTemp.doughTemp === "number") {
      const doughTempF = toF(firstWithTemp.doughTemp, firstWithTemp.tempUnit);
      state.targetRiseFraction = lookupTargetFraction(doughTempF);
    } else {
      // No dough temp logged yet — use the mid-range default (76°F row)
      state.targetRiseFraction = lookupTargetFraction(76);
    }
  }
  // ── 3. Absolute target volume ────────────────────────────────────────────
  state.targetVolume_ml =
    state.startVolume_ml * (1 + state.targetRiseFraction);
  // ── 4. Current volume (latest reading) ──────────────────────────────────
  const currentVol = volReadings[volReadings.length - 1].volume_ml;
  // ── 5. Velocity (derivative) — requires at least 2 volume readings ───────
  let velocity: number | null = null;
    // ml/ms
    if (volReadings.length >= 2) {
    const prev = volReadings[volReadings.length - 2];
    const curr = volReadings[volReadings.length - 1];
    const dt = curr.loggedAt - prev.loggedAt;
    if (dt >= BULK_MIN_DERIVATIVE_GAP_MS) {
      const dVol = curr.volume_ml - prev.volume_ml;
      let raw = dVol / dt;
      // If the baker flagged a structural intervention, damp negative swing to 0
      if (curr.postIntervention && raw < 0) {
        raw = 0;
      } else if (raw < BULK_NEGATIVE_DERIVATIVE_CAP) {
        // Hard floor: do not allow steeper-than-cap negative derivatives
        raw = BULK_NEGATIVE_DERIVATIVE_CAP;
      }
      velocity = raw;
    }
    // else: gap too short — derivative not trusted, leave velocity null
  }
  // ── 6. Projection ─────────────────────────────────────────────────────────
  const remaining = state.targetVolume_ml - currentVol;
  if (velocity !== null && velocity > 0 && remaining > 0) {
    // Time in ms until we hit target at the current velocity
    const msToTarget = remaining / velocity;
    const lastLoggedAt = volReadings[volReadings.length - 1].loggedAt;
    state.projectedTargetAt = lastLoggedAt + msToTarget;
  } else if (remaining <= 0) {
    // We've already crossed the target
    state.projectedTargetAt = null;
  }
  // else: velocity is null or zero — leave any existing projection in place
  // ── 7. Target reached detection ──────────────────────────────────────────
  if (!state.targetReachedAt && currentVol >= state.targetVolume_ml) {
    // Stamp the loggedAt of the reading that first crossed the target
    state.targetReachedAt =
      volReadings[volReadings.length - 1].loggedAt;
    state.inOvertime = true;
    state.projectedTargetAt = null; // Countdown is done
  }
  return state;
}