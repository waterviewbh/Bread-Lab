// artifacts/sourdough/lib/feedUtils.ts
import { Reading } from "@/types/feed";

/* Ensures legacy readings without a tempUnit are explicitly marked as "F". */
export function patchReadingsTempUnit(readings: Reading[]): Reading[] {
  return readings.map((r) => r.temp && !r.tempUnit ? { ...r, tempUnit: "F" as const } : r );
}

/* Compute a ratio string from weights. */
export function calcRatioStr(starter: number, flour: number, water: number, sugar?: number): string {
  if (starter <= 0 || flour <= 0 || water <= 0)
  return "";

  const f = Math.round((flour / starter) * 10) / 10;
  const w = Math.round((water / starter) * 10) / 10;

  if (sugar && sugar > 0) {
    const su = Math.round((sugar / starter) * 10) / 10;
    return `1:${f}:${w}:${su}`; }

  return `1:${f}:${w}`;
}

/* Formats milliseconds into HH:MM:SS for the live timer. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/* Formats milliseconds into "Xh Ym" or "Ym" for peak duration. */
export function formatTimeToPeak(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60; if (hours > 0)

  return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Checks if the starter is ready for graduation based on biological activity.
 * Criteria: 3 consecutive feeds doubling (2.0x) within 8 hours.
 */
export function checkGraduationEligibility(history: any[] | undefined | null): boolean {
  if (!history || !Array.isArray(history)) return false;

  const activeLogs = history.slice(0, 3);
  if (activeLogs.length < 3) return false;

  return activeLogs.every(log => {
    if (!log?.peak || !log?.initialVolume) return false;
    const peakVol = parseFloat(log.peak.volume);
    const initVol = parseFloat(log.initialVolume);
    if (isNaN(peakVol) || isNaN(initVol) || initVol <= 0) return false;
    const multiplier = peakVol / initVol;
    // 8 hours in ms = 28,800,000
    return multiplier >= 2.0 && log.peak.timeToPeakMs <= 28800000;
  });
}
