import { CheckableLine } from '../types/recipe';
import { RecipePhaseConfig, SavedRecipe, PHASE_CATEGORIES } from './recipeTypes';

/**
 * resolveRootMasterId — Traverses the parentRecipeId chain to find the root formula.
 */
export function resolveRootMasterId(recipe: SavedRecipe, allRecipes: SavedRecipe[]): string {
  let current = recipe;
  // Safety counter to prevent infinite loops in case of corrupted circular refs
  let depth = 0;
  while (current.parentRecipeId && depth < 20) {
    const parent = allRecipes.find(r => r.id === current.parentRecipeId);
    if (!parent) break; // Parent was deleted or not found, current is the "functional" master
    current = parent;
    depth++;
  }
  return current.id;
}

/**
 * scalePhaseText — display-only quantity scaler for phase spec text blocks.
 *
 * Scales only mass/volume quantities (Extensive Properties) — g, kg, ml, l,
 * oz, lbs — while leaving Intensive Properties (time, temperature, fold counts)
 * untouched. The original stored string is never mutated; this is purely
 * a display-time transform.
 *
 * The function handles both spaced notation ("250 g") and condensed keyboard
 * notation ("250g"). Original unit casing and spacing style are preserved.
 * The multiplied value is rounded to ≤1 decimal place with the trailing ".0"
 * stripped so "500.0g" becomes "500g" instead of cluttering the output.
 *
 * Fast-paths: returns the original string unchanged when multiplier === 1
 * or when text is empty/falsy.
 */


export function textToCheckableLines(text: string, prefix: string): CheckableLine[] {
  const lines = (!text || typeof text !== 'string')
    ? []
    : text.split('\n').map(s => s.trim()).filter(s => s.length > 0);

  if (lines.length === 0) {
    return [{ id: `${prefix}-empty`, text: '', is_checked: false, sort_order: 0 }];
  }

  return lines.map((line, idx) => ({
    id: `${prefix}-${idx}`,
    text: line,
    is_checked: false,
    sort_order: idx,
  }));
}

export function scaleCheckableLines(lines: CheckableLine[], multiplier: number): CheckableLine[] {
  if (multiplier === 1 || !lines) return lines;

  return lines.map(line => ({
    ...line,
    // We reuse the existing logic by scaling the text property of each line
    text: scalePhaseText(line.text, multiplier)
  }));
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BD": 0.5,    // 1/2
  "\u2153": 1 / 3,  // 1/3
  "\u2154": 2 / 3,  // 2/3
  "\u00BC": 0.25,   // 1/4
  "\u00BE": 0.75,   // 3/4
  "\u2155": 0.2,    // 1/5
  "\u2156": 0.4,    // 2/5
  "\u2157": 0.6,    // 3/5
  "\u2158": 0.8,    // 4/5
  "\u2159": 1 / 6,  // 1/6
  "\u215A": 5 / 6,  // 5/6
  "\u215B": 0.125,  // 1/8
  "\u215C": 0.375,  // 3/8
  "\u215D": 0.625,  // 5/8
  "\u215E": 0.875,  // 7/8
};

const KITCHEN_FRACTIONS: { val: number; slash: string; unicode: string }[] = [
  { val: 1 / 8, slash: "1/8", unicode: "\u215B" },
  { val: 1 / 6, slash: "1/6", unicode: "\u2159" },
  { val: 1 / 4, slash: "1/4", unicode: "\u00BC" },
  { val: 1 / 3, slash: "1/3", unicode: "\u2153" },
  { val: 3 / 8, slash: "3/8", unicode: "\u215C" },
  { val: 1 / 2, slash: "1/2", unicode: "\u00BD" },
  { val: 5 / 8, slash: "5/8", unicode: "\u215D" },
  { val: 2 / 3, slash: "2/3", unicode: "\u2154" },
  { val: 3 / 4, slash: "3/4", unicode: "\u00BE" },
  { val: 5 / 6, slash: "5/6", unicode: "\u215A" },
  { val: 7 / 8, slash: "7/8", unicode: "\u215E" },
];

// Explicit dictionary of supported ingredient units with singular/plural mappings.
const PLURALIZABLE_UNITS: Record<string, { singular: string; plural: string }> = {
  // Imperial mass
  lb: { singular: "lb", plural: "lbs" },
  lbs: { singular: "lb", plural: "lbs" },
  pound: { singular: "pound", plural: "pounds" },
  pounds: { singular: "pound", plural: "pounds" },
  ounce: { singular: "ounce", plural: "ounces" },
  ounces: { singular: "ounce", plural: "ounces" },

  // Eggs & Item counts
  egg: { singular: "egg", plural: "eggs" },
  eggs: { singular: "egg", plural: "eggs" },
  "large egg": { singular: "large egg", plural: "large eggs" },
  "large eggs": { singular: "large egg", plural: "large eggs" },
  yolk: { singular: "yolk", plural: "yolks" },
  yolks: { singular: "yolk", plural: "yolks" },
  "egg yolk": { singular: "egg yolk", plural: "egg yolks" },
  "egg yolks": { singular: "egg yolk", plural: "egg yolks" },
  white: { singular: "white", plural: "whites" },
  whites: { singular: "white", plural: "whites" },
  "egg white": { singular: "egg white", plural: "egg whites" },
  "egg whites": { singular: "egg white", plural: "egg whites" },

  // Fat & Dairy units
  stick: { singular: "stick", plural: "sticks" },
  sticks: { singular: "stick", plural: "sticks" },
  slice: { singular: "slice", plural: "slices" },
  slices: { singular: "slice", plural: "slices" },

  // Kitchen Volume units
  cup: { singular: "cup", plural: "cups" },
  cups: { singular: "cup", plural: "cups" },
  tablespoon: { singular: "tablespoon", plural: "tablespoons" },
  tablespoons: { singular: "tablespoon", plural: "tablespoons" },
  teaspoon: { singular: "teaspoon", plural: "teaspoons" },
  teaspoons: { singular: "teaspoon", plural: "teaspoons" },
  pinch: { singular: "pinch", plural: "pinches" },
  pinches: { singular: "pinch", plural: "pinches" },
  dash: { singular: "dash", plural: "dashes" },
  dashes: { singular: "dash", plural: "dashes" },
  clove: { singular: "clove", plural: "cloves" },
  cloves: { singular: "clove", plural: "cloves" },

  // Standard mass/volume full words
  gram: { singular: "gram", plural: "grams" },
  grams: { singular: "gram", plural: "grams" },
  kilogram: { singular: "kilogram", plural: "kilograms" },
  kilograms: { singular: "kilogram", plural: "kilograms" },
  milliliter: { singular: "milliliter", plural: "milliliters" },
  milliliters: { singular: "milliliter", plural: "milliliters" },
  liter: { singular: "liter", plural: "liters" },
  liters: { singular: "liter", plural: "liters" },
};

function parseQuantityInfo(numStr: string): { qty: number; isSlash: boolean; isUnicode: boolean } {
  const trimmed = numStr.trim();

  // Check unicode fraction (e.g. "½", "1½", "1 ½")
  for (const [char, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (trimmed.includes(char)) {
      const wholePart = trimmed.replace(char, "").trim();
      const whole = wholePart ? parseFloat(wholePart) : 0;
      return { qty: whole + val, isSlash: false, isUnicode: true };
    }
  }

  // Check slash fraction / mixed fraction (e.g. "1 1/2", "1/2")
  if (trimmed.includes("/")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 2) {
      const whole = parseFloat(parts[0]);
      const [num, den] = parts[1].split("/").map(Number);
      return { qty: whole + num / den, isSlash: true, isUnicode: false };
    } else if (parts.length === 1) {
      const [num, den] = parts[0].split("/").map(Number);
      return { qty: num / den, isSlash: true, isUnicode: false };
    }
  }

  return { qty: parseFloat(trimmed), isSlash: false, isUnicode: false };
}

function formatQuantity(scaled: number, isSlash: boolean, isUnicode: boolean): { formattedQty: string; isFractionOutput: boolean } {
  // If exact integer, format as whole number
  if (Math.abs(scaled - Math.round(scaled)) < 0.0001) {
    return { formattedQty: Math.round(scaled).toString(), isFractionOutput: false };
  }

  // If input was a fraction (slash or unicode), attempt fraction-preserving output
  if (isSlash || isUnicode) {
    const whole = Math.floor(scaled);
    const fractionalPart = scaled - whole;

    // Match against kitchen fractions within tolerance
    const match = KITCHEN_FRACTIONS.find(f => Math.abs(fractionalPart - f.val) < 0.015);
    if (match) {
      if (isUnicode) {
        return { formattedQty: whole > 0 ? `${whole}${match.unicode}` : match.unicode, isFractionOutput: true };
      } else {
        return { formattedQty: whole > 0 ? `${whole} ${match.slash}` : match.slash, isFractionOutput: true };
      }
    }
  }

  // Fallback for non-fractions or unrepresentable fractions: decimal rounded to <= 2 decimal places
  return { formattedQty: parseFloat(scaled.toFixed(2)).toString(), isFractionOutput: false };
}

// Regex matching quantity followed by optional space and a whitelisted unit word.
const INGREDIENT_UNIT_REGEX = /(?<=^|[\s,;(])((?:\d+\s+)?\d+\/\d+|\d+\s*[\u00BD\u2153\u2154\u00BC\u00BE\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E]|[\u00BD\u2153\u2154\u00BC\u00BE\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E]|\d+(?:\.\d+)?)(?:(\s+)?)(large eggs|large egg|egg yolks|egg yolk|egg whites|egg white|tablespoons|tablespoon|teaspoons|teaspoon|kilograms|kilogram|milliliters|milliliter|ounces|ounce|pounds|pound|sticks|stick|slices|slice|cups|cup|pinches|pinch|dashes|dash|cloves|clove|grams|gram|liters|liter|eggs|egg|yolks|yolk|whites|white|tbsp|tbs|tb|tsp|ts|lbs|lb|oz|kg|ml|l|g)\b/gi;

export function scalePhaseText(text: string, multiplier: number): string {
  if (multiplier === 1 || !text) return text;

  return text.replace(
    INGREDIENT_UNIT_REGEX,
    (_match, numStr: string, space: string | undefined, unitMatch: string) => {
      const { qty, isSlash, isUnicode } = parseQuantityInfo(numStr);
      const scaled = qty * multiplier;
      const { formattedQty, isFractionOutput } = formatQuantity(scaled, isSlash, isUnicode);

      const lowerUnit = unitMatch.toLowerCase();
      let finalUnit = unitMatch;

      if (PLURALIZABLE_UNITS[lowerUnit]) {
        let isPlural: boolean;
        if (formattedQty === "1") {
          isPlural = false;
        } else if (isFractionOutput) {
          const isMixedNumber = formattedQty.includes(" ") || /^\d+[\u00BD\u2153\u2154\u00BC\u00BE\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E]/.test(formattedQty);
          isPlural = isMixedNumber;
        } else {
          isPlural = true;
        }

        const targetForm = isPlural
          ? PLURALIZABLE_UNITS[lowerUnit].plural
          : PLURALIZABLE_UNITS[lowerUnit].singular;

        if (unitMatch === unitMatch.toLowerCase()) {
          finalUnit = targetForm.toLowerCase();
        } else if (unitMatch === unitMatch.toUpperCase()) {
          finalUnit = targetForm.toUpperCase();
        } else if (unitMatch[0] === unitMatch[0].toUpperCase()) {
          finalUnit = targetForm.charAt(0).toUpperCase() + targetForm.slice(1).toLowerCase();
        } else {
          finalUnit = targetForm;
        }
      }

      return `${formattedQty}${space ?? ""}${finalUnit}`;
    }
  );
}

/** "01:23:45" or "23:45" — used for active phase elapsed display */
export function formatTimer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "1h 30m", "45m", "< 1m" — used for completed phase duration display */
export function formatDone(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m === 0) return "< 1m";
  return `${m}m`;
}

/** "9:05 AM" — used for reading log timestamps */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Jan 5" — used for recipe creation date display */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * detectYeastType — Specifically looks at the incorporating or fermentolysing phases
 * to determine if the recipe uses 'instant', 'dry', or 'wild' yeast.
 */
export function detectYeastType(phases: { key: string; ingredients: any }[]): 'instant' | 'dry' | 'wild' {
  const targetPhases = phases.filter(p => p.key === 'incorporating' || p.key === 'fermentolysing');

  // Priority: if no target phases, scan all just in case
  const scanPhases = targetPhases.length > 0 ? targetPhases : phases;

  let hasStarter = false;
  let commercialType: 'instant' | 'dry' | null = null;

  scanPhases.forEach(p => {
    const lines: string[] = Array.isArray(p.ingredients)
      ? p.ingredients.map((i: any) => i.text.toLowerCase())
      : typeof p.ingredients === "string"
      ? p.ingredients.toLowerCase().split("\n")
      : [];

    lines.forEach(line => {
      if (line.includes("starter") || line.includes("levain") || line.includes("leaven")) {
        hasStarter = true;
      }
      if (line.includes("yeast")) {
        if (line.includes("instant") || line.includes("saf")) commercialType = "instant";
        else if (line.includes("dry") || line.includes("active")) commercialType = "dry";
        else if (!commercialType) commercialType = "instant"; // Default to instant if "yeast" found
      }
    });
  });

  if (commercialType) return commercialType;
  if (hasStarter) return 'wild';
  return 'wild'; // Default fallback
}

/**
 * parseIngredientsForMetrics — Unified parser for Flour, Water, Starter, and Yeast.
 * Supports both legacy strings and new CheckableLine arrays.
 */
export function parseIngredientsForMetrics(phases: { ingredients: string | any[] }[]) {
  let totals = {
    flour: 0,
    water: 0,
    starter: 0,
    yeast: 0,
    salt: 0,
    yeastType: "unknown" as "instant" | "dry" | "unknown",
    // Smart hydration tracking
    additionalWater: 0,
    additionalSolids: 0,
  };

  const weightRegex = /(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|ml|l|oz|lbs)/gi;

  phases.forEach((p) => {
    const lines: string[] = Array.isArray(p.ingredients)
      ? p.ingredients.map((i) => i.text.toLowerCase())
      : typeof p.ingredients === "string"
      ? p.ingredients.toLowerCase().split("\n")
      : [];

    lines.forEach((line) => {
      // Split line by common conjunctions to isolate ingredient contexts
      const parts = line.split(/\s+(?:and|&|,)\s+/);

      parts.forEach(part => {
        let match;
        // We use a fresh regex or reset it to ensure we catch all matches in this part
        const partRegex = new RegExp(weightRegex.source, weightRegex.flags);

        while ((match = partRegex.exec(part)) !== null) {
          let weight = parseFloat(match[1]);
          const unitLabel = match[2].toLowerCase();

          if (unitLabel === "kg" || unitLabel === "l") weight *= 1000;
          else if (unitLabel === "oz") weight *= 28.35;
          else if (unitLabel === "lbs") weight *= 453.59;

          // Priority context: Yeast > Starter > Flour > Water
          if (
            part.includes("yeast") ||
            part.includes("instant starter") ||
            part.includes("saf") ||
            part.includes("active dry")
          ) {
            totals.yeast += weight;
            if (part.includes("instant") || part.includes("saf")) totals.yeastType = "instant";
            else if (part.includes("dry") || part.includes("active")) totals.yeastType = "dry";
            else if (totals.yeastType === "unknown") totals.yeastType = "instant";
          } else if (
            part.includes("starter") ||
            part.includes("levain") ||
            part.includes("leaven") ||
            part.includes("preferment") ||
            part.includes("poolish") ||
            part.includes("biga") ||
            part.includes("discard") ||
            part.includes("sponge") ||
            part.includes("mother")
          ) {
            totals.starter += weight;
          } else if (part.includes("flour") || part.includes("meal") || part.includes("wheat") || part.includes("rye") || part.includes("spelt")) {
            totals.flour += weight;
          } else if (part.includes("water") || part.includes("h2o")) {
            totals.water += weight;
          } else if (part.includes("salt")) {
            totals.salt += weight;
          }
          // Liquid Hydrators
          else if (part.includes("milk")) {
            totals.additionalWater += weight * 0.87;
            totals.additionalSolids += weight * 0.13;
          } else if (part.includes("egg")) {
            totals.additionalWater += weight * 0.75;
          } else if (part.includes("yogurt") || part.includes("sour cream")) {
            totals.additionalWater += weight * 0.8;
          } else if (part.includes("cream")) {
            totals.additionalWater += weight * 0.65;
          } else if (part.includes("puree") || part.includes("sauce")) {
            totals.additionalWater += weight * 0.85;
          }
          // Syrups & Fats
          else if (part.includes("honey") || part.includes("maple") || part.includes("molasses") || part.includes("sugar") || part.includes("sucrose")) {
            totals.additionalWater += weight * 0.18;
          } else if (part.includes("butter")) {
            totals.additionalWater += weight * 0.17;
          }
        }
      });
    });
  });

  // Convert Yeast to Starter Equivalent
  const yeastEquiv = totals.yeast * (totals.yeastType === "instant" ? 28.5 : 22.8);
  const effectiveStarter = totals.starter + yeastEquiv;

  return { ...totals, effectiveStarter };
}

/**
 * calculateRecipeMetrics — Returns total flour and hydration pct for Supabase.
 */
export function calculateRecipeMetrics(phases: any[]) {
  const { flour, water, starter, effectiveStarter, additionalWater, additionalSolids, salt } =
    parseIngredientsForMetrics(phases);

  // Recipe totals include starter components (assume 50/50)
  // and solids from milk, etc.
  const totalFlour = flour + starter / 2 + additionalSolids;
  const totalWater = water + starter / 2 + additionalWater;

  return {
    totalFlourG: Math.round(totalFlour),
    hydrationPct: totalFlour > 0 ? Math.round((totalWater / totalFlour) * 100) : 0,
    inoculationPct: totalFlour > 0 ? (effectiveStarter / totalFlour) * 100 : 20,
    saltPct: totalFlour > 0 ? (salt / totalFlour) * 100 : 0,
    enriched: additionalWater > 0 || additionalSolids > 0,
  };
}

/**
 * sortRecipePhases — Sorts recipe phases according to the canonical order in PHASE_CATEGORIES / PHASE_DEFINITIONS.
 */
export function sortRecipePhases(phases: RecipePhaseConfig[]): RecipePhaseConfig[] {
  const defOrder = new Map<string, number>();
  let idx = 0;
  for (const cat of PHASE_CATEGORIES) {
    if (!defOrder.has(cat.key)) defOrder.set(cat.key, idx);
    for (const phase of cat.phases) {
      if (!defOrder.has(phase.key)) defOrder.set(phase.key, idx);
      idx++;
    }
  }
  return [...phases].sort((a, b) => (defOrder.get(a.key) ?? 999) - (defOrder.get(b.key) ?? 999));
}

/**
 * createEmptyPhase — Instantiates a fresh recipe phase with a default empty checkable line item.
 */
export function createEmptyPhase(key: string, name: string): RecipePhaseConfig {
  const randPrefix = Math.random().toString(36).substr(2, 9);
  return {
    key,
    name,
    ingredients: [{ id: `ing-${randPrefix}-empty`, text: '', is_checked: false, sort_order: 0 }],
    instructions: [{ id: `ins-${randPrefix}-empty`, text: '', is_checked: false, sort_order: 0 }]
  };
}

