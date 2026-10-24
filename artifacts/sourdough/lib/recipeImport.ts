/**
 * artifacts/sourdough/lib/recipeImport.ts
 * Validation and Normalization layer for Portable Bread Lab Recipe Documents.
 *
 * Implements the boundary contract between external portable JSON documents and the
 * existing application persistence contract (api.recipes.upsert).
 */

import { PHASE_DEFINITIONS, RecipePhaseConfig } from "./recipeTypes";
import { calculateRecipeMetrics } from "./recipeUtils";

export interface PortableCheckableLine {
  id?: string;
  text: string;
  is_checked?: boolean;
  sort_order?: number;
}

export interface PortableRecipePhase {
  key: string;
  name?: string;
  ingredients?: PortableCheckableLine[];
  instructions?: PortableCheckableLine[];
}

export interface PortableRecipe {
  schemaVersion: "1.0" | string;
  name: string;
  overview?: string | null;
  yieldValue?: string | null;
  versionLabel?: string | null;
  phases: PortableRecipePhase[];
  [key: string]: unknown; // Allow additional unknown top-level fields for soft tolerance
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RuntimeImportOptions {
  id?: string;
  deviceId: string;
  userId?: string | null;
}

export const UNCLASSIFIED_STAGING_KEY = "unclassified_import_staging";

/**
 * Known legacy/alias key mappings to canonical PHASE_DEFINITIONS keys.
 */
export const PHASE_KEY_ALIASES: Record<string, string> = {
  dry_toasting: "toasting_flour",
  proofing: "ambient_proofing",
  baking: "the_bake",
  levain: "building_levain",
  main_dough: "incorporating",
};

/**
 * resolveCanonicalPhaseKey — Resolves an alias key to its canonical PHASE_DEFINITIONS key.
 */
export function resolveCanonicalPhaseKey(key: string): string {
  if (key === UNCLASSIFIED_STAGING_KEY) {
    return UNCLASSIFIED_STAGING_KEY;
  }
  if (PHASE_DEFINITIONS.some((def) => def.key === key)) {
    return key;
  }
  return PHASE_KEY_ALIASES[key] ?? key;
}

/**
 * generateUuid — Generates a pure UUID v4 string for Supabase PostgreSQL primary key compatibility.
 */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * generateUniqueId — Generates a fresh local ID for recipe entities or CheckableLines.
 */
function generateUniqueId(prefix: string = ""): string {
  const uuid = generateUuid();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

/**
 * validatePortableRecipe — Pure validation function for portable recipe documents.
 * Hard failures: missing schemaVersion, non-'1.0' schemaVersion, missing/empty name, missing/empty phases,
 * unknown phase keys (not in PHASE_DEFINITIONS or PHASE_KEY_ALIASES), malformed ingredient/instruction objects.
 * Soft tolerances: missing overview, missing yieldValue, custom phase names, extra top-level fields.
 */
export function validatePortableRecipe(doc: unknown): ValidationResult {
  const errors: string[] = [];

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { valid: false, errors: ["Portable recipe document must be a JSON object."] };
  }

  const recipe = doc as Record<string, any>;

  // 1. Validate schemaVersion
  if (!recipe["schemaVersion"] || typeof recipe["schemaVersion"] !== "string") {
    errors.push("Missing or invalid 'schemaVersion'. Expected string '1.0'.");
  } else if (recipe["schemaVersion"] !== "1.0") {
    errors.push(`Unsupported 'schemaVersion' '${recipe["schemaVersion"]}'. Only '1.0' is supported.`);
  }

  // 2. Validate name
  if (!recipe["name"] || typeof recipe["name"] !== "string" || recipe["name"].trim().length === 0) {
    errors.push("Missing or invalid 'name'. Non-empty recipe name is required.");
  }

  // 3. Validate phases array
  if (!Array.isArray(recipe["phases"]) || recipe["phases"].length === 0) {
    errors.push("Missing or invalid 'phases'. Non-empty array of phases is required.");
  } else {
    recipe["phases"].forEach((phase: any, pIdx: number) => {
      const phasePrefix = `Phase [${pIdx}]`;

      if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
        errors.push(`${phasePrefix}: Phase must be an object.`);
        return;
      }

      // Validate phase key against PHASE_DEFINITIONS (including aliases and import staging)
      if (!phase.key || typeof phase.key !== "string") {
        errors.push(`${phasePrefix}: Missing or invalid phase 'key'.`);
      } else {
        const canonicalKey = resolveCanonicalPhaseKey(phase.key);
        if (canonicalKey !== UNCLASSIFIED_STAGING_KEY && !PHASE_DEFINITIONS.some((def) => def.key === canonicalKey)) {
          errors.push(`${phasePrefix}: Unknown phase key '${phase.key}'. Must be a phase key.`);
        }
      }

      // Validate ingredients array if present
      if ("ingredients" in phase && phase.ingredients !== undefined) {
        if (!Array.isArray(phase.ingredients)) {
          errors.push(`${phasePrefix}: 'ingredients' must be an array.`);
        } else {
          phase.ingredients.forEach((ing: any, iIdx: number) => {
            if (!ing || typeof ing !== "object" || typeof ing.text !== "string") {
              errors.push(`${phasePrefix} ingredient [${iIdx}]: Must be an object with string 'text'.`);
            }
          });
        }
      }

      // Validate instructions array if present
      if ("instructions" in phase && phase.instructions !== undefined) {
        if (!Array.isArray(phase.instructions)) {
          errors.push(`${phasePrefix}: 'instructions' must be an array.`);
        } else {
          phase.instructions.forEach((ins: any, iIdx: number) => {
            if (!ins || typeof ins !== "object" || typeof ins.text !== "string") {
              errors.push(`${phasePrefix} instruction [${iIdx}]: Must be an object with string 'text'.`);
            }
          });
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * validateRecipeForCommit — Enforces strict Recipe commit boundary rules.
 * Candidates may contain unresolved material in Unassigned Material (UNCLASSIFIED_STAGING_KEY).
 * Committed Recipes MUST NOT: all ingredients and instructions must belong to legitimate phases.
 */
export function validateRecipeForCommit(doc: unknown): ValidationResult {
  const baseValidation = validatePortableRecipe(doc);
  if (!baseValidation.valid) {
    return baseValidation;
  }

  const recipe = doc as Record<string, any>;
  const errors: string[] = [];

  // Check if any phase is unassigned staging with ingredients or instructions
  const unassignedPhases = (recipe["phases"] as any[]).filter((phase: any) => {
    const canonicalKey = resolveCanonicalPhaseKey(phase.key);
    if (canonicalKey !== UNCLASSIFIED_STAGING_KEY) return false;
    const hasIngs = Array.isArray(phase.ingredients) && phase.ingredients.length > 0;
    const hasInsts = Array.isArray(phase.instructions) && phase.instructions.length > 0;
    return hasIngs || hasInsts;
  });

  if (unassignedPhases.length > 0) {
    errors.push(
      "Cannot commit Candidate as Recipe: Unassigned Material contains unassigned ingredients or instructions. All material must be assigned to phases before committing as a Recipe."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * parseYieldValue — Normalizes yield input to an integer yield_value and clean string.
 * Current application compatibility default: missing/empty/invalid yield becomes yield_value = 1, yieldValue = "1".
 */
export function parseYieldValue(rawYield?: string | null): { yieldValue: string; yield_value: number } {
  if (!rawYield || typeof rawYield !== "string" || rawYield.trim() === "") {
    return { yieldValue: "1", yield_value: 1 };
  }

  const parsed = parseInt(rawYield.trim(), 10);
  if (isNaN(parsed) || parsed <= 0) {
    return { yieldValue: "1", yield_value: 1 };
  }

  return { yieldValue: parsed.toString(), yield_value: parsed };
}

/**
 * normalizePortableRecipe — Pure normalization function.
 * Transforms a valid PortableRecipe into the existing application/upsert payload representation.
 * - Does NOT mutate the input document.
 * - Preserves explicit phase order without sorting.
 * - Preserves custom phase names if supplied; defaults to PHASE_DEFINITIONS name if omitted.
 * - Generates fresh local CheckableLine IDs while preserving text, ordering, and check state.
 * - Delegates metric calculations to calculateRecipeMetrics().
 * - Attaches runtime metadata from options.
 */
export function normalizePortableRecipe(doc: PortableRecipe, options: RuntimeImportOptions): any {
  const validation = validateRecipeForCommit(doc);
  if (!validation.valid) {
    throw new Error(`Portable recipe commit validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  if (!options || !options.deviceId) {
    throw new Error("RuntimeImportOptions requires 'deviceId'.");
  }

  // 1. Normalize phases preserving explicit document order, omitting Unassigned Material (staging) phase
  const normalizedPhases: RecipePhaseConfig[] = doc.phases
    .filter((phase) => {
      const canonicalKey = resolveCanonicalPhaseKey(phase.key);
      if (canonicalKey === UNCLASSIFIED_STAGING_KEY) {
        const hasIngs = Array.isArray(phase.ingredients) && phase.ingredients.length > 0;
        const hasInsts = Array.isArray(phase.instructions) && phase.instructions.length > 0;
        if (hasIngs || hasInsts) {
          throw new Error("Cannot normalize recipe: Unassigned Material contains unassigned ingredients or instructions.");
        }
        return false; // Omit empty Unassigned Material phase from promoted recipe
      }
      return true;
    })
    .map((phase) => {
    const canonicalKey = resolveCanonicalPhaseKey(phase.key);
    const canonicalDef = PHASE_DEFINITIONS.find((def) => def.key === canonicalKey);

    // Custom name takes precedence if supplied; fallback to canonical definition name
    const displayName = (phase.name && phase.name.trim().length > 0)
      ? phase.name.trim()
      : (canonicalDef ? canonicalDef.name : canonicalKey);

    const normIngredients = (phase.ingredients ?? []).map((ing, iIdx) => ({
      id: generateUniqueId("ing"),
      text: ing.text,
      is_checked: ing.is_checked ?? false,
      sort_order: ing.sort_order ?? iIdx,
    }));

    const normInstructions = (phase.instructions ?? []).map((ins, iIdx) => ({
      id: generateUniqueId("ins"),
      text: ins.text,
      is_checked: ins.is_checked ?? false,
      sort_order: ins.sort_order ?? iIdx,
    }));

    return {
      key: canonicalKey,
      name: displayName,
      ingredients: normIngredients,
      instructions: normInstructions,
    };
  });

  // 2. Delegate metric calculation to existing calculateRecipeMetrics()
  const metrics = calculateRecipeMetrics(normalizedPhases);

  // 3. Normalize yield value
  const yieldNorm = parseYieldValue(doc.yieldValue);

  // 4. Construct payload for api.recipes.upsert()
  const recipeId = options.id || generateUniqueId("rec");

  return {
    id: recipeId,
    deviceId: options.deviceId,
    userId: options.userId ?? null,
    name: doc.name.trim(),
    overview: doc.overview ? doc.overview.trim() : null,
    yieldValue: yieldNorm.yieldValue,
    yield_value: yieldNorm.yield_value,
    phases: normalizedPhases,
    total_flour_g: metrics.totalFlourG,
    hydration_pct: metrics.hydrationPct,
    parentRecipeId: null,
    versionLabel: doc.versionLabel ? doc.versionLabel.trim() : "v1.0",
    isArchived: false,
  };
}
