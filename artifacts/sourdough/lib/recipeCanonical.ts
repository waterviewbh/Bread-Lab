// lib/recipeCanonical.ts
import { SavedRecipe } from "./recipeTypes";
import { resolveRootMasterId } from "./recipeUtils";

/** Hides the suffix previously added by Log Diagnostics to generated iterations. */
export function getDisplayRecipeName(recipe: SavedRecipe): string {
  return recipe.name.replace(/\s*\(Iterated\)/gi, "").trim();
}

/** Appends the stored version only when it is not already the name's suffix. */
export function getRecipeNameWithVersion(recipe: Pick<SavedRecipe, "name" | "versionLabel">): string {
  const label = recipe.versionLabel;
  if (!label || !recipe.name || recipe.name.endsWith(` ${label}`)) return recipe.name;
  return `${recipe.name} ${label}`;
}

/** Removes only the displayed suffix before updating the canonical name. */
export function getEditableRecipeName(displayName: string, versionLabel?: string): string {
  return versionLabel && displayName.endsWith(` ${versionLabel}`)
    ? displayName.slice(0, -versionLabel.length - 1)
    : displayName;
}

/** Normalizes legacy iteration labels while leaving master and import labels unchanged. */
export function getDisplayVersionLabel(recipe: SavedRecipe): string | undefined {
  const label = recipe.versionLabel;
  const legacyIteration = recipe.parentRecipeId && label?.match(/^v1\.(\d+)$/i);
  return legacyIteration ? `v${Number(legacyIteration[1]) + 1}` : label;
}

export interface CanonicalPhase {
  key: string;
  name: string;
  ingredients: string[];
  instructions: string[];
}

export interface CanonicalRecipeContent {
  yieldValue: string;
  phases: CanonicalPhase[];
}

export function getCanonicalRecipeContent(recipe: SavedRecipe): CanonicalRecipeContent {
  const yieldValue = (recipe.yieldValue || "").trim();

  const rawPhases = Array.isArray(recipe.phases) ? recipe.phases : [];
  const phases: CanonicalPhase[] = [];

  for (const p of rawPhases) {
    if (!p) continue;
    const key = (p.key || "").trim();
    const name = (p.name || "").trim();

    const ingredients = (Array.isArray(p.ingredients) ? p.ingredients : [])
      .filter((l: any) => l && typeof l.text === 'string' && l.text.trim() !== "")
      .map((l: any) => l.text.trim());

    const instructions = (Array.isArray(p.instructions) ? p.instructions : [])
      .filter((l: any) => l && typeof l.text === 'string' && l.text.trim() !== "")
      .map((l: any) => l.text.trim());

    // Skip genuinely empty phase placeholders (no key, no name, no ingredients, no instructions)
    if (!key && !name && ingredients.length === 0 && instructions.length === 0) {
      continue;
    }

    phases.push({
      key,
      name,
      ingredients,
      instructions,
    });
  }

  return {
    yieldValue,
    phases,
  };
}

export function areCanonicalContentsEqual(a: SavedRecipe, b: SavedRecipe): boolean {
  const canonA = getCanonicalRecipeContent(a);
  const canonB = getCanonicalRecipeContent(b);
  return JSON.stringify(canonA) === JSON.stringify(canonB);
}

/**
 * Finds the most recent earlier version in the recipe's lineage that matches its canonical content.
 * Returns the display version label (e.g. "Master", "v2") or null if no earlier version matches.
 */
export function findMatchingLineageVersion(currentRecipe: SavedRecipe, allRecipes: SavedRecipe[]): string | null {
  const rootId = resolveRootMasterId(currentRecipe, allRecipes);

  // Gather all recipes in the lineage (Master + iterations)
  const lineage = allRecipes.filter(r => {
    if (r.id === currentRecipe.id) return false;
    return resolveRootMasterId(r, allRecipes) === rootId || r.id === rootId;
  });

  if (lineage.length === 0) return null;

  // Sort lineage chronologically (oldest first, or by createdAt)
  const sortedLineage = [...lineage].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // Filter to only earlier versions (createdAt < currentRecipe.createdAt, or if createdAt is equal, id comparison)
  const earlierVersions = sortedLineage.filter(r => (r.createdAt || 0) < (currentRecipe.createdAt || 0) || ((r.createdAt || 0) === (currentRecipe.createdAt || 0) && r.id !== currentRecipe.id));

  if (earlierVersions.length === 0) return null;

  // Traverse backwards (most recent first) to find the most recent matching earlier version
  for (let i = earlierVersions.length - 1; i >= 0; i--) {
    const candidate = earlierVersions[i];
    if (areCanonicalContentsEqual(currentRecipe, candidate)) {
      const isMaster = !candidate.parentRecipeId;
      if (isMaster) {
        return getDisplayVersionLabel(candidate) || "Master";
      }
      return getDisplayVersionLabel(candidate) || `v${i + 1}`;
    }
  }

  return null;
}
