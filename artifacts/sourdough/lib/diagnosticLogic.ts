// lib/diagnosticLogic.ts
import { ActiveBake } from "./recipeTypes";

export type GlossaryCategory =
  | 'process_driver'
  | 'crumb_outcome'
  | 'crust_outcome'
  | 'flavor_profile';

export type DefectSlug =
  | 'fools_crumb'
  | 'gummy_crumb'
  | 'dense_crumb'
  | 'over_proofed'
  | 'under_proofed'
  | 'pale_crust'
  | 'stuck_banneton'
  | 'weak_spring';

export type DefectPriority = 1 | 2 | 3; // 1 = Structural, 2 = Texture, 3 = Cosmetic

export interface GlossaryTerm {
  slug: string;
  displayName: string;
  category: GlossaryCategory;
  shortDefinition: string;
  priority: DefectPriority;
  isDefect?: boolean;
  defaultRootCauses?: string[];
}

export const DEFECT_LIBRARY: Record<DefectSlug, GlossaryTerm> = {
  fools_crumb: {
    slug: 'fools_crumb',
    displayName: "Fool's Crumb",
    category: 'crumb_outcome',
    priority: 1,
    isDefect: true,
    shortDefinition: "Large isolated caverns surrounded by dense, tight crumb. Usually indicates under-fermentation or weak starter.",
    defaultRootCauses: ['under_fermentation', 'weak_starter'],
  },
  over_proofed: {
    slug: 'over_proofed',
    displayName: "Over-Proofed",
    category: 'crumb_outcome',
    priority: 1,
    isDefect: true,
    shortDefinition: "Collapsed structure, pale crust, and lack of oven spring.",
    defaultRootCauses: ['long_proof', 'high_temp'],
  },
  gummy_crumb: {
    slug: 'gummy_crumb',
    displayName: "Gummy Crumb",
    category: 'crumb_outcome',
    priority: 2,
    isDefect: true,
    shortDefinition: "A dense, rubbery layer at the base of the loaf.",
    defaultRootCauses: ['under_fermentation', 'low_deck_heat'],
  },
  dense_crumb: {
    slug: 'dense_crumb',
    displayName: "Dense Crumb",
    category: 'crumb_outcome',
    priority: 2,
    isDefect: true,
    shortDefinition: "Lack of porosity and aeration throughout the loaf.",
    defaultRootCauses: ['under_proofing', 'low_hydration'],
  },
  under_proofed: {
    slug: 'under_proofed',
    displayName: "Under-Proofed",
    category: 'crumb_outcome',
    priority: 2,
    isDefect: true,
    shortDefinition: "Tight crumb with 'rabbit ears' or blowout where scored.",
    defaultRootCauses: ['short_proof', 'cold_proof'],
  },
  pale_crust: {
    slug: 'pale_crust',
    displayName: "Pale Crust",
    category: 'crust_outcome',
    priority: 3,
    isDefect: true,
    shortDefinition: "Lack of caramelization and color on the crust.",
    defaultRootCauses: ['over_fermentation', 'low_oven_temp'],
  },
  stuck_banneton: {
    slug: 'stuck_banneton',
    displayName: "Stuck to Banneton",
    category: 'crust_outcome',
    priority: 3,
    isDefect: true,
    shortDefinition: "Dough tore when turning out of the basket.",
    defaultRootCauses: ['low_dusting', 'weak_gluten'],
  },
  weak_spring: {
    slug: 'weak_spring',
    displayName: "Weak Oven Spring",
    category: 'crust_outcome',
    priority: 3,
    isDefect: true,
    shortDefinition: "Loaf failed to expand significantly in the oven.",
    defaultRootCauses: ['weak_gluten', 'no_steam'],
  },
};

export interface CorrelationResult {
  defect: DefectSlug;
  confirmed: boolean;
  insight: string;
  contributingFactors: string[];
  recommendation?: string;
  assumptionWarning?: string;
  terminationStatus?: 'TARGET_MET' | 'BOUNDARY_HIT' | 'PLATEAU' | 'CONTINUE' | 'OVERSHOOT';
  appliedDelta?: { variable: string, value: number };
}

// ─── Constants & Scalers ──────────────────────────────────────────────────────
export const SAFETY_BOUNDARIES = {
  MAX_BULK_TEMP_F: 82,
  MIN_HYDRATION_PCT: 65,
  MAX_HYDRATION_PCT: 85,
  MAX_RETARD_HOURS: 24,
};

const STEP_DELTAS = {
    BULK_MINS: 20,
    HYDRATION_PCT: 3,
};

/**
 * Opposite Defect Mapping
 * Used to detect "Overshoots" in the iteration cycle.
 */
const OPPOSITE_DEFECT_MAP: Partial<Record<DefectSlug, DefectSlug>> = {
    'fools_crumb': 'over_proofed',
    'under_proofed': 'over_proofed',
    'over_proofed': 'fools_crumb', // Bidirectional
};

/** Q10 Retard Scaler lookup matrix */
const RETARD_LOOKUP = [
    { tempMin: 34, tempMax: 36, stepDeltaHours: 6.0 },
    { tempMin: 37, tempMax: 39, stepDeltaHours: 4.0 },
    { tempMin: 40, tempMax: 43, stepDeltaHours: 2.5 },
    { tempMin: 44, tempMax: 48, stepDeltaHours: 1.5 }
];

/**
 * Analysis Engine: Correlates bake telemetry with visual observations.
 * Implements Tiered Priority (Structural > Texture > Cosmetic).
 */
export function getCorrelationAnalysis(
  bake: ActiveBake,
  selectedDefects: DefectSlug[],
  previousBake?: ActiveBake
): CorrelationResult[] {
  // 1. Prioritize defects: only evaluate the highest priority tier present
  const activeDefects = selectedDefects.map(s => DEFECT_LIBRARY[s]).filter(Boolean);
  if (activeDefects.length === 0) return [];

  const minPriority = Math.min(...activeDefects.map(d => d.priority));
  const prioritizedSlugs = activeDefects.filter(d => d.priority === minPriority).map(d => d.slug as DefectSlug);

  const results: CorrelationResult[] = [];

  // 2. Telemetry Extraction with Resilience
  const bulkPhase = bake.phases.find(p => p.key === 'bulk_fermenting');
  const retardPhase = bake.phases.find(p => p.key === 'cold_retarding');

  let assumptionWarning = "";
  const durationHours = (bulkPhase?.completedAt && bulkPhase?.startedAt)
    ? (bulkPhase.completedAt - bulkPhase.startedAt) / (1000 * 60 * 60)
    : 4; // Assume 4h baseline if missing

  if (!bulkPhase?.startedAt) assumptionWarning = "Telemetry missing for Bulk Duration. Assuming 4h baseline...";

  const latestReading = bulkPhase?.readings[bulkPhase.readings.length - 1] as any;
  let tempF = latestReading?.doughTemp || latestReading?.temp;
  if (!tempF) {
      tempF = 70; // Assume room temp
      assumptionWarning = assumptionWarning || "Telemetry missing for Bulk Temp. Assuming standard room temp (70°F)...";
  } else {
      tempF = typeof tempF === 'string' ? parseFloat(tempF) : tempF;
  }

  const retardHours = (retardPhase?.completedAt && retardPhase?.startedAt)
    ? (retardPhase.completedAt - retardPhase.startedAt) / (1000 * 60 * 60)
    : 0;

  const retardTemp = 38; // Mock/Assumption for now as Retard Temp logging is future scope

  prioritizedSlugs.forEach(slug => {
    const defect = DEFECT_LIBRARY[slug];
    let confirmed = false;
    let insight = "";
    let recommendation = "";
    let terminationStatus: CorrelationResult['terminationStatus'] = 'CONTINUE';
    const contributingFactors: string[] = [];

    const currentScore = bake.outcome?.overallScore || 0;
    const prevScore = previousBake?.outcome?.overallScore || 0;
    const scoreDelta = currentScore - prevScore;

    // Detect polarity flip (Overshoot)
    const prevDefects = previousBake?.outcome?.defects || [];
    const isOvershoot = prevDefects.some(d => OPPOSITE_DEFECT_MAP[slug] === d || OPPOSITE_DEFECT_MAP[d as any] === slug);

    // 3. Logic Paths
    let delta = 0;
    let variable = '';

    if (slug === 'fools_crumb' || slug === 'under_proofed') {
      variable = 'bulk_duration';
      if (tempF < 72 && durationHours < 6) {
        confirmed = true;
        insight = "Correlates with short bulk duration for a cool dough temperature.";
        contributingFactors.push(`Bulk: ${durationHours.toFixed(1)}h @ ${tempF.toFixed(1)}°F`);
        delta = STEP_DELTAS.BULK_MINS;
      } else if (!bulkPhase?.startedAt) {
        insight = "Assuming under-fermentation based on visual pattern.";
        delta = STEP_DELTAS.BULK_MINS;
      }
    }

    if (slug === 'over_proofed') {
      variable = 'bulk_duration';
      if (durationHours > 7 || tempF > 78) {
        confirmed = true;
        insight = "Correlates with extended bulk time or high temperature.";
        contributingFactors.push(`Bulk: ${durationHours.toFixed(1)}h @ ${tempF.toFixed(1)}°F`);
        delta = -STEP_DELTAS.BULK_MINS;
      } else if (!bulkPhase?.startedAt) {
        insight = "Assuming over-fermentation based on visual pattern.";
        delta = -STEP_DELTAS.BULK_MINS;
      }
    }

    if (slug === 'pale_crust') {
      variable = 'bulk_duration';
      if (durationHours > 8 && tempF > 75) {
        confirmed = true;
        insight = "High temperature bulk likely depleted surface sugars.";
        delta = -STEP_DELTAS.BULK_MINS;
      }
    }

    if (slug === 'gummy_crumb') {
      variable = 'hydration';
      delta = -STEP_DELTAS.HYDRATION_PCT;
      insight = "Analyzing starch gelatinization; reducing hydration to improve structure.";
    }

    // Retard Scaler Logic
    if (slug === 'weak_spring' && retardHours > 0) {
        variable = 'retard_duration';
        const scaler = RETARD_LOOKUP.find(r => retardTemp >= r.tempMin && retardTemp <= r.tempMax);
        delta = scaler?.stepDeltaHours || 4.0;
        recommendation = `Extend Cold Retard by +${delta} hours (scaled for ${retardTemp}°F).`;
    }

    // Binary Convergence (Half-Step) Logic
    if (delta !== 0 && isOvershoot) {
        const prevAppliedDelta = previousBake?.outcome?.appliedDelta?.value || delta;
        const halvedDelta = Math.max(variable === 'hydration' ? 1 : 5, Math.round(Math.abs(prevAppliedDelta) * 0.5));
        delta = (delta > 0 ? 1 : -1) * halvedDelta;
        recommendation = `Overshoot detected. Reversing direction with 50% damping: ${delta > 0 ? '+' : ''}${delta} ${variable === 'bulk_duration' ? 'mins' : variable}.`;
        terminationStatus = 'OVERSHOOT';
    } else if (delta !== 0 && !recommendation) {
        recommendation = `${delta > 0 ? 'Increase' : 'Reduce'} ${variable.replace('_', ' ')} by ${Math.abs(delta)} ${variable === 'bulk_duration' ? 'minutes' : variable === 'hydration' ? '%' : 'hours'}.`;
    }

    // 4. Termination Evaluator (Overrides active recommendation)
    if (currentScore >= 4) {
      terminationStatus = 'TARGET_MET';
      recommendation = "Target reached (4/5+). Primary driver optimized.";
    } else if (tempF >= SAFETY_BOUNDARIES.MAX_BULK_TEMP_F) {
      terminationStatus = 'BOUNDARY_HIT';
      recommendation = "Safety boundary hit (82°F). High risk of acid degradation. Switch drivers.";
    } else if (previousBake && scoreDelta === 0 && currentScore > 0) {
      terminationStatus = 'PLATEAU';
      recommendation = "Plateau detected. The current driver has yielded all gains.";
    }

    results.push({
      defect: slug,
      confirmed,
      insight: insight || `Analyzing ${defect.displayName} mechanisms...`,
      contributingFactors,
      recommendation,
      assumptionWarning,
      terminationStatus
    });
  });

  return results;
}
