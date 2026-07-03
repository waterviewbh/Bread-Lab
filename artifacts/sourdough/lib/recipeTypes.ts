// lib/recipeTypes.ts
// ─── Single source of truth for all recipe/bake data shapes ──────────────────
// Pure TypeScript — no React, no hooks, no AsyncStorage.
// Imported by recipe.tsx today; will be shared with the Universal Card
// schema (types/recipe.ts) in a later phase without naming collision.

// ─── Storage keys ─────────────────────────────────────────────────────────────
export const RECIPES_KEY            = "bread_lab_recipes_v1";
export const BAKE_KEY               = "bread_lab_bake_v2";
export const BAKE_HISTORY_KEY       = "bread_lab_bake_history_v1";
export const NUDGE_KEY              = "bread_lab_name_nudge_shown_v1";
export const DELETED_RECIPE_IDS_KEY = "bread_lab_deleted_recipe_ids_v1";

// ─── Reading ──────────────────────────────────────────────────────────────────
export interface Reading {
  id: string;
  temp: string;
  tempUnit: "F" | "C";
  pH: string;
  note: string;
  volume: string;
  loggedAt: number;
}

// ─── Sensory scores (bulk ferment log modal) ───────────────────────────────────
// Integer 1–3 scale per dimension; undefined = not yet observed.
// These live as a sub-object on BulkFermentReading so they can be graphed
// independently from numeric data in a later phase.
export interface BulkSensoryScores {
  /* Surface curvature: 1 = Flat, 2 = Curved, 3 = Domed */
  surfaceShape?:  1 | 2 | 3;
  /* Bubble visibility: 1 = None, 2 = Edges, 3 = Surface */
  bubbles?:       1 | 2 | 3;
  /* Dough puffiness: 1 = Dense, 2 = Airy, 3 = Very puffy */
  puffiness?:     1 | 2 | 3;
  /* Stickiness on hands: 1 = Very sticky, 2 = Slightly sticky, 3 = Clean */
  stickiness?:    1 | 2 | 3;
}

// ─── Bulk ferment reading (extends generic Reading) ───────────────────────────
// Used exclusively within BakePhase.key === "bulk_fermenting".
// volume_ml is stored as a number here (not the string Reading.volume) so the
// PD engine can operate without parsing. The base Reading.volume string is kept
// for display consistency with non-bulk phases.
export interface BulkFermentReading extends Reading {
  /* Measured container volume in ml (required for PD velocity calc) */
  volume_ml?: number;
  /* Dough temperature at log time (float, same unit as Reading.tempUnit) */
  doughTemp?: number;
  /* Ambient room temperature at log time (float) */
  ambientTemp?: number;
  /* Structured sensory observations; undefined = tap-form not yet submitted */
  sensory?: BulkSensoryScores;
  /* True if this reading was taken immediately after a structural intervention
   *  (e.g., coil fold, lamination) — flags a likely temporary volume dip
   *  so the PD engine can damp rather than react to the negative derivative */
  postIntervention?: boolean;
}

// ─── Bulk ferment PD engine state (stored on BakePhase for persistence) ───────
// Written by the PD engine after each new BulkFermentReading; never edited by
// the user directly. All fields are optional so the phase shape stays valid
// before the engine has enough data to make a projection.
export interface BulkFermentState {
  /* Container volume at phase start (the enforced baseline, ml) */
  startVolume_ml?: number;
  /* Target rise percentage (0.0–1.0) resolved from the temp-lookup table */
  targetRiseFraction?: number;
  /* Absolute target volume in ml: startVolume_ml * (1 + targetRiseFraction) */
  targetVolume_ml?: number;
  /* Unix ms timestamp when the PD engine's projection is set to hit zero */
  projectedTargetAt?: number | null;
  /* Unix ms timestamp when the countdown actually hit zero (target first reached) */
  targetReachedAt?: number | null;
  /* True once the countdown has transitioned to the passive overtime counter */
  inOvertime?: boolean;
  /* Timestamp when the baker confirmed "Complete" during/after overtime */
  completedAt?: number | null;
}

// ─── Recipe phase (builder config, persisted shape) ───────────────────────────
export interface RecipePhaseConfig {
  key: string;
  name: string;
  ingredients: string;
  instructions: string;
}

// ─── Saved recipe (persisted shape) ──────────────────────────────────────────
export interface SavedRecipe {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  phases: RecipePhaseConfig[];
  yieldValue?: string;
}

// ─── Active bake phase (runner shape, extends builder config) ─────────────────
export interface BakePhase extends RecipePhaseConfig {
  startedAt: number | null;
  completedAt: number | null;
  /* Generic readings (all phases); for bulk_fermenting, cast elements to BulkFermentReading */
  readings: Reading[];
  /* Legacy display string (non-bulk volume phases) */
  startVolume?: string;
  foldCount?: number;
  /* Populated only when key === "bulk_fermenting" */
  bulkFermentState?: BulkFermentState;
}

// ─── Active bake (in-progress state) ─────────────────────────────────────────
export interface ActiveBake {
  id: string;
  recipeId: string;
  recipeName: string;
  startedAt: number;
  phases: BakePhase[];
  notes?: string;
  yieldValue?: string;
}

// ─── Phase catalogue (hierarchical) ──────────────────────────────────────────
// Defines every possible phase in canonical display order.
// KeycapKey rendering constants are NOT here — those live in the component file.
export const PHASE_CATEGORIES: {
  key: string;
  name: string;
  phases: { key: string; name: string; hint: string }[];
}[] = [
  {
    key: "pre_processing",
    name: "Pre-Processing",
    phases: [
      { key: "building_levain",  name: "Building the Levain",  hint: "Build your levain/starter culture before mixing" },
      { key: "scalding",         name: "Scalding",             hint: "Scald flour or grains with boiling water" },
      { key: "toasting_flour",   name: "Dry Toasting",         hint: "Dry toast flour, nuts, or seeds for deeper flavor (Flour, nuts, seeds)" },
      { key: "soaking_seeds",    name: "Soaking Seeds/Grains", hint: "Pre-soak seeds or whole grains to soften them" },
    ],
  },
  {
    key: "mixing",
    name: "Mixing",
    phases: [
      { key: "autolysing",       name: "Autolysing",      hint: "Flour and water rest before salt/levain are added" },
      { key: "fermentolysing",   name: "Fermentolysing",  hint: "Autolyse with levain included for extra activity" },
      { key: "incorporating",    name: "Incorporating",   hint: "Combine all dough components into a cohesive mass" },
      { key: "delaying_salt",    name: "Delayed Salt",    hint: "Add salt separately after initial mixing" },
      { key: "bassinage",        name: "Bassinage",       hint: "Gradually add reserved water to tighten the dough" },
      { key: "adding_inclusions",name: "Adding Inclusions",hint: "Fold in seeds, nuts, cheese, or other mix-ins" },
    ],
  },
  {
    key: "fermentation",
    name: "Fermentation",
    phases: [
      { key: "stretching_folding", name: "Stretching and Folding", hint: "Develop gluten strength during bulk fermentation" },
      { key: "laminating",         name: "Laminating",             hint: "Open dough flat and fold to incorporate inclusions" },
      { key: "bulk_fermenting",    name: "Bulk Fermenting",        hint: "Main fermentation period at room temperature" },
    ],
  },
  {
    key: "shaping",
    name: "Shaping",
    phases: [
      { key: "preshaping",    name: "Preshaping",    hint: "Initial rough shaping to build tension" },
      { key: "bench_resting", name: "Bench Resting", hint: "Rest on the bench between preshape and final shape" },
      { key: "final_shaping", name: "Final Shaping", hint: "Tight final shaping before proof" },
      { key: "stitching",     name: "Stitching",     hint: "Tighten the seam side to add more tension" },
    ],
  },
  {
    key: "proofing",
    name: "Proofing",
    phases: [
      { key: "cold_retarding",   name: "Cold Retarding", hint: "Long cold proof in the refrigerator overnight" },
      { key: "ambient_proofing", name: "Proofing",       hint: "Room-temperature final proof" },
    ],
  },
  {
    key: "baking",
    name: "Baking",
    phases: [
      { key: "scoring",   name: "Scoring", hint: "Score the surface for controlled oven spring" },
      { key: "the_bake",  name: "Baking",  hint: "Into the oven — steam phase then open bake" },
    ],
  },
];

// ─── Flat lookup list (backward-compatible; derived from PHASE_CATEGORIES) ────
// Use PHASE_CATEGORIES for grouped display; use PHASE_DEFINITIONS for key lookups.
export const PHASE_DEFINITIONS = PHASE_CATEGORIES.flatMap((c) => c.phases);

// ─── Phase keys where volume tracking fields should be shown ──────────────────
// Fermentation/proofing phases where rise tracking (start vs. end volume) matters.
// "ambient_proofing" is intentionally excluded — not useful in practice.
export const VOLUME_TRACKING_PHASE_KEYS = new Set([
  "building_levain",
  "bulk_fermenting",
  "cold_retarding",
]);

// ─── Bulk ferment: dough temp → target rise fraction lookup ───────────────────
// Rows are matched by finding the first entry where doughTempF <= the threshold.
// Source: empirical sourdough bulk ferment combines guidance from Cucuzza's TSJ and Forkish's FWSY.
// Cooler dough = longer bulk = more conservative rise target before shaping.
export const BULK_TEMP_RISE_TABLE: { maxTempF: number; targetFraction: number }[] = [
  { maxTempF: 68, targetFraction: 0.80 }, // Cool kitchen: 50% rise target
  { maxTempF: 72, targetFraction: 0.60 },
  { maxTempF: 76, targetFraction: 0.47 },
  { maxTempF: 80, targetFraction: 0.32 },
  { maxTempF: 84, targetFraction: 0.30 }, // Warm kitchen: 30% rise target
];

/** Minimum elapsed-time gap (ms) between readings before the derivative is trusted.
 *  Prevents a "two-point jolt" from a rapid second reading. */
export const BULK_MIN_DERIVATIVE_GAP_MS = 20 * 60 * 1000; // 20 minutes

/** Cap on the negative derivative swing (ml/ms) to absorb degassing events.
 *  A fold-induced dip steeper than this is damped to zero. */
export const BULK_NEGATIVE_DERIVATIVE_CAP = -0.0005; // ≈ −0.5 ml/s