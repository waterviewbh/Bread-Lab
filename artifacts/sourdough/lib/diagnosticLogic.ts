// lib/diagnosticLogic.ts
import { ActiveBake } from "./recipeTypes";

export type GlossaryCategory =
  | 'crust'
  | 'crumb'
  | 'shape'
  | 'volume';

export type DefectSlug =
  | 'pale_crust'
  | 'torn_crust'
  | 'matte_surface'
  | 'blistered_skin'
  | 'fools_crumb'
  | 'dense_crumb'
  | 'gummy_bottom'
  | 'fragile_webbing'
  | 'wild_pockets'
  | 'pancake_profile'
  | 'flat_top'
  | 'asymmetric_rise'
  | 'burst_score'
  | 'collapsed_score'
  | 'jagged_ear'
  | 'sharp_edges'
  | 'explosive_spring'
  | 'zero_spring';

export type DefectPriority = 1 | 2 | 3; // 1 = Structural, 2 = Texture, 3 = Cosmetic

export interface GlossaryTerm {
  slug: DefectSlug;
  displayName: string;
  category: GlossaryCategory;
  shortDefinition: string;
  priority: DefectPriority;
  isDefect: boolean;
  isBenchmark?: boolean;
}

export const DEFECT_LIBRARY: Record<DefectSlug, GlossaryTerm> = {
  // CRUST
  pale_crust: {
    slug: 'pale_crust',
    displayName: "Pale Crust",
    category: 'crust',
    priority: 3,
    isDefect: true,
    shortDefinition: "Dull, blonde coloration indicating insufficient Maillard reaction.",
  },
  torn_crust: {
    slug: 'torn_crust',
    displayName: "Torn Crust",
    category: 'crust',
    priority: 3,
    isDefect: true,
    shortDefinition: "Ragged, involuntary ruptures away from the score line.",
  },
  matte_surface: {
    slug: 'matte_surface',
    displayName: "Matte Surface",
    category: 'crust',
    priority: 3,
    isDefect: true,
    shortDefinition: "Chalky, dull finish lacking shine, indicating low ambient steam.",
  },
  blistered_skin: {
    slug: 'blistered_skin',
    displayName: "Blistered Skin",
    category: 'crust',
    priority: 3,
    isDefect: false,
    isBenchmark: true,
    shortDefinition: "Tiny crisp surface bubbles. Sign of excellent steam and long retard.",
  },
  // CRUMB
  fools_crumb: {
    slug: 'fools_crumb',
    displayName: "Fool's Crumb",
    category: 'crumb',
    priority: 1,
    isDefect: true,
    shortDefinition: "Massive top caverns with a dense, gummy base.",
  },
  dense_crumb: {
    slug: 'dense_crumb',
    displayName: "Dense Crumb",
    category: 'crumb',
    priority: 1,
    isDefect: true,
    shortDefinition: "Tight, tiny, uniform cells with poor aeration.",
  },
  gummy_bottom: {
    slug: 'gummy_bottom',
    displayName: "Gummy Bottom",
    category: 'crumb',
    priority: 2,
    isDefect: true,
    shortDefinition: "Uncooked, rubbery paste layer at the very base of the loaf.",
  },
  fragile_webbing: {
    slug: 'fragile_webbing',
    displayName: "Fragile Webbing",
    category: 'crumb',
    priority: 1,
    isDefect: true,
    shortDefinition: "Shattered, weak cell walls that tear easily upon slicing.",
  },
  wild_pockets: {
    slug: 'wild_pockets',
    displayName: "Wild Pockets",
    category: 'crumb',
    priority: 1,
    isDefect: true,
    shortDefinition: "Ragged, irregular large holes scattered randomly.",
  },
  // SHAPE
  pancake_profile: {
    slug: 'pancake_profile',
    displayName: "Pancake Profile",
    category: 'shape',
    priority: 1,
    isDefect: true,
    shortDefinition: "Spreads completely flat and wide once turned out.",
  },
  flat_top: {
    slug: 'flat_top',
    displayName: "Flat Top",
    category: 'shape',
    priority: 2,
    isDefect: true,
    shortDefinition: "Squared, leveling off at the apex without a rounded dome.",
  },
  asymmetric_rise: {
    slug: 'asymmetric_rise',
    displayName: "Asymmetric Rise",
    category: 'shape',
    priority: 2,
    isDefect: true,
    shortDefinition: "Uneven expansion where one side bursts upward while the other remains flat.",
  },
  burst_score: {
    slug: 'burst_score',
    displayName: "Burst Score",
    category: 'shape',
    priority: 2,
    isDefect: true,
    shortDefinition: "Scoring line violently ripped, exploded, or jaggedly forced open.",
  },
  collapsed_score: {
    slug: 'collapsed_score',
    displayName: "Collapsed Score",
    category: 'shape',
    priority: 1,
    isDefect: true,
    shortDefinition: "Scoring line melted flat, softened out, or sealed entirely closed.",
  },
  jagged_ear: {
    slug: 'jagged_ear',
    displayName: "Jagged Ear",
    category: 'shape',
    priority: 2,
    isDefect: true,
    shortDefinition: "Wild, sharp, uneven crust separation forming a pronounced ridge.",
  },
  sharp_edges: {
    slug: 'sharp_edges',
    displayName: "Sharp Edges",
    category: 'shape',
    priority: 3,
    isDefect: true,
    shortDefinition: "Hard corners where dough aggressively met baking vessel walls.",
  },
  // VOLUME
  explosive_spring: {
    slug: 'explosive_spring',
    displayName: "Explosive Spring",
    category: 'volume',
    priority: 2,
    isDefect: true,
    shortDefinition: "Massive, aggressive vertical rise out of the score.",
  },
  zero_spring: {
    slug: 'zero_spring',
    displayName: "Zero Spring",
    category: 'volume',
    priority: 1,
    isDefect: true,
    shortDefinition: "Loaf enters and leaves oven at nearly identical heights.",
  },
};

export type EngineStatus = 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION' | 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF';

export interface DiagnosticPayload {
  bulkStatus: Extract<EngineStatus, 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION'>;
  proofStatus: Extract<EngineStatus, 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF'>;
  rootCause: string;
  triggeringSymptoms: string[];
  actions: string[];
  markdown: string;
}

/**
 * Generates the Unified UX Payload as a Markdown-structured summary.
 */
export function generateDiagnosticSummary(
  bake: ActiveBake,
  selectedSlugs: DefectSlug[],
  isTelemetryAuthentic: boolean
): DiagnosticPayload {
  const selected = new Set(selectedSlugs);
  const triggeringSymptoms = selectedSlugs.map(s => DEFECT_LIBRARY[s].displayName);

  // 1. ENGINE 1: Bulk Fermentation State
  let bulkStatus: Extract<EngineStatus, 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION'>;
  const hasCrumbDefect = selectedSlugs.some(s => DEFECT_LIBRARY[s].category === 'crumb');

  if ((selected.has('fools_crumb') || selected.has('wild_pockets')) && (selected.has('gummy_bottom') || selected.has('dense_crumb'))) {
    bulkStatus = 'UNDER-FERMENTED';
  } else if ((selected.has('fragile_webbing') || selected.has('dense_crumb')) && (selected.has('pale_crust') || selected.has('flat_top'))) {
    bulkStatus = 'OVER-FERMENTED';
  } else if (!hasCrumbDefect && !selected.has('zero_spring')) {
    bulkStatus = 'OPTIMAL_FERMENTATION';
  } else {
    // Default fallback if logic is ambiguous
    bulkStatus = hasCrumbDefect ? 'UNDER-FERMENTED' : 'OPTIMAL_FERMENTATION';
  }

  // 2. ENGINE 2: Final Proofing State
  let proofStatus: Extract<EngineStatus, 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF'>;
  const hasShapeOrVolDefect = selectedSlugs.some(s => ['shape', 'volume'].includes(DEFECT_LIBRARY[s].category));

  if (selected.has('explosive_spring') || selected.has('burst_score') || selected.has('jagged_ear')) {
    proofStatus = 'UNDER-PROOFED';
  } else if (selected.has('pancake_profile') || selected.has('zero_spring') || selected.has('collapsed_score') || selected.has('pale_crust')) {
    proofStatus = 'OVER-PROOFED';
  } else if (!hasShapeOrVolDefect) {
    proofStatus = 'OPTIMAL_PROOF';
  } else {
    proofStatus = hasShapeOrVolDefect ? 'OVER-PROOFED' : 'OPTIMAL_PROOF';
  }

  // 3. ROOT CAUSE ANALYSIS & ACTIONS
  let rootCause = "";
  const actions: string[] = [];

  // Determine primary driver based on severity/priority
  if (bulkStatus === 'UNDER-FERMENTED') {
    rootCause = "The dough structure shows signs of incomplete gas accumulation and insufficient enzymatic activity during Bulk Fermentation.";
    actions.push("Extend Bulk Fermentation duration by 30-45 minutes next time.");
    actions.push("Ensure your dough maintains a temperature between 75°F and 80°F.");
  } else if (bulkStatus === 'OVER-FERMENTED') {
    rootCause = "The yeast has exhausted the available sugars and the gluten network has begun to degrade due to excessive acidity.";
    actions.push("Reduce Bulk Fermentation time or decrease the ambient temperature.");
    actions.push("Use cooler water (65-70°F) to slow down the initial fermentation rate.");
  } else if (proofStatus === 'UNDER-PROOFED') {
    rootCause = "The loaf entered the oven with too much residual tension and explosive energy, leading to structural ruptures.";
    actions.push("Allow for a longer final proofing period (30-60m extra if at room temp).");
    actions.push("Perform the 'poke test' to ensure the dough springs back slowly and leaves a small indentation.");
  } else if (proofStatus === 'OVER-PROOFED') {
    rootCause = "The gluten matrix lost its ability to hold gas just before or during the bake, causing structural collapse.";
    actions.push("Move the dough to the refrigerator earlier for the cold retard.");
    actions.push("Ensure your oven is fully preheated to prevent the dough from sitting too long at low heat.");
  } else {
    rootCause = "The fermentation and proofing stages appear well-balanced. Minor defects may be attributed to handling or scoring technique.";
    actions.push("Refine scoring depth and angle (45 degrees) for a cleaner ear.");
    actions.push("Check steam levels in the oven during the first 15-20 minutes of baking.");
  }

  // 4. TELEMETRY MATH INJECTION
  let telemetryInsight = "";
  if (isTelemetryAuthentic) {
    const bulkPhase = bake.phases?.find(p => p.key === 'bulk_fermenting');
    const durationMins = (bulkPhase?.completedAt && bulkPhase?.startedAt)
      ? (bulkPhase.completedAt - bulkPhase.startedAt) / (1000 * 60)
      : 240;

    const readings = bulkPhase?.readings || [];
    const latestReading = readings.length > 0 ? readings[readings.length - 1] as any : null;
    let tempF = latestReading?.doughTemp || latestReading?.temp;
    tempF = typeof tempF === 'string' ? parseFloat(tempF) : (tempF || 70);

    const hours = (durationMins / 60).toFixed(1);
    telemetryInsight = `Based on your logged data (${hours}h at ${tempF.toFixed(1)}°F), yeast activity was ${tempF > 78 ? 'aggressive' : tempF < 72 ? 'sluggish' : 'consistent'}. `;
  } else {
    telemetryInsight = "Look for a 30-50% increase in volume during Bulk Fermentation as your primary visual cue. ";
  }

  // 5. ASSEMBLE MARKDOWN
  const markdown = `# ─── DIAGNOSTIC SUMMARY ───

**BULK FERMENTATION:** ${bulkStatus.replace('_', ' ')}
**FINAL PROOFING:** ${proofStatus.replace('_', ' ')}

## 1. ROOT CAUSE ANALYSIS
${telemetryInsight}${rootCause}

## 2. TRIGGERING SYMPTOMS OBSERVED
${triggeringSymptoms.length > 0 ? triggeringSymptoms.map(s => `• ${s}`).join('\n') : "• No specific defects selected."}

## 3. ACTIONS FOR NEXT BAKE
${actions.map(a => `• ${a}`).join('\n')}
`;

  return {
    bulkStatus,
    proofStatus,
    rootCause,
    triggeringSymptoms,
    actions,
    markdown
  };
}

// ─── Legacy Support (Keep for backward compatibility until refactor is complete) ────────────────
export function getCorrelationAnalysis(
  bake: ActiveBake,
  selectedSlugs: DefectSlug[],
  previousBake?: ActiveBake
): CorrelationResult[] {
  // We'll return an empty array for now since logDiagnostic.tsx is being refactored to use generateDiagnosticSummary
  return [];
}
