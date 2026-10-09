/**
 * artifacts/sourdough/constants/testCandidateFixture.ts
 * Deterministic test candidate fixture for Maestro E2E walkthroughs & RNTL testing.
 *
 * Provides a fixed in-memory Candidate independent of:
 * - network access
 * - web scraping
 * - Android ACTION_SEND
 * - Supabase persistence
 * - existing user data
 */

import { ExtractionResult } from "@/lib/recipeExtractor";
import { UNCLASSIFIED_STAGING_KEY } from "@/lib/recipeImport";

export const DETERMINISTIC_TEST_CANDIDATE: ExtractionResult = {
  status: "single_candidate",
  sourceUrl: "https://breadlab.test/fixture-recipe",
  warnings: [],
  candidate: {
    schemaVersion: "1.0",
    name: "San Francisco Sourdough Test Fixture",
    overview: "Deterministic test candidate for Candidate Review Maestro verification.",
    yieldValue: "2 loaves",
    versionLabel: "v1.0 (Test Fixture)",
    phases: [
      {
        key: "levain",
        name: "Levain / Starter Build",
        ingredients: [
          { id: "ing-lev-1", text: "50g active sourdough starter", is_checked: false, sort_order: 0 },
          { id: "ing-lev-2", text: "100g bread flour", is_checked: false, sort_order: 1 },
          { id: "ing-lev-3", text: "100g water (28°C)", is_checked: false, sort_order: 2 },
        ],
        instructions: [
          { id: "ins-lev-1", text: "Mix starter, flour, and water in jar.", is_checked: false, sort_order: 0 },
          { id: "ins-lev-2", text: "Rest at 26°C for 4 hours until doubled.", is_checked: false, sort_order: 1 },
        ],
      },
      {
        key: "main_dough",
        name: "Main Dough Mix",
        ingredients: [
          { id: "ing-main-1", text: "800g unbleached bread flour", is_checked: false, sort_order: 0 },
          { id: "ing-main-2", text: "560g lukewarm water", is_checked: false, sort_order: 1 },
          { id: "ing-main-3", text: "18g fine sea salt", is_checked: false, sort_order: 2 },
        ],
        instructions: [
          { id: "ins-main-1", text: "Autolyse flour and water for 45 minutes.", is_checked: false, sort_order: 0 },
          { id: "ins-main-2", text: "Incorporate levain and salt thoroughly.", is_checked: false, sort_order: 1 },
        ],
      },
      {
        key: UNCLASSIFIED_STAGING_KEY,
        name: "Unassigned Material",
        ingredients: [
          { id: "ing-un-1", text: "50g toasted sesame seeds (topping)", is_checked: false, sort_order: 0 },
        ],
        instructions: [
          { id: "ins-un-1", text: "Coat dough exterior with toasted seeds before final proof.", is_checked: false, sort_order: 0 },
        ],
      },
    ],
  },
};
