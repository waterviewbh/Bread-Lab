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
  DOUGHLAB_PRIOR_TABLE,
} from "@/lib/recipeTypes";
import { calculateRecipeMetrics } from "./recipeUtils";

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

/**
 * Scan vertically by temperature, then horizontally by inoculation percentage
 * to get the total estimated bulk baseline duration in milliseconds.
 * Source: Doughlab Sourdough Bulk Fermentation Chart dough-lab.com (2026).
 */
export function lookupExpectedDuration(
  doughTempF: number,
  inoculationPercent: 10 | 20 | 30 = 20
): number {
  for (const row of DOUGHLAB_PRIOR_TABLE) {
    if (doughTempF <= row.maxTempF) {
      const expectedHours = row.hoursByInoculation[inoculationPercent];
      return expectedHours * 3600 * 1000; // Convert hours to ms
    }
  }
  // Fallback to warmest row (85°F+) if dough temp is above all steps
  const warmestRow = DOUGHLAB_PRIOR_TABLE[DOUGHLAB_PRIOR_TABLE.length - 1];
  return warmestRow.hoursByInoculation[inoculationPercent] * 3600 * 1000;
}

// ─── Helpers (lib/bulkFermentEngine.ts) ────────────────────────────────────────

/**
 * Resolves the inoculation percentage using the unified parser and maps it
 * to a discrete Doughlab chart matrix column bucket (10%, 20%, or 30%).
 */
export function estimateInoculationPercent(phases: { ingredients: any }[] = []): 10 | 20 | 30 {
  const { inoculationPct } = calculateRecipeMetrics(phases);

  if (inoculationPct <= 15) return 10;
  if (inoculationPct >= 25) return 30;
  return 20;  // 16% to 24% maps safely to the 20% baseline
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
  existing: BulkFermentState,
  allRecipePhases: { ingredients: any }[] = [],
  phaseStartedAt?: number | null,
  manualStartVolume?: string
): BulkFermentState {
  // Work with a shallow copy — we never mutate the caller's state
  const state: BulkFermentState = { ...existing };

  // Compute metrics using the unified Smart Hydration Engine
  const { inoculationPct, hydrationPct } = calculateRecipeMetrics(allRecipePhases);

  // 1. Bucket Inoculation (10%, 20%, 30%) for matrix lookup
  const inoculationBucket: 10 | 20 | 30 =
    inoculationPct <= 15 ? 10 : inoculationPct >= 25 ? 30 : 20;
  state.activeInoculationPercent = inoculationBucket;

  // Filter and isolate readings containing valid, numeric volumetric entries
  const volReadings = readings
    .filter(
      (r): r is BulkFermentReading & { volume_ml: number } =>
        typeof r.volume_ml === "number" && isFinite(r.volume_ml)
    )
    .sort((a, b) => a.loggedAt - b.loggedAt);

  const manualVol = manualStartVolume ? parseFloat(manualStartVolume) : NaN;
  const hasManualVol = !isNaN(manualVol) && manualVol > 0;

  if (!volReadings.length && !hasManualVol) return state;

  // ── 1. Establish Baseline Volume ────────────────────────────────────────
  if (hasManualVol) {
    state.startVolume_ml = manualVol;
  } else if (volReadings.length > 0) {
    state.startVolume_ml = volReadings[0].volume_ml;
  }
  const startVol = state.startVolume_ml || 0;

  // ── 2. Track Current Volume incl. Damping From Folds, etc. ────────────────
  const currentVol =
    volReadings.length > 0 ? volReadings[volReadings.length - 1].volume_ml : startVol;
  state.maxVolume_ml = Math.max(state.maxVolume_ml || 0, currentVol);

  // ── 3. Resolve Temperature & Target Rise ──────────────────────────────────
  const lastWithTemp = [...readings].reverse().find((r) => typeof r.doughTemp === "number");
  let currentTempF = lastWithTemp?.doughTemp ? toF(lastWithTemp.doughTemp, lastWithTemp.tempUnit) : 76;

  // ── 3. Calculate Target Rise ───────────────────────────────────────────────
  const targetFraction = lookupTargetFraction(currentTempF);
  state.targetVolume_ml = startVol * (1 + targetFraction);

  // ── 4. Calculate Velocity (Derivative) ────────────────────────────
  let velocity: number | null = null;
  if (volReadings.length > 0) {
    const curr = volReadings[volReadings.length - 1];
    let prev: { volume_ml: number; loggedAt: number } | null = null;

    // Synthesize reading at t=0 if we have a manual start volume
    if (hasManualVol && phaseStartedAt && curr.loggedAt > phaseStartedAt) {
      prev = { volume_ml: manualVol, loggedAt: phaseStartedAt };
    } else if (volReadings.length >= 2) {
      prev = volReadings[volReadings.length - 2];
    }

    if (prev) {
      const dt = curr.loggedAt - prev.loggedAt;
      if (dt >= BULK_MIN_DERIVATIVE_GAP_MS) {
        const dVol = curr.volume_ml - prev.volume_ml;
        // Including Velocity=0 due to recent fold (while it recovers)
        velocity =
          curr.postIntervention && dVol < 0 ? 0 : Math.max(dVol / dt, BULK_NEGATIVE_DERIVATIVE_CAP);
      }
    }
  }

  // ── 5. Projection (Using Doughlab data + Hydration Scaling) ────────────────────────
  const remaining = state.targetVolume_ml - currentVol;
  if (remaining > 0) {
    const firstReading =
      hasManualVol && phaseStartedAt
        ? { volume_ml: manualVol, loggedAt: phaseStartedAt }
        : volReadings[0];
    const lastReading = volReadings.length > 0 ? volReadings[volReadings.length - 1] : firstReading;

    if (firstReading && lastReading) {
      const elapsedMs = lastReading.loggedAt - firstReading.loggedAt;

      // A. Look up biological prior duration from the Doughlab matrix
      let totalExpectedDurationMs = lookupExpectedDuration(currentTempF, inoculationBucket);

      // B. Apply Hydration Scaling Factor
      // Heuristic: -1.5% duration per 1% hydration above 70%
      if (hydrationPct > 70) {
        const hydrationBonus = (hydrationPct - 70) * 0.015;
        const multiplier = Math.max(0.5, 1 - hydrationBonus); // Cap at 50% reduction
        totalExpectedDurationMs *= multiplier;
      }

      const baselineVelocity = (state.targetVolume_ml - startVol) / totalExpectedDurationMs;

      // C. Blend calculations using a dynamic time-weighted complementary model
      let blendedVelocity = baselineVelocity;
      if (velocity !== null && velocity > 0) {
        const alpha = Math.min(1, elapsedMs / totalExpectedDurationMs);
        blendedVelocity = alpha * velocity + (1 - alpha) * baselineVelocity;
      }

      // D. Extrapolate final baseline timeline parameters
      if (blendedVelocity > 0) {
        state.projectedTargetAt = lastReading.loggedAt + remaining / blendedVelocity;
      }
    }
  } else {
    state.projectedTargetAt = null;
  }

  // ── 6. Target Reached Check ──────────────────────────────────────────────────
  if (!state.targetReachedAt && currentVol >= state.targetVolume_ml && volReadings.length > 0) {
    state.targetReachedAt = volReadings[volReadings.length - 1].loggedAt;
    state.inOvertime = true;
    state.projectedTargetAt = null;
  }

  return state;
}
