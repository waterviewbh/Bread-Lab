// artifacts/sourdough/lib/__tests__/recipeUniversalCardMigration.test.ts
import { migrateToUniversalCard } from "../recipeMigration";
import { SavedRecipe } from "../recipeTypes";

describe("migrateToUniversalCard Unit Tests", () => {
  it("losslessly promotes legacy flat-string recipe to structured Universal Recipe Card format", () => {
    const legacyRecipe: SavedRecipe = {
      id: "legacy-rec-1",
      name: "Classic Sourdough",
      overview: "A simple classic loaf",
      yieldValue: "2",
      phases: [
        {
          key: "mix",
          name: "Mixing",
          ingredients: [{ id: "i1", text: "500g Flour", checked: false }],
          instructions: [{ id: "ins1", text: "Mix flour and water", checked: false }]
        }
      ]
    };

    const card = migrateToUniversalCard(legacyRecipe);

    expect(card.version).toBe("1.2.0");
    expect(card.title).toBe("Classic Sourdough");
    expect(card.slug).toBe("classic-sourdough");
    expect(card.reference_yield.loaves).toBe(2);
    expect(card.migration_metadata.is_migrated).toBe(true);
    expect(card.migration_metadata.source_legacy_id).toBe("legacy-rec-1");
    expect(card.ingredients.length).toBe(1);
    expect(card.ingredients[0].name).toBe("500g Flour");
    expect(card.timeline.length).toBe(1);
    expect(card.timeline[0].name).toBe("Mixing");
    expect(card.timeline[0].checklist_items.length).toBe(1);
  });
});
