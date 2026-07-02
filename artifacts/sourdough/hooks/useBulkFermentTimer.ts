// hooks/useBulkFermentTimer.ts
// ─── Reactive 1-second ticker for the Bulk Ferment countdown/overtime display ─
// Consumes BulkFermentState; returns the current timer display string and mode.
// Stops ticking automatically when there is nothing to count (mode === "none").
import { useEffect, useState } from "react";
import type { BulkFermentState } from "@/lib/recipeTypes";
import { getBulkTimerDisplay } from "@/lib/bulkFermentUtils";
export interface BulkTimerResult {
  mode: "none" | "countdown" | "overtime";
  label: string;
}

export function useBulkFermentTimer(
  state: BulkFermentState | undefined
): BulkTimerResult {
  const [result, setResult] = useState<BulkTimerResult>({ mode: "none", label: "" });
  useEffect(() => {
    // Recompute immediately on state change
    const tick = () => {
      setResult(getBulkTimerDisplay(state, Date.now()));
    };
  tick();

    // Only tick when there's something live to show
    const shouldTick =
      !!state?.projectedTargetAt || !!state?.targetReachedAt;
    if (!shouldTick) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    // Re-subscribe when the projection or the reached timestamp changes
    state?.projectedTargetAt,
    state?.targetReachedAt,
  ]);
  return result;
}