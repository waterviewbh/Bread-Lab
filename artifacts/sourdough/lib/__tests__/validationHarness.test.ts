// lib/__tests__/validationHarness.test.ts
import {
  type ValidationBakeFixture,
  evaluateBakeSession,
  evaluateCorpus,
  compareEstimators,
} from "../validationHarness";
import { computeBulkFermentState } from "../bulkFermentEngine";

describe("Estimator Validation Harness & Benchmark Suite", () => {
  const hourMs = 3600 * 1000;
  const t0 = 1700000000000;

  // Permanent 6-Bake Regression Corpus
  const REGRESSION_CORPUS: ValidationBakeFixture[] = [
    {
      id: "b1",
      name: "Bake 1: Standard Room Temp (76F, 20% Inoc, 75% Hyd)",
      actualDurationHr: 4.50,
      regimeTags: ["MODERATE_TEMP", "STANDARD_INOC"],
      phases: [],
      readings: [
        { id: "b1_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b1_2", loggedAt: t0 + 0.75 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 425, volume: "425", pH: "", note: "" },
        { id: "b1_3", loggedAt: t0 + 2.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
        { id: "b1_4", loggedAt: t0 + 3.25 * hourMs, temp: "73", tempUnit: "F", doughTemp: 73, ambientTemp: 72, volume_ml: 540, volume: "540", pH: "", note: "" },
        { id: "b1_5", loggedAt: t0 + 4.5 * hourMs, temp: "72", tempUnit: "F", doughTemp: 72, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
      ],
    },
    {
      id: "b2",
      name: "Bake 2: Warm Summer (82F, 20% Inoc, 70% Hyd)",
      actualDurationHr: 3.00,
      regimeTags: ["WARM_TEMP", "STANDARD_INOC"],
      phases: [],
      readings: [
        { id: "b2_1", loggedAt: t0, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b2_2", loggedAt: t0 + 0.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 435, volume: "435", pH: "", note: "" },
        { id: "b2_3", loggedAt: t0 + 1.8 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 485, volume: "485", pH: "", note: "" },
        { id: "b2_4", loggedAt: t0 + 3.0 * hourMs, temp: "82", tempUnit: "F", doughTemp: 82, ambientTemp: 80, volume_ml: 540, volume: "540", pH: "", note: "" },
      ],
    },
    {
      id: "b3",
      name: "Bake 3: Cool Winter Kitchen (66F, 20% Inoc, 75% Hyd)",
      actualDurationHr: 9.00,
      regimeTags: ["COOL_TEMP", "STANDARD_INOC"],
      phases: [],
      readings: [
        { id: "b3_1", loggedAt: t0, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b3_2", loggedAt: t0 + 2.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 460, volume: "460", pH: "", note: "" },
        { id: "b3_3", loggedAt: t0 + 4.5 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 550, volume: "550", pH: "", note: "" },
        { id: "b3_4", loggedAt: t0 + 7.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 670, volume: "670", pH: "", note: "" },
        { id: "b3_5", loggedAt: t0 + 9.0 * hourMs, temp: "66", tempUnit: "F", doughTemp: 66, ambientTemp: 66, volume_ml: 800, volume: "800", pH: "", note: "" },
      ],
    },
    {
      id: "b4",
      name: "Bake 4: Low Inoculation (75F, 10% Inoc, 72% Hyd)",
      actualDurationHr: 7.00,
      regimeTags: ["MODERATE_TEMP", "LOW_INOC"],
      phases: [{ key: "mixing", ingredients: "500g flour\n350g water\n50g starter\n10g salt" }],
      readings: [
        { id: "b4_1", loggedAt: t0, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b4_2", loggedAt: t0 + 1.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 430, volume: "430", pH: "", note: "" },
        { id: "b4_3", loggedAt: t0 + 3.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 480, volume: "480", pH: "", note: "" },
        { id: "b4_4", loggedAt: t0 + 5.5 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 550, volume: "550", pH: "", note: "" },
        { id: "b4_5", loggedAt: t0 + 7.0 * hourMs, temp: "75", tempUnit: "F", doughTemp: 75, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
      ],
    },
    {
      id: "b5",
      name: "Bake 5: High Inoculation (76F, 30% Inoc, 75% Hyd)",
      actualDurationHr: 3.50,
      regimeTags: ["MODERATE_TEMP", "HIGH_INOC"],
      phases: [{ key: "mixing", ingredients: "500g flour\n350g water\n150g starter\n10g salt" }],
      readings: [
        { id: "b5_1", loggedAt: t0, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b5_2", loggedAt: t0 + 1.0 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 450, volume: "450", pH: "", note: "" },
        { id: "b5_3", loggedAt: t0 + 2.2 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 530, volume: "530", pH: "", note: "" },
        { id: "b5_4", loggedAt: t0 + 3.5 * hourMs, temp: "76", tempUnit: "F", doughTemp: 76, ambientTemp: 72, volume_ml: 620, volume: "620", pH: "", note: "" },
      ],
    },
    {
      id: "b6",
      name: "Bake 6: Post-Fold Degassed Recovery (74F, 20% Inoc, 78% Hyd)",
      actualDurationHr: 6.00,
      regimeTags: ["MODERATE_TEMP", "STANDARD_INOC", "FOLD_INTERVENTION"],
      phases: [],
      readings: [
        { id: "b6_1", loggedAt: t0, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 400, volume: "400", pH: "", note: "" },
        { id: "b6_2", loggedAt: t0 + 1.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 410, volume: "410", pH: "", note: "", postIntervention: true },
        { id: "b6_3", loggedAt: t0 + 2.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 460, volume: "460", pH: "", note: "" },
        { id: "b6_4", loggedAt: t0 + 4.5 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 540, volume: "540", pH: "", note: "" },
        { id: "b6_5", loggedAt: t0 + 6.0 * hourMs, temp: "74", tempUnit: "F", doughTemp: 74, ambientTemp: 70, volume_ml: 620, volume: "620", pH: "", note: "" },
      ],
    },
  ];

  it("1. Single Bake Session Causal Replay", () => {
    const res = evaluateBakeSession(REGRESSION_CORPUS[0], computeBulkFermentState);

    expect(res.bakeId).toBe("b1");
    expect(res.traces.length).toBe(5);
    expect(res.activeForecastCount).toBe(4);
    expect(res.finalPreTargetTrace).toBeDefined();
    expect(res.finalPreTargetErrorMin).toBeCloseTo(22.8, 1);
  });

  it("2. Full Corpus Evaluation & Benchmark Metric Verification", () => {
    // Production Default (2-Hour P)
    const prodSummary = evaluateCorpus(
      REGRESSION_CORPUS,
      computeBulkFermentState,
      "Production Default (2h P)"
    );

    expect(prodSummary.totalForecastObservations).toBe(22);
    expect(prodSummary.forecastMAE).toBeGreaterThan(0);
    expect(prodSummary.finalPreTargetMAE).toBeGreaterThan(0);
    expect(prodSummary.finalPreTargetMedianAbsError).toBeGreaterThan(0);

    // Full History Rollback Reference (null)
    const rollbackSummary = evaluateCorpus(
      REGRESSION_CORPUS,
      computeBulkFermentState,
      "Rollback Reference (Full-History P)",
      null
    );

    expect(rollbackSummary.forecastMAE).toBeGreaterThan(0);
    expect(rollbackSummary.finalPreTargetMAE).toBeGreaterThan(0);
  });

  it("3. Multi-Estimator Side-by-Side Comparison", () => {
    const comparisons = compareEstimators(REGRESSION_CORPUS, [
      { label: "Production Default (2h P)", fn: computeBulkFermentState, options: { pMemoryHorizonMs: 7200000 } },
      { label: "Rollback Reference (Full-History P)", fn: computeBulkFermentState, options: null },
    ]);

    expect(comparisons.length).toBe(2);
    expect(comparisons[0].estimatorLabel).toBe("Production Default (2h P)");
    expect(comparisons[1].estimatorLabel).toBe("Rollback Reference (Full-History P)");

    // Verify Production 2h achieves lower final pre-target MAE than full history
    expect(comparisons[0].finalPreTargetMAE).toBeLessThan(comparisons[1].finalPreTargetMAE);
  });

  it("4. Regime Breakdown Verification", () => {
    const summary = evaluateCorpus(
      REGRESSION_CORPUS,
      computeBulkFermentState,
      "Production Default (2h P)"
    );

    const coolRegime = summary.regimeSummaries["COOL_TEMP"];
    const warmRegime = summary.regimeSummaries["WARM_TEMP"];
    const modRegime = summary.regimeSummaries["MODERATE_TEMP"];

    expect(coolRegime).toBeDefined();
    expect(warmRegime).toBeDefined();
    expect(modRegime).toBeDefined();

    expect(coolRegime.observationCount).toBe(4);
    expect(warmRegime.maeMin).toBeLessThan(coolRegime.maeMin);
  });
});
