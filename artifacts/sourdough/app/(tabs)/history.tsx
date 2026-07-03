import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredUser, getStoredToken, type AuthUser } from "@/lib/auth";
import { hasPendingMigration, migrateLocalDataToAccount } from "@/lib/migrate";
import { useMigrationToast } from "@/contexts/MigrationToastContext";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthModal from "@/components/AuthModal";
import * as Haptics from "expo-haptics";
import {
  Alert,
  AppState,
  AppStateStatus,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";
import { computeSessionAcidVelocity } from "@/lib/analytics";
import { TourStep, CopilotView } from "@/components/TourStep"; // red-tagged for webapp-0.1 rmv in 3 revs
import { typography, spacing, radius, fonts } from "@/constants/theme";

// const CopilotView = walkthroughable(View); red-tagged for webapp-0.1 rmv in 3 revs

const HISTORY_KEY = "sourdough_feed_history_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const FEED_FILTER_KEY = "bread_lab_feed_filter_v1";
const ACTIVE_BAKE_KEY = "bread_lab_bake_v2";
const DELETED_FEED_IDS_KEY = "bread_lab_deleted_feed_ids_v1";
const DELETED_BAKE_IDS_KEY = "bread_lab_deleted_bake_ids_v1";

async function loadTombstoneSet(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

async function addToTombstone(key: string, id: string): Promise<void> {
  try {
    const set = await loadTombstoneSet(key);
    set.add(id);
    await AsyncStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

async function removeFromTombstone(key: string, id: string): Promise<void> {
  try {
    const set = await loadTombstoneSet(key);
    set.delete(id);
    await AsyncStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

/** Per-reading shape stored inside a bake phase (mirrors recipe.tsx Reading). */
interface BakePhaseReading {
  id: string;
  temp: string;
  tempUnit: string;
  pH: string;
  note: string;
  volume: string;
  loggedAt: number;
}

interface BakeHistoryEntry {
  id: string;
  recipeId: string;
  recipeName: string;
  savedAt: number;
  startedAt: number;
  /** Bake-level notes stored at save time. */
  notes?: string;
  phases: {
    key: string;
    name: string;
    ingredients?: string;
    instructions?: string;
    startedAt: number | null;
    completedAt: number | null;
    /** pH/temp/volume readings logged during this phase. */
    readings?: BakePhaseReading[];
    /** Volume recorded at phase activation. */
    startVolume?: string;
    foldCount?: number;
  }[];
}

interface PeakData {
  pH: string;
  temp?: string;
  tempUnit?: "F" | "C";
  volume: string;
  photo: string | null;
  loggedAt: number;
  volumeIncreasePct: number;
  timeToPeakMs: number;
}

/** Per-reading shape stored inside a feed session. */
interface FeedReading {
  pH: string;
  temp: string;
  tempUnit?: "F" | "C";
  note: string;
  loggedAt: number;
}

interface HistoryEntry {
  id: string;
  savedAt: number;
  completedAt?: number;
  starterWeight: string;
  ratioStr: string;
  flourWeight: number;
  waterWeight: number;
  wwPercent: number;
  initialPH: string;
  initialTemp?: string;
  initialTempUnit?: "F" | "C";
  initialVolume: string;
  peak?: PeakData;
  /** pH readings logged during this feed session. */
  readings?: FeedReading[];
  /** Optional sugar weight (g) if the 4th ratio element was used. */
  sugarWeight?: number;
  /** Base64 data URI or file URI of the photo taken right after feeding. */
  fedPhoto?: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSyncTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function SyncLabel({ ts }: { ts: number }) {
  const colors = useColors();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={[styles.syncLabel, { color: colors.mutedForeground }]}>
      Synced {formatSyncTime(ts)}
    </Text>
  );
}

function formatTimeToPeak(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Build an HTML block for the Lifting Index section of a feed PDF.
 * Returns an empty string when the entry has no peak data.
 * Rendered using CSS only (no SVG) for maximum print-WebView compatibility.
 */
function buildLiftingIndexHtml(entry: HistoryEntry): string {
  if (!entry.peak) return "";

  const timeToPeakHrs = (entry.peak.timeToPeakMs / 3_600_000).toFixed(1);
  const risePct = entry.peak.volumeIncreasePct;
  const barPct = Math.min(100, (entry.peak.timeToPeakMs / (24 * 3_600_000)) * 100).toFixed(1);

  const starterType: "sugar" | "ww" | "standard" =
    (entry.sugarWeight ?? 0) > 0
      ? "sugar"
      : (entry.wwPercent ?? 0) >= 50
      ? "ww"
      : "standard";

  let barStyle: string;
  if (starterType === "sugar") {
    barStyle =
      "background:repeating-linear-gradient(45deg,#C4704F 0,#C4704F 3px,#F5F0E6 3px,#F5F0E6 8px)";
  } else if (starterType === "ww") {
    barStyle =
      "background-color:#F5F0E6;" +
      "background-image:repeating-linear-gradient(45deg,#C4704F 0,#C4704F 1.5px,transparent 1.5px,transparent 7px)," +
      "repeating-linear-gradient(-45deg,#C4704F 0,#C4704F 1.5px,transparent 1.5px,transparent 7px)";
  } else {
    barStyle = "background-color:#C4704F";
  }

  return `<h3>Lifting Index</h3>
<div style="margin:8px 0 12px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="flex:1;background:#e0d5c4;border-radius:4px;height:18px;overflow:hidden">
      <div style="width:${barPct}%;height:100%;border-radius:4px;${barStyle}"></div>
    </div>
    <span style="font-size:13px;white-space:nowrap;color:#2A1508">${timeToPeakHrs} h to peak</span>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:17px;color:#C4704F">&#9661;</span>
    <span style="font-size:13px;color:#2A1508">+${risePct}% rise</span>
  </div>
</div>`;
}

/**
 * Build an HTML block for the Acidification section of a feed PDF.
 * Returns an empty string when the entry lacks sufficient pH data.
 * Formula mirrors computeAcidificationSeries in analytics.ts.
 */
function buildAcidVelocityHtml(entry: HistoryEntry): string {
  const velocity = computeSessionAcidVelocity(entry);
  if (velocity === null) return "";
  return `<h3>Acidification</h3>
<p style="margin:4px 0 12px;font-size:13px;color:#2A1508">Acidification rate: ${velocity.toFixed(2)} pH/hr</p>`;
}

/** Format a duration in milliseconds as "Xh Ym" / "Ym" / "< 1m". */
function formatPhaseDuration(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (total === 0) return "< 1m";
  return `${m}m`;
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type FeedFilter = "all" | "sugar" | "ww";

function entryMatchesFilter(entry: HistoryEntry, filter: FeedFilter): boolean {
  if (filter === "sugar") return (entry.sugarWeight ?? 0) > 0;
  if (filter === "ww") return (entry.wwPercent ?? 0) > 0;
  return true;
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const { pendingCount } = useSyncStatus();
  const { isMigrationActive, startMigration, finishMigration } = useMigrationToast();

  const now = new Date();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bakeHistory, setBakeHistory] = useState<BakeHistoryEntry[]>([]);
  const [displayMonth, setDisplayMonth] = useState(now.getMonth());
  const [displayYear, setDisplayYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [localDeviceId, setLocalDeviceId] = useState("");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(FEED_FILTER_KEY).then((v) => {
      if (v === "sugar" || v === "ww") setFeedFilter(v);
    }).catch(() => {});
  }, []);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  // Feed / bake entry selected for full-detail modal view.
  const [selectedFeedDetail, setSelectedFeedDetail] = useState<HistoryEntry | null>(null);
  const [selectedBakeDetail, setSelectedBakeDetail] = useState<BakeHistoryEntry | null>(null);
  /** Fallback ingredients/instructions loaded from the source recipe (for older bakes). */
  const [bakeRecipeMap, setBakeRecipeMap] = useState<Record<string, { ingredients?: string; instructions?: string }>>({});
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const migrationInFlightRef = useRef(false);

  const retryPendingMigration = useCallback(async () => {
    if (migrationInFlightRef.current) return;
    migrationInFlightRef.current = true;
    try {
      const token = await getStoredToken().catch(() => null);
      if (!token) return;
      const pending = await hasPendingMigration();
      if (!pending) return;
      startMigration();
      const result = await migrateLocalDataToAccount(token).catch(() => null);
      finishMigration(result);
    } finally {
      migrationInFlightRef.current = false;
    }
  }, [startMigration, finishMigration]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current !== "active" && nextState === "active") {
        loadHistory();
        retryPendingMigration();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [retryPendingMigration]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
      getStoredUser().then(setCurrentUser).catch(() => {});
      getDeviceId().then(setLocalDeviceId).catch(() => {});
      retryPendingMigration();
    }, [retryPendingMigration])
  );

  const refresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  // ── Print helpers ─────────────────────────────────────────────────────────

  /**
   * Convert any photo URI to a base64 data URI suitable for embedding in
   * print HTML. Returns null if the URI is missing or cannot be read.
   * - data: URIs → returned as-is
   * - file:// URIs → read as base64 via expo-file-system
   * - http/https URIs → returned as-is (print WebView can fetch remote images)
   */
  const toDataUri = async (uri: string | null | undefined): Promise<string | null> => {
    if (!uri) return null;
    if (uri.startsWith("data:")) return uri;
    if (uri.startsWith("file://")) {
      try {
        const file = new FileSystem.File(uri);
        const base64 = await file.base64();
        return `data:image/jpeg;base64,${base64}`;
      } catch {
        return null;
      }
    }
    return uri;
  };

  /** Build HTML and invoke the system print dialog for a feed session. */
  const printFeedSession = async (entry: HistoryEntry) => {
    const date = new Date(entry.savedAt).toLocaleDateString();
    const initialRow = entry.initialPH
      ? `<tr><td>0m</td><td>${entry.initialPH}</td><td>—</td><td></td></tr>`
      : "";
    const midRows = (entry.readings ?? [])
      .map((r) => {
        const elapsed = Math.floor((r.loggedAt - entry.savedAt) / 60000);
        return `<tr><td>${elapsed}m</td><td>${r.pH}</td><td>${r.temp != null && r.temp !== "" ? `${r.temp}°${r.tempUnit ?? "F"}` : "—"}</td><td>${r.note ?? ""}</td></tr>`;
      })
      .join("");
    const peakRow = entry.peak
      ? `<tr><td>${Math.floor(entry.peak.timeToPeakMs / 60000)}m</td><td>${entry.peak.pH}</td><td>—</td><td><em>Peak</em></td></tr>`
      : "";
    const allRows = initialRow + midRows + peakRow;
    const imgStyle = "max-width:100%;max-height:320px;border-radius:8px;object-fit:cover;display:block;margin:8px 0";
    const [fedDataUri, peakDataUri] = await Promise.all([
      toDataUri(entry.fedPhoto),
      toDataUri(entry.peak?.photo),
    ]);
    const fedPhotoHtml = fedDataUri
      ? `<h3>Feed Photo</h3><img src="${fedDataUri}" style="${imgStyle}" alt="Feed photo" />`
      : "";
    const peakPhotoHtml = peakDataUri
      ? `<img src="${peakDataUri}" style="${imgStyle}" alt="Peak photo" />`
      : "";
    const html = `<html><body style="font-family:sans-serif;padding:24px">
      <h2>Bread Lab — Feed Session</h2>
      <p><strong>Date:</strong> ${date} &nbsp;·&nbsp; <strong>Ratio:</strong> ${entry.ratioStr}</p>
      <p><strong>Starter:</strong> ${entry.starterWeight}g &nbsp;
         <strong>Flour:</strong> ${entry.flourWeight}g &nbsp;
         <strong>Water:</strong> ${entry.waterWeight}g
         ${(entry.sugarWeight ?? 0) > 0 ? `&nbsp;<strong>Sugar:</strong> ${entry.sugarWeight}g` : ""}
      </p>
      ${fedPhotoHtml}
      ${allRows ? `<h3>pH Readings</h3><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Elapsed</th><th>pH</th><th>Temp</th><th>Note</th></tr>${allRows}</table>` : ""}
      ${entry.peak ? `<h3>Peak</h3><p>Rise +${entry.peak.volumeIncreasePct}% &nbsp;·&nbsp; ${formatTimeToPeak(entry.peak.timeToPeakMs)}</p>${peakPhotoHtml}` : ""}
      ${buildAcidVelocityHtml(entry)}
      ${buildLiftingIndexHtml(entry)}
    </body></html>`;
    await Print.printAsync({ html }).catch(() => {});
  };

  /** Build HTML and share a feed session as a PDF via the native share sheet. */
  const shareFeedSession = async (entry: HistoryEntry) => {
    try {
      const date = new Date(entry.savedAt).toLocaleDateString();
      const initialRow = entry.initialPH
        ? `<tr><td>0m</td><td>${entry.initialPH}</td><td>—</td><td></td></tr>`
        : "";
      const midRows = (entry.readings ?? [])
        .map((r) => {
          const elapsed = Math.floor((r.loggedAt - entry.savedAt) / 60000);
          return `<tr><td>${elapsed}m</td><td>${r.pH}</td><td>${r.temp != null && r.temp !== "" ? `${r.temp}°${r.tempUnit ?? "F"}` : "—"}</td><td>${r.note ?? ""}</td></tr>`;
        })
        .join("");
      const peakRow = entry.peak
        ? `<tr><td>${Math.floor(entry.peak.timeToPeakMs / 60000)}m</td><td>${entry.peak.pH}</td><td>—</td><td><em>Peak</em></td></tr>`
        : "";
      const allRows = initialRow + midRows + peakRow;
      const imgStyle = "max-width:100%;max-height:320px;border-radius:8px;object-fit:cover;display:block;margin:8px 0";
      const [fedDataUri, peakDataUri] = await Promise.all([
        toDataUri(entry.fedPhoto),
        toDataUri(entry.peak?.photo),
      ]);
      const fedPhotoHtml = fedDataUri
        ? `<h3>Feed Photo</h3><img src="${fedDataUri}" style="${imgStyle}" alt="Feed photo" />`
        : "";
      const peakPhotoHtml = peakDataUri
        ? `<img src="${peakDataUri}" style="${imgStyle}" alt="Peak photo" />`
        : "";
      const html = `<html><body style="font-family:sans-serif;padding:24px">
        <h2>Bread Lab — Feed Session</h2>
        <p><strong>Date:</strong> ${date} &nbsp;·&nbsp; <strong>Ratio:</strong> ${entry.ratioStr}</p>
        <p><strong>Starter:</strong> ${entry.starterWeight}g &nbsp;
           <strong>Flour:</strong> ${entry.flourWeight}g &nbsp;
           <strong>Water:</strong> ${entry.waterWeight}g
           ${(entry.sugarWeight ?? 0) > 0 ? `&nbsp;<strong>Sugar:</strong> ${entry.sugarWeight}g` : ""}
        </p>
        ${fedPhotoHtml}
        ${allRows ? `<h3>pH Readings</h3><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Elapsed</th><th>pH</th><th>Temp</th><th>Note</th></tr>${allRows}</table>` : ""}
        ${entry.peak ? `<h3>Peak</h3><p>Rise +${entry.peak.volumeIncreasePct}% &nbsp;·&nbsp; ${formatTimeToPeak(entry.peak.timeToPeakMs)}</p>${peakPhotoHtml}` : ""}
        ${buildAcidVelocityHtml(entry)}
        ${buildLiftingIndexHtml(entry)}
      </body></html>`;
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
        return;
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share Feed Session", UTI: "com.adobe.pdf" });
    } catch {
      Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again.");
    }
  };

  /**
   * Open the bake detail modal immediately, then asynchronously populate the
   * fallback recipe phase map (ingredients/instructions for older bakes that
   * pre-date the field storage fix). A stale-guard ensures a slow lookup for
   * bake A never overwrites the map after the user has already opened bake B.
   */
  const openBakeDetail = (bake: BakeHistoryEntry) => {
    // Show the modal right away — no waiting on storage.
    setBakeRecipeMap({});
    setSelectedBakeDetail(bake);

    if (!bake.recipeId) return;

    const requestedId = bake.id;
    AsyncStorage.getItem("bread_lab_recipes_v1")
      .then((recipesRaw) => {
        if (!recipesRaw) return;
        const recipes = JSON.parse(recipesRaw) as { id: string; phases: { key: string; ingredients?: string; instructions?: string }[] }[];
        const sourceRecipe = recipes.find((r) => r.id === bake.recipeId);
        if (!sourceRecipe) return;
        const recipePhaseMap: Record<string, { ingredients?: string; instructions?: string }> = {};
        for (const rp of sourceRecipe.phases) {
          recipePhaseMap[rp.key] = { ingredients: rp.ingredients, instructions: rp.instructions };
        }
        // Only apply if the user hasn't navigated to a different bake.
        setSelectedBakeDetail((current) => {
          if (current?.id !== requestedId) return current;
          setBakeRecipeMap(recipePhaseMap);
          return current;
        });
      })
      .catch(() => {
        // Gracefully fall back to bake-only data if lookup fails
      });
  };

    /** Build the HTML document for a bake session with app-like styling. */
    const buildBakeDetailHtml = async (bake: BakeHistoryEntry): Promise<string> => {
      let recipePhaseMap: Record<string, { ingredients?: string; instructions?: string }> = {};
      if (bake.recipeId) {
        try {
          const recipesRaw = await AsyncStorage.getItem("bread_lab_recipes_v1");
          if (recipesRaw) {
            const recipes = JSON.parse(recipesRaw) as { id: string; phases: { key: string; ingredients?: string; instructions?: string }[] }[];
            const sourceRecipe = recipes.find((r) => r.id === bake.recipeId);
            if (sourceRecipe) {
              for (const rp of sourceRecipe.phases) {
                recipePhaseMap[rp.key] = { ingredients: rp.ingredients, instructions: rp.instructions };
              }
            }
          }
        } catch {
          // If lookup fails, gracefully fall back to bake-only data
        }
      }

      const printDate = new Date(bake.startedAt).toLocaleDateString();

      const phasesHtml = bake.phases.map((p) => {
        const dur = p.startedAt && p.completedAt
          ? formatPhaseDuration(p.completedAt - p.startedAt)
          : p.startedAt ? "In progress" : "—";

        const fallback = recipePhaseMap[p.key] ?? {};
        const ingredients = p.ingredients || fallback.ingredients;
        const instructions = p.instructions || fallback.instructions;

        // Build readings table if they exist
        const readingsHtml = (p.readings ?? []).length > 0
          ? `<div class="readings">
               <table>
                 <tr><th>Time</th><th>pH</th><th>Temp</th><th>Note</th></tr>
                 ${p.readings!.map(r => `<tr><td>${formatTime(r.loggedAt)}</td><td>${r.pH || '—'}</td><td>${r.temp ? `${r.temp}°${r.tempUnit}` : '—'}</td><td>${r.note || ''}</td></tr>`).join('')}
               </table>
             </div>`
          : "";

        const foldHtml = p.key === "stretching_folding"
          ? (() => {
              const count = (p as any).foldCount ?? 0;
              const circles = [0,1,2,3].map(i =>
                `<span style="display:inline-block;width:16px;height:16px;border-radius:50%;border:2px solid #6E7558;background:${i < count ? '#6E7558' : 'transparent'};margin-right:6px"></span>`
              ).join('');
              return `<div class="section"><div class="label">Folds</div><div>${circles}</div></div>`;
            })()
          : "";

        return `
          <div class="card">
            <div class="card-header">
              <span class="phase-name">${p.name}</span>
              <span class="duration">${dur}</span>
            </div>
            ${ingredients ? `<div class="section"><div class="label">Ingredients</div><div class="content">${ingredients.replace(/\n/g, "<br>")}</div></div>` : ""}
            ${instructions ? `<div class="section"><div class="label">Instructions</div><div class="content">${instructions.replace(/\n/g, "<br>")}</div></div>` : ""}
            ${foldHtml}
            ${readingsHtml}
          </div>
        `;
      }).join("");

      return `
        <html>
          <head>
            <style>
              body { font-family: -apple-system, sans-serif; background: #f9f9f9; color: #2A1508; padding: 40px; }
              h2 { margin-bottom: 4px; color: #C4704F; font-size: 24px; }
              .date { margin-bottom: 24px; color: #666; font-size: 14px; }
              .notes-box { background: #fff; padding: 16px; border-radius: 12px; border: 1px solid #e0e0e0; margin-bottom: 24px; font-size: 14px; }
              .card { background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e0e0e0; margin-bottom: 16px; page-break-inside: avoid; }
              .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #f0f0f0; padding-bottom: 8px; }
              .phase-name { font-weight: 700; font-size: 16px; }
              .duration { color: #666; font-size: 13px; }
              .section { margin-top: 12px; }
              .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #999; font-weight: 700; margin-bottom: 4px; }
              .content { font-size: 14px; line-height: 1.5; color: #333; }
              .readings { margin-top: 15px; border-top: 1px dashed #eee; padding-top: 10px; }
              table { width: 100%; border-collapse: collapse; font-size: 12px; }
              th { text-align: left; color: #888; padding-bottom: 4px; }
              td { padding: 4px 0; border-bottom: 1px solid #fafafa; }
              @media print { body { background: #fff; padding: 0; } .card { border: 1px solid #eee; } }
            </style>
          </head>
          <body>
            <h2>${bake.recipeName}</h2>
            <div class="date">Bake started on ${printDate}</div>
            ${bake.notes ? `<div class="notes-box"><strong>Baker's Notes:</strong><br>${bake.notes.replace(/\n/g, "<br>")}</div>` : ""}
            ${phasesHtml}
          </body>
        </html>
      `;
    };

    /** Build HTML and invoke the system print dialog for a bake session. */
    const printBakeDetail = async (bake: BakeHistoryEntry) => {
      const html = await buildBakeDetailHtml(bake);

      if (Platform.OS === "web") {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();

          // Brief delay to ensure browser engine renders the HTML string
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            document.body.removeChild(iframe);
          }, 500);
        }
      } else {
        await Print.printAsync({ html }).catch(() => {});
      }
    };


  /** Export a bake session as a PDF and open the native share sheet. */
  const shareBakeDetail = async (bake: BakeHistoryEntry) => {
    try {
      const html = await buildBakeDetailHtml(bake);
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
        return;
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Share ${bake.recipeName}`, UTI: "com.adobe.pdf" });
    } catch {
      Alert.alert("Could not share PDF", "Something went wrong while generating the PDF. Please try again.");
    }
  };

  const loadHistory = async () => {
    const mergeActiveBake = (
      list: BakeHistoryEntry[],
      activeRaw: string | null
    ): BakeHistoryEntry[] => {
      if (!activeRaw) return list;
      try {
        const active = JSON.parse(activeRaw) as {
          id: string;
          recipeId: string;
          recipeName: string;
          startedAt: number;
          phases: { key: string; name: string; startedAt: number | null; completedAt: number | null; foldCount?: number; }[];
        };
        if (!active?.id || !active?.startedAt) return list;
        const alreadyInHistory = list.some((e) => e.id === active.id);
        if (alreadyInHistory) return list;
        return [
          {
            id: active.id,
            recipeId: active.recipeId ?? "",
            recipeName: active.recipeName,
            savedAt: active.startedAt,
            startedAt: active.startedAt,
            phases: active.phases.map((p) => ({
              key: p.key,
              name: p.name,
              startedAt: p.startedAt ?? null,
              completedAt: p.completedAt ?? null,
              foldCount: (p as any).foldCount,
            })),
          },
          ...list,
        ];
      } catch {
        return list;
      }
    };

    try {
      const [feedStored, bakeStored, activeStored] = await Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        AsyncStorage.getItem(ACTIVE_BAKE_KEY),
      ]);
      if (feedStored) setHistory(JSON.parse(feedStored));
      const bakeList: BakeHistoryEntry[] = bakeStored ? JSON.parse(bakeStored) : [];
      setBakeHistory(mergeActiveBake(bakeList, activeStored));
    } catch (e) {}
    try {
      const deviceId = await getDeviceId();
      const token = await getStoredToken().catch(() => null);
      const [apiFeed, apiBakes, activeStored] = await Promise.all([
        api.history.feed.list(deviceId, token ?? undefined),
        api.history.bakes.list(deviceId, token ?? undefined),
        AsyncStorage.getItem(ACTIVE_BAKE_KEY),
      ]);
      const mapped = apiFeed.map((s) => s.data as unknown as HistoryEntry);

      // Merge Supabase results with local-only entries so a failed or
      // incomplete sync never silently erases sessions that exist only
      // in AsyncStorage (e.g., the session from last night that didn't sync).
      const [localFeedRaw, localBakeRaw, deletedFeedRaw, deletedBakeRaw] = await Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        AsyncStorage.getItem(DELETED_FEED_IDS_KEY),
        AsyncStorage.getItem(DELETED_BAKE_IDS_KEY),
      ]);
      const deletedFeedIds = new Set<string>(
        deletedFeedRaw ? (JSON.parse(deletedFeedRaw) as string[]) : []
      );
      const deletedBakeIds = new Set<string>(
        deletedBakeRaw ? (JSON.parse(deletedBakeRaw) as string[]) : []
      );
      const localFeed: HistoryEntry[] = localFeedRaw ? JSON.parse(localFeedRaw) : [];
      const supabaseFeedIds = new Set(mapped.map((e) => e.id));
      const localOnlyFeed = localFeed.filter(
        (e) => !supabaseFeedIds.has(e.id) && !deletedFeedIds.has(e.id)
      );
      const mergedFeed = [
        ...mapped.filter((e) => !deletedFeedIds.has(e.id)),
        ...localOnlyFeed,
      ].sort((a, b) => {
        const aTime = a.completedAt ?? a.savedAt;
        const bTime = b.completedAt ?? b.savedAt;
        return bTime - aTime;
      });

      if (token || apiFeed.length > 0) {
        setHistory(mergedFeed);
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(mergedFeed));
      }

      const apiMapped: BakeHistoryEntry[] = apiBakes.map((b) => ({
        id: b.id,
        recipeId: b.recipeId ?? "",
        recipeName: b.recipeName,
        savedAt: b.savedAt,
        startedAt: b.startedAt,
        phases: b.phases.map((p) => ({
          key: p.key,
          name: p.name,
          ingredients: p.ingredients,
          instructions: p.instructions,
          startedAt: p.startedAt ?? null,
          completedAt: p.completedAt ?? null,
          // Preserve readings and startVolume from the API so the detail modal
          // can show per-phase data without a separate fetch.
          readings: p.readings?.map((r) => ({
            id: r.id,
            temp: r.temp,
            tempUnit: r.tempUnit,
            pH: r.pH,
            note: r.note,
            volume: r.volume,
            loggedAt: r.loggedAt,
          })),
          startVolume: p.startVolume,
          foldCount: (p as any).foldCount,
        })),
      }));

      const localBakes: BakeHistoryEntry[] = localBakeRaw ? JSON.parse(localBakeRaw) : [];
      const supabaseBakeIds = new Set(apiMapped.map((b) => b.id));
      const localOnlyBakes = localBakes.filter(
        (b) => !supabaseBakeIds.has(b.id) && !deletedBakeIds.has(b.id)
      );
      const mergedBakes = [
        ...apiMapped.filter((b) => !deletedBakeIds.has(b.id)),
        ...localOnlyBakes,
      ].sort((a, b) => {
        return (b.startedAt ?? b.savedAt) - (a.startedAt ?? a.savedAt);
      });

      if (token || apiBakes.length > 0) {
        await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(mergedBakes));
      }
      setBakeHistory(mergeActiveBake(mergedBakes, activeStored));
      setLastSynced(Date.now());
    } catch {}
  };

  const deleteEntry = (id: string) => {
    const doDelete = async () => {
      const updated = history.filter((e) => e.id !== id);
      setHistory(updated);
      await addToTombstone(DELETED_FEED_IDS_KEY, id);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      if (selectedDay !== null) {
        const remaining = updated.filter((e) => {
          const d = new Date(e.completedAt ?? e.savedAt);
          return (
            d.getDate() === selectedDay &&
            d.getMonth() === displayMonth &&
            d.getFullYear() === displayYear
          );
        });
        if (remaining.length === 0) setSelectedDay(null);
      }
      const feedDeleteToken = await getStoredToken().catch(() => null);
      api.history.feed.delete(id, localDeviceId || undefined, feedDeleteToken ?? undefined)
        .then((deleted) => { if (deleted) removeFromTombstone(DELETED_FEED_IDS_KEY, id); })
        .catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Entry", "Remove this refresh from your history?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const deleteBakeEntry = (id: string) => {
    const doDelete = async () => {
      const updated = bakeHistory.filter((e) => e.id !== id);
      setBakeHistory(updated);
      await addToTombstone(DELETED_BAKE_IDS_KEY, id);
      try {
        const activeRaw = await AsyncStorage.getItem(ACTIVE_BAKE_KEY);
        const activeId = activeRaw
          ? (JSON.parse(activeRaw) as { id?: string }).id
          : null;
        const toStore = updated.filter((e) => e.id !== activeId);
        await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(toStore));
      } catch {}
      const bakeDeleteToken = await getStoredToken().catch(() => null);
      api.history.bakes.delete(id, localDeviceId || undefined, bakeDeleteToken ?? undefined)
        .then((deleted) => { if (deleted) removeFromTombstone(DELETED_BAKE_IDS_KEY, id); })
        .catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Bake", "Remove this bake from your history?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const deleteBakeReading = (bakeId: string, phaseKey: string, readingId: string | undefined, readingIndex: number) => {
    const matchReading = (r: BakePhaseReading, ri: number) =>
      readingId ? r.id === readingId : ri === readingIndex;

    const doDelete = async () => {
      const updatedBakeHistory = bakeHistory.map((bake) => {
        if (bake.id !== bakeId) return bake;
        return {
          ...bake,
          phases: bake.phases.map((p) => {
            if (p.key !== phaseKey) return p;
            return {
              ...p,
              readings: (p.readings ?? []).filter((r, ri) => !matchReading(r, ri)),
            };
          }),
        };
      });
      setBakeHistory(updatedBakeHistory);
      if (selectedBakeDetail?.id === bakeId) {
        setSelectedBakeDetail((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            phases: prev.phases.map((p) => {
              if (p.key !== phaseKey) return p;
              return {
                ...p,
                readings: (p.readings ?? []).filter((r, ri) => !matchReading(r, ri)),
              };
            }),
          };
        });
      }
      try {
        const activeRaw = await AsyncStorage.getItem(ACTIVE_BAKE_KEY);
        const activeId = activeRaw ? (JSON.parse(activeRaw) as { id?: string }).id : null;
        const toStore = updatedBakeHistory.filter((e) => e.id !== activeId);
        await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(toStore));
      } catch {}
      const updatedBake = updatedBakeHistory.find((b) => b.id === bakeId);
      if (updatedBake) {
        api.history.bakes.upsert({
          id: updatedBake.id,
          deviceId: localDeviceId,
          recipeId: updatedBake.recipeId || null,
          recipeName: updatedBake.recipeName,
          savedAt: updatedBake.savedAt,
          startedAt: updatedBake.startedAt,
          phases: updatedBake.phases.map((p) => ({
            key: p.key,
            name: p.name,
            ingredients: p.ingredients,
            instructions: p.instructions,
            startedAt: p.startedAt ?? null,
            completedAt: p.completedAt ?? null,
            readings: (p.readings ?? []).map((r) => ({
              id: r.id,
              temp: r.temp,
              tempUnit: r.tempUnit as "F" | "C",
              pH: r.pH,
              note: r.note,
              volume: r.volume,
              loggedAt: r.loggedAt,
            })),
            startVolume: p.startVolume,
          })),
        }).catch(() => {});
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Reading", "Remove this reading from the bake history?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const deleteFeedPeak = (feedId: string) => {
    const doDelete = async () => {
      const updatedHistory = history.map((entry) => {
        if (entry.id !== feedId) return entry;
        return { ...entry, peak: undefined };
      });
      setHistory(updatedHistory);
      setSelectedFeedDetail((prev) => {
        if (!prev || prev.id !== feedId) return prev;
        return { ...prev, peak: undefined };
      });
      try {
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      } catch {}
      const updatedEntry = updatedHistory.find((e) => e.id === feedId);
      if (updatedEntry) {
        api.history.feed.upsert({
          id: updatedEntry.id,
          deviceId: localDeviceId,
          savedAt: updatedEntry.savedAt,
          startedAt: null,
          data: updatedEntry as unknown as Record<string, unknown>,
        }).catch(() => {});
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Remove Peak", "Clear the peak entry from this feed session?", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const deleteFeedReading = (feedId: string, readingIndex: number) => {
    const doDelete = async () => {
      const updatedHistory = history.map((entry) => {
        if (entry.id !== feedId) return entry;
        return {
          ...entry,
          readings: (entry.readings ?? []).filter((_, ri) => ri !== readingIndex),
        };
      });
      setHistory(updatedHistory);
      if (selectedFeedDetail?.id === feedId) {
        setSelectedFeedDetail((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            readings: (prev.readings ?? []).filter((_, ri) => ri !== readingIndex),
          };
        });
      }
      try {
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      } catch {}
      const updatedEntry = updatedHistory.find((e) => e.id === feedId);
      if (updatedEntry) {
        api.history.feed.upsert({
          id: updatedEntry.id,
          deviceId: localDeviceId,
          savedAt: updatedEntry.savedAt,
          startedAt: null,
          data: updatedEntry as unknown as Record<string, unknown>,
        }).catch(() => {});
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Reading", "Remove this reading from the feed history?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const feedDayMap = useMemo(() => {
    const map: Record<string, HistoryEntry[]> = {};
    history.forEach((entry) => {
      const d = new Date(entry.completedAt ?? entry.savedAt);
      if (
        d.getMonth() === displayMonth &&
        d.getFullYear() === displayYear
      ) {
        const key = d.getDate().toString();
        if (!map[key]) map[key] = [];
        map[key].push(entry);
      }
    });
    return map;
  }, [history, displayMonth, displayYear]);

  const displayFeedDayMap = useMemo(() => {
    if (feedFilter === "all") return feedDayMap;
    const map: Record<string, HistoryEntry[]> = {};
    Object.entries(feedDayMap).forEach(([key, entries]) => {
      const filtered = entries.filter((e) => entryMatchesFilter(e, feedFilter));
      if (filtered.length > 0) map[key] = filtered;
    });
    return map;
  }, [feedDayMap, feedFilter]);

  const calendarRows = useMemo(() => {
    const firstDay = new Date(displayYear, displayMonth, 1).getDay();
    const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [displayMonth, displayYear]);

  const bakeDayMap = useMemo(() => {
    const map: Record<string, BakeHistoryEntry[]> = {};
    bakeHistory.forEach((entry) => {
      const d = new Date(entry.savedAt);
      if (d.getMonth() === displayMonth && d.getFullYear() === displayYear) {
        const key = d.getDate().toString();
        if (!map[key]) map[key] = [];
        map[key].push(entry);
      }
    });
    return map;
  }, [bakeHistory, displayMonth, displayYear]);

  const streak = useMemo(() => {
    if (history.length === 0 && bakeHistory.length === 0) return 0;
    const fedDays = new Set([
      ...history.map((e) => dayKey(e.completedAt ?? e.savedAt)),
      ...bakeHistory.map((e) => dayKey(e.savedAt)),
    ]);
    const check = new Date();
    check.setHours(0, 0, 0, 0);
    const todayK = dayKey(check.getTime());
    if (!fedDays.has(todayK)) {
      check.setDate(check.getDate() - 1);
    }
    let count = 0;
    while (fedDays.has(dayKey(check.getTime()))) {
      count++;
      check.setDate(check.getDate() - 1);
    }
    return count;
  }, [history, bakeHistory]);

  const totalThisMonth = Object.values(feedDayMap).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const goToPrevMonth = () => {
    setSelectedDay(null);
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear((y) => y - 1);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    setSelectedDay(null);
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear((y) => y + 1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  };

  const today = now.getDate();
  const isCurrentMonth =
    displayMonth === now.getMonth() && displayYear === now.getFullYear();

  const selectedEntries =
    selectedDay !== null ? displayFeedDayMap[selectedDay.toString()] ?? [] : [];

  const selectedBakeEntries =
    selectedDay !== null ? bakeDayMap[selectedDay.toString()] ?? [] : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + webTop + 16,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 49) + 32,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.mutedForeground}
          />
        }
      >
        <Animated.View entering={FadeIn.duration(400)} style={[styles.pageHeader, { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }]}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>
              Calendar
            </Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
              your feeding history
            </Text>
            {lastSynced !== null && <SyncLabel ts={lastSynced} />}
          </View>
          <TourStep
            text="Sync and name your data across devices."
            order={17}
            name="name-name-button"
          >
            <CopilotView>
              <Pressable
                onPress={() => setShowAuthModal(true)}
                style={({ pressed }) => [styles.accountBtn, { borderColor: colors.border, backgroundColor: currentUser ? colors.primary + "15" : colors.card, opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={{ position: "relative" }}>
                  {currentUser ? (
                    <View style={[styles.avatarMini, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.avatarMiniText, { color: colors.primaryForeground }]}>
                        {currentUser.firstName?.[0]?.toUpperCase() ?? "?"}
                      </Text>
                    </View>
                  ) : (
                    <Feather name="user" size={16} color={colors.mutedForeground} />
                  )}
                  {(pendingCount > 0 || isMigrationActive) && (
                    <View
                      style={[
                        styles.syncBadge,
                        { backgroundColor: colors.accent, borderColor: currentUser ? colors.primary + "15" : colors.card },
                      ]}
                    />
                  )}
                </View>
                <Text
                  style={[styles.accountBtnText, { color: currentUser ? colors.primary : colors.mutedForeground, maxWidth: 130 }]}
                  numberOfLines={1}
                >
                  {currentUser ? `${currentUser.firstName}'s ${currentUser.starterName}` : "Name my data"}
                </Text>
              </Pressable>
            </CopilotView>
          </TourStep>
        </Animated.View>

        {/* Stat strip */}
        <TourStep
          text="Track the number of refreshes, and see your longest daily activity streak."
          order={18}
          name="feed-leaderboard"
        >
          <CopilotView
            style={styles.statsRow}
          >
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {totalThisMonth}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                this month
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: streak > 0 ? colors.accent : colors.foreground }]}>
                {streak}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                day streak
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {history.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                total feeds
              </Text>
            </View>
          </CopilotView>
        </TourStep>

        {/* Feed filter chips */}
        <Animated.View
          entering={FadeInDown.delay(90).duration(400)}
          style={styles.filterRow}
        >
          {(["all", "sugar", "ww"] as FeedFilter[]).map((f) => {
            const label = f === "all" ? "All" : f === "sugar" ? "Sugar" : "WW Blend";
            const active = feedFilter === f;
            return (
              <Pressable
                key={f}
                onPress={() => {
                  setFeedFilter(f);
                  AsyncStorage.setItem(FEED_FILTER_KEY, f).catch(() => {});
                  setSelectedDay(null);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Animated.View>

        {/* Calendar card */}
        <TourStep
          text="View your activity history on the calendar."
          order={19}
          name="calendar"
        >
          <CopilotView
            style={[
              styles.calendarCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {/* Month navigation */}
            <View style={styles.monthNav}>
              <Pressable
                onPress={goToPrevMonth}
                style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}
                hitSlop={12}
              >
                <Feather name="chevron-left" size={22} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.monthLabel, { color: colors.foreground }]}>
                {MONTH_NAMES[displayMonth]} {displayYear}
              </Text>
              <Pressable
                onPress={goToNextMonth}
                style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}
                hitSlop={12}
              >
                <Feather name="chevron-right" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            {/* Weekday headers */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map((d, i) => (
                <View key={i} style={styles.dayCell}>
                  <Text
                    style={[styles.weekdayLabel, { color: colors.mutedForeground }]}
                  >
                    {d}
                  </Text>
                </View>
              ))}
            </View>

            {/* Calendar grid */}
            {calendarRows.map((row, ri) => (
              <View key={ri} style={styles.weekRow}>
                {row.map((day, di) => {
                  if (day === null) {
                    return <View key={di} style={styles.dayCell} />;
                  }
                  const hasFeed = !!displayFeedDayMap[day.toString()];
                  const feedCount = displayFeedDayMap[day.toString()]?.length ?? 0;
                  const hasBake = (bakeDayMap[day.toString()]?.length ?? 0) > 0;
                  const isToday = isCurrentMonth && day === today;
                  const isSelected = day === selectedDay;

                  return (
                    <Pressable
                      key={di}
                      style={styles.dayCell}
                      onPress={() =>
                        setSelectedDay(isSelected ? null : day)
                      }
                      hitSlop={2}
                    >
                      <View
                        style={[
                          styles.dayInner,
                          isSelected && {
                            backgroundColor: colors.primary,
                            borderRadius: 20,
                          },
                          isToday &&
                            !isSelected && {
                              borderWidth: 1.5,
                              borderColor: colors.primary,
                              borderRadius: 20,
                            },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            {
                              color: isSelected
                                ? colors.primaryForeground
                                : isToday
                                ? colors.primary
                                : colors.foreground,
                              fontFamily: isToday
                                ?  fonts.sansSemiBold
                                : fonts.sans,
                            },
                          ]}
                        >
                          {day}
                        </Text>
                      </View>
                      {(hasFeed || hasBake) && (
                        <View style={styles.dotRow}>
                          {Array.from({ length: Math.min(feedCount, 2) }).map(
                            (_, i) => (
                              <View
                                key={`f${i}`}
                                style={[
                                  styles.dot,
                                  {
                                    backgroundColor: isSelected
                                      ? colors.primaryForeground
                                      : colors.accent,
                                  },
                                ]}
                              />
                            )
                          )}
                          {hasBake && (
                            <View
                              style={[
                                styles.dot,
                                {
                                  backgroundColor: isSelected
                                    ? colors.primaryForeground
                                    : colors.primary,
                                },
                              ]}
                            />
                          )}
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </CopilotView>
        </TourStep>

        {/* Selected day detail */}
        {selectedDay !== null && (
          <TourStep
            text="Review, print, and share your refreshes and your bakes (including added notes)."
            order={20}
            name="activity-history"
          >
            <CopilotView style={{ marginTop: 20 }}>
              {selectedEntries.length === 0 && selectedBakeEntries.length === 0 ? (
                <View
                  style={[
                    styles.emptyDay,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.emptyDayText, { color: colors.mutedForeground }]}
                  >
                    {feedFilter !== "all" && (feedDayMap[selectedDay!.toString()]?.length ?? 0) > 0
                      ? `No ${feedFilter === "sugar" ? "sugar" : "WW blend"} refreshes on ${MONTH_NAMES[displayMonth]} ${selectedDay}`
                      : `No activity on ${MONTH_NAMES[displayMonth]} ${selectedDay}`}
                  </Text>
                </View>
              ) : (
                selectedEntries.map((entry, idx) => (
                  <Pressable
                    key={`${entry.id}-${idx}`} // <--- Safe fallback to avoid ID collision
                    onPress={() => setSelectedFeedDetail(entry)}
                    style={({ pressed }) => [
                      styles.entryCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        marginBottom: idx < selectedEntries.length - 1 ? 12 : 0,
                        opacity: pressed ? 0.92 : 1,
                      },
                    ]}
                  >
                    <View style={styles.entryHeader}>
                      <Text style={[styles.entryTime, { color: colors.foreground }]}>
                        {formatTime(entry.savedAt)}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {entry.peak && (
                          <View style={[styles.peakedBadge, { backgroundColor: colors.accent + "18", borderColor: colors.accent + "40" }]}>
                            <Ionicons name="checkmark-circle" size={12} color={colors.accent} />
                            <Text style={[styles.peakedText, { color: colors.accent }]}>Peaked</Text>
                          </View>
                        )}
                        <Pressable onPress={() => deleteEntry(entry.id)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })} hitSlop={8}>
                          <Feather name="trash-2" size={14} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    </View>

                    {/* Unified Initial Feed Row: 5 Columns */}
                    <View style={[styles.entryGrid, { justifyContent: 'space-between', gap: 4 }]}>
                      <View style={[styles.entryGridItem, { minWidth: 50 }]}>
                        <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.starterWeight}g</Text>
                        <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Starter</Text>
                      </View>

                      <View style={[styles.entryGridItem, { minWidth: 60 }]}>
                        <Text style={[styles.entryVal, { color: colors.primary }]}>{entry.ratioStr}</Text>
                        <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Ratio</Text>
                      </View>

                      {entry.initialPH ? (
                        <View style={[styles.entryGridItem, { minWidth: 40 }]}>
                          <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.initialPH}</Text>
                          <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                        </View>
                      ) : null}

                      {entry.initialTemp ? (
                        <View style={[styles.entryGridItem, { minWidth: 40 }]}>
                          <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.initialTemp}°</Text>
                          <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>Temp</Text>
                        </View>
                      ) : null}

                      {entry.initialVolume ? (
                        <View style={[styles.entryGridItem, { minWidth: 40 }]}>
                          <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.initialVolume}</Text>
                          <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>Vol</Text>
                        </View>
                      ) : null}
                    </View>

                    {entry.wwPercent > 0 && (
                      <Text style={[styles.flourNote, { color: colors.mutedForeground, marginTop: 12 }]}>
                        {100 - entry.wwPercent}% AP · {entry.wwPercent}% WW
                      </Text>
                    )}

                    {/* Peak Stats Block */}
                    {entry.peak && (
                      <View style={[styles.peakBlock, { borderTopColor: colors.border }]}>
                        <Text style={[styles.peakTitle, { color: colors.mutedForeground }]}>Peak Results</Text>
                        <View style={[styles.entryGrid, { justifyContent: 'space-between', gap: 4 }]}>
                          {entry.peak.pH ? (
                            <View style={[styles.entryGridItem, { minWidth: 40 }]}>
                              <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.peak.pH}</Text>
                              <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                            </View>
                          ) : null}
                          {entry.peak.temp ? (
                            <View style={[styles.entryGridItem, { minWidth: 40 }]}>
                              <Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.peak.temp}°</Text>
                              <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>Temp</Text>
                            </View>
                          ) : null}
                          {typeof entry.peak.volumeIncreasePct === 'number' && (
                            <View style={[styles.entryGridItem, { minWidth: 50 }]}>
                              <Text style={[styles.entryVal, { color: colors.accent }]}>+{entry.peak.volumeIncreasePct}%</Text>
                              <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Rise</Text>
                            </View>
                          )}
                          <View style={[styles.entryGridItem, { minWidth: 60 }]}>
                            <Text style={[styles.entryVal, { color: colors.foreground }]}>{formatTimeToPeak(entry.peak.timeToPeakMs)}</Text>
                            <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Time</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </Pressable>
                ))
              )}
            </CopilotView>
          </TourStep>
        )}

        {/* Bake entries for selected day */}
        {selectedBakeEntries.length > 0 && (
          <Animated.View entering={FadeInDown.delay(80).duration(300)} style={{ marginTop: 12 }}>
            {selectedBakeEntries.map((bake, idx) => {
              const completedPhases = bake.phases.filter((p) => p.completedAt);
              const lastComplete = bake.phases.reduce<number | null>((max, p) =>
                p.completedAt ? (max === null ? p.completedAt : Math.max(max, p.completedAt)) : max
              , null);
              const totalMs = lastComplete ? lastComplete - bake.startedAt : null;
              const hrs = totalMs ? Math.floor(totalMs / 3600000) : 0;
              const mins = totalMs ? Math.floor((totalMs % 3600000) / 60000) : 0;
              const duration = totalMs
                ? hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
                : null;
              return (
                <Pressable
                  key={`${bake.id}-${idx}`} // <--- Guarantees uniqueness even if IDs collide
                  onPress={() => openBakeDetail(bake)}
                  style={({ pressed }) => [
                    styles.entryCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      marginBottom: idx < selectedBakeEntries.length - 1 ? 12 : 0,
                      opacity: pressed ? 0.92 : 1,
                    },
                  ]}
                >
                  <View style={styles.entryHeader}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.entryTime, { color: colors.foreground }]}>
                        {bake.recipeName}
                      </Text>
                      <Text style={[styles.flourNote, { color: colors.mutedForeground, marginTop: 0 }]}>
                        {formatTime(bake.savedAt)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={[
                          styles.peakedBadge,
                          {
                            backgroundColor: colors.primary + "18",
                            borderColor: colors.primary + "40",
                          },
                        ]}
                      >
                        <Ionicons name="flame-outline" size={12} color={colors.primary} />
                        <Text style={[styles.peakedText, { color: colors.primary }]}>
                          Bake
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => deleteBakeEntry(bake.id)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.5 : 1,
                          padding: 4,
                        })}
                        hitSlop={8}
                      >
                        <Feather
                          name="trash-2"
                          size={14}
                          color={colors.mutedForeground}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.entryGrid}>
                    <View style={styles.entryGridItem}>
                      <Text style={[styles.entryVal, { color: colors.foreground }]}>
                        {completedPhases.length}/{bake.phases.length}
                      </Text>
                      <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>
                        Phases
                      </Text>
                    </View>
                    {duration && (
                      <View style={styles.entryGridItem}>
                        <Text style={[styles.entryVal, { color: colors.foreground }]}>
                          {duration}
                        </Text>
                        <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>
                          Total
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={[styles.peakBlock, { borderTopColor: colors.border, marginTop: 12, paddingTop: 12 }]}>
                    <Text style={[styles.peakTitle, { color: colors.mutedForeground }]}>
                      Phases
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {bake.phases.map((p) => (
                        <View
                          key={p.key}
                          style={[
                            styles.peakedBadge,
                            {
                              backgroundColor: p.completedAt
                                ? colors.primary + "14"
                                : colors.muted,
                              borderColor: p.completedAt
                                ? colors.primary + "30"
                                : colors.border,
                            },
                          ]}
                        >
                          {p.completedAt && (
                            <Ionicons name="checkmark" size={10} color={colors.primary} />
                          )}
                          <Text
                            style={[
                              styles.peakedText,
                              {
                                color: p.completedAt
                                  ? colors.primary
                                  : colors.mutedForeground,
                              },
                            ]}
                          >
                            {p.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        )}

        {history.length === 0 && (
          <Animated.View
            entering={FadeInDown.delay(200).duration(400)}
            style={[
              styles.emptyState,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="calendar" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No history yet
            </Text>
            <Text
              style={[styles.emptyBody, { color: colors.mutedForeground }]}
            >
              Start a feed session and tap New Session — each completed feed
              will appear here.
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* ─── Feed session full-detail modal ───────────────────────────────── */}
      <Modal
        visible={selectedFeedDetail !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedFeedDetail(null)}
      >
        {selectedFeedDetail && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.detailHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
              <Pressable onPress={() => setSelectedFeedDetail(null)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <Ionicons name="close" size={22} color={colors.foreground} />
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={[styles.detailTitle, { color: colors.foreground }]}>Feed Session</Text>
                <Text style={[styles.detailSubtitle, { color: colors.mutedForeground }]}>
                  {new Date(selectedFeedDetail.savedAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  {" · "}{formatTime(selectedFeedDetail.savedAt)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <Pressable onPress={() => shareFeedSession(selectedFeedDetail)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                  <Feather name="share" size={20} color={colors.primary} />
                </Pressable>
                <Pressable onPress={() => printFeedSession(selectedFeedDetail)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                  <Feather name="printer" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
              {/* Feed weights / ratio */}
              <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground }]}>Feed</Text>
              <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
                <View style={styles.entryGrid}>
                  <View style={styles.entryGridItem}>
                    <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.starterWeight}g</Text>
                    <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Starter</Text>
                  </View>
                  <View style={styles.entryGridItem}>
                    <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.flourWeight}g</Text>
                    <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Flour</Text>
                  </View>
                  <View style={styles.entryGridItem}>
                    <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.waterWeight}g</Text>
                    <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Water</Text>
                  </View>
                  {(selectedFeedDetail.sugarWeight ?? 0) > 0 && (
                    <View style={styles.entryGridItem}>
                      <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.sugarWeight}g</Text>
                      <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Sugar</Text>
                    </View>
                  )}
                  {selectedFeedDetail.initialPH ? (
                    <View style={styles.entryGridItem}>
                      <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.initialPH}</Text>
                      <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.flourNote, { color: colors.mutedForeground }]}>ratio {selectedFeedDetail.ratioStr}</Text>
                {selectedFeedDetail.wwPercent > 0 && (
                  <Text style={[styles.flourNote, { color: colors.mutedForeground }]}>
                    {100 - selectedFeedDetail.wwPercent}% AP · {selectedFeedDetail.wwPercent}% WW
                  </Text>
                )}
              </View>

              {/* pH readings timeline */}
              {(selectedFeedDetail.readings ?? []).length > 0 && (
                <>
                  <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH Readings</Text>
                  <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: "hidden", marginBottom: 16 }]}>
                    {(selectedFeedDetail.readings ?? []).map((r, i, arr) => {
                      const elapsed = r.loggedAt - selectedFeedDetail.savedAt;
                      const mins = Math.floor(elapsed / 60000);
                      const hrs = Math.floor(mins / 60);
                      const elapsedStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                      return (
                        <View key={i} style={[styles.detailReadingRow, {
                          borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0,
                          borderBottomColor: colors.border,
                        }]}>
                          <Text style={[styles.detailReadingTime, { color: colors.mutedForeground }]}>{elapsedStr}</Text>
                          <View style={{ flex: 1 }}>
                            {r.pH ? <Text style={[styles.detailReadingPH, { color: colors.foreground }]}>pH {r.pH}</Text> : null}
                            {r.temp ? <Text style={[styles.detailReadingNote, { color: colors.mutedForeground }]}>{r.temp}°{r.tempUnit ?? "F"}</Text> : null}
                            {r.note ? <Text style={[styles.detailReadingNote, { color: colors.mutedForeground }]}>{r.note}</Text> : null}
                          </View>
                          <Pressable
                            onPress={() => deleteFeedReading(selectedFeedDetail.id, i)}
                            hitSlop={8}
                            style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, paddingLeft: 12 })}
                          >
                            <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Peak data */}
              {selectedFeedDetail.peak && (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>Peak</Text>
                    <Pressable
                      onPress={() => deleteFeedPeak(selectedFeedDetail.id)}
                      hitSlop={8}
                      style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, paddingLeft: 12 })}
                    >
                      <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
                    <View style={styles.entryGrid}>
                      {selectedFeedDetail.peak.pH ? (
                        <View style={styles.entryGridItem}>
                          <Text style={[styles.entryVal, { color: colors.foreground }]}>{selectedFeedDetail.peak.pH}</Text>
                          <Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                        </View>
                      ) : null}
                      {selectedFeedDetail.peak.volumeIncreasePct > 0 && (
                        <View style={styles.entryGridItem}>
                          <Text style={[styles.entryVal, { color: colors.accent }]}>+{selectedFeedDetail.peak.volumeIncreasePct}%</Text>
                          <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Rise</Text>
                        </View>
                      )}
                      <View style={styles.entryGridItem}>
                        <Text style={[styles.entryVal, { color: colors.foreground }]}>{formatTimeToPeak(selectedFeedDetail.peak.timeToPeakMs)}</Text>
                        <Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Time to peak</Text>
                      </View>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* ─── Bake session full-detail modal ────────────────────────────────── */}
      <Modal
        visible={selectedBakeDetail !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedBakeDetail(null)}
      >
        {selectedBakeDetail && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.detailHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
              <Pressable onPress={() => setSelectedBakeDetail(null)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <Ionicons name="close" size={22} color={colors.foreground} />
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedBakeDetail.recipeName}</Text>
                <Text style={[styles.detailSubtitle, { color: colors.mutedForeground }]}>
                  {new Date(selectedBakeDetail.startedAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <Pressable onPress={() => shareBakeDetail(selectedBakeDetail)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })} accessibilityLabel="Share bake summary as PDF" accessibilityRole="button">
                  <Feather name="share" size={20} color={colors.primary} />
                </Pressable>
                <Pressable onPress={() => printBakeDetail(selectedBakeDetail)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })} accessibilityLabel="Print bake summary" accessibilityRole="button">
                  <Feather name="printer" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
              {/* Bake-level notes */}
              {selectedBakeDetail.notes ? (
                <>
                  <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground }]}>Notes</Text>
                  <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
                    <Text style={[styles.detailNoteText, { color: colors.foreground }]}>{selectedBakeDetail.notes}</Text>
                  </View>
                </>
              ) : null}

              {/* Ingredients summary across all phases */}
              {(() => {
                const ingredientLines = selectedBakeDetail.phases
                  .map((p) => {
                    const ing = p.ingredients || bakeRecipeMap[p.key]?.ingredients;
                    return ing ? { phaseName: p.name, ingredients: ing } : null;
                  })
                  .filter((item): item is { phaseName: string; ingredients: string } => item !== null);
                if (ingredientLines.length === 0) return null;
                return (
                  <>
                    <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground }]}>Ingredients</Text>
                    <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16, gap: 8 }]}>
                      {ingredientLines.map(({ phaseName, ingredients }, idx) => (
                        <View key={idx}>
                          <Text style={[styles.flourNote, { color: colors.mutedForeground, fontWeight: "600", marginBottom: 2 }]}>
                            {phaseName}
                          </Text>
                          <Text style={[styles.detailNoteText, { color: colors.foreground }]}>{ingredients}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()}

              {/* Phase-by-phase breakdown */}
              <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground }]}>Phases</Text>
              {selectedBakeDetail.phases.map((p, i) => {
                const dur =
                  p.startedAt && p.completedAt
                    ? formatPhaseDuration(p.completedAt - p.startedAt)
                    : p.startedAt ? "In progress" : "Not started";
                const lastVol = (p.readings ?? []).filter((r) => r.volume).at(-1)?.volume;
                return (
                  <View
                    key={p.key}
                    style={[styles.entryCard, {
                      backgroundColor: colors.card,
                      borderColor: p.completedAt ? colors.primary + "30" : colors.border,
                      marginBottom: 10,
                    }]}
                  >
                    {/* Phase header */}
                    <View style={[styles.entryHeader, { marginBottom: 6 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                        {p.completedAt ? (
                          <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                        ) : p.startedAt ? (
                          <Ionicons name="radio-button-on" size={14} color={colors.accent} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={14} color={colors.border} />
                        )}
                        <Text style={[styles.entryTime, { color: colors.foreground, fontSize: 14 }]}>{p.name}</Text>
                      </View>
                      <Text style={[styles.flourNote, { color: colors.mutedForeground }]}>{dur}</Text>
                    </View>
                    {/* Volume range row */}
                    {(p.startVolume || lastVol) && (
                      <Text style={[styles.flourNote, { color: colors.mutedForeground, marginBottom: 8 }]}>
                        Volume: {p.startVolume || "—"} → {lastVol || "—"}
                      </Text>
                    )}
                    {/* Ingredients */}
                    {(() => {
                      const ingredients = p.ingredients || bakeRecipeMap[p.key]?.ingredients;
                      return ingredients ? (
                        <View style={{ marginBottom: 8 }}>
                          <Text style={[styles.flourNote, { color: colors.mutedForeground, fontWeight: "600", marginBottom: 2 }]}>
                            Ingredients
                          </Text>
                          <Text style={[styles.detailNoteText, { color: colors.foreground }]}>{ingredients}</Text>
                        </View>
                      ) : null;
                    })()}
                    {/* Instructions */}
                    {(() => {
                      const instructions = p.instructions || bakeRecipeMap[p.key]?.instructions;
                      return instructions ? (
                        <View style={{ marginBottom: 8 }}>
                          <Text style={[styles.flourNote, { color: colors.mutedForeground, fontWeight: "600", marginBottom: 2 }]}>
                            Instructions
                          </Text>
                          <Text style={[styles.detailNoteText, { color: colors.foreground }]}>{instructions}</Text>
                        </View>
                      ) : null;
                    })()}
                    {/* Per-phase readings */}
                    {(p.readings ?? []).length > 0 && (
                      <View style={[styles.peakBlock, { borderTopColor: colors.border }]}>
                        {(p.readings ?? []).map((r, ri, arr) => (
                          <View key={r.id ?? ri} style={[styles.detailReadingRow, {
                            borderBottomWidth: ri < arr.length - 1 ? StyleSheet.hairlineWidth : 0,
                            borderBottomColor: colors.border,
                          }]}>
                            <Text style={[styles.detailReadingTime, { color: colors.mutedForeground }]}>
                              {formatTime(r.loggedAt)}
                            </Text>
                            <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {r.pH ? <Text style={[styles.detailReadingPH, { color: colors.foreground }]}>pH {r.pH}</Text> : null}
                              {r.temp ? <Text style={[styles.detailReadingNote, { color: colors.mutedForeground }]}>{r.temp}°{r.tempUnit}</Text> : null}
                              {r.volume ? <Text style={[styles.detailReadingNote, { color: colors.mutedForeground }]}>{r.volume}</Text> : null}
                              {r.note ? <Text style={[styles.detailReadingNote, { color: colors.mutedForeground, flex: 1 }]}>{r.note}</Text> : null}
                            </View>
                            <Pressable
                              onPress={() => deleteBakeReading(selectedBakeDetail.id, p.key, r.id, ri)}
                              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4, marginLeft: 4 })}
                              hitSlop={8}
                            >
                              <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </Modal>

      <AuthModal
        visible={showAuthModal}
        currentUser={currentUser}
        onClose={() => setShowAuthModal(false)}
        onAuthChange={(user) => {
          setCurrentUser(user);
          loadHistory();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    marginBottom: spacing.lg,                // 24
  },
  accountBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.full,               // pill shape
    borderWidth: 1,
    marginTop: spacing.xs,                   // 4
  },
  accountBtnText: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium
    fontSize: 13,
  },
  avatarMini: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMiniText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 10,
  },
  syncBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  pageTitle: {
    ...typography.headlineLgMobile,          // LibreCaslonText_700Bold, 28px
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 14,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  syncLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 11,
    marginTop: spacing.xs,                   // 4
    letterSpacing: 0.2,
    opacity: 0.7,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: spacing.md,               // 16
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,                         // 8
    marginBottom: spacing.md,               // 16
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,               // pill shape
    borderWidth: 1,
  },
  filterChipText: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium
    fontSize: 13,
  },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — numeric data
    fontSize: 22,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 11,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  calendarCard: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: spacing.md,                     // 16
  },
  monthNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,               // 16
  },
  monthLabel: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — month name as editorial serif
    fontSize: 17,
    letterSpacing: -0.2,
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 3,
  },
  weekdayLabel: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingBottom: spacing.sm,               // 8
  },
  dayInner: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: {
    fontSize: 14,
    // fontFamily set inline — driven by isToday flag
  },
  dotRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
    height: 6,
    alignItems: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  emptyDay: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: spacing.md,                     // 16
    alignItems: "center",
  },
  emptyDayText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 14,
  },
  entryCard: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: spacing.md,                     // 16
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  entryTime: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 16,
  },
  peakedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,               // pill shape
    borderWidth: 1,
  },
  peakedText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold
    fontSize: 11,
  },
  entryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  entryGridItem: {
    alignItems: "center",
    minWidth: 56,
  },
  entryVal: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — data readings (pH, weight, ratio, volume)
    fontSize: 18,
  },
  entryLbl: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 11,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  flourNote: {
    ...typography.metaLabel,                 // HankenGrotesk_400Regular, 12px
    marginTop: 10,
    letterSpacing: 0.2,
  },
  peakBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  peakTitle: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,               // 8
  },
  emptyState: {
    borderRadius: radius.lg,                 // 12
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  emptyTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — serif for empty state headline
    fontSize: 17,
  },
  emptyBody: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  // ── Detail modal styles ───────────────────────────────────────────────────
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,           // 16
    paddingBottom: spacing.md,               // 16
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — modal title in serif
    fontSize: 16,
  },
  detailSubtitle: {
    ...typography.metaLabel,                 // HankenGrotesk_400Regular, 12px
    marginTop: 2,
  },
  detailSectionLabel: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: spacing.sm,               // 8
  },
  detailReadingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.sm,             // 8
    paddingHorizontal: 14,
    gap: 10,
  },
  detailReadingTime: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — time is data
    fontSize: 12,
    minWidth: 52,
    paddingTop: 1,
  },
  detailReadingPH: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — pH is scientific data
    fontSize: 15,
  },
  detailReadingNote: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — freeform text
    fontSize: 12,
  },
  detailNoteText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    fontSize: 14,
    lineHeight: 20,
  },
});
