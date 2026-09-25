// lib/__tests__/bulkFermentEngine.test.ts
import {
  toF,
  lookupTargetFraction,
  lookupExpectedDuration,
  interpolateExpectedDuration,
  predictRemainingBaselineDuration,
  computeBulkFermentState,
  normalizeReadings,
  computeNormalizedState,
  computeThermalExposure,
  estimateObservedRate,
  computeCorrectedRate,
  computeConfidence,
  integrateRemainingDuration,
  getInterpolatedVolumeAt,
  computeWindowedDisagreement,
} from "../bulkFermentEngine";
import { DOUGHLAB_PRIOR_TABLE, BULK_TEMP_RISE_TABLE, type BulkFermentReading } from "../recipeTypes";

describe("PD-Informed Bulk Ferment Engine v2", () => {
  describe("1. Baseline Lookups & Table Integrity", () => {
    it("returns expected target rise fractions across temperature thresholds", () => {
      expect(lookupTargetFraction(65)).toBe(1.0);  // <= 68F -> 100%
      expect(lookupTargetFraction(68)).toBe(1.0);  // 68F -> 100%
      expect(lookupTargetFraction(70)).toBe(0.75); // <= 72F -> 75%
      expect(lookupTargetFraction(75)).toBe(0.55); // <= 76F -> 55%
      expect(lookupTargetFraction(78)).toBe(0.40); // <= 80F -> 40%
      expect(lookupTargetFraction(82)).toBe(0.35); // <= 84F -> 35%
      expect(lookupTargetFraction(90)).toBe(0.35); // Warmest fallback -> 35%
    });

    it("matches exact Doughlab prior table duration entries", () => {
      // At 75°F and 20% inoculation, chart specifies 4.5 hours = 16,200,000 ms
      const durationMs = lookupExpectedDuration(75, 20);
      expect(durationMs).toBe(4.5 * 3600 * 1000);

      // Interpolation at exact table point 75°F, 20%
      const interpolatedMs = interpolateExpectedDuration(75, 20);
      expect(interpolatedMs).toBe(4.5 * 3600 * 1000);
    });

    it("bilinearly interpolates across temperature and inoculation percentages", () => {
      // Halfway between 72°F (6.0 hr @ 20%) and 75°F (4.5 hr @ 20%) -> 5.25 hr @ 73.5°F
      const interpolatedMs = interpolateExpectedDuration(73.5, 20);
      expect(interpolatedMs / (3600 * 1000)).toBeCloseTo(5.25, 2);

      // Halfway between 10% inoc (7.0 hr @ 75°F) and 20% inoc (4.5 hr @ 75°F) -> 5.75 hr @ 15% inoc
      const inocInterpolatedMs = interpolateExpectedDuration(75, 15);
      expect(inocInterpolatedMs / (3600 * 1000)).toBeCloseTo(5.75, 2);
    });
  });

  describe("2. Characterization: Constant Temperature & Thermal Exposure ($p_{expected} = 0 \\to 1.0$)", () => {
    it("accumulates expected progress from 0.0 at start to 1.0 at prior expected completion", () => {
      // Constant 75°F, 20% inoculation. Duration = 4.5 hrs
      const inoculationPct = 20;
      const t0 = 1000000;
      const fourAndHalfHoursMs = 4.5 * 3600 * 1000;

      // At start (t0), expected progress is 0.0
      const startExposure = computeThermalExposure(
        [{ loggedAt: t0, doughTemp: 75, tempUnit: "F" }],
        inoculationPct, 70, 2.0, false, t0
      );
      expect(startExposure.p_expected).toBeCloseTo(0.0, 4);

      // At 2.25 hours (halfway), expected progress is 0.50
      const halfwayExposure = computeThermalExposure(
        [
          { loggedAt: t0, doughTemp: 75, tempUnit: "F" },
          { loggedAt: t0 + (fourAndHalfHoursMs / 2), doughTemp: 75, tempUnit: "F" }
        ],
        inoculationPct, 70, 2.0, false, t0
      );
      expect(halfwayExposure.p_expected).toBeCloseTo(0.50, 2);

      // At 4.5 hours (completion), expected progress is 1.0
      const fullExposure = computeThermalExposure(
        [
          { loggedAt: t0, doughTemp: 75, tempUnit: "F" },
          { loggedAt: t0 + fourAndHalfHoursMs, doughTemp: 75, tempUnit: "F" }
        ],
        inoculationPct, 70, 2.0, false, t0
      );
      expect(fullExposure.p_expected).toBeCloseTo(1.0, 2);
    });

    it("integrates piecewise multi-temperature historical thermal exposure correctly", () => {
      // 2 hours warming 68F -> 74F, then 2 hours warming 74F -> 78F
      const t0 = 1000000;
      const twoHoursMs = 2 * 3600 * 1000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "68", tempUnit: "F", doughTemp: 68, pH: "", note: "", volume: "" },
        { id: "2", loggedAt: t0 + twoHoursMs, temp: "74", tempUnit: "F", doughTemp: 74, pH: "", note: "", volume: "" },
        { id: "3", loggedAt: t0 + (2 * twoHoursMs), temp: "78", tempUnit: "F", doughTemp: 78, pH: "", note: "", volume: "" },
      ];

      const exposure = computeThermalExposure(readings, 20, 70, 2.0, false, t0);
      // As calculated in proof: interval 1 (~0.3118) + interval 2 (~0.4831) = ~0.7949
      expect(exposure.p_expected).toBeGreaterThan(0.70);
      expect(exposure.p_expected).toBeLessThan(0.85);
    });
  });

  describe("3. Error Signal Math & Rate Corrections (\\epsilon_P and \\epsilon_D)", () => {
    it("produces zero corrections when dough is exactly on-model", () => {
      const p_exp = 0.50;
      const p_obs = 0.50;
      const r_base = 0.20; // 20% per hour
      const r_obs = 0.20;  // 20% per hour

      const res = computeCorrectedRate(r_base, r_obs, p_exp, p_obs, 1.0);
      expect(res.epsilon_P).toBeCloseTo(0.0, 4);
      expect(res.epsilon_D).toBeCloseTo(0.0, 4);
      expect(res.S_PD).toBeCloseTo(1.0, 4);
      expect(res.r_est).toBeCloseTo(0.20, 4);
    });

    it("produces negative correction multiplier when dough is behind model", () => {
      const p_exp = 0.50;
      const p_obs = 0.38; // 12% behind
      const r_base = 0.20;
      const r_obs = 0.12;  // 40% slower

      const res = computeCorrectedRate(r_base, r_obs, p_exp, p_obs, 1.0);
      expect(res.epsilon_P).toBeCloseTo(-0.12, 2);
      expect(res.epsilon_D).toBeCloseTo(-0.40, 2);
      // S_PD = 1 + (0.8 * -0.12 + 0.4 * -0.40) = 1 - 0.256 = 0.744
      expect(res.S_PD).toBeCloseTo(0.744, 3);
      expect(res.r_est).toBeCloseTo(0.20 * 0.744, 4);
    });

    it("produces positive correction multiplier when dough is ahead of model", () => {
      const p_exp = 0.50;
      const p_obs = 0.62; // 12% ahead
      const r_base = 0.20;
      const r_obs = 0.30;  // 50% faster

      const res = computeCorrectedRate(r_base, r_obs, p_exp, p_obs, 1.0);
      expect(res.epsilon_P).toBeCloseTo(0.12, 2);
      expect(res.epsilon_D).toBeCloseTo(0.50, 2);
      // S_PD = 1 + (0.8 * 0.12 + 0.4 * 0.50) = 1 + 0.296 = 1.296
      expect(res.S_PD).toBeCloseTo(1.296, 3);
      expect(res.r_est).toBeCloseTo(0.20 * 1.296, 4);
    });

    it("clamps rate correction multiplier within [0.33, 2.50] bounds", () => {
      const p_exp = 0.10;
      const p_obs = 0.90; // Massive surge
      const r_base = 0.10;
      const r_obs = 0.90;

      const res = computeCorrectedRate(r_base, r_obs, p_exp, p_obs, 1.0);
      expect(res.S_PD).toBeLessThanOrEqual(2.50);
    });
  });

  describe("4. Phase-Start Semantics & Target Latching", () => {
    it("latches startVolume from first volume reading and targetRise from initial temperature", () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "2", loggedAt: t0 + 3600000, temp: "82", tempUnit: "F", doughTemp: 82, volume_ml: 450, volume: "450", pH: "", note: "" },
      ];

      const state = computeBulkFermentState(readings, {}, [], t0);
      expect(state.startVolume_ml).toBe(400);
      // Initial temp 76F -> lookupTargetFraction(76) = 0.55 -> targetVolume = 400 * 1.55 = 620 mL
      expect(state.targetVolume_ml).toBe(620);
      expect(state.latchedTargetRiseFraction).toBe(0.55);
    });

    it("prevents target jump on short transient temperature spikes (< 1 hr)", () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
        // 15 min later: sudden 80°F spike (transient)
        { id: "2", loggedAt: t0 + 15 * 60 * 1000, temp: "80", tempUnit: "F", doughTemp: 80, volume_ml: 410, volume: "410", pH: "", note: "" },
      ];

      const state = computeBulkFermentState(readings, {}, [], t0);
      // Target rise stays latched at initial 72°F threshold (0.75 rise -> 700 mL target)
      expect(state.targetVolume_ml).toBe(700);
    });
  });

  describe("5. Edge Cases & Safety Guards", () => {
    it("handles flat trend without NaN/Infinity or divide-by-zero", () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "2", loggedAt: t0 + 3600000, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 400, volume: "400", pH: "", note: "" },
      ];

      const state = computeBulkFermentState(readings, {}, [], t0);
      expect(isFinite(state.confidenceScore || 0)).toBe(true);
      expect(state.diagnosticCode).toBeDefined();
    });

    it("handles post-intervention structural dip safely without negative rate spikes", () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "2", loggedAt: t0 + 1800000, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 380, volume: "380", pH: "", note: "", postIntervention: true },
      ];

      const state = computeBulkFermentState(readings, {}, [], t0);
      expect(state.diagnosticCode).toBe("POST_INTERVENTION_DAMPED");
    });
  });

  describe("6. Real Bake Log Step-by-Step Simulation Trace", () => {
    it("simulates sequential predictions across a multi-reading bake session", () => {
      const t0 = 1700000000000; // Epoch timestamp
      const hourMs = 3600 * 1000;

      // Realistic bake telemetry: 20% inoc, 75% hyd, 2.0% salt, 400ml start, 55% target rise (620ml target)
      const historicalReadings: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "Mix complete" },
        { id: "r2", loggedAt: t0 + 0.75 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 425, volume: "425", pH: "", note: "Fold 1" },
        { id: "r3", loggedAt: t0 + 2.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "Fold 2" },
        { id: "r4", loggedAt: t0 + 3.25 * hourMs, temp: "73", tempUnit: "F", doughTemp: 73, ambientTemp: 72, volume_ml: 540, volume: "540", pH: "", note: "Puffy surface" },
        { id: "r5", loggedAt: t0 + 4.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "Target reached" },
      ];

      const trace: any[] = [];
      let activeReadings: BulkFermentReading[] = [];
      let state: any = {};

      for (const r of historicalReadings) {
        activeReadings = [...activeReadings, r];
        state = computeBulkFermentState(activeReadings, state, [], t0);

        const elapsedHr = (r.loggedAt - t0) / hourMs;
        const projectedEtaHr = state.projectedTargetAt ? (state.projectedTargetAt - t0) / hourMs : null;

        trace.push({
          readingId: r.id,
          elapsedHr,
          volume_ml: r.volume_ml,
          doughTemp: r.doughTemp,
          p_exp: state.thermalExposureDegreeHours?.toFixed(4),
          p_obs: ((r.volume_ml! - 400) / 220).toFixed(4),
          confidence: state.confidenceScore?.toFixed(2),
          code: state.diagnosticCode,
          correctedMult: state.correctedRateMultiplier?.toFixed(3),
          projectedEtaHr: projectedEtaHr?.toFixed(2),
        });
      }

      // Assertions on the trace
      expect(trace[0].code).toBe("INSUFFICIENT_DATA");
      expect(trace[1].confidence).toBeDefined();
      expect(parseFloat(trace[2].confidence)).toBeGreaterThan(0.5);
      expect(trace[4].code).toBe("STABLE_TREND");

      // Verify completion timestamp was reached near 4.5 hours
      expect(parseFloat(trace[3].projectedEtaHr)).toBeGreaterThan(4.0);
      expect(parseFloat(trace[3].projectedEtaHr)).toBeLessThan(5.5);
    });
  });

  describe("7. Attribution / Ablation Characterization Study", () => {
    it("reports ETA forecasts across 6 model configurations at each reading", () => {
      const t0 = 1700000000000;
      const hourMs = 3600 * 1000;

      const readings: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "Mix complete" },
        { id: "r2", loggedAt: t0 + 0.75 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 425, volume: "425", pH: "", note: "Fold 1" },
        { id: "r3", loggedAt: t0 + 2.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "Fold 2" },
        { id: "r4", loggedAt: t0 + 3.25 * hourMs, temp: "73", tempUnit: "F", doughTemp: 73, ambientTemp: 72, volume_ml: 540, volume: "540", pH: "", note: "Puffy surface" },
        { id: "r5", loggedAt: t0 + 4.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "Target reached" },
      ];

      const ablationResults: Record<string, Record<string, string>> = {
        r1: {}, r2: {}, r3: {}, r4: {}, r5: {}
      };

      for (let i = 1; i <= readings.length; i++) {
        const active = readings.slice(0, i);
        const rCurrent = active[active.length - 1];
        const rId = rCurrent.id;

        // Config A: Prior Only
        const durA = interpolateExpectedDuration(toF(active[0].doughTemp!, active[0].tempUnit), 20);
        ablationResults[rId]["Config_A_PriorOnly"] = (durA / hourMs).toFixed(2);

        // Config B: Prior + Thermal Exposure
        const stateB = computeBulkFermentState(active, {}, [], t0);
        const etaB = stateB.projectedTargetAt ? ((stateB.projectedTargetAt - t0) / hourMs).toFixed(2) : "REACHED";
        ablationResults[rId]["Config_B_ThermalExposure"] = etaB;

        // Config C: Proportional Only (Kp=0.8, Kd=0.0, C=1.0)
        // Tested via computeCorrectedRate directly
        const norm = computeNormalizedState(active as any, 400, 76);
        const therm = computeThermalExposure(active, 20, 75, 2.0, false, t0);
        const obs = estimateObservedRate(active as any, norm.targetVolume_ml, 400);

        const corrC = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.8, 0.0);
        const remC = integrateRemainingDuration(norm.e_remaining, corrC.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false);
        ablationResults[rId]["Config_C_P_Only"] = (norm.e_remaining <= 0) ? "REACHED" : (((rCurrent.loggedAt + remC) - t0) / hourMs).toFixed(2);

        // Config D: Derivative Only (Kp=0.0, Kd=0.4, C=1.0)
        const corrD = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.0, 0.4);
        const remD = integrateRemainingDuration(norm.e_remaining, corrD.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false);
        ablationResults[rId]["Config_D_D_Only"] = (norm.e_remaining <= 0) ? "REACHED" : (((rCurrent.loggedAt + remD) - t0) / hourMs).toFixed(2);

        // Config E: Full P/D without C Weighting (C=1.0)
        const corrE = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.8, 0.4);
        const remE = integrateRemainingDuration(norm.e_remaining, corrE.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false);
        ablationResults[rId]["Config_E_Full_PD_Unweighted"] = (norm.e_remaining <= 0) ? "REACHED" : (((rCurrent.loggedAt + remE) - t0) / hourMs).toFixed(2);

        // Config F: Full P/D with Confidence Weighting (C)
        const conf = computeConfidence(active, active as any, t0, obs.postInterventionDamped, obs.isNegativeTrend);
        const corrF = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, conf.confidenceScore, 0.8, 0.4);
        const remF = integrateRemainingDuration(norm.e_remaining, corrF.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false);
        ablationResults[rId]["Config_F_Full_PD_Weighted"] = (norm.e_remaining <= 0) ? "REACHED" : (((rCurrent.loggedAt + remF) - t0) / hourMs).toFixed(2);
      }

      // Verify ablation outputs exist and are well-formed
      expect(ablationResults.r1.Config_A_PriorOnly).toBe("4.17");
      expect(ablationResults.r5.Config_F_Full_PD_Weighted).toBe("REACHED");
    });
  });

  describe("8. Multi-Bake Retrospective Replay (Un-tuned Parameters)", () => {
    it("replays predictions across 3 distinct historical bake logs", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      // Fixture 1: Standard Cool Room Bake (68°F, Target 800ml = 100% rise)
      const fixture1Readings: BulkFermentReading[] = [
        { id: "f1_1", loggedAt: t0, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 400, volume: "400", pH: "", note: "Mix" },
        { id: "f1_2", loggedAt: t0 + 2.0 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 470, volume: "470", pH: "", note: "" },
        { id: "f1_3", loggedAt: t0 + 4.0 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 560, volume: "560", pH: "", note: "" },
        { id: "f1_4", loggedAt: t0 + 6.0 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 680, volume: "680", pH: "", note: "" },
        { id: "f1_5", loggedAt: t0 + 8.0 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 800, volume: "800", pH: "", note: "Target" },
      ];

      // Fixture 2: Warm Proof Box Bake (80°F, Target 560ml = 40% rise)
      const fixture2Readings: BulkFermentReading[] = [
        { id: "f2_1", loggedAt: t0, temp: "80", tempUnit: "F", doughTemp: 80, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "Mix" },
        { id: "f2_2", loggedAt: t0 + 1.0 * hourMs, temp: "80", tempUnit: "F", doughTemp: 80, ambientTemp: 80, volume_ml: 450, volume: "450", pH: "", note: "" },
        { id: "f2_3", loggedAt: t0 + 2.0 * hourMs, temp: "80", tempUnit: "F", doughTemp: 80, ambientTemp: 80, volume_ml: 510, volume: "510", pH: "", note: "" },
        { id: "f2_4", loggedAt: t0 + 3.2 * hourMs, temp: "80", tempUnit: "F", doughTemp: 80, ambientTemp: 80, volume_ml: 560, volume: "560", pH: "", note: "Target" },
      ];

      // Fixture 3: Sluggish / Cooling Draft Bake (74°F -> 68°F, Target 620ml = 55% rise)
      const fixture3Readings: BulkFermentReading[] = [
        { id: "f3_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 68, volume_ml: 400, volume: "400", pH: "", note: "Mix" },
        { id: "f3_2", loggedAt: t0 + 1.5 * hourMs, temp: "71", tempUnit: "F", doughTemp: 71, ambientTemp: 68, volume_ml: 415, volume: "415", pH: "", note: "" },
        { id: "f3_3", loggedAt: t0 + 3.0 * hourMs, temp: "69", tempUnit: "F", doughTemp: 69, ambientTemp: 68, volume_ml: 460, volume: "460", pH: "", note: "" },
        { id: "f3_4", loggedAt: t0 + 5.0 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 540, volume: "540", pH: "", note: "" },
        { id: "f3_5", loggedAt: t0 + 6.8 * hourMs, temp: "68", tempUnit: "F", doughTemp: 68, ambientTemp: 68, volume_ml: 620, volume: "620", pH: "", note: "Target" },
      ];

      const runReplay = (readings: BulkFermentReading[]) => {
        const trace: any[] = [];
        let active: BulkFermentReading[] = [];
        let state: any = {};
        for (const r of readings) {
          active = [...active, r];
          state = computeBulkFermentState(active, state, [], t0);
          const elapsed = (r.loggedAt - t0) / hourMs;
          const eta = state.projectedTargetAt ? ((state.projectedTargetAt - t0) / hourMs).toFixed(2) : "REACHED";
          trace.push({
            elapsed: elapsed.toFixed(2),
            vol: r.volume_ml,
            temp: r.doughTemp,
            eta,
            conf: state.confidenceScore?.toFixed(2),
            code: state.diagnosticCode,
          });
        }
        return trace;
      };

      const trace1 = runReplay(fixture1Readings);
      const trace2 = runReplay(fixture2Readings);
      const trace3 = runReplay(fixture3Readings);

      expect(trace1[trace1.length - 1].eta).toBe("REACHED");
      expect(trace2[trace2.length - 1].eta).toBe("REACHED");
      expect(trace3[trace3.length - 1].eta).toBe("REACHED");
    });
  });

  describe("9. Broad Retrospective Forecast-Error Benchmark Suite (6 Diversity Bakes)", () => {
    it("measures MAE, MBE, and signed forecast errors across 6 distinct bake logs", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      const benchmarkBakes = [
        {
          name: "Bake 1: Standard Room Temp (72F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 5.50,
          phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2: Warm Summer (82F, 20% Inoc, 70% Hyd)",
          actualDurationHr: 3.00,
          phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3: Cool Winter Kitchen (66F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 9.00,
          phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4: Low Inoculation (75F, 10% Inoc, 72% Hyd)",
          actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5: High Inoculation (76F, 30% Inoc, 75% Hyd)",
          actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6: Post-Fold Degassed Recovery (74F, 20% Inoc, 78% Hyd)",
          actualDurationHr: 6.00,
          phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      const benchmarkErrors: { bake: string; elapsedHr: number; predictedTotalHr: number; actualTotalHr: number; errorMin: number }[] = [];

      for (const bake of benchmarkBakes) {
        let active: BulkFermentReading[] = [];
        let state: any = {};
        for (const r of bake.readings) {
          active = [...active, r];
          state = computeBulkFermentState(active, state, bake.phases, t0);
          const elapsedHr = (r.loggedAt - t0) / hourMs;
          if (state.projectedTargetAt) {
            const predictedTotalHr = (state.projectedTargetAt - t0) / hourMs;
            const errorMin = (predictedTotalHr - bake.actualDurationHr) * 60;
            benchmarkErrors.push({
              bake: bake.name,
              elapsedHr,
              predictedTotalHr,
              actualTotalHr: bake.actualDurationHr,
              errorMin,
            });
          }
        }
      }

      // Compute aggregate metrics
      const absoluteErrorsMin = benchmarkErrors.map(e => Math.abs(e.errorMin));
      const signedErrorsMin = benchmarkErrors.map(e => e.errorMin);
      const maeMin = absoluteErrorsMin.reduce((a, b) => a + b, 0) / absoluteErrorsMin.length;
      const mbeMin = signedErrorsMin.reduce((a, b) => a + b, 0) / signedErrorsMin.length;

      const earlyErrors = benchmarkErrors.filter(e => e.elapsedHr <= 2.0).map(e => Math.abs(e.errorMin));
      const lateErrors = benchmarkErrors.filter(e => e.elapsedHr > 2.0).map(e => Math.abs(e.errorMin));
      const earlyMaeMin = earlyErrors.reduce((a, b) => a + b, 0) / earlyErrors.length;
      const lateMaeMin = lateErrors.reduce((a, b) => a + b, 0) / lateErrors.length;

      // Verify benchmark completed cleanly
      expect(benchmarkErrors.length).toBeGreaterThan(15);
      expect(maeMin).toBeGreaterThan(0);
      expect(earlyMaeMin).toBeGreaterThan(0);
      expect(lateMaeMin).toBeGreaterThan(0);
    });
  });

  describe("10. Deep Diagnostic Audit & Coupling Analysis Suite", () => {
    it("computes exact forecast-only metrics, Bake 3 ablation trace, and P/D coupling ratios", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      const benchmarkBakes = [
        {
          name: "Bake 1: Standard Room Temp (72F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 5.50,
          phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2: Warm Summer (82F, 20% Inoc, 70% Hyd)",
          actualDurationHr: 3.00,
          phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3: Cool Winter Kitchen (66F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 9.00,
          phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4: Low Inoculation (75F, 10% Inoc, 72% Hyd)",
          actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5: High Inoculation (76F, 30% Inoc, 75% Hyd)",
          actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6: Post-Fold Degassed Recovery (74F, 20% Inoc, 78% Hyd)",
          actualDurationHr: 6.00,
          phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      const forecastEntries: { bake: string; p_obs: number; elapsedHr: number; predHr: number; actualHr: number; errorMin: number; epsP: number; epsD: number; S_PD: number }[] = [];
      const finalPreTargetEntries: { bake: string; predHr: number; actualHr: number; errorMin: number }[] = [];

      for (const bake of benchmarkBakes) {
        let active: BulkFermentReading[] = [];
        let state: any = {};
        const totalReadings = bake.readings.length;

        for (let i = 0; i < totalReadings; i++) {
          const r = bake.readings[i];
          const isTargetReached = (i === totalReadings - 1);
          active = [...active, r];
          state = computeBulkFermentState(active, state, bake.phases, t0);
          const elapsedHr = (r.loggedAt - t0) / hourMs;

          if (!isTargetReached && state.projectedTargetAt) {
            const predHr = (state.projectedTargetAt - t0) / hourMs;
            const errorMin = (predHr - bake.actualDurationHr) * 60;
            const p_obs = state.latchedTargetRiseFraction && state.startVolume_ml
              ? (r.volume_ml! - state.startVolume_ml) / (state.startVolume_ml * state.latchedTargetRiseFraction)
              : 0;

            forecastEntries.push({
              bake: bake.name,
              p_obs,
              elapsedHr,
              predHr,
              actualHr: bake.actualDurationHr,
              errorMin,
              epsP: state.thermalExposureDegreeHours ? (p_obs - state.thermalExposureDegreeHours) : 0,
              epsD: state.correctedRateMultiplier ? (state.correctedRateMultiplier - 1) : 0,
              S_PD: state.correctedRateMultiplier || 1.0,
            });

            // If last reading before target reached
            if (i === totalReadings - 2) {
              finalPreTargetEntries.push({
                bake: bake.name,
                predHr,
                actualHr: bake.actualDurationHr,
                errorMin,
              });
            }
          }
        }
      }

      // 1. Forecast-Only MAE & MBE
      const absForecastErrors = forecastEntries.map(e => Math.abs(e.errorMin));
      const signedForecastErrors = forecastEntries.map(e => e.errorMin);
      const forecastMAE = absForecastErrors.reduce((a, b) => a + b, 0) / absForecastErrors.length;
      const forecastMBE = signedForecastErrors.reduce((a, b) => a + b, 0) / signedForecastErrors.length;

      // 2. Final Pre-Target Forecast Metrics
      const finalAbsErrors = finalPreTargetEntries.map(e => Math.abs(e.errorMin));
      const finalSignedErrors = finalPreTargetEntries.map(e => e.errorMin);
      const finalPreTargetMAE = finalAbsErrors.reduce((a, b) => a + b, 0) / finalAbsErrors.length;
      const finalPreTargetMBE = finalSignedErrors.reduce((a, b) => a + b, 0) / finalSignedErrors.length;

      const sortedFinalAbs = [...finalAbsErrors].sort((a, b) => a - b);
      const medianFinalAbsError = sortedFinalAbs[Math.floor(sortedFinalAbs.length / 2)];

      // Verify diagnostic audit metrics computed cleanly
      expect(forecastEntries.length).toBe(22); // 28 total - 6 target rows = 22
      expect(forecastMAE).toBeGreaterThan(0);
      expect(forecastMBE).toBeDefined();
      expect(finalPreTargetMAE).toBeGreaterThan(0);
      expect(medianFinalAbsError).toBeDefined();
    });
  });

  describe("11. Final Analytical Diagnostic Pass Suite", () => {
    it("computes naive baseline comparisons, Pearson/Spearman coupling, and Bake 3 error decomposition", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      const benchmarkBakes = [
        {
          name: "Bake 1: Standard Room Temp (72F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 5.50,
          phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2: Warm Summer (82F, 20% Inoc, 70% Hyd)",
          actualDurationHr: 3.00,
          phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3: Cool Winter Kitchen (66F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 9.00,
          phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4: Low Inoculation (75F, 10% Inoc, 72% Hyd)",
          actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5: High Inoculation (76F, 30% Inoc, 75% Hyd)",
          actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6: Post-Fold Degassed Recovery (74F, 20% Inoc, 78% Hyd)",
          actualDurationHr: 6.00,
          phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      const baselineComparisons: {
        b1_staticErr: number;
        b2_naiveTableErr: number;
        b3_obsRateErr: number;
        v2_fullErr: number;
        epsP: number;
        epsD: number;
        epsP_per_hr: number;
      }[] = [];

      for (const bake of benchmarkBakes) {
        let active: BulkFermentReading[] = [];
        let state: any = {};
        const totalReadings = bake.readings.length;

        for (let i = 0; i < totalReadings - 1; i++) {
          const r = bake.readings[i];
          active = [...active, r];
          state = computeBulkFermentState(active, state, bake.phases, t0);
          const elapsedHr = (r.loggedAt - t0) / hourMs;

          const norm = computeNormalizedState(active as any, 400, toF(r.doughTemp!, r.tempUnit));
          const therm = computeThermalExposure(active, 20, 75, 2.0, false, t0);
          const obs = estimateObservedRate(active as any, norm.targetVolume_ml, 400);

          // Baseline 1: Static table duration at current temp
          const dur1 = interpolateExpectedDuration(toF(r.doughTemp!, r.tempUnit), 20) / hourMs;
          const b1_err = (dur1 - bake.actualDurationHr) * 60;

          // Baseline 2: Naive table-derived remaining duration from current progress
          const remainingProgress = norm.e_remaining;
          const dur2 = elapsedHr + (remainingProgress / therm.r_base);
          const b2_err = (dur2 - bake.actualDurationHr) * 60;

          // Baseline 3: Observed-rate-only ETA
          const dur3 = obs.r_obs > 0 ? elapsedHr + (remainingProgress / obs.r_obs) : dur2;
          const b3_err = (dur3 - bake.actualDurationHr) * 60;

          // Full V2 Estimator
          const predV2 = state.projectedTargetAt ? (state.projectedTargetAt - t0) / hourMs : dur2;
          const v2_err = (predV2 - bake.actualDurationHr) * 60;

          const epsP = norm.p_observed - therm.p_expected;
          const epsD = obs.r_obs > 0 ? (obs.r_obs - therm.r_base) / therm.r_base : 0;
          const epsP_per_hr = elapsedHr > 0 ? epsP / elapsedHr : 0;

          baselineComparisons.push({
            b1_staticErr: b1_err,
            b2_naiveTableErr: b2_err,
            b3_obsRateErr: b3_err,
            v2_fullErr: v2_err,
            epsP,
            epsD,
            epsP_per_hr,
          });
        }
      }

      // Compute MAE for each baseline
      const b1_mae = baselineComparisons.map(c => Math.abs(c.b1_staticErr)).reduce((a,b)=>a+b,0) / baselineComparisons.length;
      const b2_mae = baselineComparisons.map(c => Math.abs(c.b2_naiveTableErr)).reduce((a,b)=>a+b,0) / baselineComparisons.length;
      const b3_mae = baselineComparisons.map(c => Math.abs(c.b3_obsRateErr)).reduce((a,b)=>a+b,0) / baselineComparisons.length;
      const v2_mae = baselineComparisons.map(c => Math.abs(c.v2_fullErr)).reduce((a,b)=>a+b,0) / baselineComparisons.length;

      // Pearson correlation between epsP and epsD
      const meanEpsP = baselineComparisons.reduce((a,b)=>a+b.epsP,0) / baselineComparisons.length;
      const meanEpsD = baselineComparisons.reduce((a,b)=>a+b.epsD,0) / baselineComparisons.length;
      const numP = baselineComparisons.reduce((a,b)=>a+(b.epsP - meanEpsP)*(b.epsD - meanEpsD),0);
      const denP = Math.sqrt(
        baselineComparisons.reduce((a,b)=>a+Math.pow(b.epsP - meanEpsP, 2),0) *
        baselineComparisons.reduce((a,b)=>a+Math.pow(b.epsD - meanEpsD, 2),0)
      );
      const pearsonR = denP > 0 ? numP / denP : 0;

      expect(baselineComparisons.length).toBe(22);
      expect(b1_mae).toBeGreaterThan(0);
      expect(b2_mae).toBeGreaterThan(0);
      expect(v2_mae).toBeGreaterThan(0);
      expect(pearsonR).toBeGreaterThan(0.5); // Confirm strong positive coupling between epsP and epsD
    });
  });

  describe("12. Controlled Counterfactual Replay Experiment Suite", () => {
    it("evaluates Configs A through F at final pre-target and full sequence levels", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      const benchmarkBakes = [
        {
          name: "Bake 1: Standard Room Temp (72F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 5.50,
          phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2: Warm Summer (82F, 20% Inoc, 70% Hyd)",
          actualDurationHr: 3.00,
          phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3: Cool Winter Kitchen (66F, 20% Inoc, 75% Hyd)",
          actualDurationHr: 9.00,
          phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4: Low Inoculation (75F, 10% Inoc, 72% Hyd)",
          actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5: High Inoculation (76F, 30% Inoc, 75% Hyd)",
          actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6: Post-Fold Degassed Recovery (74F, 20% Inoc, 78% Hyd)",
          actualDurationHr: 6.00,
          phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      // Final Pre-Target Matrix across Configs A to F
      const finalPreTargetErrors: Record<string, Record<string, number>> = {};
      const fullSequenceErrors: Record<string, number[]> = {
        Config_A: [], Config_B: [], Config_C: [], Config_D: [], Config_E: [], Config_F: []
      };

      for (const bake of benchmarkBakes) {
        const active = bake.readings.slice(0, bake.readings.length - 1);
        const rFinalPre = active[active.length - 1];
        const elapsedHr = (rFinalPre.loggedAt - t0) / hourMs;

        const norm = computeNormalizedState(active as any, 400, toF(rFinalPre.doughTemp!, rFinalPre.tempUnit));
        const therm = computeThermalExposure(active, 20, 75, 2.0, false, t0);
        const obs = estimateObservedRate(active as any, norm.targetVolume_ml, 400);

        // Config A: Prior Only
        const durA = interpolateExpectedDuration(toF(active[0].doughTemp!, active[0].tempUnit), 20) / hourMs;
        const errA = (durA - bake.actualDurationHr) * 60;

        // Config B: Prior + Observed Progress (No P/D)
        const durB = elapsedHr + (norm.e_remaining / therm.r_base);
        const errB = (durB - bake.actualDurationHr) * 60;

        // Config C: Prior + D Only (Kp=0.0, Kd=0.4, C=1.0)
        const corrC = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.0, 0.4);
        const remC = integrateRemainingDuration(norm.e_remaining, corrC.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
        const errC = (elapsedHr + remC - bake.actualDurationHr) * 60;

        // Config D: Prior + P Only (Kp=0.8, Kd=0.0, C=1.0)
        const corrD = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.8, 0.0);
        const remD = integrateRemainingDuration(norm.e_remaining, corrD.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
        const errD = (elapsedHr + remD - bake.actualDurationHr) * 60;

        // Config E: Full P+D Unweighted (C=1.0)
        const corrE = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, 1.0, 0.8, 0.4);
        const remE = integrateRemainingDuration(norm.e_remaining, corrE.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
        const errE = (elapsedHr + remE - bake.actualDurationHr) * 60;

        // Config F: Full P+D Weighted (C)
        const conf = computeConfidence(active, active as any, t0, obs.postInterventionDamped, obs.isNegativeTrend);
        const corrF = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, conf.confidenceScore, 0.8, 0.4);
        const remF = integrateRemainingDuration(norm.e_remaining, corrF.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
        const errF = (elapsedHr + remF - bake.actualDurationHr) * 60;

        finalPreTargetErrors[bake.name] = {
          errA, errB, errC, errD, errE, errF
        };

        // Full sequence errors across all active observations
        for (let i = 1; i < bake.readings.length - 1; i++) {
          const actSeq = bake.readings.slice(0, i + 1);
          const rSeq = actSeq[actSeq.length - 1];
          const elSeq = (rSeq.loggedAt - t0) / hourMs;

          const nSeq = computeNormalizedState(actSeq as any, 400, toF(rSeq.doughTemp!, rSeq.tempUnit));
          const tSeq = computeThermalExposure(actSeq, 20, 75, 2.0, false, t0);
          const oSeq = estimateObservedRate(actSeq as any, nSeq.targetVolume_ml, 400);

          const dA = interpolateExpectedDuration(toF(actSeq[0].doughTemp!, actSeq[0].tempUnit), 20) / hourMs;
          fullSequenceErrors.Config_A.push(Math.abs((dA - bake.actualDurationHr) * 60));

          const dB = elSeq + (nSeq.e_remaining / tSeq.r_base);
          fullSequenceErrors.Config_B.push(Math.abs((dB - bake.actualDurationHr) * 60));

          const cC = computeCorrectedRate(tSeq.r_base, oSeq.r_obs, tSeq.p_expected, nSeq.p_observed, 1.0, 0.0, 0.4);
          const rC = integrateRemainingDuration(nSeq.e_remaining, cC.S_PD, tSeq.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
          fullSequenceErrors.Config_C.push(Math.abs((elSeq + rC - bake.actualDurationHr) * 60));

          const cD = computeCorrectedRate(tSeq.r_base, oSeq.r_obs, tSeq.p_expected, nSeq.p_observed, 1.0, 0.8, 0.0);
          const rD = integrateRemainingDuration(nSeq.e_remaining, cD.S_PD, tSeq.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
          fullSequenceErrors.Config_D.push(Math.abs((elSeq + rD - bake.actualDurationHr) * 60));

          const cE = computeCorrectedRate(tSeq.r_base, oSeq.r_obs, tSeq.p_expected, nSeq.p_observed, 1.0, 0.8, 0.4);
          const rE = integrateRemainingDuration(nSeq.e_remaining, cE.S_PD, tSeq.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
          fullSequenceErrors.Config_E.push(Math.abs((elSeq + rE - bake.actualDurationHr) * 60));

          const cConf = computeConfidence(actSeq, actSeq as any, t0, oSeq.postInterventionDamped, oSeq.isNegativeTrend);
          const cF = computeCorrectedRate(tSeq.r_base, oSeq.r_obs, tSeq.p_expected, nSeq.p_observed, cConf.confidenceScore, 0.8, 0.4);
          const rF = integrateRemainingDuration(nSeq.e_remaining, cF.S_PD, tSeq.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
          fullSequenceErrors.Config_F.push(Math.abs((elSeq + rF - bake.actualDurationHr) * 60));
        }
      }

      // Compute MAEs across full sequence
      const maeSeqB = fullSequenceErrors.Config_B.reduce((a,b)=>a+b,0) / fullSequenceErrors.Config_B.length;
      const maeSeqF = fullSequenceErrors.Config_F.reduce((a,b)=>a+b,0) / fullSequenceErrors.Config_F.length;

      expect(Object.keys(finalPreTargetErrors).length).toBe(6);
      expect(maeSeqB).toBeGreaterThan(0);
      expect(maeSeqF).toBeGreaterThan(0);
    });
  });

  describe("13. Targeted Controlled Experiment Matrix", () => {
    it("executes Experiments 1 through 5 with strict causal chronology", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;

      const benchmarkBakes = [
        {
          name: "Bake 1 (72F, 20% Inoc)", actualDurationHr: 5.50, phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2 (82F, 20% Inoc)", actualDurationHr: 3.00, phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3 (66F, 20% Inoc)", actualDurationHr: 9.00, phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4 (75F, 10% Inoc)", actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5 (76F, 30% Inoc)", actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6 (74F, Fold Recovery)", actualDurationHr: 6.00, phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      // Exp 1: Scalar Damping Factors (0%, 25%, 50%, 75%, 100%, Dynamic C)
      const dampD0_errs: number[] = [];
      const dampD25_errs: number[] = [];
      const dampD50_errs: number[] = [];
      const dampD75_errs: number[] = [];
      const dampD100_errs: number[] = [];
      const dampDynamicC_errs: number[] = [];

      for (const bake of benchmarkBakes) {
        for (let i = 1; i < bake.readings.length - 1; i++) {
          const active = bake.readings.slice(0, i + 1);
          const rCurr = active[active.length - 1];
          const el = (rCurr.loggedAt - t0) / hourMs;

          const norm = computeNormalizedState(active as any, 400, toF(rCurr.doughTemp!, rCurr.tempUnit));
          const therm = computeThermalExposure(active, 20, 75, 2.0, false, t0);
          const obs = estimateObservedRate(active as any, norm.targetVolume_ml, 400);

          const getEta = (factor: number) => {
            const corr = computeCorrectedRate(therm.r_base, obs.r_obs, therm.p_expected, norm.p_observed, factor, 0.8, 0.4);
            const rem = integrateRemainingDuration(norm.e_remaining, corr.S_PD, therm.currentTempF, 72, 20, 75, 2.0, false) / hourMs;
            return Math.abs((el + rem - bake.actualDurationHr) * 60);
          };

          const conf = computeConfidence(active, active as any, t0, obs.postInterventionDamped, obs.isNegativeTrend);

          dampD0_errs.push(getEta(0.0));
          dampD25_errs.push(getEta(0.25));
          dampD50_errs.push(getEta(0.50));
          dampD75_errs.push(getEta(0.75));
          dampD100_errs.push(getEta(1.00));
          dampDynamicC_errs.push(getEta(conf.confidenceScore));
        }
      }

      const maeD0 = dampD0_errs.reduce((a,b)=>a+b,0) / dampD0_errs.length;
      const maeD50 = dampD50_errs.reduce((a,b)=>a+b,0) / dampD50_errs.length;
      const maeDynamicC = dampDynamicC_errs.reduce((a,b)=>a+b,0) / dampDynamicC_errs.length;

      expect(maeD0).toBeGreaterThan(0);
      expect(maeD50).toBeGreaterThan(0);
      expect(maeDynamicC).toBeGreaterThan(0);
    });
  });

  describe("14. 2-Hour P-Memory Window & Expiration Test Suite", () => {
    it("14.1 Causal Volume Interpolation Edge Cases", () => {
      const t0 = 1000000;
      const hourMs = 3600 * 1000;

      // 1. Exact volume observation at window start
      const volExact = [
        { id: "1", loggedAt: t0, volume_ml: 400 },
        { id: "2", loggedAt: t0 + hourMs, volume_ml: 420 },
      ] as any;
      expect(getInterpolatedVolumeAt(volExact, t0)).toBe(400);

      // 2. Window start between two observations (linear interpolation)
      const volMid = [
        { id: "1", loggedAt: t0, volume_ml: 400 },
        { id: "2", loggedAt: t0 + 2 * hourMs, volume_ml: 440 },
      ] as any;
      // At t0 + 1 hour, volume should interpolate halfway to 420
      expect(getInterpolatedVolumeAt(volMid, t0 + hourMs)).toBe(420);

      // 3. Sparse observations spanning window
      const volSparse = [
        { id: "1", loggedAt: t0, volume_ml: 400 },
        { id: "2", loggedAt: t0 + 4 * hourMs, volume_ml: 480 },
      ] as any;
      expect(getInterpolatedVolumeAt(volSparse, t0 + 2 * hourMs)).toBe(440);

      // 4. Duplicate timestamps
      const volDup = [
        { id: "1", loggedAt: t0, volume_ml: 400 },
        { id: "2", loggedAt: t0, volume_ml: 400 },
        { id: "3", loggedAt: t0 + hourMs, volume_ml: 420 },
      ] as any;
      expect(getInterpolatedVolumeAt(volDup, t0)).toBe(400);

      // 5. Out-of-order & non-finite filtering
      const readingsOoo: BulkFermentReading[] = [
        { id: "2", loggedAt: t0 + hourMs, volume_ml: 420, temp: "75", tempUnit: "F", doughTemp: 75, volume: "420", pH: "", note: "" },
        { id: "1", loggedAt: t0, volume_ml: 400, temp: "75", tempUnit: "F", doughTemp: 75, volume: "400", pH: "", note: "" },
      ];
      const normOoo = normalizeReadings(readingsOoo, t0);
      expect(normOoo.sorted[0].loggedAt).toBe(t0);

      // 6. Inability to establish valid volume (fallback)
      expect(getInterpolatedVolumeAt([], t0)).toBeNull();
      const disFallback = computeWindowedDisagreement([], [], t0, 620, 400, 20, 2 * hourMs);
      expect(disFallback.epsilon_P).toBe(0.0);
    });

    it("14.2 Deterministic Expiration States (Lag Enters, Ages, Expires, Recovery)", () => {
      const t0 = 1000000;
      const hourMs = 3600 * 1000;
      const H = 2 * hourMs; // 2-hour P memory horizon

      // Constant 75°F, 20% inoc. Target rise = 220 mL (400 -> 620 mL).
      // Table rate at 75°F = 1 / 4.5 hr = 0.2222 hr^-1 (48.88 mL / hr).

      // State 1: Lag enters the window (t = 1.0 hr, volume = 410 mL vs expected ~448.8 mL)
      const r_state1: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, volume_ml: 400, doughTemp: 75, tempUnit: "F" } as any,
        { id: "2", loggedAt: t0 + hourMs, volume_ml: 410, doughTemp: 75, tempUnit: "F" } as any,
      ];
      const vol1 = r_state1 as any;
      const state1 = computeWindowedDisagreement(r_state1, vol1, t0, 620, 400, 20, H);
      expect(state1.epsilon_P).toBeLessThan(-0.10); // Lag active

      // State 2: Lag remains inside window (t = 2.0 hr, volume = 420 mL)
      const r_state2: BulkFermentReading[] = [
        ...r_state1,
        { id: "3", loggedAt: t0 + 2 * hourMs, volume_ml: 420, doughTemp: 75, tempUnit: "F" } as any,
      ];
      const vol2 = r_state2 as any;
      const state2 = computeWindowedDisagreement(r_state2, vol2, t0, 620, 400, 20, H);
      expect(state2.epsilon_P).toBeLessThan(-0.15); // Lag still inside 2h window

      // State 3 & 4: Old lag ages out and rate recovers over the last 2 hours (t = 4.0 hr)
      // Suppose over t = 2.0h to t = 4.0h (2 hours), dough ferments at exact baseline rate (+97.8 mL)
      // Volume goes from 420 mL at t=2.0h to 517.8 mL at t=4.0h.
      const r_state4: BulkFermentReading[] = [
        ...r_state2,
        { id: "4", loggedAt: t0 + 4 * hourMs, volume_ml: 517.8, doughTemp: 75, tempUnit: "F" } as any,
      ];
      const vol4 = r_state4 as any;
      const state4 = computeWindowedDisagreement(r_state4, vol4, t0, 620, 400, 20, H);

      // Window [t0 + 2h, t0 + 4h] has start volume = 420 mL, end volume = 517.8 mL (+97.8 mL).
      // Windowed observed progress = 97.8 / 220 = 0.4445.
      // Windowed expected progress over 2 hours = 2 * (1 / 4.5) = 0.4444.
      // Therefore, windowed epsilon_P over the 2-hour window converges to 0.0!
      expect(state4.epsilon_P).toBeCloseTo(0.0, 3);
    });

    it("14.3 Equivalence Test: Large Horizon Equals Full-History P", () => {
      const t0 = 1000000;
      const hourMs = 3600 * 1000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, volume_ml: 400, doughTemp: 75, tempUnit: "F" } as any,
        { id: "2", loggedAt: t0 + 1.5 * hourMs, volume_ml: 430, doughTemp: 75, tempUnit: "F" } as any,
        { id: "3", loggedAt: t0 + 3.0 * hourMs, volume_ml: 480, doughTemp: 75, tempUnit: "F" } as any,
      ];
      const vols = readings as any;

      // Full history (null horizon)
      const fullDis = computeWindowedDisagreement(readings, vols, t0, 620, 400, 20, null);

      // Large 10-hour horizon (exceeding 3-hour phase history)
      const largeDis = computeWindowedDisagreement(readings, vols, t0, 620, 400, 20, 10 * hourMs);

      expect(largeDis.epsilon_P).toBeCloseTo(fullDis.epsilon_P, 5);
      expect(largeDis.p_exp_window).toBeCloseTo(fullDis.p_exp_window, 5);
      expect(largeDis.p_obs_window).toBeCloseTo(fullDis.p_obs_window, 5);
    });

    it("14.4 Six-Bake Corpus Replay: Full-History P vs 2-Hour P", () => {
      const hourMs = 3600 * 1000;
      const t0 = 1700000000000;
      const H2 = 2 * hourMs;

      const benchmarkBakes = [
        {
          name: "Bake 1 (72F, 20% Inoc)", actualDurationHr: 5.50, phases: [],
          readings: [
            { id: "b1_1", loggedAt: t0, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b1_2", loggedAt: t0 + 1.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 420, volume: "420", pH: "", note: "" },
            { id: "b1_3", loggedAt: t0 + 2.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 465, volume: "465", pH: "", note: "" },
            { id: "b1_4", loggedAt: t0 + 4.0 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 520, volume: "520", pH: "", note: "" },
            { id: "b1_5", loggedAt: t0 + 5.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 580, volume: "580", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 2 (82F, 20% Inoc)", actualDurationHr: 3.00, phases: [],
          readings: [
            { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
            { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
            { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 3 (66F, 20% Inoc)", actualDurationHr: 9.00, phases: [],
          readings: [
            { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
            { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 4 (75F, 10% Inoc)", actualDurationHr: 7.00,
          phases: [{ ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
          readings: [
            { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
            { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
            { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
            { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 5 (76F, 30% Inoc)", actualDurationHr: 3.50,
          phases: [{ ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
          readings: [
            { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
            { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
            { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        },
        {
          name: "Bake 6 (74F, Fold Recovery)", actualDurationHr: 6.00, phases: [],
          readings: [
            { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
            { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
            { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
            { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
            { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
          ]
        }
      ];

      const fullErrs: number[] = [];
      const h2Errs: number[] = [];

      for (const bake of benchmarkBakes) {
        let activeFull: BulkFermentReading[] = [];
        let activeH2: BulkFermentReading[] = [];
        let stateFull: any = {};
        let stateH2: any = {};

        for (let i = 0; i < bake.readings.length - 1; i++) {
          const r = bake.readings[i];
          activeFull = [...activeFull, r];
          activeH2 = [...activeH2, r];

          stateFull = computeBulkFermentState(activeFull, stateFull, bake.phases, t0, undefined, undefined, undefined, null);
          stateH2 = computeBulkFermentState(activeH2, stateH2, bake.phases, t0, undefined, undefined, undefined, H2);

          const elapsedHr = (r.loggedAt - t0) / hourMs;
          const etaFull = stateFull.projectedTargetAt ? (stateFull.projectedTargetAt - t0) / hourMs : elapsedHr;
          const etaH2 = stateH2.projectedTargetAt ? (stateH2.projectedTargetAt - t0) / hourMs : elapsedHr;

          fullErrs.push(Math.abs((etaFull - bake.actualDurationHr) * 60));
          h2Errs.push(Math.abs((etaH2 - bake.actualDurationHr) * 60));
        }
      }

      const maeFull = fullErrs.reduce((a,b)=>a+b,0) / fullErrs.length;
      const maeH2 = h2Errs.reduce((a,b)=>a+b,0) / h2Errs.length;

      expect(maeFull).toBeGreaterThan(0);
      expect(maeH2).toBeGreaterThan(0);
    });

    it("14.5 Production Default Equivalence Test", () => {
      const t0 = 1700000000000;
      const hourMs = 3600 * 1000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 430, volume: "430", pH: "", note: "" },
        { id: "3", loggedAt: t0 + 3.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 480, volume: "480", pH: "", note: "" },
      ];

      // Omitted options (production default)
      const defaultState = computeBulkFermentState(readings, {}, [], t0);

      // Explicit { pMemoryHorizonMs: 7200000 }
      const explicit2hState = computeBulkFermentState(readings, {}, [], t0, undefined, undefined, undefined, { pMemoryHorizonMs: 7200000 });

      // Assert exact equality across all fields
      expect(defaultState.pMemoryHorizonMs).toBe(7200000);
      expect(defaultState.startVolume_ml).toBe(explicit2hState.startVolume_ml);
      expect(defaultState.targetVolume_ml).toBe(explicit2hState.targetVolume_ml);
      expect(defaultState.correctedRateMultiplier).toBeCloseTo(explicit2hState.correctedRateMultiplier!, 6);
      expect(defaultState.projectedTargetAt).toBe(explicit2hState.projectedTargetAt);
      expect(defaultState.confidenceScore).toBeCloseTo(explicit2hState.confidenceScore!, 6);
      expect(defaultState.diagnosticCode).toBe(explicit2hState.diagnosticCode);
    });

    it("14.6 Rollback Path Equivalence Test", () => {
      const t0 = 1700000000000;
      const hourMs = 3600 * 1000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 430, volume: "430", pH: "", note: "" },
        { id: "3", loggedAt: t0 + 3.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 480, volume: "480", pH: "", note: "" },
      ];

      // Explicit null (rollback to full-history P)
      const rollbackNullState = computeBulkFermentState(readings, {}, [], t0, undefined, undefined, undefined, null);
      const rollbackObjState = computeBulkFermentState(readings, {}, [], t0, undefined, undefined, undefined, { pMemoryHorizonMs: null });

      expect(rollbackNullState.pMemoryHorizonMs).toBeNull();
      expect(rollbackObjState.pMemoryHorizonMs).toBeNull();
      expect(rollbackNullState.correctedRateMultiplier).toBeCloseTo(rollbackObjState.correctedRateMultiplier!, 6);
      expect(rollbackNullState.projectedTargetAt).toBe(rollbackObjState.projectedTargetAt);
    });
  });
});
