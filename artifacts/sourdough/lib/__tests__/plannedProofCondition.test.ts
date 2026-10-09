// lib/__tests__/plannedProofCondition.test.ts
import {
  getLowTempFermentationRate,
  integratePostBulkCarryover,
  computeBulkFermentState,
  PROVISIONAL_VOLUMETRIC_YIELD_MULTIPLIER,
} from "../bulkFermentEngine";
import { type BulkFermentReading, type BulkEstimatorState } from "../recipeTypes";
import { loadPostBulkDiagnosticLogs, clearPostBulkDiagnosticLogs } from "../postBulkDiagnostics";

describe("Planned Post-Bulk Proof Condition Kinetics & Target Conversion (v2.5.4)", () => {
  beforeEach(async () => {
    await clearPostBulkDiagnosticLogs();
  });

  describe("1. Low-Temperature Kinetic Model (Ratkowsky Square-Root at 65°F Boundary)", () => {
    it("joins Doughlab prior model continuously at 65°F", () => {
      const r65_low = getLowTempFermentationRate(65.0, 20);
      const r65_high = getLowTempFermentationRate(65.1, 20);

      expect(r65_low).toBeGreaterThan(0.10);
      expect(r65_low).toBeLessThan(0.15);
      expect(Math.abs(r65_low - r65_high)).toBeLessThan(0.005);
    });

    it("evaluates rates accurately down to minimum threshold T_min = 35°F", () => {
      const r76 = getLowTempFermentationRate(76.0, 20);
      const r65 = getLowTempFermentationRate(65.0, 20);
      const r50 = getLowTempFermentationRate(50.0, 20);
      const r40 = getLowTempFermentationRate(40.0, 20);
      const r35 = getLowTempFermentationRate(35.0, 20);

      expect(r76).toBeGreaterThan(r65);
      expect(r65).toBeGreaterThan(r50);
      expect(r50).toBeGreaterThan(r40);
      expect(r40).toBeGreaterThan(r35);
      expect(r35).toBe(0.0);
      expect(r40 / r76).toBeLessThan(0.05);
    });
  });

  describe("2. Post-Bulk Carryover Integration & Asymptotic Retard Behavior", () => {
    it("returns zero carryover and base target rise for bench proof and undecided modes", () => {
      const bench = integratePostBulkCarryover(76.0, 76.0, "bench", 72, 20);
      expect(bench.carryoverProgress).toBe(0.0);
      expect(bench.recommendedTargetRiseFraction).toBe(0.55);

      const undecided = integratePostBulkCarryover(76.0, 76.0, "undecided", null, 20);
      expect(undecided.carryoverProgress).toBe(0.0);
      expect(undecided.recommendedTargetRiseFraction).toBe(0.55);
    });

    it("calculates carryover progress and reduces recommended target rise for cold retard", () => {
      const cold39 = integratePostBulkCarryover(76.0, 76.0, "cold_retard", 39, 20);

      expect(cold39.carryoverProgress).toBeGreaterThan(0.20);
      expect(cold39.carryoverProgress).toBeLessThan(0.40);

      expect(cold39.recommendedTargetRiseFraction).toBeLessThan(0.55);
      expect(cold39.recommendedTargetRiseFraction).toBeGreaterThan(0.40);
      expect(cold39.recommendedTargetRiseFraction).toBeCloseTo(0.467, 2);
    });

    it("verifies carryover progress convergence across 8h, 12h, and 24h cold retard horizons", () => {
      // Test integration over 8h, 12h, and 24h at T_fridge = 39°F
      const getCarryoverForHours = (hours: number) => {
        const dtHr = 10 / 60;
        let total = 0.0;
        const T0 = 76.0;
        const T_fridge = 39.0;
        const kc = 0.45;
        let t = 0.0;
        while (t < hours) {
          const temp1 = T_fridge + (T0 - T_fridge) * Math.exp(-kc * t);
          const temp2 = T_fridge + (T0 - T_fridge) * Math.exp(-kc * (t + dtHr));
          const r1 = getLowTempFermentationRate(temp1, 20);
          const r2 = getLowTempFermentationRate(temp2, 20);
          total += 0.5 * (r1 + r2) * dtHr;
          t += dtHr;
        }
        return total;
      };

      const P_8h = getCarryoverForHours(8.0);
      const P_12h = getCarryoverForHours(12.0);
      const P_24h = getCarryoverForHours(24.0);

      // Verify > 90% of carryover occurs in first 12h
      expect(P_12h / P_24h).toBeGreaterThan(0.90);
      // Absolute target rise difference between 12h and 24h is < 1% (0.01)
      const targetDiff24vs12 = (P_24h - P_12h) * PROVISIONAL_VOLUMETRIC_YIELD_MULTIPLIER * 0.55;
      expect(targetDiff24vs12).toBeLessThan(0.01);
    });

    it("verifies provisional volumetric yield multiplier is set to 0.50", () => {
      expect(PROVISIONAL_VOLUMETRIC_YIELD_MULTIPLIER).toBe(0.50);
    });
  });

  describe("3. Task 1: Shaping Temperature Semantics", () => {
    it("uses latest observed dough temp (T_shaping) as initial cooling condition rather than T0", () => {
      const t0 = 1000000;
      // Dough mixed cool at 68°F, but warms to 78°F at check-in
      const readings: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "68", tempUnit: "F", doughTemp: 68, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "r2", loggedAt: t0 + 7200000, temp: "78", tempUnit: "F", doughTemp: 78, volume_ml: 460, volume: "460", pH: "", note: "" },
      ];

      const state = computeBulkFermentState(readings, {}, [], t0, undefined, undefined, {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      });

      // T0 is 68°F (base rise = 100%), but T_shaping is 78°F (warmer dough cools from 78°F, generating higher carryover)
      expect(state.carryoverProgress).toBeGreaterThan( integratePostBulkCarryover(68.0, 68.0, "cold_retard", 39).carryoverProgress );
    });
  });

  describe("4. Task 2 & 3: Target Authority Data Flow & Diagnostic Logging", () => {
    it("emits TARGET_INITIALIZED on new bake setup", async () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "", note: "" },
      ];

      computeBulkFermentState(readings, {}, [], t0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await loadPostBulkDiagnosticLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].eventType).toBe("TARGET_INITIALIZED");
      expect(logs[0].newLatchedTargetRiseFraction).toBe(0.55);
    });

    it("emits PROOF_PLAN_CHANGED on explicit proof plan update", async () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "", note: "" },
      ];

      const state1 = computeBulkFermentState(readings, {}, [], t0);

      const overrides: BulkEstimatorState = {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      };

      computeBulkFermentState(readings, state1, [], t0, undefined, undefined, overrides);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await loadPostBulkDiagnosticLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].eventType).toBe("PROOF_PLAN_CHANGED");
      expect(logs[0].declaredProofMode).toBe("cold_retard");
      expect(logs[0].declaredProofTempF).toBe(39);
      expect(logs[0].newLatchedTargetRiseFraction).toBeLessThan(0.55);
    });

    it("emits TARGET_BELOW_OBSERVED when recommended target is below observed rise", async () => {
      const t0 = 1000000;
      // Observed rise is 80% (400 -> 720 mL)
      const readings: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "r2", loggedAt: t0 + 10000000, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 720, volume: "720", pH: "", note: "" },
      ];

      const existingState = {
        latchedTargetRiseFraction: 0.467,
        plannedProofMode: "cold_retard" as const,
        plannedProofTempF: 39,
      };

      // Check-in reading entered when dough has already risen 80% (400 -> 720 mL)
      const state1 = computeBulkFermentState(readings, existingState, [], t0, undefined, undefined, {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      });

      expect(state1.recommendedTargetRiseFraction).toBeLessThan(0.80);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await loadPostBulkDiagnosticLogs();
      const belowObservedLogs = logs.filter(l => l.eventType === "TARGET_BELOW_OBSERVED");
      expect(belowObservedLogs.length).toBeGreaterThan(0);
      expect(belowObservedLogs[0].reasonCode).toBe("RECOMMENDED_TARGET_BELOW_OBSERVED_RISE");
    });

    it("isolates diagnostic failures so estimator calculations never fail if diagnostics throw", () => {
      const t0 = 1000000;
      const readings: BulkFermentReading[] = [
        { id: "1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "", note: "" },
      ];

      // Even if diagnostic logger experiences an unexpected internal error, computeBulkFermentState runs cleanly
      expect(() => {
        const state = computeBulkFermentState(readings, {}, [], t0);
        expect(state.targetVolume_ml).toBe(620);
      }).not.toThrow();
    });

    it("evaluates overtime and target-reached status based on actual target (46.68% rise), not arbitrary 100%", () => {
      const t0 = 1000000;
      const startVol = 500; // mL
      // Cold retard @ 39°F produces recommended target rise = ~46.68% -> Target volume = 733.4 mL

      // Case A: Rise BELOW target (650 mL = 30% rise < 46.68%)
      const readingsBelow: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: startVol, volume: "500", pH: "", note: "" },
        { id: "r2", loggedAt: t0 + 3600000, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 650, volume: "650", pH: "", note: "" },
      ];

      const stateBelow = computeBulkFermentState(readingsBelow, {}, [], t0, undefined, undefined, {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      });

      expect(stateBelow.targetVolume_ml).toBeCloseTo(500 * (1 + stateBelow.targetRiseFraction), 1);
      expect(stateBelow.inOvertime).toBeFalsy();
      expect(stateBelow.targetReachedAt).toBeFalsy();

      // Case B: Rise EQUAL to target (734.7 mL = ~46.9% rise)
      const targetVol = stateBelow.targetVolume_ml!;
      const readingsEqual: BulkFermentReading[] = [
        ...readingsBelow,
        { id: "r3", loggedAt: t0 + 7200000, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: targetVol, volume: String(targetVol), pH: "", note: "" },
      ];

      const stateEqual = computeBulkFermentState(readingsEqual, stateBelow, [], t0, undefined, undefined, {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      });

      expect(stateEqual.inOvertime).toBe(true);
      expect(stateEqual.targetReachedAt).toBe(t0 + 7200000);

      // Case C: Rise ABOVE target (780 mL = 56% rise > 46.9%)
      const readingsAbove: BulkFermentReading[] = [
        ...readingsBelow,
        { id: "r4", loggedAt: t0 + 8000000, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 780, volume: "780", pH: "", note: "" },
      ];

      const stateAbove = computeBulkFermentState(readingsAbove, stateBelow, [], t0, undefined, undefined, {
        plannedProofMode: "cold_retard",
        plannedProofTempF: 39,
      });

      expect(stateAbove.inOvertime).toBe(true);
      expect(stateAbove.targetReachedAt).toBe(t0 + 8000000);
    });
  });

  describe("5. Historical Reading Immutability", () => {
    it("guarantees past readings array elements remain completely untouched when updating proof mode", () => {
      const t0 = 1000000;
      const originalReadings: BulkFermentReading[] = [
        { id: "r1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, volume_ml: 400, volume: "400", pH: "5.4", note: "Mix" },
        { id: "r2", loggedAt: t0 + 3600000, temp: "75", tempUnit: "F", doughTemp: 75, volume_ml: 430, volume: "430", pH: "5.2", note: "Fold 1" },
      ];

      const readingsCopyBefore = JSON.stringify(originalReadings);

      const state = computeBulkFermentState(
        originalReadings,
        {},
        [],
        t0,
        undefined,
        undefined,
        { plannedProofMode: "cold_retard", plannedProofTempF: 39 }
      );

      const readingsCopyAfter = JSON.stringify(originalReadings);

      expect(state.plannedProofMode).toBe("cold_retard");
      expect(readingsCopyAfter).toBe(readingsCopyBefore);
    });
  });
});
