// lib/recipeDiff.ts
import { SavedRecipe } from './recipeTypes';
import { calculateRecipeMetrics } from './recipeUtils';

export interface RecipeDelta {
  label: string;
  value: string;
  direction: 'increase' | 'decrease' | 'neutral';
}

/**
 * Compares an iteration recipe against its master to identify key changes.
 */
export function getRecipeDelta(master: SavedRecipe, iteration: SavedRecipe): RecipeDelta[] {
  const deltas: RecipeDelta[] = [];

  // 1. Compare Metrics (Hydration, Inoculation, Salt)
  const masterMetrics = calculateRecipeMetrics(master.phases);
  const iterMetrics = calculateRecipeMetrics(iteration.phases);

  const hydrationDiff = Math.round(iterMetrics.hydrationPct - masterMetrics.hydrationPct);
  if (hydrationDiff !== 0) {
    deltas.push({
      label: 'Water',
      value: `${hydrationDiff > 0 ? '+' : ''}${hydrationDiff}%`,
      direction: hydrationDiff > 0 ? 'increase' : 'decrease',
    });
  }

  const inocDiff = Math.round(iterMetrics.inoculationPct - masterMetrics.inoculationPct);
  if (inocDiff !== 0) {
    deltas.push({
      label: 'Starter',
      value: `${inocDiff > 0 ? '+' : ''}${inocDiff}%`,
      direction: inocDiff > 0 ? 'increase' : 'decrease',
    });
  }

  // Salt check (Salt usually 2%)
  const saltDiff = (iterMetrics.saltPct || 0) - (masterMetrics.saltPct || 0);
  if (Math.abs(saltDiff) >= 0.1) {
    deltas.push({
      label: 'Salt',
      value: `${saltDiff > 0 ? '+' : ''}${saltDiff.toFixed(1)}%`,
      direction: saltDiff > 0 ? 'increase' : 'decrease',
    });
  }

  // 3. Scan for time changes in key phases (Bulk, Retard)
  const timeRegex = /(\d+(?:\.\d+)?)\s*(?:min|minute|hour|hr|h)/i;

  const comparePhaseTime = (key: string, label: string) => {
    const mPhase = master.phases.find(p => p.key === key);
    const iPhase = iteration.phases.find(p => p.key === key);

    if (mPhase && iPhase) {
      const mText = mPhase.instructions.map(l => l.text).join(' ');
      const iText = iPhase.instructions.map(l => l.text).join(' ');

      const mMatch = mText.match(timeRegex);
      const iMatch = iText.match(timeRegex);

      if (mMatch && iMatch) {
        const mVal = parseFloat(mMatch[1]);
        const iVal = parseFloat(iMatch[1]);

        const mIsHour = mMatch[0].toLowerCase().includes('h');
        const iIsHour = iMatch[0].toLowerCase().includes('h');

        const mMinutes = mIsHour ? mVal * 60 : mVal;
        const iMinutes = iIsHour ? iVal * 60 : iVal;

        const diff = iMinutes - mMinutes;

        if (diff !== 0) {
          const unit = Math.abs(diff) >= 60 ? 'h' : 'm';
          const displayVal = Math.abs(diff) >= 60 ? (diff / 60).toFixed(1) : diff;

          deltas.push({
            label,
            value: `${diff > 0 ? '+' : ''}${displayVal}${unit}`,
            direction: diff > 0 ? 'increase' : 'decrease',
          });
        }
      }
    }
  };

  comparePhaseTime('bulk_fermenting', 'Bulk');
  comparePhaseTime('cold_retarding', 'Retard');

  return deltas;
}
