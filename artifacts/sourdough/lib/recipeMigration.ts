// artifacts/sourdough/lib/recipeMigration.ts
/*
* This utility facilitates the "lossless promotion" of legacy flat-string recipes into the
* structured Universal Recipe Card format. It primarily handles splitting unstructured text blobs
* into unique CheckableLine objects while assigning placeholder values for new metric fields.
* The core logic is contained in `migrateToUniversalCard`, which maps old phase configurations to
* the new timeline and ingredient arrays.
*/
import { randomUUID } from 'expo-crypto';
import {
  UniversalRecipeCard,
  CheckableLine,
  RecipeIngredient,
  TimelineStep
} from '../types/recipe';
import { SavedRecipe } from './recipeTypes';
import { textToCheckableLines } from './recipeUtils';

// [DIAGNOSTIC LOG] Migration Utility Loaded
//console.log("[Bread Lab] Migration: Initializing legacy-to-universal converter...");

export function migrateToUniversalCard(legacy: SavedRecipe): UniversalRecipeCard {
//  console.log(`[Bread Lab] Migration: Processing recipe "${legacy.name}" (ID: ${legacy.id})`);

  const allIngredients: RecipeIngredient[] = [];
  legacy.phases.forEach((phase, phaseIdx) => {
    const lines = Array.isArray(phase.ingredients)
      ? phase.ingredients
      : textToCheckableLines(phase.ingredients as any, 'ing');
    lines.forEach((line, lineIdx) => {
      allIngredients.push({
        id: line.id,
        name: line.text,
        category: 'other',
        measurement: { bakers_pct: 0, reference_grams: 0 },
        is_optional: false,
        variant_tags: [],
        sort_order: (phaseIdx * 100) + lineIdx,
      });
    });
  });

  const timeline: TimelineStep[] = legacy.phases.map((phase, idx) => {
  const checklist = Array.isArray(phase.instructions)
    ? phase.instructions
    : textToCheckableLines(phase.instructions as any, 'ins');

  const ingredientsInThisPhase = Array.isArray(phase.ingredients)
    ? phase.ingredients.map(l => l.id)
    : textToCheckableLines(phase.ingredients as any, 'ing').map(l => l.id);

    return {
      id: randomUUID(),
      phase_key: phase.key,
      name: phase.name,
      duration_minutes: 0,
      checklist_items: checklist,
      ingredients_introduced: ingredientsInThisPhase,
      sort_order: idx,
    };
  });

  return {
    version: '1.2.0',
    title: legacy.name,
    slug: legacy.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    is_public: false,
    reference_yield: { loaves: legacy.yieldValue ? parseInt(legacy.yieldValue, 10) : 1, total_flour_g: 0 },
    available_variants: [],
    ingredients: allIngredients,
    timeline: timeline,
    migration_metadata: { is_migrated: true, source_legacy_id: legacy.id, needs_review: true },
  };
}