import { scalePhaseText, parseIngredientsForMetrics, calculateRecipeMetrics, sortRecipePhases } from '../recipeUtils';

describe('recipeUtils', () => {
  describe('scalePhaseText', () => {
    it('1. fraction result that is representable', () => {
      expect(scalePhaseText('1/3 cup', 1.5)).toBe('1/2 cup');
    });

    it('2. decimal input remains a normal numeric path', () => {
      expect(scalePhaseText('0.5 cup', 2)).toBe('1 cup');
    });

    it('3. fraction scaling down to a proper fraction', () => {
      expect(scalePhaseText('3/4 cup', 0.5)).toBe('3/8 cup');
    });

    it('4. fraction scaling down to a whole number', () => {
      expect(scalePhaseText('2 1/2 tbsp', 0.4)).toBe('1 tbsp');
    });

    it('5. fraction scaling into a mixed number with a non-half fraction', () => {
      expect(scalePhaseText('1 1/4 cups', 2)).toBe('2 1/2 cups');
    });

    it('6. unicode fraction scaling down', () => {
      expect(scalePhaseText('\u00BE cup', 0.5)).toBe('\u215C cup');
    });

    it('7. unicode fraction to whole number', () => {
      expect(scalePhaseText('\u00BD cup', 2)).toBe('1 cup');
    });

    it('8. explicit pluralization for proper fractions vs mixed numbers', () => {
      expect(scalePhaseText('3/4 cup', 0.5)).toBe('3/8 cup');
      expect(scalePhaseText('3/4 cup', 2)).toBe('1 1/2 cups');
      expect(scalePhaseText('\u00BE cup', 0.5)).toBe('\u215C cup');
      expect(scalePhaseText('\u00BE cup', 2)).toBe('1\u00BD cups');
    });

    it('9. pluralization at the integer boundary (lb/lbs and pound/pounds)', () => {
      expect(scalePhaseText('1 lb', 2)).toBe('2 lbs');
      expect(scalePhaseText('2 lbs', 0.5)).toBe('1 lb');
      expect(scalePhaseText('1 pound', 2)).toBe('2 pounds');
      expect(scalePhaseText('2 pounds', 0.5)).toBe('1 pound');
    });

    it('10. unchanging abbreviations', () => {
      expect(scalePhaseText('2 oz', 0.5)).toBe('1 oz');
      expect(scalePhaseText('2 g', 0.5)).toBe('1 g');
      expect(scalePhaseText('2 tbsp', 0.5)).toBe('1 tbsp');
      expect(scalePhaseText('2 tsp', 0.5)).toBe('1 tsp');
    });

    it('11. instruction boundary and unrepresentable fallback', () => {
      expect(scalePhaseText('Mix for 10 minutes at 75F', 2)).toBe('Mix for 10 minutes at 75F');
      expect(scalePhaseText('1/3 cup', 1.25)).toBe('0.42 cups');
    });

    it('12. exact multiplier 1 is a no-op', () => {
      const line = '500g flour, 1 egg, 1/2 cup butter, 1 stick butter';
      expect(scalePhaseText(line, 1)).toBe(line);
    });

    it('scales eggs, including large egg', () => {
      expect(scalePhaseText('1 egg', 2)).toBe('2 eggs');
      expect(scalePhaseText('2 eggs', 0.5)).toBe('1 egg');
      expect(scalePhaseText('1 large egg', 3)).toBe('3 large eggs');
      expect(scalePhaseText('2 large eggs', 0.5)).toBe('1 large egg');
    });

    it('scales mixed ingredient lines', () => {
      const input = '500g flour, 2 eggs, 2 tbsp butter';
      const expected = '1000g flour, 4 eggs, 4 tbsp butter';
      expect(scalePhaseText(input, 2)).toBe(expected);

      const input2 = '250g flour, 1 large egg, 1/2 cup milk';
      const expected2 = '500g flour, 2 large eggs, 1 cup milk';
      expect(scalePhaseText(input2, 2)).toBe(expected2);
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

    it('correctly classifies sourdough discard as starter', () => {
      const phases = [{ ingredients: '206 g sourdough discard' }];
      const result = parseIngredientsForMetrics(phases);
      expect(result.starter).toBe(206);
    });

    it('correctly classifies instant starter as instant yeast', () => {
      const phases = [{ ingredients: '0.15 g instant starter' }];
      const result = parseIngredientsForMetrics(phases);
      expect(result.yeast).toBe(0.15);
      expect(result.yeastType).toBe('instant');
    });
  });

  describe('calculateRecipeMetrics', () => {
    it('calculates metrics for Bayside 20 hybrid recipe set', () => {
      const phases = [
        { ingredients: '500g bread flour\n350g water' },
        { ingredients: '206g sourdough discard' },
        { ingredients: '0.15g instant starter' },
        { ingredients: '10g salt' },
      ];
      const result = calculateRecipeMetrics(phases);
      // Total Flour = 500 + 206/2 = 603g
      // Effective Starter = 206 + (0.15 * 28.5) = 210.275g
      // Inoculation = (210.275 / 603) * 100 = 34.8714...%
      expect(result.totalFlourG).toBe(603);
      expect(result.inoculationPct).toBeCloseTo(34.87, 1);
    });

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

  describe('sortRecipePhases', () => {
    it('correctly sorts added phases including cold_retarding into canonical positions', () => {
      const phases = [
        { key: 'the_bake', name: 'Baking', ingredients: [], instructions: [] },
        { key: 'cold_retarding', name: 'Cold Retarding', ingredients: [], instructions: [] },
        { key: 'mixing', name: 'Mixing', ingredients: [], instructions: [] }
      ] as any;
      const sorted = sortRecipePhases(phases);
      expect(sorted[0].key).toBe('mixing');
      expect(sorted[1].key).toBe('cold_retarding');
      expect(sorted[2].key).toBe('the_bake');
    });
  });
});

