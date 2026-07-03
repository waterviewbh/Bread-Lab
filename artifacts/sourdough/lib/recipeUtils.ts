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