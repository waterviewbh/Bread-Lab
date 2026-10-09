import fs from "fs";
import path from "path";
import {
  validatePortableRecipe,
  normalizePortableRecipe,
  parseYieldValue,
  PortableRecipe,
} from "../recipeImport";
import { PHASE_DEFINITIONS } from "../recipeTypes";

describe("recipeImport Module", () => {
  const cranBanFixturePath = "C:\\Users\\LRLNH\\Downloads\\Cran-Ban_Cinnamon_Rolls.recipe_data.json";

  // ─── 1. GOLDEN FIXTURE NORMALIZATION TEST ──────────────────────────────────
  describe("Golden Fixture Normalization Test", () => {
    it("normalizes the canonical Cran-Ban Cinnamon Rolls recipe without semantic loss", () => {
      // 1. Read golden fixture (immutable source)
      const rawFixture = fs.readFileSync(cranBanFixturePath, "utf-8");
      const sourceRecipe = JSON.parse(rawFixture);

      // 2. Construct portable document in memory without modifying the fixture file
      const portableDoc: PortableRecipe = {
        schemaVersion: "1.0",
        name: sourceRecipe.name,
        overview: sourceRecipe.overview,
        yieldValue: sourceRecipe.yieldValue,
        versionLabel: sourceRecipe.versionLabel,
        phases: sourceRecipe.phases,
      };

      // Keep deep copy of input to verify unmutated input
      const inputCopy = JSON.parse(JSON.stringify(portableDoc));

      // 3. Normalize
      const runtimeOptions = {
        id: "rec-cran-ban-test-001",
        deviceId: "dev-test-device-123",
        userId: null,
      };

      const normalized = normalizePortableRecipe(portableDoc, runtimeOptions);

      // 4. Assertions: Runtime Metadata
      expect(normalized.id).toBe("rec-cran-ban-test-001");
      expect(normalized.deviceId).toBe("dev-test-device-123");
      expect(normalized.userId).toBeNull();
      expect(normalized.parentRecipeId).toBeNull();
      expect(normalized.isArchived).toBe(false);

      // 5. Assertions: Recipe Content
      expect(normalized.name).toBe("Cran-Ban Cinnamon Rolls");
      expect(normalized.overview).toBe(sourceRecipe.overview);
      expect(normalized.yieldValue).toBe("12");
      expect(normalized.yield_value).toBe(12);
      expect(normalized.versionLabel).toBe("v1.0");

      // 6. Assertions: Phases (7 phases in exact order, resolved to canonical keys)
      expect(normalized.phases).toHaveLength(7);
      const expectedCanonicalKeys = [
        "toasting_flour",     // resolved from alias "dry_toasting"
        "incorporating",
        "bulk_fermenting",
        "laminating",
        "final_shaping",
        "ambient_proofing",   // resolved from alias "proofing"
        "the_bake",           // resolved from alias "baking"
      ];
      normalized.phases.forEach((p: any, idx: number) => {
        expect(p.key).toBe(expectedCanonicalKeys[idx]);
        expect(p.name).toBe(sourceRecipe.phases[idx].name);
      });

      // 7. Assertions: Ingredients & Instructions (20 ing, 24 ins)
      let totalIng = 0;
      let totalIns = 0;

      normalized.phases.forEach((normPhase: any, pIdx: number) => {
        const srcPhase = sourceRecipe.phases[pIdx];

        // Ingredients
        expect(normPhase.ingredients).toHaveLength(srcPhase.ingredients.length);
        normPhase.ingredients.forEach((ing: any, iIdx: number) => {
          totalIng++;
          expect(ing.text).toBe(srcPhase.ingredients[iIdx].text);
          expect(ing.sort_order).toBe(srcPhase.ingredients[iIdx].sort_order ?? iIdx);
          expect(ing.id).toMatch(/^ing-/);
        });

        // Instructions
        expect(normPhase.instructions).toHaveLength(srcPhase.instructions.length);
        normPhase.instructions.forEach((ins: any, iIdx: number) => {
          totalIns++;
          expect(ins.text).toBe(srcPhase.instructions[iIdx].text);
          expect(ins.sort_order).toBe(srcPhase.instructions[iIdx].sort_order ?? iIdx);
          expect(ins.id).toMatch(/^ins-/);
        });
      });

      expect(totalIng).toBe(20);
      expect(totalIns).toBe(24);

      // 8. Assertions: Derived Metrics
      expect(normalized.total_flour_g).toBe(683);
      expect(normalized.hydration_pct).toBe(166);

      // 9. Assert input document was NOT mutated
      expect(portableDoc).toEqual(inputCopy);
    });
  });

  // ─── 2. EXPLICIT PHASE ORDERING PRESERVATION ──────────────────────────────
  describe("Phase Order Preservation", () => {
    it("strictly preserves the explicit phase order from the portable document without sorting", () => {
      const nonCanonicalOrderDoc: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Custom Workflow Sourdough",
        phases: [
          { key: "the_bake", name: "Baking First" },
          { key: "autolysing", name: "Autolyse Second" },
          { key: "bulk_fermenting", name: "Bulk Third" },
        ],
      };

      const normalized = normalizePortableRecipe(nonCanonicalOrderDoc, { deviceId: "device-1" });

      expect(normalized.phases[0].key).toBe("the_bake");
      expect(normalized.phases[1].key).toBe("autolysing");
      expect(normalized.phases[2].key).toBe("bulk_fermenting");
    });

    it("resolves candidate phase key aliases for levain and main_dough", () => {
      const candidateDoc: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Candidate Test Recipe",
        phases: [
          { key: "levain", name: "Levain Build" },
          { key: "main_dough", name: "Main Dough" },
        ],
      };

      const val = validatePortableRecipe(candidateDoc);
      expect(val.valid).toBe(true);

      const normalized = normalizePortableRecipe(candidateDoc, { deviceId: "device-1" });
      expect(normalized.phases[0].key).toBe("building_levain");
      expect(normalized.phases[0].name).toBe("Levain Build");
      expect(normalized.phases[1].key).toBe("incorporating");
      expect(normalized.phases[1].name).toBe("Main Dough");
    });

    it("validates and normalizes assigned vs unassigned candidate recipes with valid UUID primary key", () => {
      // 1. Assigned candidate
      const assignedCandidate: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Fully Assigned Candidate",
        phases: [
          { key: "levain", ingredients: [{ text: "50g starter" }] },
          { key: "main_dough", ingredients: [{ text: "500g flour" }] },
        ],
      };
      expect(validatePortableRecipe(assignedCandidate).valid).toBe(true);

      // 2. Unassigned candidate
      const unassignedCandidate: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Unassigned Candidate",
        phases: [
          { key: "unclassified_import_staging", ingredients: [{ text: "50g sesame seeds" }] },
        ],
      };
      expect(validatePortableRecipe(unassignedCandidate).valid).toBe(true);

      // 3. Normalize with UUID
      const normAssigned = normalizePortableRecipe(assignedCandidate, { id: "a3b1c2d3-e4f5-6789-0123-456789abcdef", deviceId: "dev-1" });
      expect(normAssigned.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      const normUnassigned = normalizePortableRecipe(unassignedCandidate, { id: "b4c2d3e4-f5a6-7890-1234-567890abcdef", deviceId: "dev-1" });
      expect(normUnassigned.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  // ─── 3. PHASE KEY VS DISPLAY NAME ─────────────────────────────────────────
  describe("Phase Key vs Display Name Strategy", () => {
    it("preserves custom display names when supplied", () => {
      const doc: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Test Recipe",
        phases: [{ key: "incorporating", name: "Slap it all together" }],
      };

      const normalized = normalizePortableRecipe(doc, { deviceId: "device-1" });
      expect(normalized.phases[0].key).toBe("incorporating");
      expect(normalized.phases[0].name).toBe("Slap it all together");
    });

    it("defaults phase name from PHASE_DEFINITIONS when omitted in portable document", () => {
      const doc: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Test Recipe",
        phases: [{ key: "incorporating" }], // name omitted
      };

      const canonicalName = PHASE_DEFINITIONS.find((p) => p.key === "incorporating")?.name;
      expect(canonicalName).toBe("Incorporating");

      const normalized = normalizePortableRecipe(doc, { deviceId: "device-1" });
      expect(normalized.phases[0].key).toBe("incorporating");
      expect(normalized.phases[0].name).toBe("Incorporating");
    });

    it("rejects unknown phase keys without fuzzy matching", () => {
      const doc = {
        schemaVersion: "1.0",
        name: "Test Recipe",
        phases: [{ key: "quantum_baking", name: "Slap it all together" }],
      };

      const result = validatePortableRecipe(doc);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown phase key 'quantum_baking'");
    });
  });

  // ─── 4. YIELD NORMALIZATION BEHAVIOR ──────────────────────────────────────
  describe("Yield Normalization Behavior", () => {
    it("normalizes missing or empty yieldValue to '1' and yield_value: 1", () => {
      expect(parseYieldValue(undefined)).toEqual({ yieldValue: "1", yield_value: 1 });
      expect(parseYieldValue("")).toEqual({ yieldValue: "1", yield_value: 1 });
      expect(parseYieldValue("   ")).toEqual({ yieldValue: "1", yield_value: 1 });
    });

    it("parses valid numeric yield strings", () => {
      expect(parseYieldValue("12")).toEqual({ yieldValue: "12", yield_value: 12 });
      expect(parseYieldValue(" 4 ")).toEqual({ yieldValue: "4", yield_value: 4 });
    });

    it("safely handles non-numeric yield strings without producing NaN", () => {
      expect(parseYieldValue("loaves")).toEqual({ yieldValue: "1", yield_value: 1 });
      expect(parseYieldValue("abc")).toEqual({ yieldValue: "1", yield_value: 1 });
    });
  });

  // ─── 5. CHECKABLE LINE STRATEGY ───────────────────────────────────────────
  describe("CheckableLine ID Strategy", () => {
    it("generates fresh local IDs for lines while preserving text, sort order, and check state", () => {
      const doc: PortableRecipe = {
        schemaVersion: "1.0",
        name: "Test Line IDs",
        phases: [
          {
            key: "autolysing",
            ingredients: [
              { id: "foreign-id-999", text: "500 g flour", is_checked: true, sort_order: 0 },
            ],
            instructions: [{ id: "foreign-id-888", text: "Rest for 30 min", is_checked: false, sort_order: 0 }],
          },
        ],
      };

      const normalized = normalizePortableRecipe(doc, { deviceId: "dev-1" });
      const ing = normalized.phases[0].ingredients[0];
      const ins = normalized.phases[0].instructions[0];

      expect(ing.id).not.toBe("foreign-id-999");
      expect(ing.id).toMatch(/^ing-/);
      expect(ing.text).toBe("500 g flour");
      expect(ing.is_checked).toBe(true);

      expect(ins.id).not.toBe("foreign-id-888");
      expect(ins.id).toMatch(/^ins-/);
      expect(ins.text).toBe("Rest for 30 min");
    });
  });

  // ─── 6. HARD VALIDATION FAILURES ───────────────────────────────────────────
  describe("Hard Validation Rejections", () => {
    it("rejects non-object documents", () => {
      expect(validatePortableRecipe(null).valid).toBe(false);
      expect(validatePortableRecipe("string").valid).toBe(false);
      expect(validatePortableRecipe([]).valid).toBe(false);
    });

    it("rejects missing or unsupported schemaVersion", () => {
      const missingSchema = { name: "Recipe", phases: [{ key: "the_bake" }] };
      expect(validatePortableRecipe(missingSchema).valid).toBe(false);

      const badSchema = { schemaVersion: "2.0", name: "Recipe", phases: [{ key: "the_bake" }] };
      const res = validatePortableRecipe(badSchema);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Unsupported 'schemaVersion' '2.0'");
    });

    it("rejects missing or empty recipe name", () => {
      const emptyName = { schemaVersion: "1.0", name: "   ", phases: [{ key: "the_bake" }] };
      expect(validatePortableRecipe(emptyName).valid).toBe(false);
    });

    it("rejects missing or empty phases array", () => {
      const noPhases = { schemaVersion: "1.0", name: "Test", phases: [] };
      expect(validatePortableRecipe(noPhases).valid).toBe(false);
    });

    it("rejects malformed ingredients or instructions", () => {
      const badIng = {
        schemaVersion: "1.0",
        name: "Test",
        phases: [{ key: "the_bake", ingredients: ["not an object"] }],
      };
      expect(validatePortableRecipe(badIng).valid).toBe(false);

      const missingText = {
        schemaVersion: "1.0",
        name: "Test",
        phases: [{ key: "the_bake", ingredients: [{ text: 123 }] }],
      };
      expect(validatePortableRecipe(missingText).valid).toBe(false);
    });
  });
});
