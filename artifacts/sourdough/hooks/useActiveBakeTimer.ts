import { useEffect, useState, useRef } from "react";
import type { ActiveBake } from "@/lib/recipeTypes";

/**
 * Tracks elapsed milliseconds for every in-progress phase in the active bake.
 * Returns a map of phase key → elapsed ms, updated every second.
 */
export function useActiveBakeTimer(
  bake: ActiveBake | null
): Record<string, number> {
  const [elapsed, setElapsed] = useState<Record<string, number>>({});

  // Keep a mutable ref to the latest bake object
  const bakeRef = useRef(bake);

  // Always update the ref on every render so it's never stale
  useEffect(() => {
    bakeRef.current = bake;
  });

  useEffect(() => {
    // If there's no bake, clear state and get out.
    // (The cleanup function handles clearing any existing interval)
    if (!bake?.id) {
      setElapsed({});
      return;
    }

    const tick = () => {
      // Read from the ref to ensure we have the absolute latest phase data
      const currentBake = bakeRef.current;
      if (!currentBake) return;

      const now = Date.now();
      const upd: Record<string, number> = {};
      let hasActive = false;

      currentBake.phases.forEach((p) => {
        if (p.startedAt && !p.completedAt) {
          upd[p.key] = now - p.startedAt;
          hasActive = true;
        }
      });

      // If no phases are active anymore, clear the elapsed state
      if (!hasActive) {
        setElapsed({});
      } else {
        setElapsed(upd);
      }
    };

    // Run immediately on mount / bake change
    tick();

    const id = setInterval(tick, 1000);

    // This safely clears the interval when the bake ID changes OR unmounts
    return () => clearInterval(id);

  }, [bake?.id]);

  return elapsed;
}