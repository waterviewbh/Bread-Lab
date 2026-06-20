/* Ensures legacy readings without a tempUnit are explicitly marked as "F". */
export function patchReadingsTempUnit(readings: Reading[]): Reading[] { return readings.map((r) => r.temp && !r.tempUnit ? { ...r, tempUnit: "F" as const } : r ); }

/* Compute a ratio string from weights. */
export function calcRatioStr(starter: number, flour: number, water: number, sugar?: number): string { if (starter <= 0 || flour <= 0 || water <= 0) return ""; const f = Math.round((flour / starter) * 10) / 10; const w = Math.round((water / starter) * 10) / 10; if (sugar && sugar > 0) { const su = Math.round((sugar / starter) * 10) / 10; return `1:${f}:${w}:${su}`; } return `1:${f}:${w}`; }

/* Formats milliseconds into HH:MM:SS for the live timer. */
export function formatDuration(ms: number): string { const totalSeconds = Math.floor(ms / 1000); const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }

/* Formats milliseconds into "Xh Ym" or "Ym" for peak duration. */
export function formatTimeToPeak(ms: number): string { const totalMinutes = Math.floor(ms / 60000); const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60; if (hours > 0) return `${hours}h ${minutes}m`; return `${minutes}m`; }