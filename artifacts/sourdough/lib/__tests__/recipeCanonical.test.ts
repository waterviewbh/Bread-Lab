// lib/__tests__/recipeCanonical.test.ts
import { getCanonicalRecipeContent, areCanonicalContentsEqual, findMatchingLineageVersion } from "../recipeCanonical";
import { SavedRecipe } from "../recipeTypes";

describe("Recipe Canonicalization & Lineage Matching", () => {
  const masterRecipe: SavedRecipe = {
    id: "master-1",
    name: "Sourdough Master",
    overview: "Original Master recipe overview",
    createdAt: 1000,
    yieldValue: "1 Loaf",
    parentRecipeId: undefined,
    versionLabel: "Master",
    phases: [
      {
        key: "mixing",
        name: "Mixing",
        ingredients: [{ id: "ing-1", text: "500g Flour", is_checked: false, sort_order: 0 }],
        instructions: [{ id: "ins-1", text: "Mix flour and water", is_checked: false, sort_order: 0 }],
      },
    ],
  };

  const iteration1: SavedRecipe = {
    id: "iter-1",
    name: "Sourdough Iteration 1 (Modified)",
    overview: "Changed name and overview only",
    createdAt: 2000,
    yieldValue: "1 Loaf",
    parentRecipeId: "master-1",
    versionLabel: "v1.1",
    phases: [
      {
        key: "mixing",
        name: "Mixing",
        ingredients: [{ id: "ing-1", text: "500g Flour", is_checked: true, sort_order: 0 }], // ID and check status differ, text same
        instructions: [{ id: "ins-1", text: "Mix flour and water", is_checked: false, sort_order: 0 }],
      },
    ],
  };

  const iteration2: SavedRecipe = {
    id: "iter-2",
    name: "Sourdough Iteration 2 (Different Formulation)",
    overview: "Different flour weight",
    createdAt: 3000,
    yieldValue: "2 Loaves",
    parentRecipeId: "master-1",
    versionLabel: "v1.2",
    phases: [
      {
        key: "mixing",
        name: "Mixing",
        ingredients: [{ id: "ing-2", text: "1000g Flour", is_checked: false, sort_order: 0 }],
        instructions: [{ id: "ins-2", text: "Mix flour and water", is_checked: false, sort_order: 0 }],
      },
    ],
  };

  const iterationReverted: SavedRecipe = {
    id: "iter-3",
    name: "Sourdough Iteration 3 (Reverted)",
    overview: "Reverted formulation back to master",
    createdAt: 4000,
    yieldValue: "1 Loaf",
    parentRecipeId: "master-1",
    versionLabel: "v1.3",
    phases: [
      {
        key: "mixing",
        name: "Mixing",
        ingredients: [{ id: "ing-99", text: "500g Flour", is_checked: false, sort_order: 0 }],
        instructions: [{ id: "ins-99", text: "Mix flour and water", is_checked: false, sort_order: 0 }],
      },
    ],
  };

  test("Canonical comparison ignores IDs, timestamps, names, overview, and checkboxes", () => {
    expect(areCanonicalContentsEqual(masterRecipe, iteration1)).toBe(true);
  });

  test("Canonical comparison detects formulation changes (yield or ingredient text)", () => {
    expect(areCanonicalContentsEqual(masterRecipe, iteration2)).toBe(false);
  });

  test("Lineage matching finds most recent matching earlier version", () => {
    const allRecipes = [masterRecipe, iteration1, iteration2, iterationReverted];
    const match = findMatchingLineageVersion(iterationReverted, allRecipes);
    expect(match).toBe("v1.1");
  });

  test("Lineage matching finds Master when Master is the only earlier match", () => {
    const allRecipes = [masterRecipe, iteration2, iterationReverted];
    const match = findMatchingLineageVersion(iterationReverted, allRecipes);
    expect(match).toBe("Master");
  });

  test("Lineage matching returns null when no earlier version matches", () => {
    const allRecipes = [masterRecipe, iteration2];
    const match = findMatchingLineageVersion(iteration2, allRecipes);
    expect(match).toBeNull();
  });

  test("Unrelated recipe lineages are excluded", () => {
    const unrelatedRecipe: SavedRecipe = {
      id: "unrelated-1",
      name: "Rye Bread",
      createdAt: 3500,
      yieldValue: "1 Loaf",
      phases: masterRecipe.phases,
    };
    const allRecipes = [masterRecipe, unrelatedRecipe];
    const match = findMatchingLineageVersion(unrelatedRecipe, allRecipes);
    expect(match).toBeNull();
  });
});
