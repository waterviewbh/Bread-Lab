import {
  extractRecipeFromHtml,
  extractRecipeFromText,
  isChatGPTUrl,
  extractChatGPTMarkdown,
} from '../recipeExtractor';
import { validatePortableRecipe } from '../recipeImport';

describe('Web Recipe Extractor Module (Issue #65 — Step 8B / Issue 65B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Single Valid Schema.org JSON-LD Extraction', () => {
    it('extracts a complete Schema.org Recipe JSON-LD block', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "Artisan Sourdough Bread",
            "description": "Crispy crust and chewy open crumb.",
            "recipeYield": "1 loaf",
            "recipeIngredient": [
              "500g bread flour",
              "350g water",
              "100g levain",
              "10g fine sea salt"
            ],
            "recipeInstructions": [
              { "@type": "HowToStep", "text": "Mix flour and water for autolyse." },
              { "@type": "HowToStep", "text": "Add levain and salt." },
              { "@type": "HowToStep", "text": "Perform 4 sets of stretch and folds." }
            ]
          }
          </script>
        </head>
        <body><h1>Artisan Sourdough Bread</h1></body>
        </html>
      `;

      const result = extractRecipeFromHtml(html, 'https://example.com/sourdough');

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        const candidate = result.candidate;
        expect(candidate.name).toBe('Artisan Sourdough Bread');
        expect(candidate.overview).toBe('Crispy crust and chewy open crumb.');
        expect(candidate.yieldValue).toBe('1 loaf');

        // Verify explicit unclassified import staging phase
        expect(candidate.phases).toHaveLength(1);
        const staging = candidate.phases[0];
        expect(staging.key).toBe('unclassified_import_staging');
        expect(staging.name).toBe('Unassigned Material');
        expect(staging.ingredients).toHaveLength(4);
        expect(staging.instructions).toHaveLength(3);

        // Verify portable recipe contract validation
        const val = validatePortableRecipe(candidate);
        expect(val.valid).toBe(true);
      }
    });

    it('handles HowToSection nested instruction structures', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Recipe",
          "name": "Sourdough Cinnamon Rolls",
          "recipeIngredient": ["600g flour", "120g starter"],
          "recipeInstructions": [
            {
              "@type": "HowToSection",
              "name": "Dough Prep",
              "itemListElement": [
                { "@type": "HowToStep", "text": "Mix dough ingredients." }
              ]
            },
            {
              "@type": "HowToSection",
              "name": "Baking",
              "itemListElement": [
                { "@type": "HowToStep", "text": "Bake at 375F for 25 mins." }
              ]
            }
          ]
        }
        </script>
      `;

      const result = extractRecipeFromHtml(html);

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        const instructions = result.candidate.phases[0].instructions || [];
        expect(instructions).toHaveLength(4); // 2 section markers + 2 steps
        expect(instructions[0].text).toContain('Dough Prep');
        expect(instructions[1].text).toBe('Mix dough ingredients.');
      }
    });
  });

  describe('2. Multiple Recipe Objects (Explicit Ambiguity)', () => {
    it('returns status "multiple_candidates" when page contains multiple Recipe objects', () => {
      const html = `
        <script type="application/ld+json">
        [
          {
            "@type": "Recipe",
            "name": "Recipe One: Country Loaf",
            "recipeIngredient": ["500g flour"],
            "recipeInstructions": ["Mix and bake."]
          },
          {
            "@type": "Recipe",
            "name": "Recipe Two: Sourdough Baguettes",
            "recipeIngredient": ["400g flour"],
            "recipeInstructions": ["Shape and bake."]
          }
        ]
        </script>
      `;

      const result = extractRecipeFromHtml(html);

      expect(result.status).toBe('multiple_candidates');
      if (result.status === 'multiple_candidates') {
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0].name).toBe('Recipe One: Country Loaf');
        expect(result.candidates[1].name).toBe('Recipe Two: Sourdough Baguettes');
      }
    });
  });

  describe('3. Robustness & Tolerance against Malformed JSON-LD', () => {
    it('ignores malformed JSON-LD script blocks without throwing an error', () => {
      const html = `
        <script type="application/ld+json">
        { NOT_VALID_JSON: true,
        </script>
        <script type="application/ld+json">
        {
          "@type": "Recipe",
          "name": "Valid Bread",
          "recipeIngredient": ["500g flour"],
          "recipeInstructions": ["Bake it."]
        }
        </script>
      `;

      const result = extractRecipeFromHtml(html);

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).toBe('Valid Bread');
      }
    });

    it('returns "no_candidate" when JSON-LD contains non-Recipe objects like Article or Person', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Article",
          "headline": "Why Sourdough Is Great",
          "author": "Baker Dave"
        }
        </script>
      `;

      const result = extractRecipeFromHtml(html);

      expect(result.status).toBe('no_candidate');
    });
  });

  describe('4. Fallback Extractors (Microdata & Plain-Text)', () => {
    it('extracts recipe via Microdata fallback when JSON-LD is absent', () => {
      const html = `
        <div itemscope itemtype="http://schema.org/Recipe">
          <h1 itemprop="name">Microdata Sourdough</h1>
          <li itemprop="recipeIngredient">500g flour</li>
          <li itemprop="recipeIngredient">350g water</li>
          <div itemprop="recipeInstructions">Mix and ferment for 6 hours.</div>
        </div>
      `;

      const result = extractRecipeFromHtml(html);

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).toBe('Microdata Sourdough');
        expect(result.candidate.phases[0].ingredients).toHaveLength(2);
      }
    });

    it('extracts candidate from structured plain text selection', () => {
      const text = `
        Simple Sourdough Loaf
        500g bread flour
        350g water
        100g active starter
        10g salt
        Mix flour and water and autolyse for 45 minutes.
        Add starter and salt and bulk ferment.
      `;

      const result = extractRecipeFromText(text);

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).toBe('Simple Sourdough Loaf');
        expect(result.candidate.phases[0].ingredients?.length).toBeGreaterThan(0);
      }
    });

    it('correctly classifies observed instruction regression cases', () => {
      const text = `
        Focaccia Bread
        500g flour
        350g water
        Once the dough has risen...
        Bake until the focaccia...
        Generously dust two lined brotforms or towel-lined large bowls with whole wheat flour.
      `;

      const result = extractRecipeFromText(text);
      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        const staging = result.candidate.phases[0];
        const ingredientsText = (staging.ingredients || []).map((i) => i.text);
        const instructionsText = (staging.instructions || []).map((i) => i.text);

        expect(ingredientsText).toContain('500g flour');
        expect(ingredientsText).toContain('350g water');
        expect(instructionsText).toContain('Once the dough has risen...');
        expect(instructionsText).toContain('Bake until the focaccia...');
        expect(instructionsText).toContain('Generously dust two lined brotforms or towel-lined large bowls with whole wheat flour.');
      }
    });
  });

  describe('5. Zero Side-Effects Proof', () => {
    it('proves pure HTML extraction makes zero network or fetch requests', () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Test","recipeIngredient":["flour"]}</script>`;
      extractRecipeFromHtml(html);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('6. ChatGPT Shared Content Raw Extraction (Issue 65B Phase 1)', () => {
    const chatGptHtmlFixture = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ChatGPT - Shared Content</title>
      </head>
      <body>
        <script>
          window.__reactRouterContext = {};
          window.__reactRouterContext.streamController = {
            enqueue: function() {}
          };
          window.__reactRouterContext.streamController.enqueue("[{\\\"_1\\\":2},\\\"loaderData\\\",\\\"# Fieldstone 60\\\\n\\\\n**Yield:** 4 × ~500 g loaves  \\\\n**Total dough:** ~2,002 g  \\\\n**Total flour:** 1,100 g  \\\\n**Hydration:** 89.1%  \\\\n\\\\n## Ingredients\\\\n\\\\n### Sourdough starter\\\\n- 200 g mature 100% hydration sourdough starter\\\\n  - 100 g bread flour\\\\n  - 100 g water\\\\n\\\\n### Tangzhong\\\\n- 100 g whole-wheat flour\\\\n- 400 g water\\\\n\\\\n### Autolyse\\\\n- 500 g whole-wheat flour\\\\n- 400 g bread flour\\\\n- 300 g water\\\\n\\\\n### Final incorporation\\\\n- 180 g water\\\\n- 22 g salt\\\\n- 200 g sourdough starter\\\\n\\\\n## Method\\\\n\\\\n### 1. Prepare the tangzhong\\\\nCombine **100 g whole-wheat flour** and **400 g water**.\\\\n\\\\nCook gently.\\\",\\\"index\\\",\\\"0\\\",\\\"variant\\\",\\\"document\\\"]");
        </script>
      </body>
      </html>
    `;

    it('correctly identifies ChatGPT URLs via isChatGPTUrl()', () => {
      expect(isChatGPTUrl('https://chatgpt.com/s/t_6ac6c24cd4e881918a27d190f8ae35ea')).toBe(true);
      expect(isChatGPTUrl('https://www.chatgpt.com/s/t_12345')).toBe(true);
      expect(isChatGPTUrl('https://chat.openai.com/share/12345')).toBe(true);
      expect(isChatGPTUrl('https://example.com/sourdough')).toBe(false);
      expect(isChatGPTUrl(undefined)).toBe(false);
    });

    it('extracts exact raw conversation Markdown from ChatGPT HTML fixture', () => {
      const markdown = extractChatGPTMarkdown(chatGptHtmlFixture);
      expect(markdown).not.toBeNull();
      expect(markdown).toContain('Fieldstone 60');
      expect(markdown).toContain('89.1%');
      expect(markdown).toContain('100 g bread flour');
      expect(markdown).toContain('Prepare the tangzhong');
    });

    it('extracts candidate from ChatGPT URL via extractRecipeFromHtml()', () => {
      const result = extractRecipeFromHtml(chatGptHtmlFixture, 'https://chatgpt.com/s/t_6ac6c24cd4e881918a27d190f8ae35ea');

      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).toBe('Fieldstone 60');
        expect(result.candidate.phases[0].key).toBe('unclassified_import_staging');
        expect(result.warnings).toContain('Extracted raw conversation Markdown from ChatGPT shared content.');
      }
    });

    it('fails cleanly with "no_candidate" when ChatGPT HTML lacks expected conversation structure', () => {
      const malformedChatGPTPage = `
        <!DOCTYPE html>
        <html>
        <head><title>ChatGPT</title></head>
        <body><p>Empty page or login wall</p></body>
        </html>
      `;

      const result = extractRecipeFromHtml(malformedChatGPTPage, 'https://chatgpt.com/s/t_6ac6c24cd4e881918a27d190f8ae35ea');

      expect(result.status).toBe('no_candidate');
      if (result.status === 'no_candidate') {
        expect(result.reason).toBe('No ChatGPT conversation Markdown could be extracted from page HTML.');
      }
    });
  });

  describe('7. Robust Text Extraction Regression Fixtures (Title Fallbacks & Multi-Section Ingredients)', () => {
    it('avoids naming candidate after structural headings like Ingredients or Levain', () => {
      const text = `
        Ingredients
        500g bread flour
        350g water
        10g salt
        Mix and bake.
      `;

      const result = extractRecipeFromText(text);
      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).not.toBe('Ingredients');
      }
    });

    it('correctly parses multi-section bread recipes (Levain, Dough, Directions)', () => {
      const multiSectionText = `
        King Arthur Sourdough Sandwich Bread

        Levain
        100g active starter
        100g flour
        100g water

        Dough
        400g bread flour
        200g milk
        10g salt
        50g butter

        Directions
        1. Mix levain and dough ingredients.
        2. Knead until smooth.
        3. Proof, shape, bake at 375F.
      `;

      const result = extractRecipeFromText(multiSectionText);
      expect(result.status).toBe('single_candidate');
      if (result.status === 'single_candidate') {
        expect(result.candidate.name).toBe('King Arthur Sourdough Sandwich Bread');
        const ingredients = result.candidate.phases[0].ingredients || [];
        const instructions = result.candidate.phases[0].instructions || [];

        expect(ingredients.some((i) => i.text.includes('Levain'))).toBe(true);
        expect(ingredients.some((i) => i.text.includes('Dough'))).toBe(true);
        expect(ingredients.some((i) => i.text.includes('100g active starter'))).toBe(true);
        expect(ingredients.some((i) => i.text.includes('400g bread flour'))).toBe(true);
        expect(instructions.some((ins) => ins.text.includes('Mix levain and dough'))).toBe(true);
      }
    });
  });
});
