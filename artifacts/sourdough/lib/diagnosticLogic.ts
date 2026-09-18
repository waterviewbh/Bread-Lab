// lib/diagnosticLogic.ts
import { ActiveBake, DiagnosticTagSlug } from "./recipeTypes";

export type DiagnosticCategory =
  | 'crust'
  | 'crumb'
  | 'shape'
  | 'volume';

export type DiagnosticType = 'defect' | 'target';

export type DiagnosticDriver = 'fermentation' | 'moisture' | 'thermal' | 'handling';

export type DefectPriority = 1 | 2 | 3; // 1 = Structural, 2 = Texture, 3 = Cosmetic

export type ActionVector = 'Increase' | 'Extend' | 'Reduce' | 'Elevate' | 'Tighten' | 'Standardize';

export interface DiagnosticTag {
  id: DiagnosticTagSlug;
  label: string;
  category: DiagnosticCategory;
  type: DiagnosticType;
  driver: DiagnosticDriver;
  shortDefinition: string;
  priority: DefectPriority;
  // --- Hypothesis Generation Schema ---
  actionVector?: ActionVector;
  targetVariable?: string;
  suggestedDelta?: string;
  targetOutcome?: string;
}

export const DIAGNOSTIC_TAGS: Record<DiagnosticTagSlug, DiagnosticTag> = {
  // --- CRUMB ---
  fools_crumb: {
    id: 'fools_crumb',
    label: "Fool's Crumb",
    category: 'crumb',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Massive top caverns with a dense, gummy base.",
    priority: 1,
    actionVector: 'Extend',
    targetVariable: 'bulk fermentation',
    suggestedDelta: '+30–45 min',
    targetOutcome: 'gas distribution',
  },
  dense_crumb: {
    id: 'dense_crumb',
    label: "Dense Crumb",
    category: 'crumb',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Tight, tiny, uniform cells with poor aeration.",
    priority: 1,
    actionVector: 'Extend',
    targetVariable: 'bulk fermentation',
    suggestedDelta: '+15–30 min / target 50% rise',
    targetOutcome: 'crumb density',
  },
  gummy_bottom: {
    id: 'gummy_bottom',
    label: "Gummy Bottom",
    category: 'crumb',
    type: 'defect',
    driver: 'thermal',
    shortDefinition: "Uncooked, rubbery paste layer at the very base of the loaf.",
    priority: 2,
    actionVector: 'Elevate',
    targetVariable: 'bottom heat / deck temp',
    suggestedDelta: '+10–15°F',
    targetOutcome: 'bottom crust bake',
  },
  fragile_webbing: {
    id: 'fragile_webbing',
    label: "Fragile Webbing",
    category: 'crumb',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Shattered, weak cell walls that tear easily upon slicing.",
    priority: 1,
    actionVector: 'Reduce',
    targetVariable: 'bulk fermentation',
    suggestedDelta: '-15–30 min',
    targetOutcome: 'gluten integrity',
  },
  wild_pockets: {
    id: 'wild_pockets',
    label: "Wild Pockets",
    category: 'crumb',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Ragged, irregular large holes scattered randomly.",
    priority: 1,
  },
  airy_soft: {
    id: 'airy_soft',
    label: "Airy / Soft",
    category: 'crumb',
    type: 'target',
    driver: 'fermentation',
    shortDefinition: "Well-aerated, light interior structure.",
    priority: 1,
  },
  even_texture: {
    id: 'even_texture',
    label: "Even Texture",
    category: 'crumb',
    type: 'target',
    driver: 'handling',
    shortDefinition: "Uniform gas distribution and consistent crumb maturity.",
    priority: 1,
  },

  // --- SHAPE & RISE ---
  pancake_profile: {
    id: 'pancake_profile',
    label: "Pancake Profile",
    category: 'shape',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Spreads completely flat and wide once turned out.",
    priority: 1,
    actionVector: 'Reduce',
    targetVariable: 'final proof duration',
    suggestedDelta: '-20–30 min',
    targetOutcome: 'lateral expansion',
  },
  flat_top: {
    id: 'flat_top',
    label: "Flat Top",
    category: 'shape',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Squared, leveling off at the apex without a rounded dome.",
    priority: 2,
  },
  asymmetric_rise: {
    id: 'asymmetric_rise',
    label: "Asymmetric Rise",
    category: 'shape',
    type: 'defect',
    driver: 'handling',
    shortDefinition: "Uneven expansion where one side bursts upward while the other remains flat.",
    priority: 2,
  },
  burst_score: {
    id: 'burst_score',
    label: "Burst Score",
    category: 'shape',
    type: 'defect',
    driver: 'handling',
    shortDefinition: "Scoring line violently ripped, exploded, or jaggedly forced open.",
    priority: 2,
    actionVector: 'Extend',
    targetVariable: 'final proof',
    suggestedDelta: '+20–30 min',
    targetOutcome: 'score expansion',
  },
  collapsed_score: {
    id: 'collapsed_score',
    label: "Collapsed Score",
    category: 'shape',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Scoring line melted flat, softened out, or sealed entirely closed.",
    priority: 1,
    actionVector: 'Reduce',
    targetVariable: 'bulk fermentation',
    suggestedDelta: '-30 min',
    targetOutcome: 'score definition',
  },
  jagged_ear: {
    id: 'jagged_ear',
    label: "Jagged Ear",
    category: 'shape',
    type: 'defect',
    driver: 'handling',
    shortDefinition: "Wild, sharp, uneven crust separation forming a pronounced ridge.",
    priority: 2,
  },
  sharp_edges: {
    id: 'sharp_edges',
    label: "Sharp Edges",
    category: 'shape',
    type: 'defect',
    driver: 'handling',
    shortDefinition: "Hard corners where dough aggressively met baking vessel walls.",
    priority: 3,
  },
  strong_rise: {
    id: 'strong_rise',
    label: "Strong Rise",
    category: 'shape',
    type: 'target',
    driver: 'fermentation',
    shortDefinition: "Pronounced vertical expansion and structural integrity.",
    priority: 1,
  },
  clean_form: {
    id: 'clean_form',
    label: "Clean Edges / Form",
    category: 'shape',
    type: 'target',
    driver: 'handling',
    shortDefinition: "Sharp, intentional shaping and scoring execution.",
    priority: 1,
  },

  // --- CRUST & SURFACE ---
  pale_crust: {
    id: 'pale_crust',
    label: "Pale Crust",
    category: 'crust',
    type: 'defect',
    driver: 'thermal',
    shortDefinition: "Dull, blonde coloration indicating insufficient Maillard reaction.",
    priority: 3,
    actionVector: 'Elevate',
    targetVariable: 'oven / deck temp',
    suggestedDelta: '+15–20°F (or +5 min steam)',
    targetOutcome: 'crust browning',
  },
  torn_crust: {
    id: 'torn_crust',
    label: "Torn Crust",
    category: 'crust',
    type: 'defect',
    driver: 'moisture',
    shortDefinition: "Ragged, involuntary ruptures away from the score line.",
    priority: 3,
  },
  matte_surface: {
    id: 'matte_surface',
    label: "Matte Surface",
    category: 'crust',
    type: 'defect',
    driver: 'moisture',
    shortDefinition: "Chalky, dull finish lacking shine, indicating low ambient steam.",
    priority: 3,
  },
  ideal_browning: {
    id: 'ideal_browning',
    label: "Ideal Browning",
    category: 'crust',
    type: 'target',
    driver: 'thermal',
    shortDefinition: "Deep mahogany/gold caramelization.",
    priority: 3,
  },
  blistered_skin: {
    id: 'blistered_skin',
    label: "Blistered / Crisp",
    category: 'crust',
    type: 'target',
    driver: 'moisture',
    shortDefinition: "Tiny crisp surface bubbles. Sign of excellent steam and long retard.",
    priority: 3,
  },

  // --- VOLUME ---
  explosive_spring: {
    id: 'explosive_spring',
    label: "Explosive Spring",
    category: 'volume',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Massive, aggressive vertical rise out of the score.",
    priority: 2,
  },
  zero_spring: {
    id: 'zero_spring',
    label: "Zero Spring",
    category: 'volume',
    type: 'defect',
    driver: 'fermentation',
    shortDefinition: "Loaf enters and leaves oven at nearly identical heights.",
    priority: 1,
  },
  stuck_banneton: {
    id: 'stuck_banneton',
    label: "Stuck to Banneton",
    category: 'volume', // or shape
    type: 'defect',
    driver: 'handling',
    shortDefinition: "Dough adhered to proofing vessel, tearing the skin.",
    priority: 2,
  }
};

export type EngineStatus = 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION' | 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF';

export interface DiagnosticPayload {
  bulkStatus: Extract<EngineStatus, 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION'>;
  proofStatus: Extract<EngineStatus, 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF'>;
  rootCause: string;
  triggeringSymptoms: string[];
  actions: string[];
  markdown: string;
  iterationStatus: 'LOCK' | 'ITERATE' | 'NEUTRAL';
  suggestedHypothesis: string;
}

/**
 * Generates an explicit, directional, and quantitative hypothesis for recipe iteration.
 * Implements the Conflict Resolution Engine: defaults to localized technique fixes when
 * a success and defect exist in the same category.
 */
export function generateHypothesis(
  primaryDefect: DiagnosticTag,
  conflictPair?: DiagnosticTag
): string {
  // Scenario A: Conflict / Localized Defect (e.g., Dense Crumb + Airy Soft)
  if (conflictPair) {
    if (primaryDefect.id === 'dense_crumb' && conflictPair.id === 'airy_soft') {
      return `Standardize dough temp and tighten shaping tension to resolve localized density without extending bulk time.`;
    }
    // Generic technique-based fallback for conflicts
    return `Verify dough temp consistency and refine ${primaryDefect.driver} technique to eliminate localized ${primaryDefect.targetOutcome || 'issues'} without altering total duration.`;
  }

  // Scenario B: Standard Defect Action Vector
  if (primaryDefect.actionVector && primaryDefect.targetVariable) {
    return `${primaryDefect.actionVector} ${primaryDefect.targetVariable} (${primaryDefect.suggestedDelta || 'targeted adjustment'}) to improve ${primaryDefect.targetOutcome || primaryDefect.label}.`;
  }

  // Fallback to definition-based advice
  return `Adjust ${primaryDefect.driver} parameters to resolve ${primaryDefect.label}: ${primaryDefect.shortDefinition}`;
}

/**
 * Generates the Unified UX Payload as a Markdown-structured summary.
 * Implements the Conflict Resolution Engine: targets damp defects instead of binary kill-switches.
 */
export function generateDiagnosticSummary(
  bake: ActiveBake,
  selectedSlugs: DiagnosticTagSlug[],
  isTelemetryAuthentic: boolean
): DiagnosticPayload {
  const selected = new Set(selectedSlugs);
  const triggeringSymptoms = selectedSlugs.map(s => DIAGNOSTIC_TAGS[s]?.label || s);

  // Identify active drivers and their types
  const activeTargets = new Set<DiagnosticDriver>();
  const activeDefects = new Set<DiagnosticDriver>();

  selectedSlugs.forEach(slug => {
    const tag = DIAGNOSTIC_TAGS[slug];
    if (!tag) return;
    if (tag.type === 'target') activeTargets.add(tag.driver);
    else activeDefects.add(tag.driver);
  });

  // 1. ENGINE 1: Bulk Fermentation State
  let bulkStatus: Extract<EngineStatus, 'UNDER-FERMENTED' | 'OVER-FERMENTED' | 'OPTIMAL_FERMENTATION'>;
  const hasCrumbDefect = selectedSlugs.some(s => DIAGNOSTIC_TAGS[s]?.category === 'crumb' && DIAGNOSTIC_TAGS[s]?.type === 'defect');

  if ((selected.has('fools_crumb') || selected.has('wild_pockets')) && (selected.has('gummy_bottom') || selected.has('dense_crumb'))) {
    bulkStatus = 'UNDER-FERMENTED';
  } else if ((selected.has('fragile_webbing') || selected.has('dense_crumb')) && (selected.has('pale_crust') || selected.has('flat_top'))) {
    bulkStatus = 'OVER-FERMENTED';
  } else if (!hasCrumbDefect && !selected.has('zero_spring') && (selected.has('airy_soft') || selected.has('even_texture'))) {
    bulkStatus = 'OPTIMAL_FERMENTATION';
  } else {
    bulkStatus = hasCrumbDefect ? 'UNDER-FERMENTED' : 'OPTIMAL_FERMENTATION';
  }

  // 2. ENGINE 2: Final Proofing State
  let proofStatus: Extract<EngineStatus, 'UNDER-PROOFED' | 'OVER-PROOFED' | 'OPTIMAL_PROOF'>;
  const hasShapeOrVolDefect = selectedSlugs.some(s => ['shape', 'volume'].includes(DIAGNOSTIC_TAGS[s]?.category) && DIAGNOSTIC_TAGS[s]?.type === 'defect');

  if (selected.has('explosive_spring') || selected.has('burst_score') || selected.has('jagged_ear')) {
    proofStatus = 'UNDER-PROOFED';
  } else if (selected.has('pancake_profile') || selected.has('zero_spring') || selected.has('collapsed_score') || selected.has('pale_crust')) {
    proofStatus = 'OVER-PROOFED';
  } else if (!hasShapeOrVolDefect && (selected.has('strong_rise') || selected.has('clean_form'))) {
    proofStatus = 'OPTIMAL_PROOF';
  } else {
    proofStatus = hasShapeOrVolDefect ? 'OVER-PROOFED' : 'OPTIMAL_PROOF';
  }

  // 3. ROOT CAUSE ANALYSIS & ACTIONS (Conflict Resolution Engine)
  let rootCause = "";
  const fermentationActions: string[] = [];
  const thermalMoistureActions: string[] = [];
  const handlingScoringActions: string[] = [];

  // FERMENTATION DRIVER
  if (activeTargets.has('fermentation') && activeDefects.has('fermentation')) {
    // Conflict Override
    if (selected.has('dense_crumb') || selected.has('gummy_bottom')) {
      fermentationActions.push("Crumb density is localized—verify internal dough temperature consistency and shaping uniformity rather than extending total bulk time.");
    } else {
      fermentationActions.push("Fermentation quality is high but showing minor localized defects; check starter peak timing and fold consistency.");
    }
  } else if (!activeTargets.has('fermentation')) {
    if (bulkStatus === 'UNDER-FERMENTED') {
      fermentationActions.push("Extend bulk fermentation by 15–30 minutes next time.");
      fermentationActions.push("Verify internal core temp reaches 205–208°F (96–98°C) before pulling.");
    } else if (bulkStatus === 'OVER-FERMENTED' || proofStatus === 'OVER-PROOFED') {
      if (selected.has('pancake_profile') || selected.has('flat_top')) {
         fermentationActions.push("Reduce final proof time by 20–30 minutes to prevent over-proofing.");
      } else {
         fermentationActions.push("Reduce bulk fermentation duration by 30-45 minutes.");
      }
    }
    if (selected.has('fools_crumb') || selected.has('wild_pockets')) {
      fermentationActions.push("Extend bulk fermentation time to allow gas distribution to equalize; avoid rushing to final proof.");
    }
  } else if (selected.has('airy_soft') && selected.has('even_texture')) {
    fermentationActions.push("Maintain current fermentation temperature and starter build ratio; interior dough structure is optimized.");
  }

  // THERMAL / MOISTURE DRIVERS
  if (activeTargets.has('thermal') && activeDefects.has('thermal')) {
      thermalMoistureActions.push("Surface color is optimal—localized thermal issues suggest checking oven/griddle hot spots.");
  } else if (!activeTargets.has('thermal')) {
    if (selected.has('pale_crust') || selected.has('matte_surface')) {
      thermalMoistureActions.push("Increase baking/griddling temperature by 15–20°F, or extend high-heat phase by 5 minutes.");
    }
  } else if (selected.has('ideal_browning') && selected.has('blistered_skin')) {
    thermalMoistureActions.push("Surface moisture and thermal timing are dialed in; maintain exact preheat duration and baking vessel setup.");
  }

  if (!activeTargets.has('moisture')) {
    if (selected.has('torn_crust')) {
      thermalMoistureActions.push("Increase steam in the initial bake stage (or extend covered period) to keep skin extensible.");
    }
  }

  // HANDLING / SCORING DRIVERS
  if (activeTargets.has('handling') && activeDefects.has('handling')) {
    handlingScoringActions.push("Handling form is strong—minor structural anomalies suggest checking preshape rest duration or flour dusting levels.");
  } else if (!activeTargets.has('handling')) {
    if (selected.has('pancake_profile') || selected.has('flat_top')) {
      handlingScoringActions.push("Increase preshaping tension to improve structural support.");
    }
    if (selected.has('asymmetric_rise') || selected.has('burst_score') || selected.has('collapsed_score')) {
      handlingScoringActions.push("Refine scoring depth (~0.5 in) and angle (45°) to direct expansion evenly.");
    }
  } else if (selected.has('strong_rise') && selected.has('clean_form')) {
    handlingScoringActions.push("Keep current shaping tension and proof duration locked for this recipe flour blend.");
  }

  // 4. ITERATION ENGINE LOGIC
  const overallScore = bake.outcome?.overallScore || 0;
  const unGuardedDefects = selectedSlugs.filter(slug => {
      const tag = DIAGNOSTIC_TAGS[slug];
      return tag?.type === 'defect' && !activeTargets.has(tag.driver);
  });

  let iterationStatus: 'LOCK' | 'ITERATE' | 'NEUTRAL' = 'NEUTRAL';
  if (unGuardedDefects.length === 0 && overallScore >= 4.0) {
      iterationStatus = 'LOCK';
  } else if (unGuardedDefects.length > 0 || overallScore < 3.5) {
      iterationStatus = 'ITERATE';
  }

  // Root Cause Synthesis
  if (unGuardedDefects.length === 0 && activeTargets.size > 0) {
    rootCause = "All process variables (fermentation, thermal management, and dough handling) hit optimal targets.";
  } else if (bulkStatus === 'UNDER-FERMENTED' || proofStatus === 'UNDER-PROOFED') {
    rootCause = "The dough structure shows signs of incomplete gas accumulation or insufficient proofing maturity.";
  } else if (bulkStatus === 'OVER-FERMENTED' || proofStatus === 'OVER-PROOFED') {
    rootCause = "The gluten network has begun to degrade or has lost its ability to hold gas due to extended fermentation.";
  } else {
    rootCause = "The fermentation and proofing stages appear well-balanced. Minor observations may be attributed to handling or moisture levels.";
  }

  // Actions Prioritization
  const actions = [
    ...fermentationActions,
    ...thermalMoistureActions,
    ...handlingScoringActions
  ];

  if (iterationStatus === 'LOCK') {
    actions.push("Lock Baseline: Save total timing, temperature, and hydration targets as the master baseline.");
    actions.push("Repeatability Check: Maintain exact starter peak timing and vessel preheat duration.");
  }

  // Suggested Hypothesis Pre-fill
  let suggestedHypothesis = "";
  if (iterationStatus === 'ITERATE') {
      const defects = selectedSlugs
        .map(s => DIAGNOSTIC_TAGS[s])
        .filter(t => t?.type === 'defect')
        .sort((a, b) => a.priority - b.priority);

      if (defects.length > 0) {
          const primary = defects[0];
          // Check for conflict: a target in the same category as the primary defect
          const conflict = selectedSlugs
            .map(s => DIAGNOSTIC_TAGS[s])
            .find(t => t?.type === 'target' && t.category === primary.category);

          suggestedHypothesis = `Hypothesis: ${generateHypothesis(primary, conflict)}`;
      }
  } else if (iterationStatus === 'LOCK') {
      suggestedHypothesis = "Recipe locked as Master Baseline.";
  }

  // 5. TELEMETRY MATH INJECTION
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
    telemetryInsight = `Data Review: ${hours}h at ${tempF.toFixed(1)}°F. `;
  }

  // 6. ASSEMBLE MARKDOWN
  const markdown = `# ─── DIAGNOSTIC SUMMARY ───

**BULK FERMENTATION:** ${bulkStatus.replace('_', ' ')}
**FINAL PROOFING:** ${proofStatus.replace('_', ' ')}

## 1. ROOT CAUSE ANALYSIS
${telemetryInsight}${rootCause}

## 2. TRIGGERING SYMPTOMS OBSERVED
${triggeringSymptoms.length > 0 ? triggeringSymptoms.map(s => `• ${s}`).join('\n') : "• No specific traits selected."}

## 3. ACTIONS FOR NEXT BAKE
${actions.map(a => `• ${a}`).join('\n')}
`;

  return {
    bulkStatus,
    proofStatus,
    rootCause,
    triggeringSymptoms,
    actions,
    markdown,
    iterationStatus,
    suggestedHypothesis
  };
}

// ─── Legacy Support (Keep for backward compatibility) ──────────────────────────
export const DEFECT_LIBRARY = DIAGNOSTIC_TAGS;
export type DefectSlug = DiagnosticTagSlug;
export type GlossaryCategory = DiagnosticCategory;
export type GlossaryTerm = DiagnosticTag;

export function getCorrelationAnalysis(
  bake: ActiveBake,
  selectedSlugs: DiagnosticTagSlug[],
  previousBake?: ActiveBake
): any[] {
  return [];
}
