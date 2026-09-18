// artifacts/sourdough/components/bench/ActiveFeedSection.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View, StyleSheet, Modal, Text, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";

import AuthModal from "@/components/AuthModal";
import FeedActiveSessionView from "@/components/feed/FeedActiveSessionView";
import FeedSetupView from "@/components/feed/FeedSetupView";

import { FeedSession, Reading, PeakData } from "@/types/feed";
import { calcRatioStr, checkGraduationEligibility } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Ionicons } from "@expo/vector-icons"; // Added for Day 2 button icon

const STORAGE_KEY = "sourdough_feed_session_v1";
const HISTORY_KEY = "sourdough_feed_history_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const DECLINED_TUTORIAL_KEY = "bread_lab_declined_tutorial_v1";

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
  const {
    starterTutorialMode, setStarterTutorialMode,
    tutorialDay, setTutorialDay,
    baselineVolume, setBaselineVolume,
    tutorialMetadata, setTutorialMetadata
  } = usePreferences();

  // --- Core State ---
  const [session, setSession] = useState<FeedSession | null>(null);
  const [historyData, setHistoryData] = useState<FeedSession[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasDeclinedTutorial, setHasDeclinedTutorial] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showGraduationModal, setShowGraduationModal] = useState(false);

  const isEligibleForGraduation = React.useMemo(() => checkGraduationEligibility(historyData), [historyData]);

  useEffect(() => {
    if (starterTutorialMode && isEligibleForGraduation && !showGraduationModal) {
      setShowGraduationModal(true);
    }
  }, [starterTutorialMode, isEligibleForGraduation, showGraduationModal]);

  const sessionRef = useRef<FeedSession | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // --- Sync Logic ---
  const syncActiveSession = useCallback(async (knownLocal?: FeedSession | null) => {
    if (starterTutorialMode) return; // Skip remote sync in tutorial mode

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
  }, [reportSyncStart, reportSyncSuccess, reportSyncFailure, starterTutorialMode]);

  useEffect(() => {
    const init = async () => {
      const [stored, histRaw, bakeHistRaw, user, declined] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(BAKE_HISTORY_KEY),
        getStoredUser(),
        AsyncStorage.getItem(DECLINED_TUTORIAL_KEY),
      ]);

      if (declined === "true") setHasDeclinedTutorial(true);

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

      let historyArray: FeedSession[] = [];
      if (histRaw) {
        try {
          const parsed = JSON.parse(histRaw);
          if (Array.isArray(parsed)) {
            historyArray = parsed;
            setHistoryData(parsed);
          }
        } catch (e) {
          console.warn("[Feed] Failed to parse history", e);
        }
      }
      if (user) setCurrentUser(user);

      if (currentSession) {
        setSession(currentSession);
        syncActiveSession(currentSession);
      }

      // --- NEW: Robust Onboarding Check ---
      // We only show the "New Culture" prompt if:
      // 1. Not already in tutorial mode
      // 2. Haven't declined it before
      // 3. No active session exists
      // 4. No feed history exists
      // 5. No bake history exists (established baker)
      // 6. User is not logged in (returning user)
      const hasBakes = bakeHistRaw && JSON.parse(bakeHistRaw).length > 0;
      const shouldPrompt = !starterTutorialMode &&
                           declined !== "true" &&
                           !currentSession &&
                           historyArray.length === 0 &&
                           !hasBakes &&
                           !user;

      if (shouldPrompt) {
        Alert.alert(
          "Would you like to start a new culture?",
          "It looks like your feed history is empty. Would you like a guided tutorial to establish a new starter?",
          [
            {
              text: "No thanks",
              style: "cancel",
              onPress: () => {
                setHasDeclinedTutorial(true);
                AsyncStorage.setItem(DECLINED_TUTORIAL_KEY, "true");
              }
            },
            {
              text: "Let's begin!",
              onPress: () => {
                setStarterTutorialMode(true);
                setTutorialDay(1);
              }
            }
          ]
        );
      }

      setIsLoaded(true);
    };
    init();
  }, [syncActiveSession]);

  // --- Handlers ---
  const handleStartFeed = async (data: any) => {
    const now = Date.now();
    const isNew = starterTutorialMode;

    if (starterTutorialMode && tutorialDay === 1) {
      setBaselineVolume(parseFloat(data.initialVolume) || 0);
    }

    const newSession: FeedSession = {
      id: now.toString() + Math.random().toString(36).substr(2, 9),
      ...data,
      ratioStr: isNew ? (tutorialDay === 1 ? "0:1:1" : "1:1:1") : calcRatioStr(parseFloat(data.starterWeight), data.flourWeight, data.waterWeight, data.sugarWeight),
      savedAt: now,
      updatedAt: now,
      readings: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    syncActiveSession(newSession);
  };

  const handleConfirmStir = async () => {
    const now = Date.now();
    const stirSession: FeedSession = {
      id: "stir-" + now.toString(),
      starterWeight: "N/A",
      flourWeight: 0,
      waterWeight: 0,
      wwPercent: 0,
      initialPH: "",
      initialTemp: "",
      initialTempUnit: "F",
      initialVolume: String(baselineVolume),
      fedPhoto: null,
      ratioStr: "STIR PHASE",
      savedAt: now,
      updatedAt: now,
      readings: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stirSession));
    setSession(stirSession);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSavePeak = async (peak: PeakData) => {
    if (!session) return;

    // Save to local history as a snapshot
    const completed = {
      ...session,
      peak,
      completedAt: Date.now(),
      updatedAt: Date.now(),
      isTutorialSnapshot: starterTutorialMode
    };

    const stored = await AsyncStorage.getItem(HISTORY_KEY);
    let existing = [];
    try {
      const parsed = stored ? JSON.parse(stored) : [];
      existing = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("[Feed] Failed to parse history during save", e);
    }

    existing.unshift(completed);
    const historyTrimmed = existing.slice(0, 500);
    setHistoryData(historyTrimmed);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyTrimmed));

    if (!starterTutorialMode) {
      // Normal Mode: Persist to remote and clear active session
      await AsyncStorage.removeItem(STORAGE_KEY);
      setSession(null);

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
          inProgress: false,
          data: completed as any,
        });
        reportSyncSuccess();
      } catch (e) {
        reportSyncFailure();
      }
    } else {
      // Tutorial Mode: Keep session active until manual progression
      const updated = { ...session, peak, updatedAt: Date.now() };
      setSession(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleProgressDay = async () => {
    // Mandate volume for Day 5+
    if (starterTutorialMode && tutorialDay >= 5) {
      const hasFinalVolume = session?.peak?.volume || (session?.readings && session.readings.length > 0 && session.readings[session.readings.length - 1].volume);
      if (!hasFinalVolume) {
        Alert.alert("Final Volume Required", "From Day 5 onwards, you must record the starter's volume just before discarding and feeding for the next day.");
        return;
      }
    }

    const nextDay = tutorialDay + 1;
    setTutorialDay(nextDay);
    await AsyncStorage.removeItem(STORAGE_KEY);
    setSession(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleGraduate = () => {
    Alert.alert(
      "Graduate Starter?",
      "This will turn off Tutorial Mode and move you to established baker tracking.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Graduate",
          onPress: () => {
            setStarterTutorialMode(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      ]
    );
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
  }, [autoStart, incomingStarter, session]);

  return (
    <View style={{ flex: 1 }}>
      {session ? (
        <FeedActiveSessionView
          session={session}
          historyData={historyData}
          onLogReading={(r) => {
            if (!session) return;
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
                const [deviceId, userId] = await Promise.all([getDeviceId(), getStoredToken().catch(() => null)]);
                api.history.feed.delete(session.id, deviceId, userId ?? undefined).catch(() => {});
              }
              setSession(null);
              AsyncStorage.removeItem(STORAGE_KEY);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            };

            Alert.alert("Abandon Feed?", "This will remove the current active tracker.", [
              { text: "Cancel", style: "cancel" },
              { text: "Discard", style: "destructive", onPress: doClear }
            ]);
          }}
          onProgressDay={handleProgressDay}
          onGraduate={handleGraduate}
        />
      ) : (
        starterTutorialMode && tutorialDay === 2 ? (
          <View style={[styles.stirContainer, { backgroundColor: colors.background, paddingTop: insets.top + 60 }]}>
            <Ionicons name="reload" size={80} color={colors.primary} style={{ marginBottom: 24 }} />
            <Text selectable={true} style={[styles.stirTitle, { color: colors.foreground }]}>Day 2: Stir Phase</Text>
            <Text selectable={true} style={[styles.stirBody, { color: colors.mutedForeground }]}>
              DO NOT FEED TODAY. Stir your mixture vigorously for 30 seconds to introduce fresh oxygen and disrupt mold. Re-cover loosely.
            </Text>
            <Pressable
              onPress={handleConfirmStir}
              style={({ pressed }) => [styles.stirBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.stirBtnText, { color: colors.primaryForeground }]}>Confirm Vigorous Stir</Text>
            </Pressable>
          </View>
        ) : (
          <FeedSetupView onStartFeed={handleStartFeed} historyData={historyData} />
        )
      )}

      <AuthModal visible={showAuthModal} currentUser={currentUser} onClose={() => setShowAuthModal(false)} onAuthChange={setCurrentUser} />

      <Modal visible={showGraduationModal} animationType="slide" transparent={true}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 32, alignItems: 'center' }}>
            <Ionicons name="school-outline" size={80} color={colors.primary} style={{ marginBottom: 20 }} />
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.foreground, textAlign: 'center', marginBottom: 12 }}>Congratulations! 🎓</Text>
            <Text style={{ fontSize: 16, color: colors.mutedForeground, textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
              Your starter has reliably doubled in height within 8 hours for 3 consecutive cycles. It is officially established and ready for baking!
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 12 }}>
              <Pressable
                onPress={() => { setShowGraduationModal(false); handleGraduate(); }}
                style={({ pressed }) => [{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 16 }}>Graduate & Unlock Full App</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowGraduationModal(false)}
                style={({ pressed }) => [{ backgroundColor: colors.muted, borderRadius: 12, paddingVertical: 16, alignItems: 'center', opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={{ color: colors.mutedForeground, fontWeight: '600', fontSize: 14 }}>Keep Tracking in Tutorial Mode</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  stirContainer: { flex: 1, alignItems: 'center', paddingHorizontal: 40 },
  stirTitle: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  stirBody: { fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  stirBtn: { paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12 },
  stirBtnText: { fontSize: 16, fontWeight: '600' }
});
