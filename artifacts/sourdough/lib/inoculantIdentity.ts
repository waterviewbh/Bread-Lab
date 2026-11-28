export type InoculantIdentity = "sourdough" | "commercial" | "hybrid" | "preferment";

type IngredientLine = string | { text: string };
type IngredientPhase = { ingredients?: string | readonly IngredientLine[] | null };

/**
 * Presentation identity only. Calculator yeast defaults and weights are intentionally
 * independent from these conservative text rules.
 */
export function classifyInoculant(phases: readonly IngredientPhase[]): InoculantIdentity | null {
  let starter = false;
  let commercial = false;
  let preferment = false;
  let ambiguous = false;

  for (const phase of phases) {
    const ingredients = phase.ingredients;
    const lines = typeof ingredients === "string"
      ? ingredients.split("\n")
      : Array.isArray(ingredients) ? ingredients : [];

    for (const entry of lines) {
      const line = (typeof entry === "string" ? entry : entry?.text || "").toLowerCase();
      for (const part of line.split(/\s+(?:and|&)\s+|,\s*/)) {
        const hasStarter = /\b(?:sourdough\s+(?:starter|discard|culture)|peak\s+starter|levain)\b/.test(part);
        const hasCommercial = /\b(?:instant\s+yeast|active\s+dry\s+yeast|dry\s+active\s+yeast|saf(?:-instant)?\s+yeast)\b/.test(part);
        // Require a measured, explicitly named preferment ingredient. Descriptive
        // phrases such as "poolish-style" and a bare "preferment" stay unresolved.
        const hasPreferment = /\b\d+(?:\.\d+)?\s*(?:g|kg|grams?|oz|lbs?)\b/.test(part)
          && /\b(?:poolish|biga|sponge)\b(?![-\s]*(?:style|like|flavou?r))/.test(part);
        const unclear = /\b(?:yeast|starter|discard|leaven|preferment|poolish|biga|sponge|mother|culture)\b/.test(part)
          && !hasStarter && !hasCommercial && !hasPreferment;
        if ([hasStarter, hasCommercial, hasPreferment].filter(Boolean).length > 1) ambiguous = true;
        starter ||= hasStarter;
        commercial ||= hasCommercial;
        preferment ||= hasPreferment;
        ambiguous ||= unclear;
      }
    }
  }

  if (ambiguous || (preferment && (starter || commercial))) return null;
  if (starter && commercial) return "hybrid";
  if (preferment) return "preferment";
  if (starter) return "sourdough";
  if (commercial) return "commercial";
  return null;
}
