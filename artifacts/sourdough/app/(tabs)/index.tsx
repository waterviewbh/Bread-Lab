import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import type { SessionForAnalytics } from "@/lib/analytics";
import PHChart from "@/components/PHChart";
import type { SessionForChart, TempReading } from "@/components/PHChart";
import { Feather, Ionicons } from "@expo/vector-icons";

import AuthModal from "@/components/AuthModal";
import NudgeBanner from "@/components/NudgeBanner";
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSyncStatus } from "@/contexts/SyncContext";

interface PeakData {
  pH: string;
  volume: string;
  photo: string | null;
  loggedAt: number;
  volumeIncreasePct: number;
  timeToPeakMs: number;
}

interface Reading {
  pH: string;
  temp: string;
  tempUnit?: "F" | "C";
  note: string;
  loggedAt: number;
}

function patchReadingsTempUnit(readings: Reading[]): Reading[] {
  return readings.map((r) =>
    r.temp && !r.tempUnit ? { ...r, tempUnit: "F" as const } : r
  );
}

interface FeedSession {
  id: string;
  starterWeight: string;
  ratioStr: string;
  flourWeight: number;
  waterWeight: number;
  wwPercent: number;
  initialPH: string;
  initialVolume: string;
  fedPhoto: string | null;
  savedAt: number;
  completedAt?: number;
  savedToHistory?: boolean;
  peak?: PeakData;
  readings?: Reading[];
  /** Optional sugar weight in grams; appears as a 4th ratio element when > 0. */
  sugarWeight?: number;
}

const STORAGE_KEY = "sourdough_feed_session_v1";
const HISTORY_KEY = "sourdough_feed_history_v1";
const NUDGE_KEY = "bread_lab_name_nudge_shown_v1";

/**
 * Compute a ratio string from weights. Sugar is an optional 4th element —
 * it's omitted from the output when zero or undefined.
 */
function calcRatioStr(starter: number, flour: number, water: number, sugar?: number): string {
  if (starter <= 0 || flour <= 0 || water <= 0) return "";
  const f = Math.round((flour / starter) * 10) / 10;
  const w = Math.round((water / starter) * 10) / 10;
  if (sugar && sugar > 0) {
    const su = Math.round((sugar / starter) * 10) / 10;
    return `1:${f}:${w}:${su}`;
  }
  return `1:${f}:${w}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimeToPeak(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function FlourSlider({
  wwPercent,
  onChange,
  flourWeight,
}: {
  wwPercent: number;
  onChange: (val: number) => void;
  flourWeight: number | null;
}) {
  const colors = useColors();
  const sliderWidth = useRef(0);
  const pageXOffset = useRef(0);
  const trackRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apPct = 100 - wwPercent;
  const apGrams =
    flourWeight !== null
      ? Math.round(flourWeight * (apPct / 100) * 10) / 10
      : null;
  const wwGrams =
    flourWeight !== null
      ? Math.round(flourWeight * (wwPercent / 100) * 10) / 10
      : null;

  // Snap raw % to the nearest step boundary
  const snapVal = (raw: number, step: number) =>
    Math.round(Math.max(0, Math.min(100, raw)) / step) * step;

  // Track last emitted value so we only fire onChange + haptics on real changes
  const lastPct = useRef(-1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        lastPct.current = -1; // reset so first touch always registers
        if (sliderWidth.current === 0) return;
        // Re-measure on each touch in case the layout shifted (e.g. scroll)
        trackRef.current?.measure((_x, _y, _w, _h, px) => {
          pageXOffset.current = px;
        });
        const x = evt.nativeEvent.pageX - pageXOffset.current;
        // 1% precision on tap — user touched a deliberate spot
        const pct = snapVal((x / sliderWidth.current) * 100, 1);
        onChangeRef.current(pct);
        lastPct.current = pct;
        Haptics.selectionAsync();
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (sliderWidth.current === 0) return;
        // gestureState.moveX is absolute screen X — stable during drag
        const x = gestureState.moveX - pageXOffset.current;
        // Fast sweep (|vx| > 0.1 px/ms) → 5% steps so a quick flick stays smooth;
        // slow deliberate drag → 1% for fine-grained control
        const step = Math.abs(gestureState.vx) > 0.1 ? 5 : 1;
        const pct = snapVal((x / sliderWidth.current) * 100, step);
        if (pct !== lastPct.current) {
          onChangeRef.current(pct);
          lastPct.current = pct;
          Haptics.selectionAsync();
        }
      },
    })
  ).current;

  const TRACK_HEIGHT = 6;
  const THUMB_SIZE = 26;

  return (
    <View>
      <View style={sliderStyles.labelRow}>
        <View>
          <Text style={[sliderStyles.flourLabel, { color: colors.foreground }]}>
            AP
          </Text>
          <Text style={[sliderStyles.flourGrams, { color: colors.mutedForeground }]}>
            {apGrams !== null ? `${apGrams}g` : "—"}
          </Text>
        </View>
        <View style={sliderStyles.pctBadge}>
          {apPct > 0 && (
            <Text style={[sliderStyles.pctText, { color: colors.primary }]}>
              {apPct}%
            </Text>
          )}
          {apPct > 0 && wwPercent > 0 && (
            <Text style={[sliderStyles.pctDivider, { color: colors.border }]}>·</Text>
          )}
          {wwPercent > 0 && (
            <Text style={[sliderStyles.pctText, { color: colors.accent }]}>
              {wwPercent}%
            </Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[sliderStyles.flourLabel, { color: colors.foreground }]}>
            WW
          </Text>
          <Text style={[sliderStyles.flourGrams, { color: colors.mutedForeground }]}>
            {wwGrams !== null ? `${wwGrams}g` : "—"}
          </Text>
        </View>
      </View>

      <View
        ref={trackRef}
        style={[sliderStyles.trackContainer, { height: THUMB_SIZE + 12 }]}
        onLayout={(e) => {
          sliderWidth.current = e.nativeEvent.layout.width;
          trackRef.current?.measure((_x, _y, _w, _h, px) => {
            pageXOffset.current = px;
          });
        }}
        {...panResponder.panHandlers}
      >
        <View
          style={[
            sliderStyles.track,
            {
              height: TRACK_HEIGHT,
              backgroundColor: colors.muted,
              borderRadius: TRACK_HEIGHT / 2,
            },
          ]}
        >
          {wwPercent > 0 && (
            <View
              style={[
                sliderStyles.trackFillWW,
                {
                  width: `${wwPercent}%`,
                  backgroundColor: colors.accent,
                  borderRadius: TRACK_HEIGHT / 2,
                },
              ]}
            />
          )}
          {apPct > 0 && (
            <View
              style={[
                sliderStyles.trackFillAP,
                {
                  width: `${apPct}%`,
                  backgroundColor: colors.primary + "60",
                  borderRadius: TRACK_HEIGHT / 2,
                },
              ]}
            />
          )}
        </View>
        <View
          style={[
            sliderStyles.thumb,
            {
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: colors.card,
              borderColor:
                wwPercent > 50 ? colors.accent : colors.primary,
              left: `${wwPercent}%` as any,
              marginLeft: -(THUMB_SIZE / 2),
            },
          ]}
        />
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  flourLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  flourGrams: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  pctBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pctText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  pctDivider: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  trackContainer: {
    justifyContent: "center",
    position: "relative",
  },
  track: {
    width: "100%",
    flexDirection: "row",
    overflow: "hidden",
  },
  trackFillAP: {
    height: "100%",
  },
  trackFillWW: {
    height: "100%",
    position: "absolute",
    right: 0,
    top: 0,
  },
  thumb: {
    position: "absolute",
    top: "50%",
    marginTop: -13,
    borderWidth: 2.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reportSyncStart, reportSyncSuccess, reportSyncFailure } = useSyncStatus();

  // Section toggle state
  const [section, setSection] = useState<"track" | "plan">("track");

  const [starterWeight, setStarterWeight] = useState("");
  const [flourWeightStr, setFlourWeightStr] = useState("");
  const [waterWeightStr, setWaterWeightStr] = useState("");
  // Sugar is optional: toggle reveals a weight input; the ratio gains a 4th element.
  const [sugarEnabled, setSugarEnabled] = useState(false);
  const [sugarWeightStr, setSugarWeightStr] = useState("");
  const [wwPercent, setWwPercent] = useState(0);
  const [initialPH, setInitialPH] = useState("");
  const [initialVolume, setInitialVolume] = useState("");
  const [fedPhoto, setFedPhoto] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<FeedSession[]>([]);

  const [session, setSession] = useState<FeedSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showPeakModal, setShowPeakModal] = useState(false);
  const [peakPH, setPeakPH] = useState("");
  const [peakVolume, setPeakVolume] = useState("");
  const [peakPhoto, setPeakPhoto] = useState<string | null>(null);

  const [showReadingModal, setShowReadingModal] = useState(false);
  const [readingPH, setReadingPH] = useState("");
  const [readingTemp, setReadingTemp] = useState("");
  const [readingTempUnit, setReadingTempUnit] = useState<"F" | "C">("F");
  const [readingNote, setReadingNote] = useState("");
  const [expandedReadingIndex, setExpandedReadingIndex] = useState<number | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  useEffect(() => {
    loadSession();
    AsyncStorage.getItem(HISTORY_KEY)
      .then((s) => {
        if (!s) return;
        const hist: FeedSession[] = JSON.parse(s);
        let needsWrite = false;
        const migrated = hist.map((sess) => {
          if (sess.readings?.some((r) => r.temp && !r.tempUnit)) {
            needsWrite = true;
            return { ...sess, readings: patchReadingsTempUnit(sess.readings!) };
          }
          return sess;
        });
        if (needsWrite) {
          AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(migrated)).catch(() => {});
        }
        setHistoryData(migrated);
      })
      .catch(() => {});
    getStoredUser().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (!session || session.peak) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - session.savedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  // Sync the unit toggle to the last logged reading whenever the modal opens.
  useEffect(() => {
    if (showReadingModal) {
      const readings = session?.readings ?? [];
      const lastUnit = readings.length > 0 ? (readings[readings.length - 1].tempUnit ?? "F") : "F";
      setReadingTempUnit(lastUnit as "F" | "C");
    }
  }, [showReadingModal]);

  const loadSession = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const s: FeedSession = JSON.parse(stored);
        if (s.readings?.some((r) => r.temp && !r.tempUnit)) {
          s.readings = patchReadingsTempUnit(s.readings!);
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s)).catch(() => {});
        }
        setSession(s);
        setElapsed(Date.now() - s.savedAt);
      }
    } catch (e) {}
  };

  const checkAndShowNudge = async () => {
    try {
      const [nudgeShown, user, historyRaw] = await Promise.all([
        AsyncStorage.getItem(NUDGE_KEY),
        getStoredUser(),
        AsyncStorage.getItem(HISTORY_KEY),
      ]);
      if (nudgeShown) return;
      if (user) return;
      const history: FeedSession[] = historyRaw ? JSON.parse(historyRaw) : [];
      if (history.length !== 1) return;
      await AsyncStorage.setItem(NUDGE_KEY, "1");
      setShowNudge(true);
    } catch {}
  };

  const sw = parseFloat(starterWeight);
  const fw = parseFloat(flourWeightStr);
  const ww = parseFloat(waterWeightStr);
  const flourWeight = fw > 0 ? fw : null;
  const waterWeight = ww > 0 ? ww : null;
  const sugarWeight = sugarEnabled ? parseFloat(sugarWeightStr) : undefined;
  const derivedRatioStr =
    sw > 0 && fw > 0 && ww > 0 ? calcRatioStr(sw, fw, ww, sugarWeight) : null;

  const pickPhoto = (onPhoto: (uri: string) => void) => {
    Alert.alert("Add Photo", "Choose source", [
      {
        text: "Camera",
        onPress: async () => {
          const { status } =
            await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission needed", "Camera access is required.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: "images",
            quality: 0.8,
          });
          if (!result.canceled && result.assets[0]) {
            onPhoto(result.assets[0].uri);
          }
        },
      },
      {
        text: "Photo Library",
        onPress: async () => {
          const { status } =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              "Permission needed",
              "Photo library access is required."
            );
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: "images",
            quality: 0.8,
          });
          if (!result.canceled && result.assets[0]) {
            onPhoto(result.assets[0].uri);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const saveSession = async () => {
    if (!sw || sw <= 0 || !fw || fw <= 0 || !ww || ww <= 0) {
      Alert.alert("Missing info", "Enter valid starter, flour and water weights.");
      return;
    }
    const activeSugar = sugarEnabled && sugarWeight && sugarWeight > 0 ? sugarWeight : undefined;
    const newSession: FeedSession = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      starterWeight,
      ratioStr: calcRatioStr(sw, fw, ww, activeSugar),
      flourWeight: fw,
      waterWeight: ww,
      wwPercent,
      initialPH,
      initialVolume,
      fedPhoto,
      savedAt: Date.now(),
      readings: [],
      ...(activeSugar ? { sugarWeight: activeSugar } : {}),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
    setElapsed(0);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const savePeak = async () => {
    if (!session) return;
    const peakVol = parseFloat(peakVolume);
    const initVol = parseFloat(session.initialVolume);
    const volumeIncreasePct =
      initVol > 0 && peakVol > 0
        ? Math.round(((peakVol - initVol) / initVol) * 100 * 10) / 10
        : 0;
    const timeToPeakMs = Date.now() - session.savedAt;
    const peak: PeakData = {
      pH: peakPH,
      volume: peakVolume,
      photo: peakPhoto,
      loggedAt: Date.now(),
      volumeIncreasePct,
      timeToPeakMs,
    };
    const updatedSession: FeedSession = { ...session, peak, savedToHistory: true };
    setShowPeakModal(false);
    setPeakPH("");
    setPeakVolume("");
    setPeakPhoto(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await saveToHistory(updatedSession);
    await AsyncStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setElapsed(0);
    setStarterWeight("");
    setFlourWeightStr("");
    setWaterWeightStr("");
    setWwPercent(0);
    setInitialPH("");
    setInitialVolume("");
    setFedPhoto(null);
    checkAndShowNudge();
  };

  const saveToHistory = async (s: FeedSession) => {
    const completed: FeedSession = { ...s, completedAt: Date.now() };
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const existing: FeedSession[] = stored ? JSON.parse(stored) : [];
      existing.unshift(completed);
      await AsyncStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(existing.slice(0, 500))
      );
    } catch (e) {}
    reportSyncStart();
    const forAnalytics: SessionForAnalytics = {
      savedAt: completed.savedAt,
      readings: completed.readings,
      initialPH: completed.initialPH,
    };
    Promise.all([getDeviceId(), getStoredToken().catch(() => null)])
      .then(([deviceId, userId]) =>
        api.history.feed
          .upsert({
            id: completed.id,
            deviceId,
            userId: userId ?? undefined,
            savedAt: completed.savedAt,
            startedAt: null,
            data: completed as unknown as Record<string, unknown>,
          })
          .then(() => {
            api.analytics.updateStarter(deviceId, forAnalytics).catch(() => {});
          })
      )
      .then(() => reportSyncSuccess())
      .catch(() => reportSyncFailure());
  };

  const logReading = async () => {
    if (!session) return;
    const ph = readingPH.trim();
    if (!ph) {
      Alert.alert("Enter pH", "Please enter a pH value before saving.");
      return;
    }
    const newReading: Reading = {
      pH: ph,
      temp: readingTemp.trim(),
      tempUnit: readingTempUnit,
      note: readingNote.trim(),
      loggedAt: Date.now(),
    };
    const updatedSession = {
      ...session,
      readings: [...(session.readings ?? []), newReading],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSession));
    setSession(updatedSession);
    setShowReadingModal(false);
    setReadingPH("");
    setReadingTemp("");
    setReadingNote("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const clearSession = () => {
    Alert.alert("New Feed Session", "Clear this session and start fresh?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "New Session",
        style: "destructive",
        onPress: async () => {
          if (session && !session.savedToHistory) await saveToHistory(session);
          await AsyncStorage.removeItem(STORAGE_KEY);
          setSession(null);
          setElapsed(0);
          setStarterWeight("");
          setFlourWeightStr("");
          setWaterWeightStr("");
          setWwPercent(0);
          setInitialPH("");
          setInitialVolume("");
          setFedPhoto(null);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          checkAndShowNudge();
        },
      },
    ]);
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  if (session) {
    const apPct = 100 - session.wwPercent;
    const apGrams =
      session.flourWeight > 0
        ? Math.round(session.flourWeight * (apPct / 100) * 10) / 10
        : null;
    const wwGrams =
      session.flourWeight > 0
        ? Math.round(session.flourWeight * (session.wwPercent / 100) * 10) / 10
        : null;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + webTop + 16,
            paddingBottom: insets.bottom + tabBarPad + 24,
            paddingHorizontal: 20,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(500)}>
            <Text
              style={[
                styles.sectionLabel,
                { color: colors.mutedForeground, marginBottom: 4 },
              ]}
            >
              {session.peak ? "Peaked at" : "Time Since Feed"}
            </Text>
            <Text style={[styles.timerText, { color: colors.foreground }]}>
              {session.peak
                ? formatTimeToPeak(session.peak.timeToPeakMs)
                : formatDuration(elapsed)}
            </Text>
            {!session.peak && (
              <Text
                style={[styles.timerSub, { color: colors.mutedForeground }]}
              >
                watching it rise
              </Text>
            )}
          </Animated.View>

          <View
            style={[
              styles.divider,
              { backgroundColor: colors.border, marginVertical: 24 },
            ]}
          />

          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <Text
              style={[styles.sectionTitle, { color: colors.foreground }]}
            >
              Feed Ratios
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.ratioRow}>
                <View style={styles.ratioItem}>
                  <Text
                    style={[styles.ratioValue, { color: colors.primary }]}
                  >
                    {session.starterWeight}g
                  </Text>
                  <Text
                    style={[
                      styles.ratioLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Starter
                  </Text>
                </View>
                <Text style={[styles.ratioColon, { color: colors.border }]}>
                  :
                </Text>
                <View style={styles.ratioItem}>
                  <Text
                    style={[styles.ratioValue, { color: colors.primary }]}
                  >
                    {session.flourWeight}g
                  </Text>
                  <Text
                    style={[
                      styles.ratioLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Flour
                  </Text>
                </View>
                <Text style={[styles.ratioColon, { color: colors.border }]}>
                  :
                </Text>
                <View style={styles.ratioItem}>
                  <Text
                    style={[styles.ratioValue, { color: colors.primary }]}
                  >
                    {session.waterWeight}g
                  </Text>
                  <Text
                    style={[
                      styles.ratioLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Water
                  </Text>
                </View>
              </View>
              <Text
                style={[styles.ratioBadge, { color: colors.mutedForeground }]}
              >
                ratio {session.ratioStr}
              </Text>

              {session.wwPercent > 0 && session.wwPercent < 100 && (
                <View
                  style={[
                    styles.flourSplitRow,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.flourSplitItem}>
                    <Text
                      style={[styles.flourSplitValue, { color: colors.primary }]}
                    >
                      {apGrams}g
                    </Text>
                    <Text
                      style={[
                        styles.flourSplitLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      AP ({apPct}%)
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.flourSplitDivider,
                      { backgroundColor: colors.border },
                    ]}
                  />
                  <View style={styles.flourSplitItem}>
                    <Text
                      style={[styles.flourSplitValue, { color: colors.accent }]}
                    >
                      {wwGrams}g
                    </Text>
                    <Text
                      style={[
                        styles.flourSplitLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      WW ({session.wwPercent}%)
                    </Text>
                  </View>
                </View>
              )}
              {session.wwPercent === 100 && (
                <View
                  style={[
                    styles.flourSplitRow,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.flourSplitValue,
                      { color: colors.accent, textAlign: "center", flex: 1 },
                    ]}
                  >
                    100% Whole Wheat · {session.flourWeight}g
                  </Text>
                </View>
              )}
              {session.wwPercent === 0 && (
                <View
                  style={[
                    styles.flourSplitRow,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.flourSplitValue,
                      { color: colors.primary, textAlign: "center", flex: 1 },
                    ]}
                  >
                    100% All-Purpose · {session.flourWeight}g
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>

          {(session.initialPH || session.initialVolume) && (
            <Animated.View
              entering={FadeInDown.delay(150).duration(400)}
              style={{ marginTop: 20 }}
            >
              <Text
                style={[styles.sectionTitle, { color: colors.foreground }]}
              >
                Initial Readings
              </Text>
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.readingsRow}>
                  {session.initialPH ? (
                    <View style={styles.readingItem}>
                      <Text
                        style={[
                          styles.readingValue,
                          { color: colors.foreground },
                        ]}
                      >
                        {session.initialPH}
                      </Text>
                      <Text
                        style={[
                          styles.readingLabel,
                          { color: colors.mutedForeground, textTransform: "none" },
                        ]}
                      >
                        pH
                      </Text>
                    </View>
                  ) : null}
                  {session.initialVolume ? (
                    <View style={styles.readingItem}>
                      <Text
                        style={[
                          styles.readingValue,
                          { color: colors.foreground },
                        ]}
                      >
                        {session.initialVolume}mL
                      </Text>
                      <Text
                        style={[
                          styles.readingLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Volume
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Animated.View>
          )}

          {/* pH Readings */}
          <Animated.View
            entering={FadeInDown.delay(175).duration(400)}
            style={{ marginTop: 20 }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground, marginBottom: 0, textTransform: "none" },
                ]}
              >
                pH Readings
              </Text>
              {!session.peak && (
                <Pressable
                  onPress={() => setShowReadingModal(true)}
                  style={({ pressed }) => [
                    styles.calcChip,
                    {
                      backgroundColor: colors.primary + "15",
                      borderColor: colors.primary + "30",
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather name="plus" size={12} color={colors.primary} />
                  <Text
                    style={[
                      styles.calcChipText,
                      { color: colors.primary, fontSize: 13 },
                    ]}
                  >
                    Log Reading
                  </Text>
                </Pressable>
              )}
            </View>

            {session.readings && session.readings.length > 0 ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    padding: 0,
                    overflow: "hidden",
                  },
                ]}
              >
                {session.readings.map((r, i) => {
                  const elapsedMs = r.loggedAt - session.savedAt;
                  const hh = Math.floor(elapsedMs / 3600000);
                  const mm = Math.floor((elapsedMs % 3600000) / 60000);
                  const timeStr = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
                  const isExpanded = expandedReadingIndex === i;
                  const hasNote = !!r.note;
                  return (
                    <Pressable
                      key={i}
                      onPress={hasNote ? () => setExpandedReadingIndex(isExpanded ? null : i) : undefined}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderBottomWidth:
                          i < (session.readings?.length ?? 0) - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontFamily: "Inter_400Regular",
                            color: hasNote ? colors.primary : colors.mutedForeground,
                            width: 52,
                          }}
                        >
                          {timeStr}
                        </Text>
                        <Text
                          style={{
                            fontSize: 16,
                            fontFamily: "Inter_600SemiBold",
                            color: colors.foreground,
                            flex: 1,
                          }}
                        >
                          pH {r.pH}
                        </Text>
                        {r.temp ? (
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: "Inter_400Regular",
                              color: colors.mutedForeground,
                            }}
                          >
                            {r.temp}°{r.tempUnit ?? "F"}
                          </Text>
                        ) : null}
                      </View>
                      {hasNote && (
                        <Text
                          numberOfLines={isExpanded ? undefined : 1}
                          style={{
                            fontSize: 12,
                            fontFamily: "Inter_400Regular",
                            color: colors.mutedForeground,
                            marginTop: 3,
                            paddingLeft: 52,
                          }}
                        >
                          {r.note}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: "Inter_400Regular",
                    color: colors.mutedForeground,
                    textAlign: "center",
                  }}
                >
                  {session.peak
                    ? "No readings were logged for this session."
                    : "Tap Log Reading to capture pH & temp over time."}
                </Text>
              </View>
            )}


          </Animated.View>

          {/* Live pH chart — shown once at least one reading has been logged */}
          {(session.readings?.length ?? 0) > 0 && (
            <Animated.View
              entering={FadeInDown.delay(150).duration(400)}
              style={{ marginTop: 20 }}
            >
              <PHChart
                session={session as SessionForChart}
                history={historyData as SessionForChart[]}
                tempReadings={(session.readings ?? [])
                  .filter(
                    (r): r is typeof r & { temp: string; tempUnit: "F" | "C" } =>
                      !!r.temp && !isNaN(parseFloat(r.temp)) && (r.tempUnit === "F" || r.tempUnit === "C")
                  )
                  .map<TempReading>((r) => ({
                    elapsedMin: (r.loggedAt - session.savedAt) / 60000,
                    temp: parseFloat(r.temp),
                    tempUnit: r.tempUnit,
                  }))}
              />
            </Animated.View>
          )}

          {session.fedPhoto && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(400)}
              style={{ marginTop: 20 }}
            >
              <Text
                style={[styles.sectionTitle, { color: colors.foreground }]}
              >
                Just Fed
              </Text>
              <Image
                source={{ uri: session.fedPhoto }}
                style={[
                  styles.sessionPhoto,
                  {
                    borderRadius: colors.radius,
                    borderColor: colors.border,
                  },
                ]}
              />
            </Animated.View>
          )}

          {session.peak && (
            <Animated.View
              entering={FadeInDown.delay(250).duration(400)}
              style={{ marginTop: 20 }}
            >
              <View
                style={[
                  styles.peakBadge,
                  {
                    backgroundColor: colors.accent + "18",
                    borderColor: colors.accent + "40",
                  },
                ]}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.accent}
                />
                <Text
                  style={[styles.peakBadgeText, { color: colors.accent }]}
                >
                  Peak Reached
                </Text>
              </View>
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    marginTop: 12,
                  },
                ]}
              >
                <View style={styles.readingsRow}>
                  {session.peak.pH ? (
                    <View style={styles.readingItem}>
                      <Text
                        style={[
                          styles.readingValue,
                          { color: colors.foreground },
                        ]}
                      >
                        {session.peak.pH}
                      </Text>
                      <Text
                        style={[
                          styles.readingLabel,
                          { color: colors.mutedForeground, textTransform: "none" },
                        ]}
                      >
                        Peak pH
                      </Text>
                    </View>
                  ) : null}
                  {session.peak.volume ? (
                    <View style={styles.readingItem}>
                      <Text
                        style={[
                          styles.readingValue,
                          { color: colors.foreground },
                        ]}
                      >
                        {session.peak.volume}mL
                      </Text>
                      <Text
                        style={[
                          styles.readingLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Peak Vol
                      </Text>
                    </View>
                  ) : null}
                  {session.peak.volumeIncreasePct > 0 && (
                    <View style={styles.readingItem}>
                      <Text
                        style={[
                          styles.readingValue,
                          { color: colors.accent },
                        ]}
                      >
                        +{session.peak.volumeIncreasePct}%
                      </Text>
                      <Text
                        style={[
                          styles.readingLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Rise
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              {session.peak.photo && (
                <Image
                  source={{ uri: session.peak.photo }}
                  style={[
                    styles.sessionPhoto,
                    {
                      borderRadius: colors.radius,
                      borderColor: colors.border,
                      marginTop: 12,
                    },
                  ]}
                />
              )}
            </Animated.View>
          )}

          <View style={{ height: 32 }} />

          {!session.peak && (
            <Animated.View entering={FadeInUp.delay(300).duration(400)}>
              <Pressable
                onPress={() => setShowPeakModal(true)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.accent,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                testID="mark-peak-btn"
              >
                <Ionicons
                  name="trending-up"
                  size={20}
                  color={colors.accentForeground}
                />
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.accentForeground },
                  ]}
                >
                  Mark as Peak
                </Text>
              </Pressable>
            </Animated.View>
          )}

          <Pressable
            onPress={clearSession}
            style={({ pressed }) => [
              styles.ghostButton,
              { opacity: pressed ? 0.5 : 1, marginTop: 12 },
            ]}
            testID="new-session-btn"
          >
            <Text
              style={[
                styles.ghostButtonText,
                { color: colors.mutedForeground },
              ]}
            >
              New Session
            </Text>
          </Pressable>
        </ScrollView>

        <Modal
          visible={showPeakModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowPeakModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, backgroundColor: colors.background }}
          >
            <ScrollView
              contentContainerStyle={[
                styles.modalContent,
                {
                  paddingTop: insets.top + webTop + 24,
                  paddingBottom:
                    insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32,
                },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text
                  style={[styles.modalTitle, { color: colors.foreground }]}
                >
                  Log Peak
                </Text>
                <Pressable
                  onPress={() => setShowPeakModal(false)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={colors.foreground}
                  />
                </Pressable>
              </View>

              <View
                style={[
                  styles.autoCalcCard,
                  {
                    backgroundColor: colors.secondary,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.autoCalcLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Time to Peak (auto-calculated on save)
                </Text>
                <Text
                  style={[
                    styles.autoCalcValue,
                    { color: colors.foreground },
                  ]}
                >
                  {formatTimeToPeak(elapsed)}
                </Text>
              </View>

              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
              >
                Peak pH
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                placeholder="e.g. 4.2"
                placeholderTextColor={colors.mutedForeground}
                value={peakPH}
                onChangeText={setPeakPH}
                keyboardType="decimal-pad"
                testID="peak-ph-input"
              />

              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
              >
                Peak Volume (mL)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                placeholder="e.g. 320"
                placeholderTextColor={colors.mutedForeground}
                value={peakVolume}
                onChangeText={setPeakVolume}
                keyboardType="decimal-pad"
                testID="peak-volume-input"
              />

              {session.initialVolume && peakVolume ? (
                <View
                  style={[
                    styles.autoCalcCard,
                    {
                      backgroundColor: colors.accent + "18",
                      borderColor: colors.accent + "30",
                      borderWidth: 1,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text
                    style={[styles.autoCalcLabel, { color: colors.accent }]}
                  >
                    Volume Increase
                  </Text>
                  <Text
                    style={[styles.autoCalcValue, { color: colors.accent }]}
                  >
                    {(() => {
                      const pv = parseFloat(peakVolume);
                      const iv = parseFloat(session.initialVolume);
                      if (iv > 0 && pv > 0) {
                        return `+${Math.round(((pv - iv) / iv) * 100 * 10) / 10}%`;
                      }
                      return "—";
                    })()}
                  </Text>
                </View>
              ) : null}

              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground }]}
              >
                Peak Photo
              </Text>
              <Pressable
                onPress={() =>
                  pickPhoto((uri) => {
                    setPeakPhoto(uri);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  })
                }
                style={({ pressed }) => [
                  styles.photoPicker,
                  {
                    backgroundColor: peakPhoto ? "transparent" : colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.8 : 1,
                    borderStyle: peakPhoto ? "solid" : "dashed",
                  },
                ]}
                testID="peak-photo-btn"
              >
                {peakPhoto ? (
                  <Image
                    source={{ uri: peakPhoto }}
                    style={[
                      styles.photoPreview,
                      { borderRadius: colors.radius },
                    ]}
                  />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Feather
                      name="camera"
                      size={24}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.photoPlaceholderText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Add peak photo
                    </Text>
                  </View>
                )}
              </Pressable>

              <Pressable
                onPress={savePeak}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                    marginTop: 8,
                  },
                ]}
                testID="save-peak-btn"
              >
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Save Peak
                </Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={showReadingModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowReadingModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, backgroundColor: colors.background }}
          >
            <ScrollView
              contentContainerStyle={[
                styles.modalContent,
                {
                  paddingTop: insets.top + webTop + 24,
                  paddingBottom:
                    insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32,
                },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text
                  style={[styles.modalTitle, { color: colors.foreground }]}
                >
                  Log Reading
                </Text>
                <Pressable
                  onPress={() => setShowReadingModal(false)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons name="close" size={24} color={colors.foreground} />
                </Pressable>
              </View>

              <View
                style={[
                  styles.autoCalcCard,
                  {
                    backgroundColor: colors.secondary,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.autoCalcLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Time Since Feed
                </Text>
                <Text
                  style={[styles.autoCalcValue, { color: colors.foreground }]}
                >
                  {formatDuration(elapsed)}
                </Text>
              </View>

              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
              >
                pH
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                placeholder="e.g. 4.2"
                placeholderTextColor={colors.mutedForeground}
                value={readingPH}
                onChangeText={setReadingPH}
                keyboardType="decimal-pad"
                autoFocus
                testID="reading-ph-input"
              />

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.mutedForeground, marginTop: 16 },
                ]}
              >
                Temperature — optional
              </Text>
              <View style={styles.tempRow}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                      borderRadius: colors.radius,
                      fontFamily: "Inter_400Regular",
                    },
                  ]}
                  placeholder="e.g. 76"
                  placeholderTextColor={colors.mutedForeground}
                  value={readingTemp}
                  onChangeText={setReadingTemp}
                  keyboardType="decimal-pad"
                  testID="reading-temp-input"
                />
                <View
                  style={[
                    styles.unitToggle,
                    { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 10 },
                  ]}
                >
                  {(["F", "C"] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setReadingTempUnit(u)}
                      style={[
                        styles.unitBtn,
                        { backgroundColor: readingTempUnit === u ? colors.primary : "transparent", borderRadius: 8 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.unitBtnText,
                          { color: readingTempUnit === u ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        °{u}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.mutedForeground, marginTop: 16 },
                ]}
              >
                Note — optional
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                    minHeight: 72,
                    textAlignVertical: "top",
                    paddingTop: 10,
                  },
                ]}
                placeholder="Observations, smell, texture…"
                placeholderTextColor={colors.mutedForeground}
                value={readingNote}
                onChangeText={setReadingNote}
                multiline
                numberOfLines={3}
              />

              <Pressable
                onPress={logReading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                    marginTop: 24,
                  },
                ]}
                testID="save-reading-btn"
              >
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Save Reading
                </Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Top section toggle ─────────────────────────────────────────────── */}
      <View
        style={[
          styles.sectionToggleWrap,
          {
            paddingTop: insets.top + webTop + 16,
            paddingHorizontal: 20,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View
          style={[styles.sectionToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}
        >
          {(["track", "plan"] as const).map((sec) => (
            <Pressable
              key={sec}
              onPress={() => { setSection(sec); Haptics.selectionAsync(); }}
              style={[
                styles.sectionBtn,
                section === sec && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
              ]}
            >
              <Text
                style={[
                  styles.sectionBtnText,
                  {
                    color: section === sec ? colors.foreground : colors.mutedForeground,
                    fontFamily: section === sec ? "Inter_600SemiBold" : "Inter_400Regular",
                  },
                ]}
              >
                {sec === "track" ? "Track a Feed" : "Plan a Feed"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Track a Feed Section */}
      {section === "track" && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: insets.top + webTop + 16,
              paddingBottom: insets.bottom + tabBarPad + 24,
              paddingHorizontal: 20,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              entering={FadeIn.duration(400)}
              style={styles.appHeader}
            >
              <Text style={[styles.appTitle, { color: colors.foreground }]}>
                Bread Lab
              </Text>
              <Text
                style={[styles.appSubtitle, { color: colors.mutedForeground }]}
              >
                log your starter
              </Text>
            </Animated.View>

            {/* Feed Amounts */}
            <Animated.View entering={FadeInDown.delay(60).duration(400)}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Feed Amounts
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.inputRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text
                      style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
                    >
                      Starter (g)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          borderRadius: colors.radius,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 50"
                      placeholderTextColor={colors.mutedForeground}
                      value={starterWeight}
                      onChangeText={setStarterWeight}
                      keyboardType="decimal-pad"
                      testID="starter-weight-input"
                    />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text
                      style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
                    >
                      Flour (g)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          borderRadius: colors.radius,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 100"
                      placeholderTextColor={colors.mutedForeground}
                      value={flourWeightStr}
                      onChangeText={setFlourWeightStr}
                      keyboardType="decimal-pad"
                      testID="flour-weight-input"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}
                    >
                      Water (g)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          borderRadius: colors.radius,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 100"
                      placeholderTextColor={colors.mutedForeground}
                      value={waterWeightStr}
                      onChangeText={setWaterWeightStr}
                      keyboardType="decimal-pad"
                      testID="water-weight-input"
                    />
                  </View>
                </View>

                {/* Optional sugar field — a toggle reveals the weight input */}
                <View style={[styles.sugarRow, { borderTopColor: colors.border }]}>
                  <Pressable
                    onPress={() => {
                      setSugarEnabled((v) => !v);
                      if (sugarEnabled) setSugarWeightStr("");
                    }}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flex: 1,
                    })}
                  >
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>
                      Sugar (optional)
                    </Text>
                    {/* Minimal pill toggle */}
                    <View style={[styles.sugarToggle, { backgroundColor: sugarEnabled ? colors.accent : colors.border }]}>
                      <View style={[styles.sugarThumb, { alignSelf: sugarEnabled ? "flex-end" : "flex-start" }]} />
                    </View>
                  </Pressable>
                </View>
                {sugarEnabled && (
                  <View style={{ marginTop: 8 }}>
                    <TextInput
                      style={[styles.input, {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                        fontFamily: "Inter_400Regular",
                      }]}
                      placeholder="Sugar (g)"
                      placeholderTextColor={colors.mutedForeground}
                      value={sugarWeightStr}
                      onChangeText={setSugarWeightStr}
                      keyboardType="decimal-pad"
                      testID="sugar-weight-input"
                    />
                  </View>
                )}

                {derivedRatioStr ? (
                  <Animated.View entering={FadeIn.duration(250)} style={styles.calcRow}>
                    <View
                      style={[
                        styles.calcChip,
                        {
                          backgroundColor: colors.primary + "12",
                          borderColor: colors.primary + "28",
                        },
                      ]}
                    >
                      <Feather name="sliders" size={13} color={colors.primary} />
                      <Text style={[styles.calcChipText, { color: colors.primary }]}>
                        ratio {derivedRatioStr}
                      </Text>
                    </View>
                  </Animated.View>
                ) : (
                  <Text style={[styles.calcHint, { color: colors.mutedForeground }]}>
                    Enter all three weights to see ratio
                  </Text>
                )}
              </View>
            </Animated.View>

            {/* Flour Type Slider */}
            <Animated.View
              entering={FadeInDown.delay(100).duration(400)}
              style={{ marginTop: 20 }}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Flour Type
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <FlourSlider
                  wwPercent={wwPercent}
                  onChange={setWwPercent}
                  flourWeight={flourWeight}
                />
              </View>
            </Animated.View>

            {/* Initial Readings */}
            <Animated.View
              entering={FadeInDown.delay(160).duration(400)}
              style={{ marginTop: 20 }}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Initial Readings
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.inputRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text
                      style={[
                        styles.fieldLabel,
                        { color: colors.mutedForeground, textTransform: "none" },
                      ]}
                    >
                      pH
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          borderRadius: colors.radius,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 4.8"
                      placeholderTextColor={colors.mutedForeground}
                      value={initialPH}
                      onChangeText={setInitialPH}
                      keyboardType="decimal-pad"
                      testID="initial-ph-input"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.fieldLabel,
                        { color: colors.mutedForeground, textTransform: "none" },
                      ]}
                    >
                      Volume (mL)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                          borderRadius: colors.radius,
                          fontFamily: "Inter_400Regular",
                        },
                      ]}
                      placeholder="e.g. 200"
                      placeholderTextColor={colors.mutedForeground}
                      value={initialVolume}
                      onChangeText={setInitialVolume}
                      keyboardType="decimal-pad"
                      testID="initial-volume-input"
                    />
                  </View>
                </View>
              </View>
            </Animated.View>

            {/* Feed Photo */}
            <Animated.View
              entering={FadeInDown.delay(220).duration(400)}
              style={{ marginTop: 20 }}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Just Fed Photo
              </Text>
              <Pressable
                onPress={() =>
                  pickPhoto((uri) => {
                    setFedPhoto(uri);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  })
                }
                style={({ pressed }) => [
                  styles.photoPicker,
                  {
                    backgroundColor: fedPhoto ? "transparent" : colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.8 : 1,
                    borderStyle: fedPhoto ? "solid" : "dashed",
                  },
                ]}
                testID="fed-photo-btn"
              >
                {fedPhoto ? (
                  <View>
                    <Image
                      source={{ uri: fedPhoto }}
                      style={[
                        styles.photoPreview,
                        { borderRadius: colors.radius },
                      ]}
                    />
                    <View
                      style={[
                        styles.photoChangeOverlay,
                        { borderRadius: colors.radius },
                      ]}
                    >
                      <Feather name="refresh-cw" size={18} color="#fff" />
                    </View>
                  </View>
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Feather
                      name="camera"
                      size={28}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.photoPlaceholderText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Add a photo of your starter
                    </Text>
                  </View>
                )}
              </Pressable>
            </Animated.View>

            {/* Save Button */}
            <Animated.View
              entering={FadeInDown.delay(280).duration(400)}
              style={{ marginTop: 28 }}
            >
              <Pressable
                onPress={saveSession}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                testID="save-session-btn"
              >
                <Ionicons
                  name="timer-outline"
                  size={20}
                  color={colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Start Feed Timer
                </Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Plan a Feed Section */}
      {section === "plan" && (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 24,
            paddingBottom: insets.bottom + tabBarPad + 24,
            paddingHorizontal: 20,
            flexGrow: 1,
            justifyContent: "center",
            alignItems: "center",
          }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: "center" }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontSize: 24, marginBottom: 16 }]}>
              Plan a Feed
            </Text>
            <Text style={[styles.appSubtitle, { color: colors.mutedForeground, textAlign: "center", marginBottom: 32 }]}>
              Coming soon
            </Text>
          </Animated.View>
        </ScrollView>
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

const styles = StyleSheet.create({
  // Section toggle
  sectionToggleWrap: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionToggle: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  sectionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionBtnText: { fontSize: 14 },

  appHeader: { marginBottom: 28 },
  appTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    letterSpacing: 0.2,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  inputRow: { flexDirection: "row" },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: { height: 46, paddingHorizontal: 14, fontSize: 16, borderWidth: 1 },
  calcRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },
  calcChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  calcChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  calcHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 12,
  },
  photoPicker: {
    aspectRatio: 4 / 3,
    borderWidth: 1.5,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  photoPlaceholder: { alignItems: "center", gap: 10 },
  photoPlaceholderText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  photoPreview: { width: "100%", height: "100%" },
  photoChangeOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 6,
    borderRadius: 20,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    gap: 10,
  },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  ghostButton: { alignItems: "center", paddingVertical: 14 },
  ghostButtonText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: 1 },
  timerText: {
    fontSize: 52,
    fontFamily: "Inter_700Bold",
    letterSpacing: -2,
    marginTop: 4,
  },
  timerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    letterSpacing: 0.3,
  },
  ratioRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  ratioItem: { alignItems: "center", flex: 1 },
  ratioValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  ratioLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ratioColon: { fontSize: 22, fontFamily: "Inter_400Regular" },
  ratioBadge: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.3,
  },
  flourSplitRow: {
    flexDirection: "row",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    alignItems: "center",
  },
  flourSplitItem: { flex: 1, alignItems: "center" },
  flourSplitValue: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  flourSplitLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  flourSplitDivider: { width: 1, height: 36, marginHorizontal: 8 },
  readingsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    flexWrap: "wrap",
    gap: 16,
  },
  readingItem: { alignItems: "center", flex: 1 },
  readingValue: { fontSize: 22, fontFamily: "Inter_600SemiBold" },
  readingLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  peakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  peakBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sessionPhoto: { width: "100%", height: 220, borderWidth: 1 },
  modalContent: { paddingHorizontal: 20 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  autoCalcCard: { padding: 14, marginBottom: 20 },
  autoCalcLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  autoCalcValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  // Optional sugar toggle row
  sugarRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sugarToggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    padding: 2,
    justifyContent: "center",
  },
  sugarThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "white",
  },
  tempRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    padding: 3,
    height: 48,
    alignItems: "center",
  },
  unitBtn: {
    paddingHorizontal: 12,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  unitBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
