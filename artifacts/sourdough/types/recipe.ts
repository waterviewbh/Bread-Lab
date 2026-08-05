/**
* artifacts/sourdough/types/recipe.ts
* This file defines the Zod-validated schema for the Universal Recipe Card (v1.2.0), the app's core
* data structure. It organizes recipes into structured ingredients and a timeline of steps,
* replacing legacy flat-string fields. Major sections include schemas for measurements, checkable
* lines, ingredients, and the master recipe document.
*/
import { z } from 'zod';

// [DIAGNOSTIC LOG] Initializing Universal Recipe Card Schema (v1.2.0)
console.log("[Bread Lab] Schema: Loading UniversalRecipeCard definitions...");

export const BakerMeasurementSchema = z.object({
  bakers_pct: z.number().nonnegative(),
  reference_grams: z.number().nonnegative(),
});

export const CheckableLineSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  is_checked: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export const RecipeIngredientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  category: z.enum([
    'flour', 'water', 'salt', 'levain', 'yeast',
    'inclusion', 'fat', 'egg', 'dairy', 'sweetener', 'other'
  ]),
  measurement: BakerMeasurementSchema,
  is_optional: z.boolean().default(false),
  variant_tags: z.array(z.string().uuid()).default([]),
  sort_order: z.number().int().default(0),
});

export const TimelineStepSchema = z.object({
  id: z.string().uuid(),
  phase_key: z.string(),
  name: z.string(),
  duration_minutes: z.number().int().nonnegative().default(0),
  checklist_items: z.array(CheckableLineSchema).default([]),
  ingredients_introduced: z.array(z.string().uuid()).default([]),
  variant_tag: z.string().uuid().optional(),
  sort_order: z.number().int().default(0),
});

export const UniversalRecipeCardSchema = z.object({
  version: z.literal('1.2.0'),
  title: z.string().min(3),
  slug: z.string(),
  is_public: z.boolean().default(false),
  reference_yield: z.object({
    loaves: z.number().int().positive().default(1),
    total_flour_g: z.number().positive(),
  }),
  available_variants: z.array(z.object({
    id: z.string().uuid(),
    display_name: z.string(),
    description: z.string().optional()
  })).default([]),
  ingredients: z.array(RecipeIngredientSchema).default([]),
  timeline: z.array(TimelineStepSchema).default([]),
  migration_metadata: z.object({
    is_migrated: z.boolean().default(false),
    source_legacy_id: z.string().optional(),
    needs_review: z.boolean().default(false),
  }).optional(),
});

export type UniversalRecipeCard = z.infer<typeof UniversalRecipeCardSchema>;
export type CheckableLine = z.infer<typeof CheckableLineSchema>;
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;
export type TimelineStep = z.infer<typeof TimelineStepSchema>;