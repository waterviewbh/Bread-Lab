// lib/recipeUtils.ts
// ─── Pure display/formatting utilities for recipe and bake data ───────────────
// No React, no hooks, no AsyncStorage. Safe to import anywhere.

/**
 * scalePhaseText — display-only quantity scaler for phase spec text blocks.
 *
 * Scales only mass/volume quantities (Extensive Properties) — g, kg, ml, l,
 * oz, lbs — while leaving Intensive Properties (time, temperature, fold counts)
 * untouched. The original stored string is never mutated; this is purely
 * a display-time transform.
 *
 * The function handles both spaced notation ("250 g") and condensed keyboard
 * notation ("250g"). Original unit casing and spacing style are preserved.
 * The multiplied value is rounded to ≤1 decimal place with the trailing ".0"
 * stripped so "500.0g" becomes "500g" instead of cluttering the output.
 *
 * Fast-paths: returns the original string unchanged when multiplier === 1
 * or when text is empty/falsy.
 */

import { CheckableLine } from '../types/recipe';
import { RecipePhaseConfig } from './recipeTypes';

export function scaleCheckableLines(lines: CheckableLine[], multiplier: number): CheckableLine[] {
  if (multiplier === 1 || !lines) return lines;

  return lines.map(line => ({
    ...line,
    // We reuse the existing logic by scaling the text property of each line
    text: scalePhaseText(line.text, multiplier)
  }));
}

export function scalePhaseText(text: string, multiplier: number): string {
  if (multiplier === 1 || !text) return text;  // Case-insensitive so "G", "KG", "ML" etc. are matched.
  const MASS_VOLUME_RE = /\b(\d+(?:\.\d+)?)(?:(\s+)?)(g|kg|ml|l|oz|lbs)\b/gi;  return text.replace(
    MASS_VOLUME_RE,
    (_match, numStr: string, space: string | undefined, unit: string) => {
      const scaled = parseFloat(numStr) * multiplier;
      // Drop trailing ".0" — e.g., 500.0 → "500", 250.5 → "250.5"
      const formatted = parseFloat(scaled.toFixed(1)).toString();
      return `${formatted}${space ?? ""}${unit}`;
    }
  );
}

/** "01:23:45" or "23:45" — used for active phase elapsed display */
export function formatTimer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "1h 30m", "45m", "< 1m" — used for completed phase duration display */
export function formatDone(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m === 0) return "< 1m";
  return `${m}m`;
}

/** "9:05 AM" — used for reading log timestamps */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Jan 5" — used for recipe creation date display */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * parseIngredientsForMetrics — Unified parser for Flour, Water, Starter, and Yeast.
 * Supports both legacy strings and new CheckableLine arrays.
 */
export function parseIngredientsForMetrics(phases: { ingredients: any }[]) {
  let totals = { flour: 0, water: 0, starter: 0, yeast: 0, yeastType: "unknown" as "instant" | "dry" | "unknown" };
  const weightRegex = /(\d+(?:\.\d+)?)\s*(?:g|gram|grams|kg|ml|l)/i;

  phases.forEach(p => {
    const lines: string[] = Array.isArray(p.ingredients)
      ? p.ingredients.map(i => i.text.toLowerCase())
      : (typeof p.ingredients === 'string' ? p.ingredients.toLowerCase().split('\n') : []);

    lines.forEach(line => {
      const match = line.match(weightRegex);
      if (!match) return;

      let weight = parseFloat(match[1]);
      const unit = line.match(/(?:kg|l)/i) ? 1000 : 1;
      weight *= unit;

      if (line.includes("flour")) totals.flour += weight;
      else if (line.includes("water") || line.includes("liquid")) totals.water += weight;
      else if (line.includes("starter") || line.includes("levain")) totals.starter += weight;
      else if (line.includes("yeast")) {
        totals.yeast += weight;
        if (line.includes("instant") || line.includes("saf")) totals.yeastType = "instant";
        else if (line.includes("dry") || line.includes("active")) totals.yeastType = "dry";
      }
    });
  });

  // Convert Yeast to Starter Equivalent
  const yeastEquiv = totals.yeast * (totals.yeastType === "instant" ? 28.5 : 22.8);
  const effectiveStarter = totals.starter + yeastEquiv;

  return { ...totals, effectiveStarter };
}

/**
 * calculateRecipeMetrics — Returns total flour and hydration pct for Supabase.
 */
export function calculateRecipeMetrics(phases: { ingredients: any }[]) {
  const { flour, water, starter, effectiveStarter } = parseIngredientsForMetrics(phases);

  // Recipe totals include starter components (assume 50/50)
  const totalFlour = flour + (starter / 2);
  const totalWater = water + (starter / 2);

  return {
    totalFlourG: Math.round(totalFlour),
    hydrationPct: totalFlour > 0 ? Math.round((totalWater / totalFlour) * 100) : 0,
    inoculationPct: totalFlour > 0 ? (effectiveStarter / totalFlour) * 100 : 20
  };
}