import React, { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

import { api } from "@/lib/api";
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

export default function FeedScreen() {
  const colors = useColors();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // --- Core State ---
  const [session, setSession] = useState<FeedSession | null>(null);
  const [historyData, setHistoryData] = useState<FeedSession[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  // --- Initial Load & Migrations ---
  useEffect(() => {
    const init = async () => {
      try {
        // Load Active Session
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          let s: FeedSession = JSON.parse(stored);
          if (s.readings?.some((r) => r.temp && !r.tempUnit)) {
            s.readings = patchReadingsTempUnit(s.readings);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
          }
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
    const completed: FeedSession = { ...s, completedAt: Date.now() };
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
          startedAt: null,
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
    const newSession: FeedSession = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      ...data,
      ratioStr: calcRatioStr(sw, data.flourWeight, data.waterWeight, data.sugarWeight),
      savedAt: Date.now(),
      readings: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleLogReading = async (reading: Reading) => {
    if (!session) return;
    const updated = { ...session, readings: [...(session.readings || []), reading] };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSession(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
        <FeedSetupView onStartFeed={handleStartFeed} />
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