// artifacts/sourdough/components/log/logBook.tsx
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
import { TourStep, CopilotView } from "@/components/TourStep";
import { typography, spacing, radius, fonts } from "@/constants/theme";
import { SafePrint } from "@/lib/printUtils";

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

function ensureString(val: string | any[] | undefined): string {
  if (!val) return "";
  if (Array.isArray(val)) {
    return val.map(line => typeof line === 'string' ? line : line.text).join('\n');
  }
  return val;
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
  notes?: string;
  phases: {
    key: string;
    name: string;
    // Updated to support arrays from v1.2.0 migration
    ingredients?: string | any[];
    instructions?: string | any[];
    startedAt: number | null;
    completedAt: number | null;
    readings?: BakePhaseReading[];
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

export function HistorySection() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  const [selectedFeedDetail, setSelectedFeedDetail] = useState<HistoryEntry | null>(null);
  const [selectedBakeDetail, setSelectedBakeDetail] = useState<BakeHistoryEntry | null>(null);
  const [bakeRecipeMap, setBakeRecipeMap] = useState<Record<string, { ingredients?: string; instructions?: string }>>({});

  useEffect(() => {
    AsyncStorage.getItem(FEED_FILTER_KEY).then((v) => {
      if (v === "sugar" || v === "ww") setFeedFilter(v as FeedFilter);
    }).catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    const mergeActiveBake = (list: BakeHistoryEntry[], activeRaw: string | null): BakeHistoryEntry[] => {
      if (!activeRaw) return list;
      try {
        const active = JSON.parse(activeRaw);
        if (!active?.id || !active?.startedAt) return list;
        if (list.some((e) => e.id === active.id)) return list;
        return [{
          id: active.id,
          recipeId: active.recipeId ?? "",
          recipeName: active.recipeName,
          savedAt: active.startedAt,
          startedAt: active.startedAt,
          phases: active.phases.map((p: any) => ({
            key: p.key,
            name: p.name,
            startedAt: p.startedAt ?? null,
            completedAt: p.completedAt ?? null,
            foldCount: p.foldCount,
          })),
        }, ...list];
      } catch { return list; }
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
    } catch {}

    try {
      const deviceId = await getDeviceId();
      const token = await getStoredToken().catch(() => null);
      const [apiFeed, apiBakes, activeStored] = await Promise.all([
        api.history.feed.list(deviceId, token ?? undefined),
        api.history.bakes.list(deviceId, token ?? undefined),
        AsyncStorage.getItem(ACTIVE_BAKE_KEY),
      ]);
      const mapped = apiFeed.map((s) => s.data as unknown as HistoryEntry);

      const [localFeedRaw, localBakeRaw, deletedFeedRaw, deletedBakeRaw] = await Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        AsyncStorage.getItem(DELETED_FEED_IDS_KEY),
        AsyncStorage.getItem(DELETED_BAKE_IDS_KEY),
      ]);
      const deletedFeedIds = new Set<string>(deletedFeedRaw ? JSON.parse(deletedFeedRaw) : []);
      const deletedBakeIds = new Set<string>(deletedBakeRaw ? JSON.parse(deletedBakeRaw) : []);
      const localFeed: HistoryEntry[] = localFeedRaw ? JSON.parse(localFeedRaw) : [];
      const supabaseFeedIds = new Set(mapped.map((e) => e.id));
      const localOnlyFeed = localFeed.filter(e => !supabaseFeedIds.has(e.id) && !deletedFeedIds.has(e.id));
      const mergedFeed = [...mapped.filter(e => !deletedFeedIds.has(e.id)), ...localOnlyFeed].sort((a, b) => (b.completedAt ?? b.savedAt) - (a.completedAt ?? a.savedAt));

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
          readings: p.readings,
          startVolume: p.startVolume,
          foldCount: (p as any).foldCount,
        })),
      }));

      const localBakes: BakeHistoryEntry[] = localBakeRaw ? JSON.parse(localBakeRaw) : [];
      const supabaseBakeIds = new Set(apiMapped.map(b => b.id));
      const localOnlyBakes = localBakes.filter(b => !supabaseBakeIds.has(b.id) && !deletedBakeIds.has(b.id));
      const mergedBakes = [...apiMapped.filter(b => !deletedBakeIds.has(b.id)), ...localOnlyBakes].sort((a, b) => (b.startedAt ?? b.savedAt) - (a.startedAt ?? a.savedAt));

      if (token || apiBakes.length > 0) {
        await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(mergedBakes));
      }
      const [finalActiveStored] = await Promise.all([AsyncStorage.getItem(ACTIVE_BAKE_KEY)]);
      setBakeHistory(mergeActiveBake(mergedBakes, finalActiveStored));
      setLastSynced(Date.now());
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    loadHistory();
    getStoredUser().then(setCurrentUser).catch(() => {});
    getDeviceId().then(setLocalDeviceId).catch(() => {});
  }, [loadHistory]));

  const feedDayMap = useMemo(() => {
    const map: Record<string, HistoryEntry[]> = {};
    history.forEach((entry) => {
      const d = new Date(entry.completedAt ?? entry.savedAt);
      if (d.getMonth() === displayMonth && d.getFullYear() === displayYear) {
        const key = d.getDate().toString();
        if (!map[key]) map[key] = [];
        map[key].push(entry);
      }
    });
    return map;
  }, [history, displayMonth, displayYear]);

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

  const displayFeedDayMap = useMemo(() => {
    if (feedFilter === "all") return feedDayMap;
    const map: Record<string, HistoryEntry[]> = {};
    Object.entries(feedDayMap).forEach(([key, entries]) => {
      const filtered = entries.filter(e => entryMatchesFilter(e, feedFilter));
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
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [displayMonth, displayYear]);

  const streak = useMemo(() => {
    if (history.length === 0 && bakeHistory.length === 0) return 0;
    const fedDays = new Set([
      ...history.map(e => dayKey(e.completedAt ?? e.savedAt)),
      ...bakeHistory.map(e => dayKey(e.savedAt)),
    ]);
    const check = new Date();
    check.setHours(0, 0, 0, 0);
    if (!fedDays.has(dayKey(check.getTime()))) check.setDate(check.getDate() - 1);
    let count = 0;
    while (fedDays.has(dayKey(check.getTime()))) { count++; check.setDate(check.getDate() - 1); }
    return count;
  }, [history, bakeHistory]);

  const totalThisMonth = Object.values(feedDayMap).reduce((sum, arr) => sum + arr.length, 0);

  const deleteEntry = (id: string) => {
    const doDelete = async () => {
      const updated = history.filter(e => e.id !== id);
      setHistory(updated);
      await addToTombstone(DELETED_FEED_IDS_KEY, id);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      const token = await getStoredToken().catch(() => null);
      api.history.feed.delete(id, localDeviceId || undefined, token ?? undefined).then(ok => { if (ok) removeFromTombstone(DELETED_FEED_IDS_KEY, id); }).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    Alert.alert("Delete Entry", "Remove this refresh from history?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const deleteBakeEntry = (id: string) => {
    const doDelete = async () => {
      const updated = bakeHistory.filter(b => b.id !== id);
      setBakeHistory(updated);
      await addToTombstone(DELETED_BAKE_IDS_KEY, id);
      await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(updated));
      const token = await getStoredToken().catch(() => null);
      api.history.bakes.delete(id, localDeviceId || undefined, token ?? undefined).then(ok => { if (ok) removeFromTombstone(DELETED_BAKE_IDS_KEY, id); }).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    Alert.alert("Delete Bake", "Remove this bake from history?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const deleteFeedPeak = (feedId: string) => {
    const doDelete = async () => {
      const updatedHistory = history.map((entry) => {
        if (entry.id !== feedId) return entry;
        return { ...entry, peak: undefined };
      });
      setHistory(updatedHistory);
      setSelectedFeedDetail((prev) => (prev?.id === feedId ? { ...prev, peak: undefined } : prev));
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      const updatedEntry = updatedHistory.find((e) => e.id === feedId);
      if (updatedEntry) api.history.feed.upsert({ id: updatedEntry.id, deviceId: localDeviceId, savedAt: updatedEntry.savedAt, startedAt: null, data: updatedEntry }).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    Alert.alert("Remove Peak", "Clear the peak entry from this session?", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: doDelete }]);
  };

  const deleteFeedReading = (feedId: string, readingIndex: number) => {
    const doDelete = async () => {
      const updatedHistory = history.map((entry) => {
        if (entry.id !== feedId) return entry;
        return { ...entry, readings: (entry.readings ?? []).filter((_, ri) => ri !== readingIndex) };
      });
      setHistory(updatedHistory);
      setSelectedFeedDetail((prev) => (prev?.id === feedId ? { ...prev, readings: (prev.readings ?? []).filter((_, ri) => ri !== readingIndex) } : prev));
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      const updatedEntry = updatedHistory.find((e) => e.id === feedId);
      if (updatedEntry) api.history.feed.upsert({ id: updatedEntry.id, deviceId: localDeviceId, savedAt: updatedEntry.savedAt, startedAt: null, data: updatedEntry }).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    Alert.alert("Delete Reading", "Remove this reading?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const deleteBakeReading = (bakeId: string, phaseKey: string, readingId: string, idx: number) => {
    const doDelete = async () => {
      const updatedBakeHistory = bakeHistory.map((bake) => {
        if (bake.id !== bakeId) return bake;
        return { ...bake, phases: bake.phases.map(p => p.key === phaseKey ? { ...p, readings: (p.readings ?? []).filter((r, ri) => readingId ? r.id !== readingId : ri !== idx) } : p) };
      });
      setBakeHistory(updatedBakeHistory);
      setSelectedBakeDetail((prev) => (prev?.id === bakeId ? { ...prev, phases: prev.phases.map(p => p.key === phaseKey ? { ...p, readings: (p.readings ?? []).filter((r, ri) => readingId ? r.id !== readingId : ri !== idx) } : p) } : prev));
      await AsyncStorage.setItem(BAKE_HISTORY_KEY, JSON.stringify(updatedBakeHistory));
      const updatedBake = updatedBakeHistory.find((b) => b.id === bakeId);
      if (updatedBake) api.history.bakes.upsert({ ...updatedBake, deviceId: localDeviceId }).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    Alert.alert("Delete Reading", "Remove this reading from the bake history?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const toDataUri = async (uri: string | null | undefined): Promise<string | null> => {
    if (!uri) return null;
    if (uri.startsWith("data:")) return uri;
    if (uri.startsWith("file://")) {
      try {
        const file = new FileSystem.File(uri);
        const base64 = await file.base64();
        return `data:image/jpeg;base64,${base64}`;
      } catch { return null; }
    }
    return uri;
  };

  const printFeedSession = async (entry: HistoryEntry) => {
    const date = new Date(entry.savedAt).toLocaleDateString();
    const rows = (entry.readings ?? []).map(r => {
      const elapsed = Math.floor((r.loggedAt - entry.savedAt) / 60000);
      return `<tr><td>${elapsed}m</td><td>${r.pH}</td><td>${r.temp ? `${r.temp}°${r.tempUnit ?? "F"}` : "—"}</td><td>${r.note ?? ""}</td></tr>`;
    }).join("");
    const fedDataUri = await toDataUri(entry.fedPhoto);
    const html = `<html><body style="font-family:sans-serif;padding:24px"><h2>Feed Session</h2><p>Date: ${date} Ratio: ${entry.ratioStr}</p>${fedDataUri ? `<img src="${fedDataUri}" style="max-width:100%" />` : ""}<h3>Readings</h3><table border="1">${rows}</table></body></html>`;
    await SafePrint.printHtml(html);
  };

  const shareFeedSession = async (entry: HistoryEntry) => {
    const date = new Date(entry.savedAt).toLocaleDateString();
    const html = `<html><body style="font-family:sans-serif;padding:24px"><h2>Feed Session</h2><p>Date: ${date} Ratio: ${entry.ratioStr}</p></body></html>`;
    await SafePrint.sharePdf(html, "FeedSession");
  };

  const openBakeDetail = (bake: BakeHistoryEntry) => {
    setBakeRecipeMap({});
    setSelectedBakeDetail(bake);
    if (!bake.recipeId) return;
    AsyncStorage.getItem("bread_lab_recipes_v1").then(raw => {
      if (!raw) return;
      const recipes = JSON.parse(raw);
      const source = recipes.find((r: any) => r.id === bake.recipeId);
      if (!source) return;
      const map: Record<string, any> = {};
      source.phases.forEach((p: any) => map[p.key] = { ingredients: p.ingredients, instructions: p.instructions });
      setSelectedBakeDetail(curr => curr?.id === bake.id ? (setBakeRecipeMap(map), curr) : curr);
    }).catch(() => {});
  };

  const printBakeDetail = async (bake: BakeHistoryEntry) => {
      const html = `<html><body><h2>${bake.recipeName}</h2><p>Started: ${new Date(bake.startedAt).toLocaleDateString()}</p></body></html>`;
      await SafePrint.printHtml(html);
  };

  const shareBakeDetail = async (bake: BakeHistoryEntry) => {
      const html = `<html><body><h2>${bake.recipeName}</h2></body></html>`;
      await SafePrint.sharePdf(html, bake.recipeName);
  };

  const selectedEntries = selectedDay !== null ? displayFeedDayMap[selectedDay.toString()] ?? [] : [];
  const selectedBakeEntries = selectedDay !== null ? bakeDayMap[selectedDay.toString()] ?? [] : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 100 + insets.bottom }]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadHistory} tintColor={colors.mutedForeground} />}>
        <Animated.View entering={FadeIn.duration(400)} style={styles.pageHeader}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={[styles.pageTitle, { color: colors.foreground }]}>Calendar</Text>
              <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>history and activity</Text>
              {lastSynced !== null && <SyncLabel ts={lastSynced} />}
            </View>
            <Pressable onPress={() => setShowAuthModal(true)} style={[styles.accountBtn, { borderColor: colors.border, backgroundColor: currentUser ? colors.primary + "15" : colors.card }]}>
              {currentUser ? <View style={[styles.avatarMini, { backgroundColor: colors.primary }]}><Text style={[styles.avatarMiniText, { color: colors.primaryForeground }]}>{currentUser.firstName?.[0]?.toUpperCase() ?? "?"}</Text></View> : <Feather name="user" size={16} color={colors.mutedForeground} />}
              <Text style={[styles.accountBtnText, { color: colors.mutedForeground }]}>{currentUser ? `${currentUser.firstName}'s Data` : "Name data"}</Text>
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{streak}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>day streak</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{totalThisMonth}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>this month</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          {(["all", "sugar", "ww"] as FeedFilter[]).map(f => (
            <Pressable key={f} onPress={() => { setFeedFilter(f); AsyncStorage.setItem(FEED_FILTER_KEY, f).catch(() => {}); setSelectedDay(null); }} style={[styles.filterChip, { backgroundColor: feedFilter === f ? colors.primary : colors.card, borderColor: feedFilter === f ? colors.primary : colors.border }]}>
              <Text style={[styles.filterChipText, { color: feedFilter === f ? colors.primaryForeground : colors.mutedForeground }]}>{f === "all" ? "All" : f === "sugar" ? "Sugar" : "WW Blend"}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.monthNav}>
            <Pressable onPress={() => setDisplayMonth(m => m === 0 ? 11 : m - 1)} hitSlop={12}><Feather name="chevron-left" size={22} color={colors.foreground} /></Pressable>
            <Text style={[styles.monthLabel, { color: colors.foreground }]}>{MONTH_NAMES[displayMonth]} {displayYear}</Text>
            <Pressable onPress={() => setDisplayMonth(m => m === 11 ? 0 : m + 1)} hitSlop={12}><Feather name="chevron-right" size={22} color={colors.foreground} /></Pressable>
          </View>
          <View style={styles.weekRow}>{WEEKDAYS.map((d, i) => <View key={i} style={styles.dayCell}><Text style={[styles.weekdayLabel, { color: colors.mutedForeground }]}>{d}</Text></View>)}</View>
          {calendarRows.map((row, ri) => (
            <View key={ri} style={styles.weekRow}>
              {row.map((day, di) => {
                if (day === null) return <View key={di} style={styles.dayCell} />;
                const hasFeed = !!displayFeedDayMap[day.toString()];
                const feedCount = displayFeedDayMap[day.toString()]?.length ?? 0;
                const hasBake = (bakeDayMap[day.toString()]?.length ?? 0) > 0;
                const isToday = now.getDate() === day && now.getMonth() === displayMonth && now.getFullYear() === displayYear;
                const isSelected = day === selectedDay;
                return (
                  <Pressable key={di} style={styles.dayCell} onPress={() => setSelectedDay(isSelected ? null : day)}>
                    <View style={[styles.dayInner, isSelected && { backgroundColor: colors.primary, borderRadius: 20 }, isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 20 }]}><Text style={[styles.dayNumber, { color: isSelected ? colors.primaryForeground : isToday ? colors.primary : colors.foreground, fontFamily: isToday ? fonts.sansSemiBold : fonts.sans }]}>{day}</Text></View>
                    {(hasFeed || hasBake) && (
                      <View style={styles.dotRow}>
                        {Array.from({ length: Math.min(feedCount, 2) }).map((_, i) => <View key={`f${i}`} style={[styles.dot, { backgroundColor: isSelected ? colors.primaryForeground : colors.accent }]} />)}
                        {hasBake && <View style={[styles.dot, { backgroundColor: isSelected ? colors.primaryForeground : colors.primary }]} />}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {selectedDay !== null && (
          <View style={{ marginTop: 20 }}>
            {selectedEntries.length === 0 && selectedBakeEntries.length === 0 ? (
              <View style={[styles.emptyDay, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.emptyDayText, { color: colors.mutedForeground }]}>No activity on {MONTH_NAMES[displayMonth]} {selectedDay}</Text></View>
            ) : (
              <>
              {selectedEntries.map((entry, idx) => (
                <Pressable key={`${entry.id}-${idx}`} onPress={() => setSelectedFeedDetail(entry)} style={({ pressed }) => [styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12, opacity: pressed ? 0.92 : 1 }]}>
                  <View style={styles.entryHeader}>
                    <Text style={[styles.entryTime, { color: colors.foreground }]}>{formatTime(entry.savedAt)}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {entry.peak && <View style={[styles.peakedBadge, { backgroundColor: colors.accent + "18", borderColor: colors.accent + "40" }]}><Ionicons name="checkmark-circle" size={12} color={colors.accent} /><Text style={[styles.peakedText, { color: colors.accent }]}>Peaked</Text></View>}
                      <Pressable onPress={() => deleteEntry(entry.id)} hitSlop={8}><Feather name="trash-2" size={14} color={colors.mutedForeground} /></Pressable>
                    </View>
                  </View>
                  <View style={styles.entryGrid}>
                    <View style={styles.entryGridItem}><Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.starterWeight}g</Text><Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Starter</Text></View>
                    <View style={styles.entryGridItem}><Text style={[styles.entryVal, { color: colors.primary }]}>{entry.ratioStr}</Text><Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Ratio</Text></View>
                    {entry.initialPH && <View style={styles.entryGridItem}><Text style={[styles.entryVal, { color: colors.foreground }]}>{entry.initialPH}</Text><Text style={[styles.entryLbl, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text></View>}
                    {entry.peak && (
                      <View style={styles.entryGridItem}><Text style={[styles.entryVal, { color: colors.accent }]}>+{entry.peak.volumeIncreasePct}%</Text><Text style={[styles.entryLbl, { color: colors.mutedForeground }]}>Rise</Text></View>
                    )}
                  </View>
                </Pressable>
              ))}
              {selectedBakeEntries.map((bake, idx) => (
                <Pressable key={`${bake.id}-${idx}`} onPress={() => openBakeDetail(bake)} style={({ pressed }) => [styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12, opacity: pressed ? 0.92 : 1 }]}>
                  <View style={styles.entryHeader}><View style={{ flex: 1 }}><Text style={[styles.entryTime, { color: colors.foreground }]}>{bake.recipeName}</Text><Text style={[styles.flourNote, { color: colors.mutedForeground, marginTop: 0 }]}>{formatTime(bake.savedAt)}</Text></View><Pressable onPress={() => deleteBakeEntry(bake.id)} hitSlop={8}><Feather name="trash-2" size={14} color={colors.mutedForeground} /></Pressable></View>
                </Pressable>
              ))}
              </>
            )}
          </View>
        )}

        {history.length === 0 && <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="calendar" size={32} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text></View>}
      </ScrollView>

      {/* Detail Modals outside ScrollView for better touch handling */}
      <Modal visible={selectedFeedDetail !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedFeedDetail(null)}>
        {selectedFeedDetail && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.detailHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
              <Pressable onPress={() => setSelectedFeedDetail(null)} hitSlop={12}><Ionicons name="close" size={22} color={colors.foreground} /></Pressable>
              <View style={{ flex: 1, alignItems: "center" }}><Text style={[styles.detailTitle, { color: colors.foreground }]}>Feed Session</Text><Text style={[styles.detailSubtitle, { color: colors.mutedForeground }]}>{new Date(selectedFeedDetail.savedAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {formatTime(selectedFeedDetail.savedAt)}</Text></View>
              <View style={{ flexDirection: "row", gap: 16 }}><Pressable onPress={() => shareFeedSession(selectedFeedDetail)}><Feather name="share" size={20} color={colors.primary} /></Pressable><Pressable onPress={() => printFeedSession(selectedFeedDetail)}><Feather name="printer" size={20} color={colors.primary} /></Pressable></View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
              <Text style={styles.detailSectionLabel}>Feed</Text>
              <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
                <View style={styles.entryGrid}>
                   <View style={styles.entryGridItem}><Text style={styles.entryVal}>{selectedFeedDetail.starterWeight}g</Text><Text style={styles.entryLbl}>Starter</Text></View>
                   <View style={styles.entryGridItem}><Text style={styles.entryVal}>{selectedFeedDetail.flourWeight}g</Text><Text style={styles.entryLbl}>Flour</Text></View>
                   <View style={styles.entryGridItem}><Text style={styles.entryVal}>{selectedFeedDetail.waterWeight}g</Text><Text style={styles.entryLbl}>Water</Text></View>
                   {selectedFeedDetail.initialPH && <View style={styles.entryGridItem}><Text style={styles.entryVal}>{selectedFeedDetail.initialPH}</Text><Text style={styles.entryLbl}>pH</Text></View>}
                </View>
                <Text style={styles.flourNote}>ratio {selectedFeedDetail.ratioStr}</Text>
              </View>
              {(selectedFeedDetail.readings ?? []).length > 0 && (
                <>
                <Text style={styles.detailSectionLabel}>pH Readings</Text>
                <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: 'hidden', marginBottom: 16 }]}>
                  {selectedFeedDetail.readings!.map((r, i) => (
                    <View key={i} style={[styles.detailReadingRow, { borderBottomWidth: i < selectedFeedDetail.readings!.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }]}>
                      <Text style={styles.detailReadingTime}>{Math.floor((r.loggedAt - selectedFeedDetail.savedAt) / 60000)}m</Text>
                      <View style={{ flex: 1 }}><Text style={styles.detailReadingPH}>pH {r.pH}</Text>{r.note ? <Text style={styles.detailReadingNote}>{r.note}</Text> : null}</View>
                      <Pressable onPress={() => deleteFeedReading(selectedFeedDetail.id, i)} hitSlop={8}><Feather name="trash-2" size={13} color={colors.mutedForeground} /></Pressable>
                    </View>
                  ))}
                </View>
                </>
              )}
              {selectedFeedDetail.peak && (
                 <>
                 <Text style={styles.detailSectionLabel}>Peak Results</Text>
                 <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
                    <View style={styles.entryGrid}>
                       <View style={styles.entryGridItem}><Text style={styles.entryVal}>{selectedFeedDetail.peak.pH}</Text><Text style={styles.entryLbl}>pH</Text></View>
                       <View style={styles.entryGridItem}><Text style={[styles.entryVal, { color: colors.accent }]}>+{selectedFeedDetail.peak.volumeIncreasePct}%</Text><Text style={styles.entryLbl}>Rise</Text></View>
                       <View style={styles.entryGridItem}><Text style={styles.entryVal}>{formatTimeToPeak(selectedFeedDetail.peak.timeToPeakMs)}</Text><Text style={styles.entryLbl}>Time</Text></View>
                    </View>
                 </View>
                 </>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>

      <Modal visible={selectedBakeDetail !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedBakeDetail(null)}>
        {selectedBakeDetail && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.detailHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
              <Pressable onPress={() => setSelectedBakeDetail(null)} hitSlop={12}><Ionicons name="close" size={22} color={colors.foreground} /></Pressable>
              <View style={{ flex: 1, alignItems: "center" }}><Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedBakeDetail.recipeName}</Text><Text style={[styles.detailSubtitle, { color: colors.mutedForeground }]}>{new Date(selectedBakeDetail.startedAt).toLocaleDateString()}</Text></View>
              <View style={{ flexDirection: "row", gap: 16 }}><Pressable onPress={() => shareBakeDetail(selectedBakeDetail)}><Feather name="share" size={20} color={colors.primary} /></Pressable><Pressable onPress={() => printBakeDetail(selectedBakeDetail)}><Feather name="printer" size={20} color={colors.primary} /></Pressable></View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
              {selectedBakeDetail.notes ? <View style={[styles.entryCard, { marginBottom: 16 }]}><Text style={styles.detailNoteText}>{selectedBakeDetail.notes}</Text></View> : null}
              <Text style={styles.detailSectionLabel}>Phases</Text>
              {selectedBakeDetail.phases.map((p, i) => {
                const ingredients = p.ingredients || bakeRecipeMap[p.key]?.ingredients;
                const instructions = p.instructions || bakeRecipeMap[p.key]?.instructions;
                return (
                  <View key={i} style={[styles.entryCard, { marginBottom: 10, borderColor: p.completedAt ? colors.primary + "30" : colors.border }]}>
                    <View style={styles.entryHeader}><Text style={styles.entryTime}>{p.name}</Text></View>
                    {ingredients ? <View style={{ marginBottom: 8 }}><Text style={[styles.entryLbl, { marginBottom: 2 }]}>Ingredients</Text><Text style={styles.detailNoteText}>{ensureString(ingredients)}</Text></View> : null}
                    {instructions ? <View style={{ marginBottom: 8 }}><Text style={[styles.entryLbl, { marginBottom: 2 }]}>Instructions</Text><Text style={styles.detailNoteText}>{ensureString(instructions)}</Text></View> : null}
                    {(p.readings ?? []).length > 0 && (
                      <View style={[styles.peakBlock, { borderTopColor: colors.border }]}>
                        {p.readings!.map((r, ri) => (
                          <View key={ri} style={styles.detailReadingRow}>
                             <Text style={styles.detailReadingTime}>{formatTime(r.loggedAt)}</Text>
                             <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                               {r.pH ? <Text style={styles.detailReadingPH}>pH {r.pH}</Text> : null}
                               {r.temp ? <Text style={styles.detailReadingNote}>{r.temp}°{r.tempUnit}</Text> : null}
                             </View>
                             <Pressable onPress={() => deleteBakeReading(selectedBakeDetail.id, p.key, r.id, ri)} hitSlop={8}><Feather name="trash-2" size={13} color={colors.mutedForeground} /></Pressable>
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

      <AuthModal visible={showAuthModal} currentUser={currentUser} onClose={() => setShowAuthModal(false)} onAuthChange={(user) => { setCurrentUser(user); loadHistory(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 100 },
  pageHeader: { marginBottom: spacing.lg },
  accountBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, marginTop: spacing.xs },
  accountBtnText: { fontFamily: fonts.sansMedium, fontSize: 13 },
  avatarMini: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarMiniText: { fontFamily: fonts.sansSemiBold, fontSize: 10 },
  pageTitle: { ...typography.headlineLgMobile, letterSpacing: -0.5 },
  pageSubtitle: { fontFamily: fonts.sans, fontSize: 14, marginTop: 2, letterSpacing: 0.2 },
  syncLabel: { fontFamily: fonts.sans, fontSize: 11, marginTop: spacing.xs, letterSpacing: 0.2, opacity: 0.7 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: spacing.md },
  filterRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1 },
  filterChipText: { fontFamily: fonts.sansMedium, fontSize: 13 },
  statCard: { flex: 1, borderRadius: radius.lg, borderWidth: 1, paddingVertical: 14, alignItems: "center" },
  statValue: { fontFamily: fonts.mono, fontSize: 22, letterSpacing: -0.5 },
  statLabel: { fontFamily: fonts.sans, fontSize: 11, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  calendarCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md },
  monthNav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  monthLabel: { fontFamily: fonts.serifBold, fontSize: 17, letterSpacing: -0.2 },
  weekRow: { flexDirection: "row" },
  dayCell: { flex: 1, alignItems: "center", paddingVertical: 3 },
  weekdayLabel: { fontFamily: fonts.sansMedium, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.3, paddingBottom: spacing.sm },
  dayInner: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  dayNumber: { fontSize: 14 },
  dotRow: { flexDirection: "row", gap: 2, marginTop: 2, height: 6, alignItems: "center" },
  dot: { width: 5, height: 5, borderRadius: 3 },
  emptyDay: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, alignItems: "center" },
  emptyDayText: { fontFamily: fonts.sans, fontSize: 14 },
  entryCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  entryTime: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  peakedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, borderWidth: 1 },
  peakedText: { fontFamily: fonts.sansSemiBold, fontSize: 11 },
  entryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  entryGridItem: { alignItems: "center", minWidth: 56 },
  entryVal: { fontFamily: fonts.mono, fontSize: 18 },
  entryLbl: { fontFamily: fonts.sans, fontSize: 11, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 },
  flourNote: { ...typography.metaLabel, marginTop: 10, letterSpacing: 0.2 },
  peakBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  emptyState: { borderRadius: radius.lg, borderWidth: 1, padding: 32, alignItems: "center", gap: 12, marginTop: 4 },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 17 },
  detailHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  detailTitle: { fontFamily: fonts.serifBold, fontSize: 16 },
  detailSubtitle: { ...typography.metaLabel, marginTop: 2 },
  detailSectionLabel: { ...typography.sectionLabel, marginBottom: spacing.sm },
  detailReadingRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.sm, paddingHorizontal: 14, gap: 10 },
  detailReadingTime: { fontFamily: fonts.mono, fontSize: 12, minWidth: 52, paddingTop: 1 },
  detailReadingPH: { fontFamily: fonts.mono, fontSize: 15 },
  detailReadingNote: { fontFamily: fonts.sans, fontSize: 12 },
  detailNoteText: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
});