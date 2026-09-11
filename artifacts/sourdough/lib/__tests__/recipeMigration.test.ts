import { migrateToUniversalCard } from '../recipeMigration';
import { SavedRecipe } from '../recipeTypes';

describe('recipeMigration', () => {
  it('migrates a legacy flat-string recipe to universal card format', () => {
    const legacyRecipe: SavedRecipe = {
      id: 'old-123',
      name: 'Old Sourdough',
      yieldValue: '2',
      phases: [
        {
          key: 'levain',
          name: 'Levain',
          ingredients: '100g flour\n100g water',
          instructions: 'Mix and wait.',
          completedAt: 0,
          startedAt: 0
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false
    };

    const result = migrateToUniversalCard(legacyRecipe);

    expect(result.version).toBe('1.2.0');
    expect(result.title).toBe('Old Sourdough');
    expect(result.reference_yield.loaves).toBe(2);
    expect(result.ingredients.length).toBe(2);
    expect(result.ingredients[0].name).toBe('100g flour');
    expect(result.timeline.length).toBe(1);
    expect(result.timeline[0].name).toBe('Levain');
    expect(result.migration_metadata?.is_migrated).toBe(true);
    expect(result.migration_metadata?.source_legacy_id).toBe('old-123');
  });
});
