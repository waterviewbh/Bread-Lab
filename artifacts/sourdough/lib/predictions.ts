import { FeedSession } from "@/types/feed";
import { calcRatioStr } from "./feedUtils";

const roundToHalf = (num: number) => Math.round(num * 2) / 2;

export interface PredictionModel {
  intercept: number;
  slopeRatio: number;
  slopeTemp: number;
  isHeuristic: boolean;
}

export interface PlannedRecipe {
  starter: number;
  flour: number;
  water: number;
  ratioStr: string;
  estimatedHours: number;
  peakTime: Date;
  type: "current" | "early" | "morning";
}

/**
 * Trains a simplified prediction model based on history.
 * Sourdough Time ~ Inoculation Ratio + Ambient Temp.
 */
export function trainModel(history: FeedSession[]): PredictionModel {
  const validEntries = history.filter(
    (s) => s.peak?.timeToPeakMs && s.initialTemp && !isNaN(parseFloat(s.initialTemp))
  );

  // Biological "Slopes" (The physics of fermentation)
  // These stay relatively constant across starters.
  const slopeRatio = -3.5; // More starter = faster. Changed from -12 when moved to log ratio
  const slopeTemp = -0.08; // More heat = faster

  // Default Intercept: This is what we "tune" to the user's starter.
  // 14.5 is a safe middle-ground starting point.
  let intercept = 14.5;
  let isHeuristic = true;

  if (validEntries.length > 0) {
    // PERSONALIZATION STEP:
    // Calculate the "Average Offset" from the user's history.
    const offsets = validEntries.map((s) => {
      const sw = parseFloat(s.starterWeight);
      const ratio = sw / (s.flourWeight + s.waterWeight);
      const temp = parseFloat(s.initialTemp!);
      const actualHours = s.peak!.timeToPeakMs / 3_600_000;

      return actualHours - (slopeRatio * Math.log(ratio)) - (slopeTemp * temp);
    });

    // Use the average of their offsets as the new personalized intercept
    intercept = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    isHeuristic = validEntries.length < 3; // We call it "trained" after 3 logs
  }

  return {
    intercept,
    slopeRatio,
    slopeTemp,
    isHeuristic,
  };
}

/**
 * Checks if a given date falls within the "Sleep Zone" (8 PM - 5 AM)
 * when users are typically asleep and won't be able to mix their dough at peak.
 */
export function isInDeadZone(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 20 || hour < 5;
}

/**
 * Solves for the weights needed to hit a target window while keeping Total Mass constant.
 * Total Mass = Starter + (Flour + Water)
 */
export function solveForRecipe(
  targetHours: number,
  totalMass: number,
  temp: number,
  hydration: number,
  model: PredictionModel,
  type: PlannedRecipe["type"] = "current"
): PlannedRecipe {
  let targetRatio = Math.exp(
    (targetHours - model.intercept - (model.slopeTemp * temp)) / model.slopeRatio
  );
  // No lower cap on the ratio — instead we enforce a minimum starter weight below
  // so that the total mass expands rather than the output freezing.
  targetRatio = Math.min(targetRatio, 0.5);
  // No lower cap needed, exp() can never reach zero
  const MIN_STARTER_G = 6;  // What starter weight does this ratio imply at the user's requested total mass?
  const impliedStarter = totalMass * targetRatio / (1 + targetRatio);  // If the implied starter is below the minimum, pin starter at MIN_STARTER_G and
  // let the total mass grow beyond the user's target rather than freezing the output.
  // Derived from: starter = effectiveTotalMass * targetRatio / (1 + targetRatio)
  const effectiveTotalMass = impliedStarter < MIN_STARTER_G
    ? MIN_STARTER_G * (1 + targetRatio) / targetRatio
    : totalMass;  const freshFood = effectiveTotalMass / (1 + targetRatio);  // Calculate and round weights
  const sWeight = Math.round(effectiveTotalMass - freshFood);
  const fWeight = Math.round(freshFood / (1 + hydration / 100));
  const wWeight = Math.round(freshFood - fWeight);  const peakTime = new Date();
  peakTime.setMilliseconds(peakTime.getMilliseconds() + targetHours * 3_600_000);  return {
    starter: sWeight,
    flour: fWeight,
    water: wWeight,
    ratioStr: calcRatioStr(sWeight, fWeight, wWeight),
    estimatedHours: targetHours,
    peakTime,
    type,
  };
}

/**
 * The Peak Window Advisor:
 * Suggests shifts if the current plan peaks during the "Dead Zone" (8 PM - 5 AM).
 */
export function getPeakWindowNudges(
  currentHours: number,
  totalMass: number,
  temp: number,
  hydration: number,
  model: PredictionModel
): PlannedRecipe[] {
  const now = new Date();
  const peakTime = new Date(now.getTime() + currentHours * 3_600_000);

  const nudges: PlannedRecipe[] = [];

  // Dead Zone Filter: 8 PM (20:00) to 5 AM (05:00)
  if (isInDeadZone(peakTime)) {
    // 1. "Early Bird": Aim for 7:00 PM today.
    const target7PM = new Date(now);
    target7PM.setHours(19, 0, 0, 0);
    let hoursTo7PM = (target7PM.getTime() - now.getTime()) / 3_600_000;
    hoursTo7PM = roundToHalf(hoursTo7PM); // Round it!

    if (hoursTo7PM > 1.5) { // Only suggest if it's not immediate.
        nudges.push(solveForRecipe(hoursTo7PM, totalMass, temp, hydration, model, "early"));
    }

    // 2. "Morning Fresh": Aim for 7:00 AM tomorrow.
    const target7AM = new Date(now);
    target7AM.setDate(target7AM.getDate() + 1);
    target7AM.setHours(7, 0, 0, 0);
    let hoursTo7AM = (target7AM.getTime() - now.getTime()) / 3_600_000;
    hoursTo7AM = roundToHalf(hoursTo7AM); // Round it!

    nudges.push(solveForRecipe(hoursTo7AM, totalMass, temp, hydration, model, "morning"));
  }

  return nudges;
}