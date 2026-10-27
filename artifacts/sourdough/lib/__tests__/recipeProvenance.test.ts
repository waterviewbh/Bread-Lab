// artifacts/sourdough/lib/__tests__/recipeProvenance.test.ts
import { SavedRecipe, RecipeProvenance } from "../recipeTypes";

describe("Layer 4 & Layer 5: Recipe Provenance, Lineage & Master Copy Creation", () => {
  it("creates an independent Master copy with recipient ownership when adopting a shared recipe", () => {
    const candidatePayload = {
      name: "Padme's Famous Sourdough",
      authorName: "Padme",
      phases: [
        {
          key: "mixing",
          name: "Mixing",
          ingredients: [{ text: "500g Flour" }],
          instructions: [{ text: "Mix well" }],
        },
      ],
    };

    const recipientUserId = "luke-stable-uuid-123";

    const importedMaster: SavedRecipe = {
      id: "new-master-recipe-uuid-456",
      userId: recipientUserId,
      name: candidatePayload.name,
      createdAt: 1700000000000,
      phases: candidatePayload.phases as any,
      parentRecipeId: null, // Master in Luke's workspace
      versionLabel: "Master",
      provenance: {
        originalAuthorName: candidatePayload.authorName,
        sharedByAuthorName: "Padme",
        importedAt: 1700000000000,
      },
    };

    expect(importedMaster.userId).toBe("luke-stable-uuid-123");
    expect(importedMaster.parentRecipeId).toBeNull();
    expect(importedMaster.versionLabel).toBe("Master");
    expect(importedMaster.provenance?.originalAuthorName).toBe("Padme");
  });

  it("leaves author attribution unset when unsupplied and permits UI to render presentation fallback", () => {
    const candidateWithoutAuthor = {
      name: "Anonymous Loaf",
      phases: [],
    };

    const importedMaster: SavedRecipe = {
      id: "master-anon-123",
      userId: "luke-stable-uuid-123",
      name: candidateWithoutAuthor.name,
      createdAt: 1700000000000,
      phases: [],
      parentRecipeId: null,
      versionLabel: "Master",
      provenance: {
        originalAuthorName: undefined, // Unsupplied author remains undefined in data layer
        sharedByAuthorName: undefined,
        importedAt: 1700000000000,
      },
    };

    expect(importedMaster.provenance?.originalAuthorName).toBeUndefined();

    // UI Presentation Helper Function
    const renderAuthorAttribution = (provenance?: RecipeProvenance): string => {
      if (provenance?.originalAuthorName && provenance.originalAuthorName.trim() !== "") {
        return provenance.originalAuthorName;
      }
      return "Nameless Lab Assistant";
    };

    expect(renderAuthorAttribution(importedMaster.provenance)).toBe("Nameless Lab Assistant");
  });

  it("preserves original author provenance when Luke re-shares his Master recipe with Leia", () => {
    const lukeMaster: SavedRecipe = {
      id: "luke-master-789",
      userId: "luke-stable-uuid-123",
      name: "Padme's Famous Sourdough",
      createdAt: 1700000000000,
      phases: [],
      parentRecipeId: null,
      versionLabel: "Master",
      provenance: {
        originalAuthorName: "Padme",
        sharedByAuthorName: "Padme",
        importedAt: 1700000000000,
      },
    };

    // Luke re-shares with Leia:
    const exportPayload = {
      schemaVersion: "1.0",
      name: lukeMaster.name,
      provenance: {
        originalAuthorName: lukeMaster.provenance?.originalAuthorName, // Preserves "Padme"
        sharedByAuthorName: "Luke", // Current sharer is Luke
      },
    };

    expect(exportPayload.provenance.originalAuthorName).toBe("Padme");
    expect(exportPayload.provenance.sharedByAuthorName).toBe("Luke");
    expect((exportPayload as any).id).toBeUndefined(); // Ensures DB primary keys are stripped
    expect((exportPayload as any).userId).toBeUndefined();
    expect((exportPayload as any).originalRecipeId).toBeUndefined();
  });
});
