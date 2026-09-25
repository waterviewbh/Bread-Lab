// lib/bulkFermentEngine.ts
// ─── PD-Informed State Estimator for Bulk Ferment volume tracking ──────────
// Pure TypeScript — no React, no UI. Called from recipe.tsx after each
// BulkFermentReading is saved. Returns an updated BulkFermentState for
// persistence. Never mutates inputs.

import {
  type BulkFermentReading,
  type BulkFermentState,
  type BulkEstimatorState,
  BULK_TEMP_RISE_TABLE,
  BULK_MIN_DERIVATIVE_GAP_MS,
  BULK_NEGATIVE_DERIVATIVE_CAP,
  DOUGHLAB_PRIOR_TABLE,
} from "@/lib/recipeTypes";
import { calculateRecipeMetrics } from "./recipeUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Celsius to Fahrenheit. */
export function toF(temp: number, unit: "F" | "C"): number {
  return unit === "C" ? (temp * 9) / 5 + 32 : temp;
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
  return BULK_TEMP_RISE_TABLE[BULK_TEMP_RISE_TABLE.length - 1].targetFraction;
}

/**
 * Scan vertically by temperature, then horizontally by inoculation percentage
 * to get the total estimated bulk baseline duration in milliseconds.
 */
export function lookupExpectedDuration(
  doughTempF: number,
  inoculationPercent: 10 | 20 | 30 = 20
): number {
  for (const row of DOUGHLAB_PRIOR_TABLE) {
    if (doughTempF <= row.maxTempF) {
      const expectedHours = row.hoursByInoculation[inoculationPercent];
      return expectedHours * 3600 * 1000;
    }
  }
  const warmestRow = DOUGHLAB_PRIOR_TABLE[DOUGHLAB_PRIOR_TABLE.length - 1];
  return warmestRow.hoursByInoculation[inoculationPercent] * 3600 * 1000;
}

/**
 * Perform bilinear interpolation across the DOUGHLAB_PRIOR_TABLE matrix.
 * Returns expected baseline duration in milliseconds.
 */
export function interpolateExpectedDuration(
  doughTempF: number,
  inoculationPct: number
): number {
  const rows = [...DOUGHLAB_PRIOR_TABLE].sort((a, b) => a.maxTempF - b.maxTempF);
  const clampedInoc = Math.max(10, Math.min(30, inoculationPct));

  let rowA = rows[0];
  let rowB = rows[rows.length - 1];

  if (doughTempF <= rowA.maxTempF) {
    rowB = rowA;
  } else if (doughTempF >= rowB.maxTempF) {
    rowA = rowB;
  } else {
    for (let i = 0; i < rows.length - 1; i++) {
      if (doughTempF >= rows[i].maxTempF && doughTempF <= rows[i + 1].maxTempF) {
        rowA = rows[i];
        rowB = rows[i + 1];
        break;
      }
    }
  }

  let inocA = 10;
  let inocB = 20;
  if (clampedInoc >= 20) {
    inocA = 20;
    inocB = 30;
  }

  const q11 = rowA.hoursByInoculation[inocA as 10 | 20 | 30];
  const q12 = rowA.hoursByInoculation[inocB as 10 | 20 | 30];
  const q21 = rowB.hoursByInoculation[inocA as 10 | 20 | 30];
  const q22 = rowB.hoursByInoculation[inocB as 10 | 20 | 30];

  let rowA_val = q11;
  if (inocB !== inocA) {
    rowA_val = q11 + ((clampedInoc - inocA) / (inocB - inocA)) * (q12 - q11);
  }

  let rowB_val = q21;
  if (inocB !== inocA) {
    rowB_val = q21 + ((clampedInoc - inocA) / (inocB - inocA)) * (q22 - q21);
  }

  let finalHours = rowA_val;
  if (rowB.maxTempF !== rowA.maxTempF) {
    finalHours =
      rowA_val +
      ((doughTempF - rowA.maxTempF) / (rowB.maxTempF - rowA.maxTempF)) *
        (rowB_val - rowA_val);
  }

  return finalHours * 3600 * 1000;
}

/** Backwards-compatible baseline predictor wrapper. */
export function predictRemainingBaselineDuration(
  currentTempF: number,
  ambientTempF: number | null,
  inoculationPct: number,
  hydrationPct: number,
  saltPct: number,
  enriched: boolean,
  startVolume: number,
  targetVolume: number,
  currentVolume: number
): number {
  const volumeFractionRemaining =
    (targetVolume - currentVolume) / (targetVolume - startVolume);
  if (volumeFractionRemaining <= 0) return 0;

  let progressNeeded = volumeFractionRemaining;
  let simulatedTimeMs = 0;
  let tempF = currentTempF;
  const k_per_ms = 0.4 / (3600 * 1000);
  const stepMs = 10 * 60 * 1000;
  const maxSimulationSteps = (48 * 60) / 10;
  let steps = 0;

  while (progressNeeded > 0 && steps < maxSimulationSteps) {
    steps++;
    if (ambientTempF !== null) {
      tempF = ambientTempF + (tempF - ambientTempF) * Math.exp(-k_per_ms * stepMs);
    }

    const baseDurationMs = interpolateExpectedDuration(tempF, inoculationPct);
    const hydrationBonus = Math.min(0.10, Math.max(0, hydrationPct - 70) * 0.008);
    const hydrationMultiplier = Math.max(0.75, 1 - hydrationBonus);
    const saltMultiplier = 1 + (saltPct - 2.0) * 0.10;
    const enrichedMultiplier = enriched ? 1.15 : 1.0;

    const modifiedDurationMs =
      baseDurationMs * hydrationMultiplier * saltMultiplier * enrichedMultiplier;
    const stepProgress = stepMs / modifiedDurationMs;

    if (stepProgress >= progressNeeded) {
      const fractionOfStep = progressNeeded / stepProgress;
      simulatedTimeMs += stepMs * fractionOfStep;
      progressNeeded = 0;
    } else {
      simulatedTimeMs += stepMs;
      progressNeeded -= stepProgress;
    }
  }

  return simulatedTimeMs;
}

export function estimateInoculationPercent(
  phases: { ingredients: any }[] = []
): 10 | 20 | 30 {
  const { inoculationPct } = calculateRecipeMetrics(phases);
  if (inoculationPct <= 15) return 10;
  if (inoculationPct >= 25) return 30;
  return 20;
}

// ─── 8-Layer Estimator Architecture ──────────────────────────────────────────

// Layer 1: Input Normalization & Phase-Start Semantics
export function normalizeReadings(
  readings: BulkFermentReading[],
  phaseStartedAt?: number | null,
  manualStartVolume?: string,
  manualTargetTemp?: string
) {
  const sorted = [...readings]
    .filter((r) => isFinite(r.loggedAt) && r.loggedAt > 0)
    .sort((a, b) => a.loggedAt - b.loggedAt);

  const t0 = phaseStartedAt ?? (sorted.length > 0 ? sorted[0].loggedAt : Date.now());

  const volReadings = sorted.filter(
    (r): r is BulkFermentReading & { volume_ml: number } =>
      typeof r.volume_ml === "number" && isFinite(r.volume_ml)
  );

  const manualVol = manualStartVolume ? parseFloat(manualStartVolume) : NaN;
  const hasManualVol = !isNaN(manualVol) && manualVol > 0;
  const startVol = hasManualVol
    ? manualVol
    : volReadings.length > 0
    ? volReadings[0].volume_ml
    : 0;

  const firstTempReading = sorted.find((r) => typeof r.doughTemp === "number");
  const manualTemp = manualTargetTemp ? parseFloat(manualTargetTemp) : NaN;
  const T0 = firstTempReading?.doughTemp
    ? toF(firstTempReading.doughTemp, firstTempReading.tempUnit)
    : !isNaN(manualTemp)
    ? manualTemp
    : 76;

  return { sorted, volReadings, t0, startVol, T0, hasManualVol };
}

// Layer 2: Normalized State & Target Latching
export function computeNormalizedState(
  volReadings: (BulkFermentReading & { volume_ml: number })[],
  startVol: number,
  T0: number,
  existingState?: BulkFermentState
) {
  const latchedTargetRise =
    existingState?.latchedTargetRiseFraction ?? lookupTargetFraction(T0);
  const targetVolume_ml = startVol * (1 + latchedTargetRise);

  const currentVol =
    volReadings.length > 0 ? volReadings[volReadings.length - 1].volume_ml : startVol;
  const maxVolume_ml = Math.max(existingState?.maxVolume_ml || 0, currentVol);

  const p_observed =
    targetVolume_ml > startVol
      ? (currentVol - startVol) / (targetVolume_ml - startVol)
      : 0;
  const e_remaining = 1.0 - p_observed;

  return {
    latchedTargetRise,
    targetVolume_ml,
    currentVol,
    maxVolume_ml,
    p_observed,
    e_remaining,
  };
}

// Helper: Piecewise-linear temperature interpolation at timestamp tau
export function getInterpolatedTemperatureAt(
  tempReadings: BulkFermentReading[],
  tau: number,
  fallbackTempF = 76
): number {
  if (tempReadings.length === 0) return fallbackTempF;
  if (tempReadings.length === 1 || tau <= tempReadings[0].loggedAt) {
    return toF(tempReadings[0].doughTemp!, tempReadings[0].tempUnit);
  }
  const lastReading = tempReadings[tempReadings.length - 1];
  if (tau >= lastReading.loggedAt) {
    return toF(lastReading.doughTemp!, lastReading.tempUnit);
  }

  for (let i = 0; i < tempReadings.length - 1; i++) {
    const rA = tempReadings[i];
    const rB = tempReadings[i + 1];
    if (tau >= rA.loggedAt && tau <= rB.loggedAt) {
      const tA = rA.loggedAt;
      const tB = rB.loggedAt;
      const TA = toF(rA.doughTemp!, rA.tempUnit);
      const TB = toF(rB.doughTemp!, rB.tempUnit);
      if (tB === tA) return TA;
      return TA + ((tau - tA) / (tB - tA)) * (TB - TA);
    }
  }

  return fallbackTempF;
}

// Helper: Causal piecewise-linear volume interpolation at timestamp tau
export function getInterpolatedVolumeAt(
  volReadings: (BulkFermentReading & { volume_ml: number })[],
  tau: number
): number | null {
  if (!volReadings || volReadings.length === 0) return null;
  if (volReadings.length === 1 || tau <= volReadings[0].loggedAt) {
    return volReadings[0].volume_ml;
  }
  const lastReading = volReadings[volReadings.length - 1];
  if (tau >= lastReading.loggedAt) {
    return lastReading.volume_ml;
  }

  for (let i = 0; i < volReadings.length - 1; i++) {
    const rA = volReadings[i];
    const rB = volReadings[i + 1];
    if (tau >= rA.loggedAt && tau <= rB.loggedAt) {
      const tA = rA.loggedAt;
      const tB = rB.loggedAt;
      const VA = rA.volume_ml;
      const VB = rB.volume_ml;
      if (tB === tA) return VA;
      return VA + ((tau - tA) / (tB - tA)) * (VB - VA);
    }
  }

  return volReadings[0].volume_ml;
}

// Helper: Compute windowed disagreement signal epsilonP_H over interval [t_win_start, t_latest]
export function computeWindowedDisagreement(
  readings: BulkFermentReading[],
  volReadings: (BulkFermentReading & { volume_ml: number })[],
  t0: number,
  targetVolume_ml: number,
  startVolume_ml: number,
  inoculationPct: number,
  pMemoryHorizonMs?: number | null
): { epsilon_P: number; p_exp_window: number; p_obs_window: number } {
  const t_latest = readings.length > 0 ? readings[readings.length - 1].loggedAt : t0;
  const H = (pMemoryHorizonMs !== undefined && pMemoryHorizonMs !== null && pMemoryHorizonMs > 0)
    ? pMemoryHorizonMs
    : null;

  const t_win_start = H !== null ? Math.max(t0, t_latest - H) : t0;

  // Expected window thermal progress
  const tempReadings = readings
    .filter((r) => typeof r.doughTemp === "number")
    .sort((a, b) => a.loggedAt - b.loggedAt);

  const stepMs = 10 * 60 * 1000;
  let p_exp_window = 0.0;

  let stepStart = t_win_start;
  while (stepStart < t_latest) {
    const stepEnd = Math.min(t_latest, stepStart + stepMs);
    const stepMid = stepStart + (stepEnd - stepStart) / 2;
    const stepDtHr = (stepEnd - stepStart) / (3600 * 1000);

    const tempAtMid = getInterpolatedTemperatureAt(tempReadings, stepMid);
    const baseDurationMs = interpolateExpectedDuration(tempAtMid, inoculationPct);
    const r_table = 1.0 / (baseDurationMs / 3600000);

    p_exp_window += r_table * stepDtHr;
    stepStart = stepEnd;
  }
  p_exp_window = Math.max(0, Math.min(1.0, p_exp_window));

  // Observed window volume progress
  const totalRise = targetVolume_ml - startVolume_ml;
  if (totalRise <= 0 || volReadings.length === 0) {
    return { epsilon_P: 0.0, p_exp_window, p_obs_window: 0.0 };
  }

  const V_win_start = getInterpolatedVolumeAt(volReadings, t_win_start);
  const V_latest = volReadings[volReadings.length - 1].volume_ml;

  if (V_win_start === null) {
    return { epsilon_P: 0.0, p_exp_window, p_obs_window: 0.0 };
  }

  const p_obs_window = (V_latest - V_win_start) / totalRise;
  const epsilon_P = p_obs_window - p_exp_window;

  return { epsilon_P, p_exp_window, p_obs_window };
}

// Layer 3: Thermal History & Baseline Progress Rate
export function computeThermalExposure(
  readings: BulkFermentReading[],
  inoculationPct: number,
  hydrationPct: number,
  saltPct: number,
  enriched: boolean,
  t0: number,
  latchedTargetRise?: number
) {
  const tempReadings = readings
    .filter((r) => typeof r.doughTemp === "number")
    .sort((a, b) => a.loggedAt - b.loggedAt);

  const t_latest =
    readings.length > 0 ? readings[readings.length - 1].loggedAt : t0;
  const totalDurationMs = Math.max(0, t_latest - t0);

  if (totalDurationMs === 0 || tempReadings.length === 0) {
    const defaultTemp = tempReadings.length > 0
      ? toF(tempReadings[0].doughTemp!, tempReadings[0].tempUnit)
      : 76;
    const durationMs = interpolateExpectedDuration(defaultTemp, inoculationPct);
    const r_table = 1.0 / (durationMs / 3600000);
    return { p_expected: 0.0, r_base: r_table, currentTempF: defaultTemp };
  }

  // Stepwise thermal integration (10-minute steps) with piecewise linear interpolation
  const stepMs = 10 * 60 * 1000;
  let p_expected = 0.0;
  let currentTempF = toF(tempReadings[tempReadings.length - 1].doughTemp!, tempReadings[tempReadings.length - 1].tempUnit);

  let stepStart = t0;
  while (stepStart < t_latest) {
    const stepEnd = Math.min(t_latest, stepStart + stepMs);
    const stepMid = stepStart + (stepEnd - stepStart) / 2;
    const stepDtHr = (stepEnd - stepStart) / (3600 * 1000);

    const tempAtMid = getInterpolatedTemperatureAt(tempReadings, stepMid);

    const baseDurationMs = interpolateExpectedDuration(tempAtMid, inoculationPct);
    const baseDurationHr = baseDurationMs / (3600 * 1000);
    const r_table = 1.0 / baseDurationHr;

    p_expected += r_table * stepDtHr;
    stepStart = stepEnd;
  }

  p_expected = Math.max(0, Math.min(1.0, p_expected));

  // Ingredient multipliers
  const hydrationBonus = Math.min(0.10, Math.max(0, hydrationPct - 70) * 0.008);
  const hydrationMult = Math.max(0.75, 1 - hydrationBonus);
  const saltMult = 1 + (saltPct - 2.0) * 0.10;
  const enrichedMult = enriched ? 1.15 : 1.0;
  const totalIngredientMult = hydrationMult * saltMult * enrichedMult;

  const currentDurationMs = interpolateExpectedDuration(currentTempF, inoculationPct);
  const r_base = (1.0 / (currentDurationMs / 3600000)) / totalIngredientMult;

  return { p_expected, r_base, currentTempF };
}

// Layer 4: Observed Trend Estimator
export function estimateObservedRate(
  volReadings: (BulkFermentReading & { volume_ml: number })[],
  targetVolume_ml: number,
  startVolume_ml: number
) {
  let r_obs = 0.0;
  let rawSlopeMlHr = 0.0;
  let postInterventionDamped = false;
  let isNegativeTrend = false;

  const totalRise = targetVolume_ml - startVolume_ml;
  if (volReadings.length >= 2 && totalRise > 0) {
    const curr = volReadings[volReadings.length - 1];
    const prev = volReadings[volReadings.length - 2];
    const dtMs = curr.loggedAt - prev.loggedAt;

    if (dtMs >= BULK_MIN_DERIVATIVE_GAP_MS) {
      const dVol = curr.volume_ml - prev.volume_ml;
      const dtHr = dtMs / (3600 * 1000);

      if (curr.postIntervention && dVol < 0) {
        postInterventionDamped = true;
        r_obs = 0.0;
        rawSlopeMlHr = 0.0;
      } else {
        rawSlopeMlHr = dVol / dtHr;
        r_obs = rawSlopeMlHr / totalRise;

        if (dVol < 0) {
          isNegativeTrend = true;
          // Cap negative slope
          const maxNegProgressHr = (BULK_NEGATIVE_DERIVATIVE_CAP * 3600 * 1000) / totalRise;
          r_obs = Math.max(r_obs, maxNegProgressHr);
        }
      }
    }
  }

  return { r_obs, rawSlopeMlHr, postInterventionDamped, isNegativeTrend };
}

// Layer 5: P/D Rate Correction
export function computeCorrectedRate(
  r_base: number,
  r_obs: number,
  p_expected: number,
  p_observed: number,
  confidenceScore: number,
  Kp = 0.8,
  Kd = 0.4,
  S_min = 0.33,
  S_max = 2.50,
  overrideEpsilonP?: number
) {
  const epsilon_P = overrideEpsilonP !== undefined ? overrideEpsilonP : p_observed - p_expected;
  const epsilon_D = r_base > 0 ? (r_obs - r_base) / r_base : 0;

  const S_raw = 1 + confidenceScore * (Kp * epsilon_P + Kd * epsilon_D);
  const S_PD = Math.max(S_min, Math.min(S_max, S_raw));
  const r_est = r_base * S_PD;

  return { epsilon_P, epsilon_D, S_PD, r_est };
}

// Layer 6: Trajectory Integration (Newton's Law of Cooling Forward Integration)
export function integrateRemainingDuration(
  e_remaining: number,
  S_PD: number,
  currentTempF: number,
  ambientTempF: number | null,
  inoculationPct: number,
  hydrationPct: number,
  saltPct: number,
  enriched: boolean
): number {
  if (e_remaining <= 0) return 0;

  let progressNeeded = e_remaining;
  let simulatedTimeMs = 0;
  let tempF = currentTempF;
  const k_per_ms = 0.4 / (3600 * 1000);
  const stepMs = 10 * 60 * 1000;
  const maxSteps = (48 * 60) / 10;
  let steps = 0;

  const hydrationBonus = Math.min(0.10, Math.max(0, hydrationPct - 70) * 0.008);
  const hydrationMult = Math.max(0.75, 1 - hydrationBonus);
  const saltMult = 1 + (saltPct - 2.0) * 0.10;
  const enrichedMult = enriched ? 1.15 : 1.0;
  const totalIngredientMult = hydrationMult * saltMult * enrichedMult;

  while (progressNeeded > 0 && steps < maxSteps) {
    steps++;
    if (ambientTempF !== null) {
      tempF = ambientTempF + (tempF - ambientTempF) * Math.exp(-k_per_ms * stepMs);
    }

    const baseDurationMs = interpolateExpectedDuration(tempF, inoculationPct);
    const r_base_step = (1.0 / (baseDurationMs / 3600000)) / totalIngredientMult;
    const r_est_step = r_base_step * S_PD;

    const stepProgress = r_est_step * (stepMs / (3600 * 1000));

    if (stepProgress >= progressNeeded && stepProgress > 0) {
      const fraction = progressNeeded / stepProgress;
      simulatedTimeMs += stepMs * fraction;
      progressNeeded = 0;
    } else if (stepProgress > 0) {
      simulatedTimeMs += stepMs;
      progressNeeded -= stepProgress;
    } else {
      break;
    }
  }

  return simulatedTimeMs;
}

// Layer 7: Confidence & Diagnostic Engine
export function computeConfidence(
  readings: BulkFermentReading[],
  volReadings: (BulkFermentReading & { volume_ml: number })[],
  t0: number,
  postInterventionDamped: boolean,
  isNegativeTrend: boolean
) {
  const N_vol = volReadings.length;
  const C_count = Math.min(1.0, Math.max(0, N_vol - 1) / 3);

  const t_latest = readings.length > 0 ? readings[readings.length - 1].loggedAt : t0;
  const spanMs = Math.max(0, t_latest - t0);
  const C_span = Math.min(1.0, spanMs / (4 * 3600 * 1000));

  const hasTemp = readings.some((r) => typeof r.doughTemp === "number");
  const C_temp = hasTemp ? 1.0 : 0.5;
  const C_stability = 0.85;
  const C_interv = postInterventionDamped ? 0.4 : 1.0;

  const totalVolChange =
    volReadings.length >= 2
      ? Math.abs(volReadings[volReadings.length - 1].volume_ml - volReadings[0].volume_ml)
      : 0;
  const C_snr = Math.min(1.0, totalVolChange / 30);

  const confidenceScore =
    0.20 * C_count +
    0.20 * C_span +
    0.20 * C_temp +
    0.20 * C_stability +
    0.10 * C_interv +
    0.10 * C_snr;

  let diagnosticCode = "STABLE_TREND";
  if (N_vol < 2) {
    diagnosticCode = "INSUFFICIENT_DATA";
  } else if (postInterventionDamped) {
    diagnosticCode = "POST_INTERVENTION_DAMPED";
  } else if (isNegativeTrend) {
    diagnosticCode = "SUSTAINED_VOLUME_LOSS";
  } else if (totalVolChange < 5) {
    diagnosticCode = "FLAT_NO_RISE";
  }

  return { confidenceScore, diagnosticCode };
}

// Default production P-memory horizon = 2.0 hours (7,200,000 ms)
export const DEFAULT_P_MEMORY_HORIZON_MS = 2 * 3600 * 1000;

// Layer 8: Complete Bulk Ferment State Computation
export function computeBulkFermentState(
  readings: BulkFermentReading[],
  existing: BulkFermentState,
  allRecipePhases: { ingredients: any }[] = [],
  phaseStartedAt?: number | null,
  manualStartVolume?: string,
  manualTargetTemp?: string,
  overrides?: BulkEstimatorState,
  options?: { pMemoryHorizonMs?: number | null } | number | null
): BulkFermentState {
  const state: BulkFermentState = { ...existing };

  const pMemoryHorizonMs =
    options === null
      ? null
      : typeof options === "number"
      ? options
      : options?.pMemoryHorizonMs !== undefined
      ? options.pMemoryHorizonMs
      : DEFAULT_P_MEMORY_HORIZON_MS;

  state.pMemoryHorizonMs = pMemoryHorizonMs;

  let metrics = calculateRecipeMetrics(allRecipePhases);
  if (overrides) {
    const { flourG, waterG, starterG, saltG } = overrides;
    const overrideMetrics = calculateRecipeMetrics([
      {
        ingredients: [
          { text: `${flourG || 0}g flour` },
          { text: `${waterG || 0}g water` },
          { text: `${starterG || 0}g starter` },
          { text: `${saltG || 0}g salt` },
        ]
          .map((i) => i.text)
          .join("\n"),
      },
    ]);
    metrics = { ...overrideMetrics };
  }

  const { inoculationPct, hydrationPct, saltPct, enriched } = metrics as any;
  const inoculationBucket: 10 | 20 | 30 =
    inoculationPct <= 15 ? 10 : inoculationPct >= 25 ? 30 : 20;
  state.activeInoculationPercent = inoculationBucket;

  // Layer 1
  const { sorted, volReadings, t0, startVol, T0 } = normalizeReadings(
    readings,
    phaseStartedAt,
    manualStartVolume,
    manualTargetTemp
  );

  if (!volReadings.length && !startVol) return state;

  state.startVolume_ml = startVol;

  // Layer 2
  const {
    latchedTargetRise,
    targetVolume_ml,
    currentVol,
    maxVolume_ml,
    p_observed,
    e_remaining,
  } = computeNormalizedState(volReadings, startVol, T0, existing);

  state.latchedTargetRiseFraction = latchedTargetRise;
  state.targetRiseFraction = latchedTargetRise;
  state.targetVolume_ml = targetVolume_ml;
  state.maxVolume_ml = maxVolume_ml;

  // Layer 3
  const { p_expected, r_base, currentTempF } = computeThermalExposure(
    sorted,
    inoculationPct,
    hydrationPct,
    saltPct,
    enriched,
    t0,
    latchedTargetRise
  );
  state.thermalExposureDegreeHours = p_expected;

  const lastWithTemp = [...sorted]
    .reverse()
    .find((r) => typeof r.doughTemp === "number");
  const currentAmbientF = lastWithTemp?.ambientTemp
    ? toF(lastWithTemp.ambientTemp, lastWithTemp.tempUnit)
    : null;

  // Layer 4
  const { r_obs, rawSlopeMlHr, postInterventionDamped, isNegativeTrend } =
    estimateObservedRate(volReadings, targetVolume_ml, startVol);
  state.observedVolumeRateMlHr = rawSlopeMlHr;

  // Layer 7 (Confidence computed before Layer 5)
  const { confidenceScore, diagnosticCode } = computeConfidence(
    sorted,
    volReadings,
    t0,
    postInterventionDamped,
    isNegativeTrend
  );
  state.confidenceScore = confidenceScore;
  state.diagnosticCode = diagnosticCode;

  // Compute Windowed Disagreement Signal epsilonP_H
  const { epsilon_P } = computeWindowedDisagreement(
    sorted,
    volReadings,
    t0,
    targetVolume_ml,
    startVol,
    inoculationPct,
    pMemoryHorizonMs
  );

  // Layer 5
  const { S_PD } = computeCorrectedRate(
    r_base,
    r_obs,
    p_expected,
    p_observed,
    confidenceScore,
    0.8,
    0.4,
    0.33,
    2.50,
    epsilon_P
  );
  state.correctedRateMultiplier = S_PD;

  // Layer 6: Trajectory Integration
  if (e_remaining > 0 && volReadings.length > 0) {
    const remainingMs = integrateRemainingDuration(
      e_remaining,
      S_PD,
      currentTempF,
      currentAmbientF,
      inoculationPct,
      hydrationPct,
      saltPct,
      enriched
    );
    const lastReadingAt = volReadings[volReadings.length - 1].loggedAt;
    state.projectedTargetAt = lastReadingAt + remainingMs;
  } else {
    state.projectedTargetAt = null;
  }

  // Layer 8: Target Reached Check
  if (
    !state.targetReachedAt &&
    currentVol >= targetVolume_ml &&
    volReadings.length > 0
  ) {
    state.targetReachedAt = volReadings[volReadings.length - 1].loggedAt;
    state.inOvertime = true;
    state.projectedTargetAt = null;
  }

  return state;
}
