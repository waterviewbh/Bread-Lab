// lib/__tests__/unassignedMaterialPromotion.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  validateRecipeForCommit,
  normalizePortableRecipe,
  PortableRecipe,
  UNCLASSIFIED_STAGING_KEY,
} from "../recipeImport";
import { appendRecipeLocal, loadAll } from "../recipeStorage";
import { SavedRecipe } from "../recipeTypes";

describe("Candidate Promotion Gate: Unassigned Material Must Be Empty", () => {
  const baseRecipe: PortableRecipe = {
    schemaVersion: "1.0",
    name: "Test Loaf",
    phases: [
      {
        key: "building_levain",
        name: "Levain Build",
        ingredients: [{ text: "50g starter" }],
        instructions: [{ text: "Mix starter and water" }],
      },
      {
        key: "incorporating",
        name: "Main Mix",
        ingredients: [{ text: "500g flour" }],
        instructions: [{ text: "Combine flour and levain" }],
      },
    ],
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("1. Empty UM: promotion is allowed when all other requirements are met, and the promoted recipe has no UM phase", () => {
    const docWithEmptyUM: PortableRecipe = {
      ...baseRecipe,
      phases: [
        ...baseRecipe.phases,
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [],
          instructions: [],
        },
      ],
    };

    const commitVal = validateRecipeForCommit(docWithEmptyUM);
    expect(commitVal.valid).toBe(true);

    const normalized = normalizePortableRecipe(docWithEmptyUM, { deviceId: "device-test" });
    expect(normalized.phases).toHaveLength(2);
    expect(normalized.phases.some((p: any) => p.key === UNCLASSIFIED_STAGING_KEY)).toBe(false);
  });

  it("2. UM containing an ingredient: promotion is blocked", () => {
    const docWithIngUM: PortableRecipe = {
      ...baseRecipe,
      phases: [
        ...baseRecipe.phases,
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [{ text: "50g sesame seeds" }],
          instructions: [],
        },
      ],
    };

    const commitVal = validateRecipeForCommit(docWithIngUM);
    expect(commitVal.valid).toBe(false);
    expect(commitVal.errors.some((err) => err.includes("Unassigned Material"))).toBe(true);

    expect(() => normalizePortableRecipe(docWithIngUM, { deviceId: "device-test" })).toThrow();
  });

  it("3. UM containing an instruction: promotion is blocked", () => {
    const docWithInstUM: PortableRecipe = {
      ...baseRecipe,
      phases: [
        ...baseRecipe.phases,
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [],
          instructions: [{ text: "Fold dough gently" }],
        },
      ],
    };

    const commitVal = validateRecipeForCommit(docWithInstUM);
    expect(commitVal.valid).toBe(false);
    expect(commitVal.errors.some((err) => err.includes("Unassigned Material"))).toBe(true);

    expect(() => normalizePortableRecipe(docWithInstUM, { deviceId: "device-test" })).toThrow();
  });

  it("4. UM with both (ingredient and instruction): promotion is blocked", () => {
    const docWithBothUM: PortableRecipe = {
      ...baseRecipe,
      phases: [
        ...baseRecipe.phases,
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [{ text: "10g salt" }],
          instructions: [{ text: "Dissolve salt in water" }],
        },
      ],
    };

    const commitVal = validateRecipeForCommit(docWithBothUM);
    expect(commitVal.valid).toBe(false);
    expect(commitVal.errors.some((err) => err.includes("Unassigned Material"))).toBe(true);

    expect(() => normalizePortableRecipe(docWithBothUM, { deviceId: "device-test" })).toThrow();
  });

  it("5. Existing assignments and phase order remain intact when promotion succeeds", () => {
    const docOrdered: PortableRecipe = {
      schemaVersion: "1.0",
      name: "Ordered Loaf",
      phases: [
        {
          key: "the_bake",
          name: "Baking Phase",
          instructions: [{ text: "Bake at 450F" }],
        },
        {
          key: "building_levain",
          name: "Levain Phase",
          ingredients: [{ text: "100g starter" }],
        },
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [],
          instructions: [],
        },
      ],
    };

    const commitVal = validateRecipeForCommit(docOrdered);
    expect(commitVal.valid).toBe(true);

    const normalized = normalizePortableRecipe(docOrdered, { deviceId: "device-test" });
    expect(normalized.phases).toHaveLength(2);
    // Explicit order preserved (the_bake first, building_levain second)
    expect(normalized.phases[0].key).toBe("the_bake");
    expect(normalized.phases[0].instructions[0].text).toBe("Bake at 450F");
    expect(normalized.phases[1].key).toBe("building_levain");
    expect(normalized.phases[1].ingredients[0].text).toBe("100g starter");
    expect(normalized.phases.some((p: any) => p.key === UNCLASSIFIED_STAGING_KEY)).toBe(false);
  });

  it("6. One candidate promotion produces exactly one new recipe and filters out empty/default side-effect records", async () => {
    const docWithEmptyUM: PortableRecipe = {
      schemaVersion: "1.0",
      name: "Loafy Loaf Bread",
      phases: [
        {
          key: "incorporating",
          name: "Incorporating",
          ingredients: [{ text: "500g flour" }],
          instructions: [{ text: "Mix flour and water" }],
        },
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [],
          instructions: [],
        },
      ],
    };

    const normalized = normalizePortableRecipe(docWithEmptyUM, { deviceId: "device-test" });
    const newRecipe: SavedRecipe = {
      id: normalized.id,
      name: normalized.name,
      createdAt: Date.now(),
      phases: normalized.phases,
    };

    const emptyRecipe: SavedRecipe = {
      id: "empty-zombie",
      name: "   ",
      createdAt: Date.now(),
      phases: [],
    };

    await appendRecipeLocal(emptyRecipe);
    await appendRecipeLocal(newRecipe);

    const data = await loadAll();
    expect(data.recipes.length).toBe(1);
    expect(data.recipes[0].name).toBe("Loafy Loaf Bread");
    expect(data.recipes[0].phases.some((p: any) => p.key === UNCLASSIFIED_STAGING_KEY)).toBe(false);
  });
});
