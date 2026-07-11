// lib/feedCoordinate.ts
/**
 * Converts a feed ratio (starter : flour : water) into a continuous Base-10
 * Feed Coordinate System for scatter-plot x-axis positioning.
 *
 * Algorithm: macro flour chapters and micro stiffness placement.
 * By organizing the FCS strictly from stiffest to slackest within each column, the horizontal
 * axis functions as a literal map of the culture's organic acid balance.
 * This provides a subtle background gradient or contextual tooltip acknowledging metabolic reality
 */

/** Flour chapter boundaries. Every flour ratio floor()-maps to its chapter. */
export const FLOUR_CHAPTERS = [1, 2, 5, 10] as const;
export type FlourChapter = (typeof FLOUR_CHAPTERS)[number];

/* Returns the workload chapter a flour ratio belongs to.
 * 1.0–1.99 → 1  (Low workload, perhaps a daily refresh)
 * 2.0–3.99 → 2  (Medium workload, perhaps an active pre-ferment)
 * 4.0–7.99 → 5  (High workload, perhaps an overnight feed to peak in the morning)
 * 8.0+     → 10  (Ultra workload, perhaps to flush unwanted acids, etc.)
 */
export function flourChapter(flourRatio: number): FlourChapter {
  if (flourRatio < 2) return 1;
  if (flourRatio < 4) return 2;
  if (flourRatio < 8) return 5;
  return 10;
}

/** Hydration bucket within a chapter.
 *  water < flour        → "stiff"
 *  water ≈ flour (±10%) → "standard"
 *  water > flour        → "slack"
 */
export type HydrationSlice = "stiff" | "standard" | "slack";
export function hydrationSlice(flourRatio: number, waterRatio: number): HydrationSlice {
  const ratio = waterRatio / flourRatio;
  if (ratio < 0.9)  return "stiff";
  if (ratio <= 1.1) return "standard";
  return "slack";
}

// ─── Thermal color utilities ──────────────────────────────────────────────────

/** Realistic sourdough ambient operating range in °F. */
export const AMBIENT_TEMP_COLD_F = 55;
export const AMBIENT_TEMP_HOT_F  = 85;

/**
 * Maps an ambient temperature (°F) to a 0–1 heat fraction.
 * Clamps to [COLD, HOT] so out-of-range readings don't crash the gradient.
 */
export function tempToHeatFraction(tempF: number): number {
  return Math.max(
    0,
    Math.min(
      1,
      (tempF - AMBIENT_TEMP_COLD_F) / (AMBIENT_TEMP_HOT_F - AMBIENT_TEMP_COLD_F)
    )
  );
}

/**
 * Maps a 0–1 heat fraction to the theme's scientific journal temperature colors.
 * 0.0 = Cool     → tempZoneCool
 * 0.5 = Balanced → tempZoneBalanced
 * 1.0 = Warm     → tempZoneWarm
 *
 * Accepts the three pre-resolved hex strings so the function stays a pure
 * utility with no theme/context coupling. Call site supplies them from useColors().
 */
export function heatFractionToColor(
  t: number,
  theme: {
    tempZoneCool: string;
    tempZoneBalanced: string;
    tempZoneWarm: string;
  }
): string {
  const stops: [number, number, number][] = [
    hexToRgb(theme.tempZoneCool),
    hexToRgb(theme.tempZoneBalanced),
    hexToRgb(theme.tempZoneWarm),
  ];
  const constrained = Math.max(0, Math.min(1, t));
  const scaled = constrained * (stops.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(lo + 1, stops.length - 1);
  const f  = scaled - lo;
  const r  = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f);
  const g  = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f);
  const b  = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f);
  return `rgb(${r},${g},${b})`;
}
// ─── Private helpers ──────────────────────────────────────────────────────────

/** Parses a hex color string ("#rrggbb") into [r, g, b] components.
 *  File-private — only used by heatFractionToColor above. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

// ─── Ratio string parsing ─────────────────────────────────────────────────────

/**
 * Inverse of calcRatioStr (feedUtils.ts).
 * Parses "1:2:1.5" or "1:2:1.5:0.5" into numeric ratio parts.
 * Returns null for empty, malformed, or zero-value strings.
 */
export function parseRatioStr(
  ratioStr: string
): { starter: number; flour: number; water: number; sugar?: number } | null {
  if (!ratioStr) return null;
  const parts = ratioStr.split(":").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  const [starter, flour, water, sugar] = parts;
  if (starter <= 0 || flour <= 0 || water <= 0) return null;
  return { starter, flour, water, sugar: sugar != null ? sugar : undefined };
}