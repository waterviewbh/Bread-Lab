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
 * Parses unstructured ingredient text lines to calculate inoculation percentage.
 * Matches keywords for flours, starters, and yeast types.
 */
export function calculateInoculationFromText(ingredientsText: string): number {
  const lines = ingredientsText.toLowerCase().split("\n");

  let totalFlourG = 0;
  let starterG = 0;
  let yeastG = 0;
  let yeastType: "instant" | "dry" | "unknown" = "unknown";

  // Captures numeric weights (e.g., "500", "125.5") followed by weight units
  const weightRegex = /(\d+(?:\.\d+)?)\s*(?:g|gram|grams|kg)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(weightRegex);
    if (!match) continue;

    let weight = parseFloat(match[1]);
    if (trimmed.includes("kg")) weight *= 1000; // Normalize kg to grams

    // 1. Identify Flour Lines
    if (trimmed.includes("flour")) {
      totalFlourG += weight;
    }
    // 2. Identify Starter / Levain Lines
    else if (trimmed.includes("starter") || trimmed.includes("levain")) {
      starterG += weight;
    }
    // 3. Identify Yeast Lines
    else if (trimmed.includes("yeast")) {
      yeastG += weight;
      if (trimmed.includes("instant") || trimmed.includes("saf")) {
        yeastType = "instant";
      } else if (trimmed.includes("dry") || trimmed.includes("active")) {
        yeastType = "dry";
      }
    }
  }

  // 3c. Convert Yeast Equivalents to Sourdough Starter weight
  let convertedYeastToStarterG = 0;
  if (yeastG > 0) {
    if (yeastType === "instant") {
      convertedYeastToStarterG = yeastG * 28.5;  // 1 g instant yeast = 28.5 g starter equiv
    } else {
      // 1g Active Dry = 22.8g Starter equivalent
      convertedYeastToStarterG = yeastG * 22.8;  // 1 g dry yeast = 22.8 g starter equiv
    }
  }

  const totalEffectiveStarterG = starterG + convertedYeastToStarterG;

  // 4 & 5. Compute Baker's Inoculation Percentage
  if (totalFlourG <= 0) return 20; // Safe default inoculation percentage
  return (totalEffectiveStarterG / totalFlourG) * 100;
}

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
  // Compute and store the active inoculation percentage
  const inoculationPercent = estimateInoculationPercent(allRecipePhases);
  state.activeInoculationPercent = inoculationPercent;

// Filter and isolate readings containing valid, numeric volumetric entries
// Correct — uses the numeric volume_ml field from BulkFermentReading
const volReadings = readings
  .filter((r): r is BulkFermentReading & { volume_ml: number } =>
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
  const currentVol = volReadings.length > 0 ? volReadings[volReadings.length - 1].volume_ml : startVol;
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
            velocity = curr.postIntervention && dVol < 0 ? 0 : Math.max(dVol / dt, BULK_NEGATIVE_DERIVATIVE_CAP);
          }
        }
      }

    // ── 5. Projection (Using Doughlab data) ─────────────────────────────────────────────
    const remaining = state.targetVolume_ml - currentVol;
    if (remaining > 0) {
      const firstReading = hasManualVol && phaseStartedAt ? { volume_ml: manualVol, loggedAt: phaseStartedAt } : volReadings[0];
      const lastReading = volReadings.length > 0 ? volReadings[volReadings.length - 1] : firstReading;

      // A. Look up biological prior duration from the Doughlab matrix
      if (firstReading && lastReading) {
        const elapsedMs = lastReading.loggedAt - firstReading.loggedAt;
        const totalExpectedDurationMs = lookupExpectedDuration(currentTempF, inoculationPercent);
        const baselineVelocity = (state.targetVolume_ml - startVol) / totalExpectedDurationMs;

        // B. Blend calculations using a dynamic time-weighted complementary model
        let blendedVelocity = baselineVelocity;
        if (velocity !== null && velocity > 0) {
          const alpha = Math.min(1, elapsedMs / totalExpectedDurationMs);
          blendedVelocity = alpha * velocity + (1 - alpha) * baselineVelocity;
        }

        // C. Extrapolate final baseline timeline parameters
        if (blendedVelocity > 0) {
          state.projectedTargetAt = lastReading.loggedAt + (remaining / blendedVelocity);
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


  /* Filter to readings that actually have a numeric volume_ml   // this Claude code was replaced
  const volReadings = readings.filter(                           // by Gemini in 1.0.14-candidate
    (r): r is BulkFermentReading & { volume_ml: number } =>      // remove in 3 after function is
      typeof r.volume_ml === "number" && isFinite(r.volume_ml)   // released to Play Store
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
} */