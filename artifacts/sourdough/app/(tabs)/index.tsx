import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

import { api, type ApiFeedSession } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import type { SessionForAnalytics } from "@/lib/analytics";
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";

import AuthModal from "@/components/AuthModal";
import NudgeBanner from "@/components/NudgeBanner";
import FeedActiveSessionView from "@/components/feed/FeedActiveSessionView";
import FeedSetupView from "@/components/feed/FeedSetupView";

import { FeedSession, Reading, PeakData } from "@/types/feed";
import { patchReadingsTempUnit, calcRatioStr } from "@/lib/feedUtils";

const STORAGE_KEY = "sourdough_feed_session_v1";
const HISTORY_KEY = "sourdough_feed_history_v1";
const NUDGE_KEY = "bread_lab_name_nudge_shown_v1";
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── Cross-device sync helpers ───────────────────────────────────────────────

/** Last-write-wins: whoever touched the session most recently, wins. */
function pickFreshest(
  local: FeedSession | null,
  remote: ApiFeedSession | null
): FeedSession | null {
  if (!remote) return local;
  const remoteSession = remote.data as FeedSession;
  if (!local) return remoteSession;
  const localTime = local.updatedAt ?? local.savedAt;
  const remoteTime = remote.updatedAt ?? remote.savedAt;
  return remoteTime > localTime ? remoteSession : local;
}

async function pushActiveSession(
  deviceId: string,
  userId: string | null,
  s: FeedSession
) {
  await api.history.feed.upsert({
    id: s.id,
    deviceId,
    userId: userId ?? undefined,
    savedAt: s.savedAt,
    startedAt: s.savedAt,
    updatedAt: s.updatedAt ?? s.savedAt,
    inProgress: true,
    data: s as unknown as Record<string, unknown>,
  });
}

export default function FeedScreen() {
  const colors = useColors();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // --- Core State ---
  const [session, setSession] = useState<FeedSession | null>(null);
  const [historyData, setHistoryData] = useState<FeedSession[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  // Kept in sync with `session` so the interval/AppState callbacks (created
  // once) always see the latest value instead of a stale closure.
  const sessionRef = useRef<FeedSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // --- Cross-device active-session sync ---
  const syncActiveSession = useCallback(
    async (knownLocal?: FeedSession | null) => {
      const local = knownLocal !== undefined ? knownLocal : sessionRef.current;

      try {
        const [deviceId, userId] = await Promise.all([
          getDeviceId(),
          getStoredToken().catch(() => null),
        ]);

        if (local) {
          // Check what the server thinks of OUR session — this is how we
          // find out it was finished/cleared on another device.
          const remoteCopy = await api.history.feed.get(local.id).catch(() => null);

          if (remoteCopy && remoteCopy.inProgress === false) {
            await AsyncStorage.removeItem(STORAGE_KEY);
            setSession(null);
            return;
          }

          const winner = pickFreshest(local, remoteCopy);
          if (winner !== local) {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(winner));
            setSession(winner);
          } else {
            reportSyncStart();
            await pushActiveSession(deviceId, userId, local);
            reportSyncSuccess();
          }
        } else {
          // Nothing active locally — see if this identity has a session
          // running on another device.
          const remoteActive = await api.history.feed.active(deviceId, userId ?? undefined);
          if (remoteActive) {
            const remoteSession = remoteActive.data as FeedSession;
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remoteSession));
            setSession(remoteSession);
          }
        }
      } catch (e) {
        reportSyncFailure();
      }
    },
    [reportSyncStart, reportSyncSuccess, reportSyncFailure]
  );

  // Periodic background sync while the app is open
  useEffect(() => {
    const interval = setInterval(() => {
      syncActiveSession();
    }, session ? 30_000 : SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [syncActiveSession]);

  // Re-check immediately when the app returns to the foreground — this is
  // what makes "started on web, opened my phone a minute later" feel instant.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") syncActiveSession();
    });
    return () => sub.remove();
  }, [syncActiveSession]);

  // --- Initial Load & Migrations ---
  useEffect(() => {
    const init = async () => {
      try {
        // Load Active Session
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        let loadedSession: FeedSession | null = null;
        if (stored) {
          let s: FeedSession = JSON.parse(stored);
          if (s.readings?.some((r) => r.temp && !r.tempUnit)) {
            s.readings = patchReadingsTempUnit(s.readings);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
          }
          loadedSession = s;
          setSession(s);
        }

        // Load & Migrate History
        const histRaw = await AsyncStorage.getItem(HISTORY_KEY);
        if (histRaw) {
          const hist: FeedSession[] = JSON.parse(histRaw);
          let needsWrite = false;
          const migrated = hist.map((sess) => {
            if (sess.readings?.some((r) => r.temp && !r.tempUnit)) {
              needsWrite = true;
              return { ...sess, readings: patchReadingsTempUnit(sess.readings!) };
            }
            return sess;
          });
          if (needsWrite) {
            await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(migrated));
          }
          setHistoryData(migrated);
        }

        // Load User
        const user = await getStoredUser();
        setCurrentUser(user);

        // Reconcile with any other device the moment we open the app
        syncActiveSession(loadedSession);
      } catch (e) {}
    };
    init();
  }, []);

  // --- Persistence Handlers ---
  const checkAndShowNudge = async () => {
    try {
      const nudgeShown = await AsyncStorage.getItem(NUDGE_KEY);
      if (nudgeShown || currentUser || historyData.length !== 1) return;
      await AsyncStorage.setItem(NUDGE_KEY, "1");
      setShowNudge(true);
    } catch {}
  };

  const saveToHistory = async (s: FeedSession) => {
    const completed: FeedSession = { ...s, completedAt: Date.now(), updatedAt: Date.now() };
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const existing: FeedSession[] = stored ? JSON.parse(stored) : [];
      existing.unshift(completed);
      const newHistory = existing.slice(0, 500);
      setHistoryData(newHistory);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch (e) {}

    // Cloud Sync
    reportSyncStart();
    const forAnalytics: SessionForAnalytics = {
      savedAt: completed.savedAt,
      readings: completed.readings,
      initialPH: completed.initialPH,
    };
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.history.feed.upsert({
          id: completed.id,
          deviceId,
          userId: userId ?? undefined,
          savedAt: completed.savedAt,
          startedAt: completed.savedAt,
          updatedAt: completed.updatedAt,
          inProgress: false,
          data: completed as unknown as Record<string, unknown>,
        }).then(() => api.analytics.updateStarter(deviceId, forAnalytics).catch(() => {}))
      )
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  // --- Component Callbacks ---
  const handleStartFeed = async (data: {
    starterWeight: string;
    flourWeight: number;
    waterWeight: number;
    wwPercent: number;
    initialPH: string;
    initialTemp: string;
    initialTempUnit: "F" | "C";
    initialVolume: string;
    fedPhoto: string | null;
    sugarWeight?: number;
  }) => {
    const sw = parseFloat(data.starterWeight);
    const now = Date.now();
    const newSession: FeedSession = {
      id: now.toString() + Math.random().toString(36).substr(2, 9),
      ...data,
      ratioStr: calcRatioStr(sw, data.flourWeight, data.waterWeight, data.sugarWeight),
      savedAt: now,
      updatedAt: now,
      readings: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Push right away so other devices don't have to wait the full 15
    // minutes for the *first* sighting of this session.
    const [deviceId, userId] = await Promise.all([
      getDeviceId(),
      getStoredToken().catch(() => null),
    ]);
    reportSyncStart();
    pushActiveSession(deviceId, userId, newSession)
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  const handleLogReading = async (reading: Reading) => {
    if (!session) return;
    const updated = {
      ...session,
      readings: [...(session.readings || []), reading],
      updatedAt: Date.now(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSession(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Not pushed immediately — picked up by the 15-min interval / next foreground.
  };

  const handleSavePeak = async (peak: PeakData) => {
    if (!session) return;
    const updated = { ...session, peak, savedToHistory: true };
    await saveToHistory(updated);
    await AsyncStorage.removeItem(STORAGE_KEY);
    setSession(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    checkAndShowNudge();
  };

  const handleClearSession = () => {
    Alert.alert("New Feed Session", "Clear this session and start fresh?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "New Session",
        style: "destructive",
        onPress: async () => {
          if (session && !session.savedToHistory) await saveToHistory(session);
          await AsyncStorage.removeItem(STORAGE_KEY);
          setSession(null);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          checkAndShowNudge();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {session ? (
        <FeedActiveSessionView
          session={session}
          historyData={historyData}
          onLogReading={handleLogReading}
          onSavePeak={handleSavePeak}
          onClearSession={handleClearSession}
        />
      ) : (
        <FeedSetupView
          onStartFeed={handleStartFeed}
          historyData={historyData}
        />
      )}

      {showNudge && (
        <NudgeBanner
          onNameMyData={() => setShowAuthModal(true)}
          onDismiss={() => setShowNudge(false)}
        />
      )}

      <AuthModal
        visible={showAuthModal}
        currentUser={currentUser}
        onClose={() => setShowAuthModal(false)}
        onAuthChange={(user) => {
          setCurrentUser(user);
          if (user) setShowNudge(false);
        }}
      />
    </View>
  );
}