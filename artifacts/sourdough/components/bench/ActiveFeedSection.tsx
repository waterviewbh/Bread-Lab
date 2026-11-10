// artifacts/sourdough/components/bench/ActiveFeedSection.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View, StyleSheet, Modal, Text, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getStoredUser, type AuthUser } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";

import AuthModal from "@/components/AuthModal";
import FeedActiveSessionView from "@/components/feed/FeedActiveSessionView";
import FeedSetupView from "@/components/feed/FeedSetupView";

import { FeedSession, Reading, PeakData } from "@/types/feed";
import { calcRatioStr, checkGraduationEligibility } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Ionicons } from "@expo/vector-icons"; // Added for Day 2 button icon
import { useFocusEffect } from "expo-router";
import {
  processPendingDeletions,
  getWorkspaceIdentity,
  type WorkspaceOperationContext,
} from "@/lib/recipeStorage";
import { storageMutex, subscribeToWorkspaceChange } from "@/lib/storageUtils";
import { isNlaOwner } from "@/lib/nlaBoundary";

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

  // --- Workspace isolation (active Feed work is device-local and never synced) ---
  // The workspace (account + generation) the in-memory session was loaded or created in. A session
  // is only ever persisted while it still belongs to the current workspace; otherwise it is
  // dropped from view and nothing is written. It is never relabelled into the new workspace.
  const identityRef = useRef<WorkspaceOperationContext | null>(null);
  // Counts successful local writes so a slow init() cannot overwrite a newer local edit.
  const localEditsRef = useRef(0);
  const initRef = useRef<(() => Promise<void>) | null>(null);
  const onboardingPromptOpenRef = useRef(false);

  const sessionBelongsHere = async (): Promise<boolean> => {
    const held = identityRef.current;
    if (!held) return false;
    try {
      const now = await getWorkspaceIdentity();
      return now.owner === held.owner && now.generation === held.generation;
    } catch (e) {
      console.warn("[Feed] Could not confirm workspace identity; refusing write", e);
      return false; // fail closed
    }
  };

  // Drops the in-memory session only. It never touches storage: the active-session key may now
  // hold the destination workspace's data. Then reloads whatever this workspace actually has.
  const dropStaleSession = () => {
    identityRef.current = null;
    sessionRef.current = null;
    setSession(null);
    void initRef.current?.();
  };

  // Runs `write` only if `sessionId` is still the session on screen AND it still belongs to the
  // current workspace. Handlers created for an earlier session (for example one rendered for
  // Account A) are therefore refused even after Account B's own session has loaded.
  // Pass null when creating a brand-new session (nothing is on screen to compare against yet).
  const fencedPersist = async (sessionId: string | null, write: () => Promise<void>): Promise<boolean> => {
    if (sessionId !== null && sessionRef.current?.id !== sessionId) {
      return false; // that session is no longer the one on screen; touch nothing
    }
    // Belt and braces: the session's own stamp must name the workspace it is held in.
    const stamp = sessionId !== null ? sessionRef.current?.userId : undefined;
    if (stamp && stamp !== identityRef.current?.owner) {
      dropStaleSession();
      return false;
    }
    // The check and the write are one step under storageMutex. A workspace transition holds the
    // same mutex for its whole local switch, so it either finishes before this check (and the
    // check then fails) or starts after this write (and then discards it). Nothing can land
    // between the check and the write.
    let stale = false;
    const written = await storageMutex.run(async () => {
      if (!(await sessionBelongsHere())) {
        stale = true;
        return false;
      }
      await write();
      return true;
    });
    if (stale) {
      dropStaleSession();
      return false;
    }
    if (written) localEditsRef.current += 1;
    return written;
  };

  // Removes the stored active session only if it is still exactly what we read and the workspace
  // is unchanged, so it can never delete a session written since, or another workspace's.
  const discardStoredSessionIfUnchanged = async (rawValue: string, identity: WorkspaceOperationContext) => {
    try {
      await storageMutex.run(async () => {
        const now = await getWorkspaceIdentity();
        if (now.owner !== identity.owner || now.generation !== identity.generation) return;
        if ((await AsyncStorage.getItem(STORAGE_KEY)) === rawValue) await AsyncStorage.removeItem(STORAGE_KEY);
      });
    } catch (e) {
      console.warn("[Feed] Could not discard stored session", e);
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const init = useCallback(async () => {
    try {
      await processPendingDeletions();
    } catch (e) {
      console.warn("[Feed] background deletion sync failed:", e);
    }

    const editsAtStart = localEditsRef.current;

    // Capture which workspace we are loading for before reading anything from storage.
    let identity: WorkspaceOperationContext;
    try {
      identity = await getWorkspaceIdentity();
    } catch (e) {
      console.warn("[Feed] Could not resolve workspace identity; not loading active session", e);
      return;
    }

    const [stored, histRaw, bakeHistRaw, user, declined] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(HISTORY_KEY),
      AsyncStorage.getItem(BAKE_HISTORY_KEY),
      getStoredUser(),
      AsyncStorage.getItem(DECLINED_TUTORIAL_KEY),
    ]);

    // If the workspace changed while we were reading, what we read may belong to the other one.
    try {
      const after = await getWorkspaceIdentity();
      if (after.owner !== identity.owner || after.generation !== identity.generation) return;
    } catch {
      return;
    }

    if (declined === "true") setHasDeclinedTutorial(true);

    // The active session lives only on this device. This workspace's storage is the source of truth.
    let currentSession: FeedSession | null = null;
    if (stored) {
      try {
        currentSession = JSON.parse(stored);
      } catch (e) {
        console.warn("[Feed] Failed to parse active session", e);
      }
    }

    // Only a session stamped for THIS workspace is adopted. One saved before stamping existed, or
    // stamped for another workspace, is discarded: active work is device-local and does not survive
    // a transition, and we never guess ownership. It is removed so it cannot linger unseen (and
    // trigger a warning about a feed the baker cannot see).
    if (currentSession && currentSession.userId !== identity.owner) {
      console.warn("[Feed] Stored active session is unstamped or belongs to another workspace; discarding it");
      await discardStoredSessionIfUnchanged(stored as string, identity);
      currentSession = null;
    }

    let historyArray: FeedSession[] = [];
    if (histRaw) {
      try {
        const parsed = JSON.parse(histRaw);
        if (Array.isArray(parsed)) historyArray = parsed;
      } catch (e) {
        console.warn("[Feed] Failed to parse history", e);
      }
    }
    setHistoryData(historyArray);
    setCurrentUser(user ?? null);

    // Reset the screen to this workspace. An empty workspace must show no session. Skip only if
    // the baker edited the session locally while we were loading (that edit is newer than our read).
    if (localEditsRef.current === editsAtStart) {
      identityRef.current = currentSession ? identity : null;
      sessionRef.current = currentSession;
      setSession(currentSession);
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

    if (shouldPrompt && !onboardingPromptOpenRef.current) {
      onboardingPromptOpenRef.current = true;
      Alert.alert(
        "Would you like to start a new culture?",
        "It looks like your feed history is empty. Would you like a guided tutorial to establish a new starter?",
        [
          {
            text: "No thanks",
            style: "cancel",
            onPress: () => {
              onboardingPromptOpenRef.current = false;
              setHasDeclinedTutorial(true);
              AsyncStorage.setItem(DECLINED_TUTORIAL_KEY, "true");
            }
          },
          {
            text: "Let's begin!",
            onPress: () => {
              onboardingPromptOpenRef.current = false;
              setStarterTutorialMode(true);
              setTutorialDay(1);
            }
          }
        ],
        { onDismiss: () => { onboardingPromptOpenRef.current = false; } }
      );
    }

    setIsLoaded(true);
  }, [starterTutorialMode, setStarterTutorialMode, setTutorialDay]);

  useEffect(() => { initRef.current = init; }, [init]);

  // Reset the moment the workspace changes anywhere in the app (sign-in, sign-out, account switch),
  // not just on focus. No polling and no network: this fires once, after the change is persisted.
  useEffect(() => {
    return subscribeToWorkspaceChange(() => {
      // Hide the departing workspace's session at once, then reload once any in-flight switch has finished.
      identityRef.current = null;
      sessionRef.current = null;
      setSession(null);
      void storageMutex.run(async () => {}).then(() => initRef.current?.());
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      init();
    }, [init])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await processPendingDeletions();
      await init();
    } finally {
      setRefreshing(false);
    }
  }, [init]);

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

    // A new session belongs to the workspace it is created in, and is stamped with that owner.
    let identity: WorkspaceOperationContext;
    try {
      identity = await getWorkspaceIdentity();
    } catch (e) {
      console.warn("[Feed] Could not resolve workspace identity; not starting feed", e);
      return;
    }
    identityRef.current = identity;
    const stamped: FeedSession = { ...newSession, userId: identity.owner };
    const persisted = await fencedPersist(null, () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stamped)));
    if (!persisted) return;
    sessionRef.current = stamped;
    setSession(stamped);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    let identity: WorkspaceOperationContext;
    try {
      identity = await getWorkspaceIdentity();
    } catch (e) {
      console.warn("[Feed] Could not resolve workspace identity; not starting stir phase", e);
      return;
    }
    identityRef.current = identity;
    const stamped: FeedSession = { ...stirSession, userId: identity.owner };
    const persisted = await fencedPersist(null, () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stamped)));
    if (!persisted) return;
    sessionRef.current = stamped;
    setSession(stamped);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const logReading = async (r: Reading, sessionId: string) => {
    const current = sessionRef.current;
    if (!current || current.id !== sessionId) return;
    const updated: FeedSession = {
      ...current,
      userId: current.userId ?? identityRef.current?.owner,
      readings: [...(current.readings || []), r],
      updatedAt: Date.now(),
    };
    const persisted = await fencedPersist(sessionId, () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)));
    if (!persisted) return;
    sessionRef.current = updated;
    setSession(updated);
  };

  // Completing a Feed is the one point where it becomes a finished record eligible for the cloud.
  // Active (in-progress) work is never uploaded.
  const handleSavePeak = async (peak: PeakData) => {
    if (!session) return;
    const held = identityRef.current;

    const deviceId = await getDeviceId();

    const completedAt = Date.now();
    // The finished record is stamped with the workspace the session belongs to, not a freshly
    // resolved one.
    const completed = {
      ...session,
      userId: session.userId ?? held?.owner ?? "anonymous",
      peak,
      completedAt,
      updatedAt: completedAt,
      isTutorialSnapshot: starterTutorialMode
    };
    const tutorialUpdated: FeedSession = { ...session, userId: session.userId ?? held?.owner, peak, updatedAt: completedAt };

    let historyTrimmed: any[] = [];
    const persisted = await fencedPersist(session.id, async () => {
      // Save to local history as a snapshot
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      let existing: any[] = [];
      try {
        const parsed = stored ? JSON.parse(stored) : [];
        existing = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn("[Feed] Failed to parse history during save", e);
      }
      existing.unshift(completed);
      historyTrimmed = existing.slice(0, 500);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyTrimmed));

      if (!starterTutorialMode) {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } else {
        // Tutorial Mode: Keep session active until manual progression
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tutorialUpdated));
      }
    });
    if (!persisted) return;

    setHistoryData(historyTrimmed);

    if (!starterTutorialMode) {
      identityRef.current = null;
      sessionRef.current = null;
      setSession(null);

      // Normal Mode: the finished record is already safe on the device. Upload it only if the
      // workspace is unchanged; otherwise it stays local and uploads when its own account is next
      // active. (The API independently refuses a payload whose owner differs from the signed-in
      // session, so a switch landing after this check still cannot write it under another account.)
      // The same ID replaces any legacy in-progress row, because every column is rewritten.
      let sameWorkspace = false;
      try {
        const now = await getWorkspaceIdentity();
        sameWorkspace = !!held && now.owner === held.owner && now.generation === held.generation;
      } catch {
        sameWorkspace = false;
      }
      // NLA is device-only: the finished feed stays on the device and is never uploaded from here.
      if (sameWorkspace && held && !isNlaOwner(held.owner)) {
        try {
          reportSyncStart();
          await api.history.feed.upsert({
            id: completed.id,
            deviceId,
            userId: held && held.owner !== "anonymous" ? held.owner : undefined,
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
      }
    } else {
      sessionRef.current = tutorialUpdated;
      setSession(tutorialUpdated);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Abandon = discard the active Feed session on this device. Active work is device-local, so
  // there is no cloud copy to delete and no tombstone to write.
  const abandonFeed = async (target: FeedSession) => {
    // Something else replaced or ended this session while the dialog was open: do nothing.
    if (sessionRef.current?.id !== target.id) return;

    let cleared = false;
    try {
      cleared = await fencedPersist(target.id, () => AsyncStorage.removeItem(STORAGE_KEY));
    } catch (e) {
      console.warn("[Feed] Could not clear the active session", e);
      // Do not claim success: the session is still on this device, so keep showing it.
      Alert.alert("Couldn't abandon this feed", "Your feed is still here. Please try again in a moment.");
      return;
    }
    if (!cleared) return; // stale session was dropped without touching storage

    identityRef.current = null;
    sessionRef.current = null;
    setSession(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    if (!session) return;
    const cleared = await fencedPersist(session.id, () => AsyncStorage.removeItem(STORAGE_KEY));
    if (!cleared) return;
    setTutorialDay(nextDay);
    identityRef.current = null;
    sessionRef.current = null;
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
          refreshing={refreshing}
          onRefresh={refresh}
          onLogReading={(r) => logReading(r, session.id)}
          onSavePeak={handleSavePeak}
          onClearSession={() => {
            // Bind to exactly the session the baker is looking at when the dialog opens.
            const target = session;
            Alert.alert("Abandon Feed?", "This will remove the current active tracker.", [
              { text: "Cancel", style: "cancel" },
              { text: "Discard", style: "destructive", onPress: () => abandonFeed(target) }
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
          <FeedSetupView onStartFeed={handleStartFeed} historyData={historyData} refreshing={refreshing} onRefresh={refresh} />
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
