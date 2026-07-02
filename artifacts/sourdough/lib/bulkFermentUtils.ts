// lib/bulkFermentUtils.ts
// ─── Display helpers for the Bulk Ferment card and ReadingModal ───────────────
// Pure functions: no React, no state, no AsyncStorage.
import type { BulkFermentState } from "@/lib/recipeTypes";

/**
 * Given a BulkFermentState, return the countdown string to display.
 *
 * Possible return values:
 *  - null          → not enough data yet (engine hasn't projected)
 *  - "+MM:SS"      → overtime counter (target already reached)
 *  - "HH:MM:SS"    → countdown to projected target
 */
export function getBulkTimerDisplay(
  state: BulkFermentState | undefined,
  nowMs: number
): { mode: "none" | "countdown" | "overtime"; label: string } {  if (!state) return { mode: "none", label: "" };
  // ── Overtime mode: target has been reached ───────────────────────────────
  if (state.targetReachedAt) {
    const overtimeMs = nowMs - state.targetReachedAt;
    return { mode: "overtime", label: "+" + fmtMs(Math.max(0, overtimeMs)) };
  }
  // ── Countdown mode: projection is available ──────────────────────────────
  if (state.projectedTargetAt) {
    const remainingMs = state.projectedTargetAt - nowMs;
    if (remainingMs > 0) {
      return { mode: "countdown", label: fmtMs(remainingMs) };
    }
    // Projection has elapsed but targetReachedAt not set yet (next reading will confirm)
    return { mode: "countdown", label: "00:00" };
  }
  return { mode: "none", label: "" };
}

/**
 * Format milliseconds as H:MM:SS (hours only when >= 60 minutes) or MM:SS.
 * Used for both the countdown and overtime counter.
 */
function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Returns a short human-readable target volume string, e.g. "Target: 1,560 ml".
 * Returns null if the engine hasn't computed a target yet.
 */
export function getBulkTargetLabel(state: BulkFermentState | undefined): string | null {
  if (!state?.targetVolume_ml) return null;
  return `Target: ${Math.round(state.targetVolume_ml).toLocaleString()} ml`;
}

/**
 * Returns the current rise percentage as a 0–100 integer, or null if not
 * enough data is available. Used to drive a simple progress indicator.
 */
export function getBulkRisePercent(state: BulkFermentState | undefined, currentVolumeMl: number | undefined): number | null {
  if (!state?.startVolume_ml || !state?.targetVolume_ml || currentVolumeMl == null)
    return null;
  const range = state.targetVolume_ml - state.startVolume_ml;
  if (range <= 0) return null;
  const progress = currentVolumeMl - state.startVolume_ml;
  return Math.min(100, Math.max(0, Math.round((progress / range) * 100)));
}