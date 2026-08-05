// artifacts/sourdough/components/bench/ActiveFeedSection.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, View, StyleSheet, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { fonts } from "@/constants/theme";

const STORAGE_KEY = "sourdough_feed_session_v1";
const HISTORY_KEY = "sourdough_feed_history_v1";
const NUDGE_KEY = "bread_lab_name_nudge_shown_v1";
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

// STITCH: New Starter Bridge
const NEW_STARTER_KEY = "bread_lab_is_new_starter_v1";
const DAY_COUNTER_KEY = "bread_lab_current_day_v1";

export function ActiveFeedSection({
  incomingStarter,
  incomingFlour,
  incomingWater,
  autoStart
}: {
  incomingStarter?: string;
  incomingFlour?: string;
  incomingWater?: string;
  autoStart?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // --- Core State ---
  const [session, setSession] = useState<FeedSession | null>(null);
  const [historyData, setHistoryData] = useState<FeedSession[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  // New Starter State
  const [isNewStarter, setIsNewStarter] = useState(false);
  const [currentDay, setCurrentDay] = useState(1);

  const sessionRef = useRef<FeedSession | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // --- Sync Logic ---
  const syncActiveSession = useCallback(async (knownLocal?: FeedSession | null) => {
    const local = knownLocal !== undefined ? knownLocal : sessionRef.current;
    try {
      const [deviceId, userId] = await Promise.all([getDeviceId(), getStoredToken().catch(() => null)]);
      if (local) {
        const remoteCopy = await api.history.feed.get(local.id).catch(() => null);
        if (remoteCopy && remoteCopy.inProgress === false) {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setSession(null);
          return;
        }
        // Logic to pick freshest and push
        reportSyncStart();
        await api.history.feed.upsert({
          id: local.id,
          deviceId,
          userId: userId ?? undefined,
          savedAt: local.savedAt,
          startedAt: local.savedAt,
          updatedAt: local.updatedAt ?? local.savedAt,
          inProgress: true,
          data: local as any,
        });
        reportSyncSuccess();
      }
    } catch (e) { reportSyncFailure(); }
  }, [reportSyncStart, reportSyncSuccess, reportSyncFailure]);

  useEffect(() => {
    const init = async () => {
      const [stored, histRaw, user, starterMode, day] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(HISTORY_KEY),
        getStoredUser(),
        AsyncStorage.getItem(NEW_STARTER_KEY),
        AsyncStorage.getItem(DAY_COUNTER_KEY)
      ]);

      let currentSession: FeedSession | null = null;
      if (stored) {
        currentSession = JSON.parse(stored);
      } else {
        // HYDRATION: Fetch from Supabase if local is empty
        try {
          const [deviceId, userId] = await Promise.all([getDeviceId(), getStoredToken().catch(() => null)]);
          const remote = await api.history.feed.active(deviceId, userId ?? undefined);
          if (remote) {
            currentSession = remote.data as unknown as FeedSession;
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentSession));
          }
        } catch (e) {
          console.warn("[Feed] Failed to hydrate remote active session", e);
        }
      }

      if (currentSession) setSession(currentSession);
      if (histRaw) setHistoryData(JSON.parse(histRaw));
      if (user) setCurrentUser(user);
      if (starterMode === "1") setIsNewStarter(true);
      if (day) setCurrentDay(parseInt(day));

      if (currentSession) {
        syncActiveSession(currentSession);
      }
    };
    init();
  }, [syncActiveSession]);

  // --- Handlers ---
  const handleStartFeed = async (data: any) => {
    const sw = parseFloat(data.starterWeight);
    const now = Date.now();

    // Trigger "New Starter?" prompt if it's the very first feed ever
    if (historyData.length === 0 && !isNewStarter) {
        Alert.alert("New Starter?", "Are you starting a brand new culture from scratch?", [
            { text: "No, established", onPress: () => startSession(data, false) },
            { text: "Yes, Day 1", onPress: () => {
                setIsNewStarter(true);
                setCurrentDay(1);
                AsyncStorage.setItem(NEW_STARTER_KEY, "1");
                AsyncStorage.setItem(DAY_COUNTER_KEY, "1");
                startSession({ ...data, starterWeight: "0", flourWeight: 50, waterWeight: 50 }, true);
            }}
        ]);
    } else {
        startSession(data, isNewStarter);
    }
  };

  useEffect(() => {
      if (autoStart && incomingStarter && !session) {
        handleStartFeed({
          starterWeight: incomingStarter,
          flourWeight: parseFloat(incomingFlour || "0"),
          waterWeight: parseFloat(incomingWater || "0"),
          initialVolume: "100",
        });
      }
    }, [autoStart, incomingStarter]);

  const startSession = async (data: any, isNew: boolean) => {
    const now = Date.now();
    const newSession: FeedSession = {
      id: now.toString() + Math.random().toString(36).substr(2, 9),
      ...data,
      ratioStr: isNew ? "1:1" : calcRatioStr(parseFloat(data.starterWeight), data.flourWeight, data.waterWeight, data.sugarWeight),
      savedAt: now,
      updatedAt: now,
      readings: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    syncActiveSession(newSession);
  };

  const handleSavePeak = async (peak: PeakData) => {
    if (!session) return;
    if (isNewStarter) {
        // "Progress Day" Logic
        const nextDay = currentDay + 1;
        setCurrentDay(nextDay);
        await AsyncStorage.setItem(DAY_COUNTER_KEY, nextDay.toString());

        // Save current day to history as a "snapshot"
        const completed = { ...session, peak, completedAt: Date.now(), updatedAt: Date.now() };
        const stored = await AsyncStorage.getItem(HISTORY_KEY);
        const existing = stored ? JSON.parse(stored) : [];
        existing.unshift(completed);
        const historyTrimmed = existing.slice(0, 500);
        setHistoryData(historyTrimmed);
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyTrimmed));

        // Reset for next day instructions
        const nextInstructions = {
            starterWeight: "25",
            flourWeight: 25,
            waterWeight: 25,
            initialVolume: "50", // placeholder
        };
        startSession(nextInstructions, true);
        Alert.alert(`Day ${nextDay} Started`, "Discard down to 25g starter and add 25g flour + 25g water.");
    } else {
        // COMPLETION: Mark as closed and save to history
        const completed = { ...session, peak, completedAt: Date.now(), updatedAt: Date.now(), savedToHistory: true };

        // 1. Save to local history
        const stored = await AsyncStorage.getItem(HISTORY_KEY);
        const existing = stored ? JSON.parse(stored) : [];
        existing.unshift(completed);
        const historyTrimmed = existing.slice(0, 500);
        setHistoryData(historyTrimmed);
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyTrimmed));

        // 2. Clear active local
        await AsyncStorage.removeItem(STORAGE_KEY);
        setSession(null);

        // 3. Sync to remote (marked as completed with inProgress: false)
        try {
          const [deviceId, userId] = await Promise.all([getDeviceId(), getStoredToken().catch(() => null)]);
          reportSyncStart();
          await api.history.feed.upsert({
            id: completed.id,
            deviceId,
            userId: userId ?? undefined,
            savedAt: completed.savedAt,
            startedAt: completed.savedAt,
            updatedAt: completed.updatedAt,
            inProgress: false, // CRITICAL: marks session as closed
            data: completed as any,
          });
          reportSyncSuccess();
        } catch (e) {
          reportSyncFailure();
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {isNewStarter && session && (
          <View style={[s.dayBanner, { backgroundColor: colors.accent + "15", paddingTop: insets.top }]}>
             <Text style={[s.dayText, { color: colors.accent }]}>New Culture: Day {currentDay}</Text>
          </View>
      )}
      {session ? (
        <FeedActiveSessionView
          session={session}
          historyData={historyData}
          onLogReading={(r) => {
            if (!session) return;
            // PERSISTENCE: Update local state and sync reading
            const updated = {
              ...session,
              readings: [...(session.readings || []), r],
              updatedAt: Date.now(),
            };
            setSession(updated);
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            syncActiveSession(updated);
          }}
          onSavePeak={handleSavePeak}
          onClearSession={() => {
            const doClear = async () => {
              if (session) {
                // CLEANUP: Remove from remote as well to avoid orphaning
                const [deviceId, userId] = await Promise.all([getDeviceId(), getStoredToken().catch(() => null)]);
                api.history.feed.delete(session.id, deviceId, userId ?? undefined).catch(() => {});
              }
              setSession(null);
              AsyncStorage.removeItem(STORAGE_KEY);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            };

            Alert.alert("Abandon Feed?", "This will remove the current active tracker. You can also 'Mark as Peak' to save it to history instead.", [
              { text: "Cancel", style: "cancel" },
              { text: "Discard", style: "destructive", onPress: doClear }
            ]);
          }}
        />
      ) : (
        <FeedSetupView onStartFeed={handleStartFeed} historyData={historyData} />
      )}

      <AuthModal visible={showAuthModal} currentUser={currentUser} onClose={() => setShowAuthModal(false)} onAuthChange={setCurrentUser} />
    </View>
  );
}

const s = StyleSheet.create({
  dayBanner: { padding: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  dayText: { fontFamily: fonts.sansSemiBold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
});