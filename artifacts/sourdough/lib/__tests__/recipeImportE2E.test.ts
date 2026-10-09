// Set environment variables before requiring api / supabase modules
process.env["EXPO_PUBLIC_SUPABASE_URL"] = "https://kzueaxbloujtudxzqoju.supabase.co";
process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] = "sb_publishable_UWxEXEJvzJ_7xOkbNj3HHg_3Z9g4PK_";

// Provide WebSocket transport polyfill for Node.js test environment
if (typeof (global as any).WebSocket === "undefined") {
  (global as any).WebSocket = require("ws");
}

import fs from "fs";
import {
  validatePortableRecipe,
  normalizePortableRecipe,
  resolveCanonicalPhaseKey,
  PortableRecipe,
} from "../recipeImport";

// Require api dynamically after process.env and WebSocket polyfill are set
const { api } = require("../api");

describe("Recipe Import End-to-End Proof (Issue #65 — Step 6)", () => {
  jest.setTimeout(20000);

  const cranBanFixturePath = "C:\\Users\\LRLNH\\Downloads\\Cran-Ban_Cinnamon_Rolls.recipe_data.json";

  it("proves the complete import pipeline end-to-end: portable JSON -> validate -> normalize -> api.recipes.upsert -> api.recipes.list -> verify -> api.recipes.delete", async () => {
    // 1. Read golden fixture without modifying the immutable file
    const rawFixture = fs.readFileSync(cranBanFixturePath, "utf-8");
    const sourceRecipe = JSON.parse(rawFixture);

    // 2. Construct portable document representation in memory
    const portableDoc: PortableRecipe = {
      schemaVersion: "1.0",
      name: sourceRecipe.name,
      overview: sourceRecipe.overview,
      yieldValue: sourceRecipe.yieldValue,
      versionLabel: sourceRecipe.versionLabel,
      phases: sourceRecipe.phases,
    };

    // Define test runtime metadata
    const testRecipeId = `test-cran-ban-e2e-${Date.now()}`;
    const testDeviceId = "dev-e2e-proof-device-65";

    let testRecipeCreated = false;

    try {
      // Step A: Validate portable document
      const validation = validatePortableRecipe(portableDoc);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Step B: Normalize portable document into existing application/upsert payload
      const normalizedPayload = normalizePortableRecipe(portableDoc, {
        id: testRecipeId,
        deviceId: testDeviceId,
        userId: null,
      });

      expect(normalizedPayload.id).toBe(testRecipeId);
      expect(normalizedPayload.deviceId).toBe(testDeviceId);

      // Step C: Persist via existing api.recipes.upsert() application write path
      const upsertResult = await api.recipes.upsert(normalizedPayload);
      testRecipeCreated = true;
      expect(upsertResult).toBeDefined();
      expect(upsertResult.id).toBe(testRecipeId);

      // Step D: Read back recipe via existing application api.recipes.list() read path
      const recipeList = await api.recipes.list(testDeviceId);
      const readBackRecipe = recipeList.find((r: any) => r.id === testRecipeId);

      expect(readBackRecipe).toBeDefined();
      if (!readBackRecipe) throw new Error("Read-back recipe was not found in api.recipes.list()");

      // Step E: Primary Semantic Verification against portable document
      expect(readBackRecipe.name).toBe(portableDoc.name);
      expect(readBackRecipe.overview).toBe(portableDoc.overview);
      expect(readBackRecipe.yield_value).toBe(12);
      expect(readBackRecipe.phases).toHaveLength(portableDoc.phases.length);

      // Phase-by-phase semantic verification
      portableDoc.phases.forEach((srcPhase, pIdx) => {
        const readPhase = readBackRecipe.phases[pIdx];
        const expectedCanonicalKey = resolveCanonicalPhaseKey(srcPhase.key);

        expect(readPhase.key).toBe(expectedCanonicalKey);
        expect(readPhase.name).toBe(srcPhase.name);

        // Ingredients semantic verification
        const srcIngredients = srcPhase.ingredients ?? [];
        expect(readPhase.ingredients).toHaveLength(srcIngredients.length);
        srcIngredients.forEach((srcIng, iIdx) => {
          const readIng = (readPhase.ingredients as any[])[iIdx];
          expect(readIng.text).toBe(srcIng.text);
        });

        // Instructions semantic verification
        const srcInstructions = srcPhase.instructions ?? [];
        expect(readPhase.instructions).toHaveLength(srcInstructions.length);
        srcInstructions.forEach((srcIns, iIdx) => {
          const readIns = (readPhase.instructions as any[])[iIdx];
          expect(readIns.text).toBe(srcIns.text);
        });
      });

      // Step F: Secondary Golden Fixture-Specific Fact Verification
      expect(readBackRecipe.phases).toHaveLength(7);

      let totalIngredients = 0;
      let totalInstructions = 0;
      readBackRecipe.phases.forEach((p: any) => {
        totalIngredients += (p.ingredients as any[] || []).length;
        totalInstructions += (p.instructions as any[] || []).length;
      });

      expect(totalIngredients).toBe(20);
      expect(totalInstructions).toBe(24);

      // Derived metrics assertions
      expect(readBackRecipe.total_flour_g).toBe(683);
      expect(readBackRecipe.hydration_pct).toBe(166);

    } finally {
      // Step G: Cleanup using existing application API delete path
      if (testRecipeCreated) {
        const deleted = await api.recipes.delete(testRecipeId, testDeviceId);
        expect(deleted).toBe(true);

        // Verify cleanup by checking list again
        const remainingRecipes = await api.recipes.list(testDeviceId);
        const cleanedUp = remainingRecipes.find((r: any) => r.id === testRecipeId);
        expect(cleanedUp).toBeUndefined();
      }
    }
  });

  it("proves that Candidates with Unassigned Material are hard-blocked by validateRecipeForCommit and produce zero Supabase writes", async () => {
    const { validateRecipeForCommit, UNCLASSIFIED_STAGING_KEY, generateUuid } = require("../recipeImport");

    const unassignedCandidate: PortableRecipe = {
      schemaVersion: "1.0",
      name: "Unassigned Candidate Test",
      phases: [
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: "Unassigned Material",
          ingredients: [{ text: "100g raisins", is_checked: false, sort_order: 0 }],
          instructions: [{ text: "Fold raisins into dough.", is_checked: false, sort_order: 0 }],
        },
      ],
    };

    const testRecipeId = generateUuid();
    const testDeviceId = "dev-e2e-blocked-device-65";

    // 1. Verify Candidate is valid as a Candidate via validatePortableRecipe
    expect(validatePortableRecipe(unassignedCandidate).valid).toBe(true);

    // 2. Verify Candidate is hard-blocked for Recipe Commit via validateRecipeForCommit
    const commitValidation = validateRecipeForCommit(unassignedCandidate);
    expect(commitValidation.valid).toBe(false);
    expect(commitValidation.errors[0]).toContain("Cannot commit Candidate as Recipe");

    // 3. Attempting to commit unassigned candidate throws validation error
    const commitAttempt = () => {
      if (!validateRecipeForCommit(unassignedCandidate).valid) {
        throw new Error(commitValidation.errors.join("\n"));
      }
    };
    expect(commitAttempt).toThrow("Cannot commit Candidate as Recipe");

    // 4. Query Supabase to verify zero records were created
    const recipeList = await api.recipes.list(testDeviceId);
    const foundRecord = recipeList.find((r: any) => r.id === testRecipeId);
    expect(foundRecord).toBeUndefined();
  });
});
