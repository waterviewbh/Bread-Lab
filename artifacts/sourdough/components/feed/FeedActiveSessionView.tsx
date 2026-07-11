import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
} from "react-native-reanimated";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// import { CopilotStep, walkthroughable } from "react-native-copilot"; red-tagged for web-0.1 rmv in 3 revs
import { TourStep, CopilotView } from "@/components/TourStep";

import { useColors } from "@/hooks/useColors";
import PHChart from "@/components/PHChart";
import type { SessionForChart, TempReading } from "@/components/PHChart";
import { FeedSession, Reading, PeakData } from "@/types/feed";
import AffiliateCarousel from "@/components/AffiliateCarousel";
import { formatDuration, formatTimeToPeak } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";
import { fonts } from "@/constants/theme";

// const CopilotView = walkthroughable(View);  red-tagged for web-0.1 rmv in 3 revs

interface Props {
  session: FeedSession;
  historyData: FeedSession[];
  onLogReading: (reading: Reading) => void;
  onSavePeak: (peak: PeakData) => void;
  onClearSession: () => void;
}

export default function FeedActiveSessionView({
  session,
  historyData,
  onLogReading,
  onSavePeak,
  onClearSession,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { tempUnit } = usePreferences();

  // --- Local State (Timer & Modals) ---
  const [elapsed, setElapsed] = useState(Date.now() - session.savedAt);
  const [showPeakModal, setShowPeakModal] = useState(false);
  const [peakPH, setPeakPH] = useState("");
  const [peakTemp, setPeakTemp] = useState("");
  const [peakVolume, setPeakVolume] = useState("");
  const [peakPhoto, setPeakPhoto] = useState<string | null>(null);

  const [showReadingModal, setShowReadingModal] = useState(false);
  const [readingPH, setReadingPH] = useState("");
  const [readingTemp, setReadingTemp] = useState("");
  const [readingVolume, setReadingVolume] = useState("");
  const [readingNote, setReadingNote] = useState("");
  const [expandedReadingIndex, setExpandedReadingIndex] = useState<number | null>(null);

  // Timer Effect
  useEffect(() => {
    if (session.peak) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - session.savedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);


  const pickPhoto = (onPhoto: (uri: string) => void) => {
    Alert.alert("Add Photo", "Choose source", [
      {
        text: "Camera",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
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
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission needed", "Photo library access is required.");
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

  const handleSavePeak = () => {
    // Require volume for peak
    if (!peakVolume.trim() || isNaN(parseFloat(peakVolume)) || parseFloat(peakVolume) <= 0) {
      Alert.alert("Missing Peak Volume", "Please enter the peak volume (mL) before saving.");
      return;
    }
    const peakVol = parseFloat(peakVolume);
    const initVol = parseFloat(session.initialVolume);
    const volumeIncreasePct =
      initVol > 0 && peakVol > 0
        ? Math.round(((peakVol - initVol) / initVol) * 100 * 10) / 10
        : 0;
    const timeToPeakMs = Date.now() - session.savedAt;

    onSavePeak({
      pH: peakPH,
      temp: peakTemp,            // Include temp
      tempUnit: tempUnit as "F" | "C", // Include global unit
      volume: peakVolume,
      photo: peakPhoto,
      loggedAt: Date.now(),
      volumeIncreasePct,
      timeToPeakMs,
    });

    setShowPeakModal(false);
    setPeakPH("");
    setPeakTemp("");
    setPeakVolume("");
    setPeakPhoto(null);
  };

  const handleLogReading = () => {
    const ph = readingPH.trim();
    const temp = readingTemp.trim();
    const vol = readingVolume.trim();
    const note = readingNote.trim();

    // pH is now optional, but we want at least one field to be logged
    if (!ph && !temp && !vol && !note) {
      Alert.alert("Empty Reading", "Please enter at least one value (pH, Temp, Volume, or Note).");
      return;
    }
    onLogReading({
      pH: readingPH.trim(),
      temp: readingTemp.trim(),
      tempUnit: tempUnit as "F" | "C", // Use global preference from usePreferences()
      volume: readingVolume.trim(),
      note: readingNote.trim(),
      loggedAt: Date.now(),
    });
    setShowReadingModal(false);
    setReadingPH("");
    setReadingTemp("");
    setReadingVolume("");
    setReadingNote("");
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  const apPct = 100 - session.wwPercent;
  const apGrams = session.flourWeight > 0
    ? Math.round(session.flourWeight * (apPct / 100) * 10) / 10
    : null;
  const wwGrams = session.flourWeight > 0
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
        <TourStep order={1} name="app-name">
          <CopilotView style={styles.appHeader}>
            <Text style={[styles.appTitle, { color: colors.foreground }]}>
              Bread Lab
            </Text>
            <Text style={[styles.appSubtitle, { color: colors.mutedForeground }]}>
              {session.peak ? "log a feed" : "watching it rise"}
            </Text>
          </CopilotView>
        </TourStep>

        <Animated.View entering={FadeInDown.duration(500)}>
          <TourStep order={3} name="active-timer">
            <CopilotView>
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
            </CopilotView>
          </TourStep>
        </Animated.View>

        <View
          style={[
            styles.divider,
            { backgroundColor: colors.border, marginVertical: 24 },
          ]}
        />

        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Feed Ratios
          </Text>
          <TourStep order={4} name="feed-ratios-input">
            <CopilotView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.ratioRow}>
                <View style={styles.ratioItem}>
                  <Text style={[styles.ratioValue, { color: colors.primary }]}>
                    {session.starterWeight}g
                  </Text>
                  <Text style={[styles.ratioLabel, { color: colors.mutedForeground }]}>
                    Starter
                  </Text>
                </View>
                <Text style={[styles.ratioColon, { color: colors.border }]}>:</Text>
                <View style={styles.ratioItem}>
                  <Text style={[styles.ratioValue, { color: colors.primary }]}>
                    {session.flourWeight}g
                  </Text>
                  <Text style={[styles.ratioLabel, { color: colors.mutedForeground }]}>
                    Flour
                  </Text>
                </View>
                <Text style={[styles.ratioColon, { color: colors.border }]}>:</Text>
                <View style={styles.ratioItem}>
                  <Text style={[styles.ratioValue, { color: colors.primary }]}>
                    {session.waterWeight}g
                  </Text>
                  <Text style={[styles.ratioLabel, { color: colors.mutedForeground }]}>
                    Water
                  </Text>
                </View>
              </View>
              <Text style={[styles.ratioBadge, { color: colors.mutedForeground }]}>
                ratio {session.ratioStr}
              </Text>

              {session.wwPercent > 0 && session.wwPercent < 100 && (
                <View style={[styles.flourSplitRow, { borderTopColor: colors.border }]}>
                  <View style={styles.flourSplitItem}>
                    <Text style={[styles.flourSplitValue, { color: colors.primary }]}>{apGrams}g</Text>
                    <Text style={[styles.flourSplitLabel, { color: colors.mutedForeground }]}>AP ({apPct}%)</Text>
                  </View>
                  <View style={[styles.flourSplitDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.flourSplitItem}>
                    <Text style={[styles.flourSplitValue, { color: colors.accent }]}>{wwGrams}g</Text>
                    <Text style={[styles.flourSplitLabel, { color: colors.mutedForeground }]}>WW ({session.wwPercent}%)</Text>
                  </View>
                </View>
              )}
              {session.wwPercent === 100 && (
                <View style={[styles.flourSplitRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.flourSplitValue, { color: colors.accent, textAlign: "center", flex: 1 }]}>
                    100% Whole Wheat · {session.flourWeight}g
                  </Text>
                </View>
              )}
              {session.wwPercent === 0 && (
                <View style={[styles.flourSplitRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.flourSplitValue, { color: colors.primary, textAlign: "center", flex: 1 }]}>
                    100% All-Purpose · {session.flourWeight}g
                  </Text>
                </View>
              )}
            </CopilotView>
          </TourStep>
        </Animated.View>

        {/* Unified Feed Readings Section */}
        <Animated.View entering={FadeInDown.delay(175).duration(400)} style={{ marginTop: 24 }}>
          <TourStep order={5} name="live-data-log">
            <CopilotView style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0, textTransform: "none" }]}>Feed Readings</Text>
              {!session.peak && (
                <Pressable onPress={() => setShowReadingModal(true)} style={({ pressed }) => [styles.calcChip, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30", opacity: pressed ? 0.7 : 1 }]}>
                  <Feather name="plus" size={12} color={colors.primary} />
                  <Text style={[styles.calcChipText, { color: colors.primary, fontSize: 13 }]}>Log Reading</Text>
                </Pressable>
              )}
            </CopilotView>
          </TourStep>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: "hidden" }]}>
            {/* Table Header */}
            <View style={{ flexDirection: "row", backgroundColor: colors.secondary + "20", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, width: 75 }]}>Time</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1, textAlign: 'center' }]}>pH</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1, textAlign: 'center' }]}>Temp (°{tempUnit})</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1, textAlign: 'center' }]}>Volume (mL)</Text>
            </View>

            {/* Initial Reading Row (t=0) */}
            {(session.initialPH || session.initialTemp || session.initialVolume) && (
              <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: (session.readings?.length ?? 0) > 0 ? 1 : 0, borderBottomColor: colors.border }}>
                <Text style={[styles.readCol, { color: colors.mutedForeground, width: 75 }]}>0m</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: fonts.sansSemiBold, textAlign: 'center' }]}>{session.initialPH || "—"}</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: fonts.mono, textAlign: 'center' }]}>{session.initialTemp ? `${session.initialTemp}°` : "—"}</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: fonts.mono, textAlign: 'center' }]}>{session.initialVolume ? `${session.initialVolume}` : "—"}</Text>
              </View>
            )}

            {/* Logged Readings */}
            {session.readings && session.readings.length > 0 ? (
              session.readings.map((r, i) => {
                const elapsedMs = r.loggedAt - session.savedAt;
                const hh = Math.floor(elapsedMs / 3600000);
                const mm = Math.floor((elapsedMs % 3600000) / 60000);
                const timeStr = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
                const isExpanded = expandedReadingIndex === i;
                const hasNote = !!r.note;
                const isLast = i === session.readings!.length - 1;

                return (
                  <View key={i} style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border }}>
                    <Pressable
                      onPress={hasNote ? () => setExpandedReadingIndex(isExpanded ? null : i) : undefined}
                      style={{ paddingHorizontal: 16, paddingVertical: 12 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={[styles.readCol, { color: hasNote ? colors.primary : colors.mutedForeground, width: 75 }]}>{timeStr}</Text>
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: fonts.sansSemiBold, textAlign: 'center' }]}>{r.pH}</Text>
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'center' }]}>{r.temp ? `${r.temp}°` : "—"}</Text>
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'center' }]}>{r.volume ? `${r.volume}` : "—"}</Text>
                      </View>
                      {hasNote && (
                        <Text numberOfLines={isExpanded ? undefined : 1} style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4, fontStyle: "italic", paddingLeft: 75 }}>
                          "{r.note}"
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            ) : (
              !session.initialPH && !session.initialTemp && !session.initialVolume && (
                <Text style={{ padding: 24, textAlign: "center", color: colors.mutedForeground, fontSize: 13 }}>
                  No readings logged yet.
                </Text>
              )
            )}
          </View>
        </Animated.View>

        {/* Live pH chart */}
        {((session.readings?.length ?? 0) > 0 ||
          (!!session.initialPH && !isNaN(parseFloat(session.initialPH))) ||
          (!!session.initialTemp && !isNaN(parseFloat(session.initialTemp)))) && (
          <Animated.View
            entering={FadeInDown.delay(150).duration(400)}
            style={{ marginTop: 20 }}
          >
            <TourStep order={8} name="feed-trends">
              <CopilotView>
                <PHChart
                  session={session as SessionForChart}
                  history={historyData as SessionForChart[]}
                  tempReadings={[
                    // 1. Prepend the initial temperature at 0 minutes
                    ...(session.initialTemp && !isNaN(parseFloat(session.initialTemp))
                      ? [
                          {
                            elapsedMin: 0,
                            temp: parseFloat(session.initialTemp),
                            tempUnit: tempUnit as "F" | "C",
                          } as TempReading,
                        ]
                      : []),
                    // 2. Map the rest of the log as usual
                    ...(session.readings ?? [])
                      .filter(
                        (r): r is typeof r & { temp: string; tempUnit: "F" | "C" } =>
                          !!r.temp &&
                          !isNaN(parseFloat(r.temp)) &&
                          (r.tempUnit === "F" || r.tempUnit === "C")
                      )
                      .map<TempReading>((r) => ({
                        elapsedMin: (r.loggedAt - session.savedAt) / 60000,
                        temp: parseFloat(r.temp),
                        tempUnit: r.tempUnit as "F" | "C",
                      })),
                  ]}
                />
              </CopilotView>
            </TourStep>
          </Animated.View>
        )}

        {session.fedPhoto && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Just Fed</Text>
            <Image source={{ uri: session.fedPhoto }} style={[styles.sessionPhoto, { borderRadius: colors.radius, borderColor: colors.border }]} />
          </Animated.View>
        )}

        {session.peak && (
          <Animated.View entering={FadeInDown.delay(250).duration(400)} style={{ marginTop: 20 }}>
            <View style={[styles.peakBadge, { backgroundColor: colors.accent + "18", borderColor: colors.accent + "40" }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={[styles.peakBadgeText, { color: colors.accent }]}>Peak Reached</Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
              <View style={styles.readingsRow}>
                {session.peak.pH ? (
                  <View style={styles.readingItem}>
                    <Text style={[styles.readingValue, { color: colors.foreground }]}>{session.peak.pH}</Text>
                    <Text style={[styles.readingLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Peak pH</Text>
                  </View>
                ) : null}
                {session.peak.volume ? (
                  <View style={styles.readingItem}>
                    <Text style={[styles.readingValue, { color: colors.foreground }]}>{session.peak.volume}mL</Text>
                    <Text style={[styles.readingLabel, { color: colors.mutedForeground }]}>Peak Vol</Text>
                  </View>
                ) : null}
                {session.peak.volumeIncreasePct > 0 && (
                  <View style={styles.readingItem}>
                    <Text style={[styles.readingValue, { color: colors.accent }]}>+{session.peak.volumeIncreasePct}%</Text>
                    <Text style={[styles.readingLabel, { color: colors.mutedForeground }]}>Rise</Text>
                  </View>
                )}
              </View>
            </View>
            {session.peak.photo && <Image source={{ uri: session.peak.photo }} style={[styles.sessionPhoto, { borderRadius: colors.radius, borderColor: colors.border, marginTop: 12 }]} />}
          </Animated.View>
        )}

        <View style={{ height: 32 }} />

        {!session.peak && (
          <Animated.View entering={FadeInUp.delay(300).duration(400)}>
            <TourStep order={9} name="mark-as-peak">
              <CopilotView>
                <Pressable onPress={() => setShowPeakModal(true)} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.accent, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}>
                  <Ionicons name="trending-up" size={20} color={colors.accentForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>Mark as Peak</Text>
                </Pressable>
              </CopilotView>
            </TourStep>
          </Animated.View>
        )}
        {/* Affiliate product carousel — shown while session is active */}
        <AffiliateCarousel />

        <Pressable onPress={onClearSession} style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.5 : 1, marginTop: 12 }]}>
          <Text style={[styles.ghostButtonText, { color: colors.mutedForeground }]}>New Session</Text>
        </Pressable>
        {/* Tour transition anchor — zero-height, sits just above tab bar.
            Only the tooltip matters; no highlight hole needed here. */}
        <TourStep order={10} name="next-chapter-is-graph" >
          <CopilotView>
            <View style={{ height: 0 }} />
          </CopilotView>
        </TourStep>
      </ScrollView>

        {/* Log Peak Modal */}
        <Modal visible={showPeakModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPeakModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView contentContainerStyle={[styles.modalContent, { paddingTop: insets.top + webTop + 24, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32 }]} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log Peak</Text>
                <Pressable onPress={() => setShowPeakModal(false)}><Ionicons name="close" size={24} color={colors.foreground} /></Pressable>
              </View>

              {/* Top Card: Time and Rise */}
              <View style={[styles.autoCalcCard, { backgroundColor: colors.secondary, borderRadius: colors.radius, marginBottom: 16, flexDirection: 'row' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.autoCalcLabel, { color: colors.mutedForeground }]}>Time to Peak</Text>
                  <Text style={[styles.autoCalcValue, { color: colors.foreground }]}>{formatTimeToPeak(elapsed)}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 16, opacity: 0.5 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.autoCalcLabel, { color: colors.mutedForeground }]}>Total Rise</Text>
                  <Text style={[styles.autoCalcValue, { color: colors.accent }]}>
                    {(() => {
                      const pv = parseFloat(peakVolume);
                      const iv = parseFloat(session.initialVolume);
                      return iv > 0 && pv > 0 ? `+${Math.round(((pv - iv) / iv) * 100)}%` : "—";
                    })()}
                  </Text>
                </View>
              </View>

              {/* 3-Column Inputs: pH, Temp, Volume */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, marginBottom: 20 }]}>
                <View style={styles.readingsRow}>
                  <View style={styles.readingItem}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Peak pH</Text>
                    <TextInput
                      style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                      placeholder="3.9"
                      value={peakPH}
                      onChangeText={setPeakPH}
                      keyboardType="decimal-pad"
                      autoFocus
                    />
                  </View>

                  <View style={styles.readingItem}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Temp (°{tempUnit})</Text>
                    <TextInput
                      style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                      placeholder="76"
                      value={peakTemp}
                      onChangeText={setPeakTemp}
                      keyboardType="decimal-pad"
                    />
                  </View>

                  <View style={styles.readingItem}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Vol (mL)</Text>
                    <TextInput
                      style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                      placeholder="200"
                      value={peakVolume}
                      onChangeText={setPeakVolume}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Peak Photo</Text>
              <Pressable onPress={() => pickPhoto((uri) => { setPeakPhoto(uri); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); })} style={[styles.photoPicker, { backgroundColor: peakPhoto ? "transparent" : colors.card, borderColor: colors.border, borderRadius: colors.radius, borderStyle: peakPhoto ? "solid" : "dashed" }]}>
                {peakPhoto ? <Image source={{ uri: peakPhoto }} style={[styles.photoPreview, { borderRadius: colors.radius }]} /> : <View style={styles.photoPlaceholder}><Feather name="camera" size={24} color={colors.mutedForeground} /><Text style={[styles.photoPlaceholderText, { color: colors.mutedForeground }]}>Add peak photo</Text></View>}
              </Pressable>

              <Pressable onPress={handleSavePeak} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1, marginTop: 24 }]}>
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Save Peak</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

            {/* Log Reading Modal */}
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
                      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32
                    }
                  ]}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                      Log Reading
                    </Text>
                    <Pressable onPress={() => setShowReadingModal(false)}>
                      <Ionicons name="close" size={24} color={colors.foreground} />
                    </Pressable>
                  </View>

                  {/* Auto Calculation Card */}
                  <View style={[styles.autoCalcCard, { backgroundColor: colors.secondary, borderRadius: colors.radius, marginBottom: 16 }]}>
                    <Text style={[styles.autoCalcLabel, { color: colors.mutedForeground }]}>
                      Time Since Feed
                    </Text>
                    <Text style={[styles.autoCalcValue, { color: colors.foreground }]}>
                      {formatDuration(elapsed)}
                    </Text>
                  </View>

                  {/* 3-Column Inputs matching Initial Readings */}
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, marginBottom: 20 }]}>
                    <View style={styles.readingsRow}>
                      {/* pH */}
                      <View style={styles.readingItem}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                        <TextInput
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                          placeholder="4.2"
                          value={readingPH}
                          onChangeText={setReadingPH}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                      </View>

                      {/* Temp */}
                      <View style={styles.readingItem}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Temp (°{tempUnit})</Text>
                        <TextInput
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                          placeholder="76"
                          value={readingTemp}
                          onChangeText={setReadingTemp}
                          keyboardType="decimal-pad"
                        />
                      </View>

                      {/* Volume */}
                      <View style={styles.readingItem}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Vol (mL)</Text>
                        <TextInput
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono, textAlign: 'center' }]}
                          placeholder="200"
                          value={readingVolume}
                          onChangeText={setReadingVolume}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                  </View>

                  {/* Notes Input */}
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
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
                        fontFamily: fonts.sans,
                        minHeight: 80,
                        textAlignVertical: "top",
                        paddingTop: 12
                      }
                    ]}
                    placeholder="Observations, smell, texture…"
                    value={readingNote}
                    onChangeText={setReadingNote}
                    multiline
                    numberOfLines={3}
                  />

                  {/* Submit Button */}
                  <Pressable
                    onPress={handleLogReading}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.85 : 1,
                        marginTop: 24
                      }
                    ]}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                      Save Reading
                    </Text>
                  </Pressable>
                </ScrollView>
              </KeyboardAvoidingView>
            </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Page structure ─────────────────────────────────────────────────────────
  appHeader: { marginBottom: 28 },
  appTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — page title
    fontSize: 28,
    letterSpacing: -0.5,
  },
  modalTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — modal sheet title
    fontSize: 24,
    letterSpacing: -0.5,
  },
  timerText: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — fermentation elapsed timer
    fontSize: 52,
    letterSpacing: -2,
    color: "#5d3a26",
  },
  appSubtitle: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "watching it rise"
    fontSize: 14,
    marginTop: 2,
  },
// ── Section labels ─────────────────────────────────────────────────────────
  sectionTitle: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — uppercase section header
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — "Time Since Feed" eyebrow
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  fieldLabel: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — input field labels
    fontSize: 12,
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: "uppercase",
  },
// ── Cards & layout ─────────────────────────────────────────────────────────
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  divider: { height: 1 },
  modalContent: { paddingHorizontal: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },  // ── Input ──────────────────────────────────────────────────────────────────
  input: {
    height: 46,
    paddingHorizontal: 0,
    fontSize: 16,
    borderWidth: 1,
    // fontFamily set inline per instance — fonts.mono for numeric data fields
  },
// ── Chip / button ──────────────────────────────────────────────────────────
  calcChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  calcChipText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Log Reading" chip label
    fontSize: 14,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    gap: 10,
  },
  primaryButtonText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Save Peak", "Mark as Peak"
    fontSize: 16,
  },
  ghostButton: { alignItems: "center", paddingVertical: 14 },
  ghostButtonText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "New Session"
    fontSize: 15,
  },
// ── Photo picker ───────────────────────────────────────────────────────────
  photoPicker: {
    aspectRatio: 4 / 3,
    borderWidth: 1.5,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  photoPlaceholder: { alignItems: "center", gap: 10 },
  photoPlaceholderText: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "Add peak photo"
    fontSize: 14,
  },
  photoPreview: { width: "100%", height: "100%" },
  sessionPhoto: { width: "100%", height: 220, borderWidth: 1 },
  // ── Feed ratio card ────────────────────────────────────────────────────────
  ratioRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  ratioItem: { alignItems: "center", flex: 1 },
  ratioValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — starter/flour/water gram values
    fontSize: 22,
    letterSpacing: -0.5,
  },
  ratioLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "Starter", "Flour", "Water"
    fontSize: 12,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ratioColon: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — punctuation separator
    fontSize: 22,
  },
  ratioBadge: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — "ratio 1:2:2" is data
    textAlign: "center",
    marginTop: 12,
    fontSize: 12,
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
  flourSplitValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — gram weights are numeric data
    fontSize: 18,
  },
  flourSplitLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "AP (70%)" description label
    fontSize: 11,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  flourSplitDivider: { width: 1, height: 36, marginHorizontal: 8 },
  // ── Readings table ─────────────────────────────────────────────────────────
  headerCol: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — "Time", "pH", "Temp", "Volume"
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  readCol: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — all table cell data values
    fontSize: 14,
  },
  readingsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    flexWrap: "wrap",
    gap: 16,
  },
  readingItem: { alignItems: "center", flex: 1 },
  readingValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — peak pH, volume, rise %
    fontSize: 22,
  },
  readingLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — "Peak pH", "Rise" labels
    fontSize: 12,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
// ── Peak badge ─────────────────────────────────────────────────────────────
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
  peakBadgeText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Peak Reached"
    fontSize: 13,
  },
// ── Auto-calc card ─────────────────────────────────────────────────────────
  autoCalcCard: { padding: 14, marginBottom: 20 },
  autoCalcLabel: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — "Time to Peak", "Total Rise"
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  autoCalcValue: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — calculated time/percentage values
    fontSize: 22,
    letterSpacing: -0.5,
  },
// ── Unit toggle ────────────────────────────────────────────────────────────
  tempRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  unitToggle: { flexDirection: "row", borderWidth: 1, padding: 3, height: 48, alignItems: "center" },
  unitBtn: { paddingHorizontal: 12, height: 36, alignItems: "center", justifyContent: "center" },
  unitBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "°F" / "°C" toggle
    fontSize: 14,
  },
});