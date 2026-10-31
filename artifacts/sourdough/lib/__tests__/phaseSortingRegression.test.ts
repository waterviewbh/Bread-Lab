// lib/__tests__/phaseSortingRegression.test.ts
import { sortRecipePhases } from "../recipeUtils";
import { RecipePhaseConfig } from "../recipeTypes";

describe("Phase Sorting Regression: Builder vs. Runner Phase Order", () => {
  it("sorts a phase list containing all nine phases (with Unassigned Material first and Baking third) into the canonical order, with Baking last among canonical phases and Unassigned Material ninth (last)", () => {
    // Arbitrary/unsorted input where Unassigned Material is 1st and Baking is 3rd
    const unsortedPhases: RecipePhaseConfig[] = [
      { key: "unclassified_import_staging", name: "Unassigned Material", ingredients: [], instructions: [] },
      { key: "incorporating", name: "Incorporating", ingredients: [], instructions: [] },
      { key: "the_bake", name: "Baking", ingredients: [], instructions: [] },
      { key: "stretching_folding", name: "Stretching and Folding", ingredients: [], instructions: [] },
      { key: "bulk_fermenting", name: "Bulk Fermenting", ingredients: [], instructions: [] },
      { key: "preshaping", name: "Preshaping", ingredients: [], instructions: [] },
      { key: "final_shaping", name: "Final Shaping", ingredients: [], instructions: [] },
      { key: "ambient_proofing", name: "Proofing", ingredients: [], instructions: [] },
      { key: "scoring", name: "Scoring", ingredients: [], instructions: [] },
    ];

    const sorted = sortRecipePhases(unsortedPhases);

    expect(sorted).toHaveLength(9);

    // Unassigned Material ('unclassified_import_staging') should be 9th (last)
    expect(sorted[8].key).toBe("unclassified_import_staging");

    // Baking ('the_bake') should be 8th (last of the canonical phases, right before Unassigned Material)
    expect(sorted[7].key).toBe("the_bake");

    // Verify exact canonical order:
    const keys = sorted.map(p => p.key);
    expect(keys).toEqual([
      "incorporating",
      "stretching_folding",
      "bulk_fermenting",
      "preshaping",
      "final_shaping",
      "ambient_proofing",
      "scoring",
      "the_bake",
      "unclassified_import_staging",
    ]);
  });
});
