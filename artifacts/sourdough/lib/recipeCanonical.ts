// lib/recipeCanonical.ts
import { SavedRecipe } from "./recipeTypes";
import { resolveRootMasterId } from "./recipeUtils";

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
 * Returns the version label (e.g. "Master", "v1.1") or null if no earlier version matches.
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
        return candidate.versionLabel || "Master";
      }
      return candidate.versionLabel || `v1.${i}`;
    }
  }

  return null;
}
