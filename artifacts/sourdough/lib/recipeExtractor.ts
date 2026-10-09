/**
 * Web Recipe Extractor (Issue #65 — Step 8B / Issue 65B Phase 1)
 *
 * PURE EXTRACTION LAYER BOUNDARIES:
 * 1. Pure string/DOM manipulation functions — ZERO network calls, ZERO persistence side-effects.
 * 2. Trustworthiness over fake precision — Unphased content is explicitly assigned to
 *    `unclassified_import_staging` rather than guessing canonical culinary phases.
 * 3. Ambiguity representation — Multiple Recipe objects on a page return `multiple_candidates`
 *    rather than silently guessing an arbitrary primary recipe.
 */

import { PortableRecipe, PortableRecipePhase, PortableCheckableLine } from './recipeImport';

export type ExtractionResult =
  | {
      status: 'single_candidate';
      candidate: PortableRecipe;
      sourceUrl?: string;
      warnings: string[];
    }
  | {
      status: 'multiple_candidates';
      candidates: PortableRecipe[];
      sourceUrl?: string;
      warnings: string[];
    }
  | {
      status: 'no_candidate';
      reason: string;
      sourceUrl?: string;
      warnings: string[];
    };

/**
 * Checks if a URL belongs to ChatGPT based on hostname.
 */
export function isChatGPTUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'chatgpt.com' || host === 'www.chatgpt.com' || host === 'chat.openai.com';
  } catch (_e) {
    return false;
  }
}

/**
 * Pure function: Extracts raw conversation Markdown text from a ChatGPT HTML response body.
 */
export function extractChatGPTMarkdown(html: string): string | null {
  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    return null;
  }

  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];

    if (
      scriptContent.includes('streamController') ||
      scriptContent.includes('loaderData') ||
      scriptContent.includes('window.__reactRouterContext') ||
      scriptContent.includes('Fieldstone') ||
      scriptContent.includes('hydration')
    ) {
      const docMatch = scriptContent.match(/(#\s+[\s\S]*?)(?::::|\\*",\\*"|"$)/);
      if (docMatch) {
        const rawMatch = docMatch[1].trim();

        const unescaped = rawMatch
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\\\/g, '\\')
          .replace(/\\\s*\n/g, '\n')
          .trim();

        if (unescaped.length > 0) {
          return unescaped;
        }
      }
    }
  }

  return null;
}

/**
 * Strips HTML tags from text content.
 */
function stripHtmlTags(input: string): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes yield values from Schema.org formats (string, number, array).
 */
function normalizeRecipeYield(rawYield: unknown): string | null {
  if (typeof rawYield === 'string' && rawYield.trim().length > 0) {
    return rawYield.trim();
  }
  if (typeof rawYield === 'number' && !isNaN(rawYield)) {
    return rawYield.toString();
  }
  if (Array.isArray(rawYield) && rawYield.length > 0) {
    return normalizeRecipeYield(rawYield[0]);
  }
  return null;
}

/**
 * Recursively extracts plain text instructions from HowToStep, HowToSection, or string arrays.
 */
function extractInstructionText(item: unknown): string[] {
  if (typeof item === 'string') {
    const cleaned = stripHtmlTags(item);
    return cleaned ? [cleaned] : [];
  }

  if (Array.isArray(item)) {
    return item.flatMap((sub) => extractInstructionText(sub));
  }

  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    if (typeof obj['text'] === 'string') {
      const cleaned = stripHtmlTags(obj['text']);
      return cleaned ? [cleaned] : [];
    }
    if (typeof obj['name'] === 'string' && Array.isArray(obj['itemListElement'])) {
      const sectionName = stripHtmlTags(obj['name']);
      const stepTexts = extractInstructionText(obj['itemListElement']);
      return sectionName ? [`[Section: ${sectionName}]`, ...stepTexts] : stepTexts;
    }
    if (Array.isArray(obj['itemListElement'])) {
      return extractInstructionText(obj['itemListElement']);
    }
  }

  return [];
}

/**
 * Converts raw string lists into PortableCheckableLine arrays.
 */
function toCheckableLines(lines: string[], prefix: string): PortableCheckableLine[] {
  return lines.map((text, idx) => ({
    id: `${prefix}-${idx + 1}`,
    text: text.trim(),
    is_checked: false,
    sort_order: idx,
  }));
}

/**
 * Checks if an object matches Schema.org Recipe @type.
 */
function isRecipeType(typeVal: unknown): boolean {
  if (typeof typeVal === 'string') {
    return typeVal.toLowerCase().includes('recipe');
  }
  if (Array.isArray(typeVal)) {
    return typeVal.some((t) => typeof t === 'string' && t.toLowerCase().includes('recipe'));
  }
  return false;
}

/**
 * Collects all JSON-LD Recipe objects from parsed JSON structure.
 */
function collectJsonLdRecipes(data: unknown): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  if (!data || typeof data !== 'object') {
    return results;
  }

  if (Array.isArray(data)) {
    data.forEach((item) => results.push(...collectJsonLdRecipes(item)));
    return results;
  }

  const obj = data as Record<string, unknown>;

  if (obj['@type'] && isRecipeType(obj['@type'])) {
    results.push(obj);
  }

  if (Array.isArray(obj['@graph'])) {
    results.push(...collectJsonLdRecipes(obj['@graph']));
  }

  return results;
}

/**
 * Converts a raw Schema.org Recipe object into a PortableRecipe candidate.
 */
function buildCandidateFromSchemaRecipe(recipeObj: Record<string, unknown>): PortableRecipe | null {
  const name = typeof recipeObj['name'] === 'string' ? stripHtmlTags(recipeObj['name']) : '';
  if (!name) {
    return null;
  }

  const overview = typeof recipeObj['description'] === 'string'
    ? stripHtmlTags(recipeObj['description'])
    : null;

  const yieldValue = normalizeRecipeYield(recipeObj['recipeYield']);

  let rawIngredients: string[] = [];
  if (Array.isArray(recipeObj['recipeIngredient'])) {
    rawIngredients = recipeObj['recipeIngredient']
      .map((i) => (typeof i === 'string' ? stripHtmlTags(i) : ''))
      .filter((i) => i.length > 0);
  } else if (typeof recipeObj['recipeIngredient'] === 'string') {
    rawIngredients = [stripHtmlTags(recipeObj['recipeIngredient'])];
  }

  const rawInstructions = extractInstructionText(recipeObj['recipeInstructions']);

  if (rawIngredients.length === 0 && rawInstructions.length === 0) {
    return null;
  }

  const stagingPhase: PortableRecipePhase = {
    key: 'unclassified_import_staging',
    name: 'Unassigned Material',
    ingredients: toCheckableLines(rawIngredients, 'ing'),
    instructions: toCheckableLines(rawInstructions, 'ins'),
  };

  return {
    schemaVersion: '1.0',
    name,
    overview,
    yieldValue,
    versionLabel: 'v1.0 (Import Candidate)',
    phases: [stagingPhase],
  };
}

/**
 * Pure function: Extracts candidate PortableRecipe(s) from HTML string.
 */
export function extractRecipeFromHtml(html: string, sourceUrl?: string): ExtractionResult {
  const warnings: string[] = [];

  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    return {
      status: 'no_candidate',
      reason: 'Empty HTML input provided.',
      sourceUrl,
      warnings,
    };
  }

  const jsonLdRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const foundRecipes: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    const rawJson = match[1];
    try {
      const parsed = JSON.parse(rawJson);
      const collected = collectJsonLdRecipes(parsed);
      foundRecipes.push(...collected);
    } catch (_e) {
      warnings.push('Encountered malformed JSON-LD script block; skipped block.');
    }
  }

  const candidates = foundRecipes
    .map((r) => buildCandidateFromSchemaRecipe(r))
    .filter((c): c is PortableRecipe => c !== null);

  if (candidates.length === 1) {
    return {
      status: 'single_candidate',
      candidate: candidates[0],
      sourceUrl,
      warnings,
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'multiple_candidates',
      candidates,
      sourceUrl,
      warnings,
    };
  }

  if (html.includes('schema.org/Recipe')) {
    const nameMatch = html.match(/itemprop=["']name["'][^>]*>([^<]+)</i);
    const name = nameMatch ? stripHtmlTags(nameMatch[1]) : '';

    if (name) {
      const ingRegex = /itemprop=["']recipeIngredient["'][^>]*>([^<]+)</gi;
      const ingredients: string[] = [];
      let ingM: RegExpExecArray | null;
      while ((ingM = ingRegex.exec(html)) !== null) {
        const cleaned = stripHtmlTags(ingM[1]);
        if (cleaned) ingredients.push(cleaned);
      }

      const insRegex = /itemprop=["']recipeInstructions["'][^>]*>([^<]+)</gi;
      const instructions: string[] = [];
      let insM: RegExpExecArray | null;
      while ((insM = insRegex.exec(html)) !== null) {
        const cleaned = stripHtmlTags(insM[1]);
        if (cleaned) instructions.push(cleaned);
      }

      if (ingredients.length > 0 || instructions.length > 0) {
        const microdataCandidate: PortableRecipe = {
          schemaVersion: '1.0',
          name,
          versionLabel: 'v1.0 (Microdata Import)',
          phases: [
            {
              key: 'unclassified_import_staging',
              name: 'Unassigned Material',
              ingredients: toCheckableLines(ingredients, 'ing'),
              instructions: toCheckableLines(instructions, 'ins'),
            },
          ],
        };
        return {
          status: 'single_candidate',
          candidate: microdataCandidate,
          sourceUrl,
          warnings: [...warnings, 'Extracted using Microdata fallback.'],
        };
      }
    }
  }

  if (isChatGPTUrl(sourceUrl)) {
    const chatGptMarkdown = extractChatGPTMarkdown(html);
    if (chatGptMarkdown) {
      const extractedCandidate = extractRecipeFromText(chatGptMarkdown);
      if (extractedCandidate.status === 'single_candidate') {
        return {
          ...extractedCandidate,
          sourceUrl,
          warnings: [...warnings, 'Extracted raw conversation Markdown from ChatGPT shared content.'],
        };
      }
    }

    return {
      status: 'no_candidate',
      reason: 'No ChatGPT conversation Markdown could be extracted from page HTML.',
      sourceUrl,
      warnings,
    };
  }

  return {
    status: 'no_candidate',
    reason: 'No structured Schema.org Recipe JSON-LD or Microdata found in HTML.',
    sourceUrl,
    warnings,
  };
}

/**
 * Heuristic check to determine if a line of text is an instruction rather than an ingredient.
 */
function isInstructionLine(line: string): boolean {
  const lower = line.toLowerCase().trim();
  if (lower.startsWith('[section:')) return false;

  const instructionStarters = [
    'once the', 'bake until', 'generously', 'mix', 'bake', 'knead', 'shape', 'cover', 'let', 'ferment',
    'proof', 'stretch', 'fold', 'score', 'preheat', 'transfer', 'divide', 'cool', 'slice', 'brush',
    'drizzle', 'sprinkle', 'dust', 'grease', 'line', 'turn', 'invert', 'steam', 'whip', 'whisk',
    'stir', 'combine', 'add', 'pour', 'press', 'dimple', 'slap', 'bench', 'rest', 'chill',
    'refrigerate', 'heat', 'boil', 'melt', 'dissolve', 'incorporate', 'after', 'when', 'repeat',
    'continue', 'allow', 'place', 'put'
  ];

  for (const starter of instructionStarters) {
    if (lower === starter || lower.startsWith(starter + ' ') || lower.startsWith(starter + ',')) {
      return true;
    }
  }

  if (
    lower.includes('until ') ||
    lower.includes('minutes') ||
    lower.includes('hours') ||
    lower.includes('degrees') ||
    lower.includes('oven') ||
    lower.includes('dough') ||
    lower.includes('brotform') ||
    lower.includes('brotforms') ||
    lower.includes('focaccia')
  ) {
    const hasQuantityAndUnit = /^\d+(\.\d+)?\s*(g|kg|cup|cups|tbsp|tsp|oz|lb|ml|grams|ounces|ml)\b/i.test(lower);
    if (!hasQuantityAndUnit && (lower.length > 25 || lower.endsWith('.'))) {
      return true;
    }
  }

  return false;
}

/**
 * Pure function: Robust plain-text recipe parser for shared and pasted text selections.
 * GUARANTEES: Zero network calls, zero persistence.
 * Handles structural heading title fallbacks and multi-section ingredient blocks (Levain, Dough, etc.).
 */
export function extractRecipeFromText(text: string): ExtractionResult {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return {
      status: 'no_candidate',
      reason: 'Empty text input provided.',
      warnings: [],
    };
  }

  const rawLines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (rawLines.length < 3) {
    return {
      status: 'no_candidate',
      reason: 'Text selection too short to contain structured recipe data.',
      warnings: [],
    };
  }

  const structuralHeadings = new Set([
    'ingredients', 'levain', 'dough', 'directions', 'instructions', 'method', 'notes', 'overview', 'prep', 'baking', 'starter', 'tangzhong', 'autolyse', 'final incorporation'
  ]);

  const cleanHeading = (l: string) => l.toLowerCase().replace(/^[#\s_*=]+|[#\s_*=]+$/g, '').trim();

  // Find candidate name: first line that is NOT a structural heading
  let candidateName = 'Imported Recipe Candidate';
  let startIndex = 0;

  if (!structuralHeadings.has(cleanHeading(rawLines[0]))) {
    candidateName = rawLines[0].replace(/^[#\s_*]+|[#\s_*]+$/g, '').trim();
    startIndex = 1;
  } else {
    for (let i = 0; i < rawLines.length; i++) {
      const cleaned = cleanHeading(rawLines[i]);
      if (!structuralHeadings.has(cleaned) && rawLines[i].length > 3) {
        candidateName = rawLines[i].replace(/^[#\s_*]+|[#\s_*]+$/g, '').trim();
        startIndex = i + 1;
        break;
      }
    }
  }

  const ingredientLines: string[] = [];
  const instructionLines: string[] = [];

  const instructionHeadingRegex = /^(directions|instructions|method|baking steps|steps|procedure)/i;
  const ingredientHeadingRegex = /^(ingredients|levain|dough|autolyse|tangzhong|starter|sponge|poolish|biga|filling|topping|glaze)/i;

  let currentMode: 'ingredients' | 'instructions' = 'ingredients';

  for (let i = startIndex; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cleanLine = line.replace(/^[#\s_*=]+|[#\s_*=]+$/g, '').trim();
    const lowerClean = cleanLine.toLowerCase();

    if (instructionHeadingRegex.test(lowerClean)) {
      currentMode = 'instructions';
      instructionLines.push(`[Section: ${cleanLine}]`);
      continue;
    }

    if (ingredientHeadingRegex.test(lowerClean)) {
      currentMode = 'ingredients';
      ingredientLines.push(`[Section: ${cleanLine}]`);
      continue;
    }

    if (currentMode === 'ingredients') {
      if (isInstructionLine(line)) {
        instructionLines.push(line);
      } else {
        ingredientLines.push(line);
      }
    } else {
      instructionLines.push(line);
    }
  }

  if (ingredientLines.length === 0 && instructionLines.length === 0) {
    return {
      status: 'no_candidate',
      reason: 'Could not extract confident ingredient or instruction lines from plain text.',
      warnings: [],
    };
  }

  const candidate: PortableRecipe = {
    schemaVersion: '1.0',
    name: candidateName,
    versionLabel: 'v1.0 (Text Selection Import)',
    phases: [
      {
        key: 'unclassified_import_staging',
        name: 'Unassigned Material',
        ingredients: toCheckableLines(ingredientLines, 'ing'),
        instructions: toCheckableLines(instructionLines, 'ins'),
      },
    ],
  };

  return {
    status: 'single_candidate',
    candidate,
    warnings: ['Extracted from plain text using robust multi-section heuristics.'],
  };
}
