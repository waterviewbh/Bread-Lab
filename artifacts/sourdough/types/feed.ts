export interface PeakData {
    pH: string;
    volume: string;
    temp?: string;
    tempUnit?: "F" | "C";
    photo: string | null;
    loggedAt: number;
    volumeIncreasePct: number;
    timeToPeakMs: number; }
export interface Reading {
    pH: string;
    temp: string;
    tempUnit?: "F" | "C";
    volume?: string;
    note: string;
    loggedAt: number; }
export interface FeedSession {
    id: string;
    starterWeight: string;
    ratioStr: string;
    flourWeight: number;
    waterWeight: number;
    wwPercent: number;
    initialPH: string;
    initialVolume: string;
    initialTemp?: string;
    fedPhoto: string | null;
    savedAt: number;
    updatedAt?: number;       // ← bumped on every local mutation
    completedAt?: number;
    savedToHistory?: boolean;
    peak?: PeakData;
    readings?: Reading[];
    /* Optional sugar weight in grams; appears as a 4th ratio element when > 0. */
    sugarWeight?: number; }