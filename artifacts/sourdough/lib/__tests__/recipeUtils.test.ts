import { scalePhaseText, parseIngredientsForMetrics, calculateRecipeMetrics } from '../recipeUtils';

describe('recipeUtils', () => {
  describe('scalePhaseText', () => {
    it('scales simple gram values', () => {
      expect(scalePhaseText('500g flour', 2)).toBe('1000g flour');
      expect(scalePhaseText('250 g water', 0.5)).toBe('125 g water');
    });

    it('scales multiple ingredients in one string', () => {
      const input = '500g flour, 350g water, 10g salt';
      const expected = '1000g flour, 700g water, 20g salt';
      expect(scalePhaseText(input, 2)).toBe(expected);
    });

    it('handles floating point results correctly', () => {
      expect(scalePhaseText('100g flour', 1.5)).toBe('150g flour');
      expect(scalePhaseText('10g salt', 1.25)).toBe('12.5g salt');
    });

    it('preserves intensive properties (time, temp)', () => {
      expect(scalePhaseText('Mix for 10 minutes at 75F', 2)).toBe('Mix for 10 minutes at 75F');
    });
  });

  describe('parseIngredientsForMetrics', () => {
    it('correctly parses basic sourdough components', () => {
      const phases = [
        { ingredients: '500g flour\n350g water' },
        { ingredients: '100g starter' },
        { ingredients: '10g salt' }
      ];
      const result = parseIngredientsForMetrics(phases);
      expect(result.flour).toBe(500);
      expect(result.water).toBe(350);
      expect(result.starter).toBe(100);
      expect(result.salt).toBe(10);
    });

    it('handles liquid hydrators like milk', () => {
      const phases = [{ ingredients: '100g milk' }];
      const result = parseIngredientsForMetrics(phases);
      // Milk is ~87% water, 13% solids
      expect(result.additionalWater).toBeCloseTo(87);
      expect(result.additionalSolids).toBeCloseTo(13);
    });
  });

  describe('calculateRecipeMetrics', () => {
    it('calculates hydration correctly including starter (50/50)', () => {
      const phases = [
        { ingredients: '500g flour' },
        { ingredients: '350g water' },
        { ingredients: '100g starter' }
      ];
      const result = calculateRecipeMetrics(phases);
      // Total Flour = 500 + 50 = 550
      // Total Water = 350 + 50 = 400
      // Hydration = 400 / 550 = 72.72% -> 73%
      expect(result.totalFlourG).toBe(550);
      expect(result.hydrationPct).toBe(73);
    });
  });
});
