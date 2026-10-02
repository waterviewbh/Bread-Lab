// lib/validationHarness.ts
// ─── Estimator Validation Harness & Benchmark Evaluator ─────────────────────
// Pure TypeScript — no React, no AsyncStorage, no UI.
// Evaluates any current or future bulk-fermentation estimator against
// historical bake logs with strict causal chronology and zero future leakage.

import {
  type BulkFermentReading,
  type BulkFermentState,
  type RecipePhaseConfig,
  type BulkEstimatorState,
} from "@/lib/recipeTypes";
import { computeBulkFermentState, toF } from "./bulkFermentEngine";

// ─── Data Types & Interfaces ──────────────────────────────────────────────────

export interface ValidationBakeFixture {
  id: string;
  name: string;
  actualDurationHr: number;
  phases: { key: string; name?: string; ingredients: any; instructions?: any }[];
  readings: BulkFermentReading[];
  regimeTags?: string[]; // e.g. ["COOL_TEMP", "STANDARD_INOC", "FOLD_INTERVENTION"]
}

export interface BakeObservationTrace {
  readingId: string;
  loggedAt: number;
  elapsedHr: number;
  currentVolMl: number | null;
  doughTempF: number | null;
  p_obs: number;
  p_exp: number;
  epsilon_P: number;
  r_obs_hr: number;
  r_base_hr: number;
  epsilon_D: number;
  S_PD: number;
  confidenceScore: number;
  diagnosticCode: string;
  predictedTotalHr: number | null;
  actualTotalHr: number;
  errorMin: number | null;
  absErrorMin: number | null;
}

export interface BakeEvaluationResult {
  bakeId: string;
  bakeName: string;
  actualDurationHr: number;
  regimeTags: string[];
  traces: BakeObservationTrace[];
  activeForecastCount: number;
  finalPreTargetTrace: BakeObservationTrace | null;
  finalPreTargetErrorMin: number | null;
  sequenceMAE: number;
  sequenceMBE: number;
}

export interface RegimeMetricSummary {
  regimeTag: string;
  observationCount: number;
  maeMin: number;
  mbeMin: number;
}

export interface CorpusEvaluationSummary {
  estimatorLabel: string;
  bakeResults: BakeEvaluationResult[];
  totalForecastObservations: number;
  forecastMAE: number;
  forecastMBE: number;
  finalPreTargetMAE: number;
  finalPreTargetMBE: number;
  finalPreTargetMedianAbsError: number;
  regimeSummaries: Record<string, RegimeMetricSummary>;
}

export type EstimatorFn = (
  readings: BulkFermentReading[],
  existing: BulkFermentState,
  allRecipePhases?: any[],
  phaseStartedAt?: number | null,
  manualStartVolume?: string,
  manualTargetTemp?: string,
  overrides?: BulkEstimatorState,
  options?: any
) => BulkFermentState;

// ─── Core Evaluators ──────────────────────────────────────────────────────────

/**
 * Evaluate a single bake session with strict causal chronology.
 * At reading index i, ONLY readings[0..i] are passed to the estimator.
 */
export function evaluateBakeSession(
  bake: ValidationBakeFixture,
  estimatorFn: EstimatorFn = computeBulkFermentState,
  options?: any
): BakeEvaluationResult {
  const hourMs = 3600 * 1000;
  const sortedReadings = [...bake.readings].sort((a, b) => a.loggedAt - b.loggedAt);
  const t0 = sortedReadings.length > 0 ? sortedReadings[0].loggedAt : Date.now();

  const traces: BakeObservationTrace[] = [];
  let existingState: BulkFermentState = {};

  const totalReadings = sortedReadings.length;

  for (let i = 0; i < totalReadings; i++) {
    // Strict causal slice: only observations available at or before this timestamp
    const causalSlice = sortedReadings.slice(0, i + 1);
    const currReading = causalSlice[causalSlice.length - 1];

    existingState = estimatorFn(
      causalSlice,
      existingState,
      bake.phases,
      t0,
      undefined,
      undefined,
      undefined,
      options
    );

    const elapsedHr = (currReading.loggedAt - t0) / hourMs;
    const startVol = existingState.startVolume_ml || 400;
    const targetVol = existingState.targetVolume_ml || 620;
    const currentVolMl = typeof currReading.volume_ml === "number" ? currReading.volume_ml : null;

    const isTargetReachedRow = i === totalReadings - 1;

    let predictedTotalHr: number | null = null;
    let errorMin: number | null = null;
    let absErrorMin: number | null = null;

    if (!isTargetReachedRow && existingState.projectedTargetAt) {
      predictedTotalHr = (existingState.projectedTargetAt - t0) / hourMs;
      errorMin = (predictedTotalHr - bake.actualDurationHr) * 60;
      absErrorMin = Math.abs(errorMin);
    }

    const totalRise = targetVol - startVol;

    const p_obs =
      currentVolMl !== null && totalRise > 0 ? (currentVolMl - startVol) / totalRise : 0;
    const p_exp = existingState.thermalExposureDegreeHours || 0;
    const epsilon_P = p_obs - p_exp;

    const rawSlope = existingState.observedVolumeRateMlHr || 0;
    const r_obs_hr = totalRise > 0 ? rawSlope / totalRise : 0;

    const S_PD = existingState.correctedRateMultiplier || 1.0;
    const r_base_hr = S_PD > 0 ? r_obs_hr / S_PD : 0;
    const epsilon_D = r_base_hr > 0 ? (r_obs_hr - r_base_hr) / r_base_hr : 0;

    const doughTempF = typeof currReading.doughTemp === "number"
      ? toF(currReading.doughTemp, currReading.tempUnit)
      : null;

    traces.push({
      readingId: currReading.id || `r_${i}`,
      loggedAt: currReading.loggedAt,
      elapsedHr,
      currentVolMl,
      doughTempF,
      p_obs,
      p_exp,
      epsilon_P,
      r_obs_hr,
      r_base_hr,
      epsilon_D,
      S_PD,
      confidenceScore: existingState.confidenceScore ?? 0.20,
      diagnosticCode: existingState.diagnosticCode || "INSUFFICIENT_DATA",
      predictedTotalHr,
      actualTotalHr: bake.actualDurationHr,
      errorMin,
      absErrorMin,
    });
  }

  // Active forecast traces exclude terminal target-reached row
  const activeForecastTraces = traces.filter((t) => t.errorMin !== null);
  const activeForecastCount = activeForecastTraces.length;

  const finalPreTargetTrace =
    activeForecastTraces.length > 0
      ? activeForecastTraces[activeForecastTraces.length - 1]
      : null;
  const finalPreTargetErrorMin = finalPreTargetTrace ? finalPreTargetTrace.errorMin : null;

  const seqAbsErrors = activeForecastTraces.map((t) => t.absErrorMin!);
  const seqSignedErrors = activeForecastTraces.map((t) => t.errorMin!);

  const sequenceMAE =
    seqAbsErrors.length > 0 ? seqAbsErrors.reduce((a, b) => a + b, 0) / seqAbsErrors.length : 0;
  const sequenceMBE =
    seqSignedErrors.length > 0
      ? seqSignedErrors.reduce((a, b) => a + b, 0) / seqSignedErrors.length
      : 0;

  return {
    bakeId: bake.id,
    bakeName: bake.name,
    actualDurationHr: bake.actualDurationHr,
    regimeTags: bake.regimeTags || [],
    traces,
    activeForecastCount,
    finalPreTargetTrace,
    finalPreTargetErrorMin,
    sequenceMAE,
    sequenceMBE,
  };
}

/**
 * Evaluates an entire corpus of bake fixtures and returns standardized summary statistics
 * and regime breakdowns.
 */
export function evaluateCorpus(
  corpus: ValidationBakeFixture[],
  estimatorFn: EstimatorFn = computeBulkFermentState,
  estimatorLabel = "Current Production Estimator",
  options?: any
): CorpusEvaluationSummary {
  const bakeResults = corpus.map((bake) =>
    evaluateBakeSession(bake, estimatorFn, options)
  );

  const allForecastTraces = bakeResults.flatMap((b) =>
    b.traces.filter((t) => t.errorMin !== null)
  );
  const totalForecastObservations = allForecastTraces.length;

  const absForecastErrors = allForecastTraces.map((t) => t.absErrorMin!);
  const signedForecastErrors = allForecastTraces.map((t) => t.errorMin!);

  const forecastMAE =
    absForecastErrors.length > 0
      ? absForecastErrors.reduce((a, b) => a + b, 0) / absForecastErrors.length
      : 0;
  const forecastMBE =
    signedForecastErrors.length > 0
      ? signedForecastErrors.reduce((a, b) => a + b, 0) / signedForecastErrors.length
      : 0;

  const finalPreTargetTraces = bakeResults
    .map((b) => b.finalPreTargetTrace)
    .filter((t): t is BakeObservationTrace => t !== null);

  const finalAbsErrors = finalPreTargetTraces.map((t) => t.absErrorMin!);
  const finalSignedErrors = finalPreTargetTraces.map((t) => t.errorMin!);

  const finalPreTargetMAE =
    finalAbsErrors.length > 0
      ? finalAbsErrors.reduce((a, b) => a + b, 0) / finalAbsErrors.length
      : 0;
  const finalPreTargetMBE =
    finalSignedErrors.length > 0
      ? finalSignedErrors.reduce((a, b) => a + b, 0) / finalSignedErrors.length
      : 0;

  const sortedFinalAbs = [...finalAbsErrors].sort((a, b) => a - b);
  const finalPreTargetMedianAbsError =
    sortedFinalAbs.length > 0
      ? sortedFinalAbs[Math.floor(sortedFinalAbs.length / 2)]
      : 0;

  // Aggregate by Regimes
  const regimeMap: Record<string, { absErrors: number[]; signedErrors: number[] }> = {};

  for (const bResult of bakeResults) {
    for (const trace of bResult.traces) {
      if (trace.errorMin === null) continue;

      // Add bake-level regime tags
      for (const tag of bResult.regimeTags) {
        if (!regimeMap[tag]) regimeMap[tag] = { absErrors: [], signedErrors: [] };
        regimeMap[tag].absErrors.push(trace.absErrorMin!);
        regimeMap[tag].signedErrors.push(trace.errorMin!);
      }

      // Add dynamic stage tags
      const stageTag = trace.elapsedHr <= 2.0 ? "EARLY_STAGE_le_2h" : "LATE_STAGE_gt_2h";
      if (!regimeMap[stageTag]) regimeMap[stageTag] = { absErrors: [], signedErrors: [] };
      regimeMap[stageTag].absErrors.push(trace.absErrorMin!);
      regimeMap[stageTag].signedErrors.push(trace.errorMin!);
    }
  }

  const regimeSummaries: Record<string, RegimeMetricSummary> = {};
  for (const [tag, data] of Object.entries(regimeMap)) {
    const maeMin =
      data.absErrors.length > 0
        ? data.absErrors.reduce((a, b) => a + b, 0) / data.absErrors.length
        : 0;
    const mbeMin =
      data.signedErrors.length > 0
        ? data.signedErrors.reduce((a, b) => a + b, 0) / data.signedErrors.length
        : 0;

    regimeSummaries[tag] = {
      regimeTag: tag,
      observationCount: data.absErrors.length,
      maeMin,
      mbeMin,
    };
  }

  return {
    estimatorLabel,
    bakeResults,
    totalForecastObservations,
    forecastMAE,
    forecastMBE,
    finalPreTargetMAE,
    finalPreTargetMBE,
    finalPreTargetMedianAbsError,
    regimeSummaries,
  };
}

/**
 * Compare multiple estimators against the same bake corpus.
 * Returns comparative summaries and observation-level trace diffs.
 */
export function compareEstimators(
  corpus: ValidationBakeFixture[],
  estimators: { label: string; fn: EstimatorFn; options?: any }[]
) {
  return estimators.map((e) => evaluateCorpus(corpus, e.fn, e.label, e.options));
}

export interface FuzzingOptions {
  /** Pseudo-random seed for deterministic noise generation */
  seed?: number;
  /** Max temperature noise in F (default: 3.0) */
  tempJitterF?: number;
  /** Max volume noise in ml (default: 15.0) */
  volumeJitterMl?: number;
  /** Probability of missing temperature reading (0.0 to 1.0, default: 0.1) */
  missingDataProbability?: number;
  /** Toggle temp units between F and C randomly */
  toggleUnits?: boolean;
}

/**
 * Generate a fuzzed/noisy copy of a clean validation bake fixture.
 * Injects observational noise, unit toggles, and missing readings
 * WITHOUT modifying ground truth actual duration or recipe phases.
 */
export function generateFuzzedBakeSession(
  fixture: ValidationBakeFixture,
  options: FuzzingOptions = {}
): ValidationBakeFixture {
  const {
    seed = 42,
    tempJitterF = 3.0,
    volumeJitterMl = 15.0,
    missingDataProbability = 0.1,
    toggleUnits = true,
  } = options;

  let currentSeed = seed;
  const pseudoRandom = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  const fuzzedReadings: BulkFermentReading[] = fixture.readings.map((r, idx) => {
    const fuzzed: BulkFermentReading = { ...r };

    // Inject temperature jitter
    if (typeof fuzzed.doughTemp === "number") {
      const tempNoise = (pseudoRandom() * 2 - 1) * tempJitterF;
      let rawTemp = fuzzed.doughTemp + tempNoise;

      // Randomly toggle units between F and C
      if (toggleUnits && pseudoRandom() > 0.5) {
        fuzzed.tempUnit = "C";
        fuzzed.doughTemp = Math.round(((rawTemp - 32) * 5 / 9) * 10) / 10;
      } else {
        fuzzed.tempUnit = "F";
        fuzzed.doughTemp = Math.round(rawTemp * 10) / 10;
      }
    }

    // Inject volume noise
    if (typeof fuzzed.volume_ml === "number") {
      const volNoise = (pseudoRandom() * 2 - 1) * volumeJitterMl;
      fuzzed.volume_ml = Math.max(100, Math.round(fuzzed.volume_ml + volNoise));
    }

    // Randomly omit non-essential reading fields
    if (idx > 0 && pseudoRandom() < missingDataProbability) {
      delete fuzzed.doughTemp;
    }

    return fuzzed;
  });

  return {
    ...fixture,
    id: `${fixture.id}_fuzzed`,
    name: `${fixture.name} (Fuzzed Chaos)`,
    readings: fuzzedReadings,
    regimeTags: [...(fixture.regimeTags || []), "FUZZED_CHAOS"],
  };
}

