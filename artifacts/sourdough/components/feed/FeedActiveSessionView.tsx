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
import { CopilotStep, walkthroughable } from "react-native-copilot";

import { useColors } from "@/hooks/useColors";
import PHChart from "@/components/PHChart";
import type { SessionForChart, TempReading } from "@/components/PHChart";
import { FeedSession, Reading, PeakData } from "@/types/feed";
import { formatDuration, formatTimeToPeak } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";

const CopilotView = walkthroughable(View);

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
    const peakVol = parseFloat(peakVolume);
    const initVol = parseFloat(session.initialVolume);
    const volumeIncreasePct =
      initVol > 0 && peakVol > 0
        ? Math.round(((peakVol - initVol) / initVol) * 100 * 10) / 10
        : 0;
    const timeToPeakMs = Date.now() - session.savedAt;

    onSavePeak({
      pH: peakPH,
      volume: peakVolume,
      photo: peakPhoto,
      loggedAt: Date.now(),
      volumeIncreasePct,
      timeToPeakMs,
    });

    setShowPeakModal(false);
    setPeakPH("");
    setPeakVolume("");
    setPeakPhoto(null);
  };

  const handleLogReading = () => {
    if (!readingPH.trim()) {
      Alert.alert("Enter pH", "Please enter a pH value before saving.");
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
        <CopilotStep
          name="app-name"
          order={1}
          text="Welcome to the Bread Lab! This app helps turn bakers into scientists, and back again. Start here by logging your starter's feeds."
        >
          <CopilotView style={styles.appHeader}>
            <Text style={[styles.appTitle, { color: colors.foreground }]}>
              Bread Lab
            </Text>
            <Text style={[styles.appSubtitle, { color: colors.mutedForeground }]}>
              {session.peak ? "log a feed" : "watching it rise"}
            </Text>
          </CopilotView>
        </CopilotStep>

        <Animated.View entering={FadeInDown.duration(500)}>
          <CopilotStep
            name="active-timer"
            order={4}
            text="This timer tracks exactly how long your starter has been fermenting."
          >
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
          </CopilotStep>
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
          <CopilotStep text="Enter your starter, flour, and water weights here." order={5} name="feed-ratios-input">
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
          </CopilotStep>
        </Animated.View>

        {/* Unified Feed Readings Section */}
        <Animated.View entering={FadeInDown.delay(175).duration(400)} style={{ marginTop: 24 }}>
          <CopilotStep text="A timeline of your starter's vitality: pH, Temp, and Volume readings." order={6} name="live-data-log">
            <CopilotView style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0, textTransform: "none" }]}>Feed Readings</Text>
              {!session.peak && (
                <Pressable onPress={() => setShowReadingModal(true)} style={({ pressed }) => [styles.calcChip, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30", opacity: pressed ? 0.7 : 1 }]}>
                  <Feather name="plus" size={12} color={colors.primary} />
                  <Text style={[styles.calcChipText, { color: colors.primary, fontSize: 13 }]}>Log Reading</Text>
                </Pressable>
              )}
            </CopilotView>
          </CopilotStep>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: "hidden" }]}>
            {/* Table Header */}
            <View style={{ flexDirection: "row", backgroundColor: colors.secondary + "20", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, width: 75 }]}>Time</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1 }]}>pH</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1, textAlign: 'center' }]}>Temp (°{tempUnit})</Text>
              <Text style={[styles.headerCol, { color: colors.mutedForeground, flex: 1, textAlign: 'right' }]}>Volume</Text>
            </View>

            {/* Initial Reading Row (t=0) */}
            {(session.initialPH || session.initialTemp || session.initialVolume) && (
              <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: (session.readings?.length ?? 0) > 0 ? 1 : 0, borderBottomColor: colors.border }}>
                <Text style={[styles.readCol, { color: colors.mutedForeground, width: 75 }]}>0m</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: "Inter_600SemiBold" }]}>{session.initialPH || "—"}</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'center' }]}>{session.initialTemp ? `${session.initialTemp}°` : "—"}</Text>
                <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'right' }]}>{session.initialVolume ? `${session.initialVolume}mL` : "—"}</Text>
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
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, fontFamily: "Inter_600SemiBold" }]}>{r.pH}</Text>
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'center' }]}>{r.temp ? `${r.temp}°` : "—"}</Text>
                        <Text style={[styles.readCol, { color: colors.foreground, flex: 1, textAlign: 'right' }]}>{r.volume ? `${r.volume}mL` : "—"}</Text>
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
            <CopilotStep
              text="Elapsed time along the bottom, pH on the left axis, and temperature on the right. A graph of your real-time log."
              order={9}
              name="feed-trends"
            >
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
            </CopilotStep>
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
            <CopilotStep text="Once your starter reaches its peak, mark the refresh complete..." order={10} name="mark-as-peak">
              <CopilotView>
                <Pressable onPress={() => setShowPeakModal(true)} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.accent, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}>
                  <Ionicons name="trending-up" size={20} color={colors.accentForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>Mark as Peak</Text>
                </Pressable>
              </CopilotView>
            </CopilotStep>
          </Animated.View>
        )}

        <Pressable onPress={onClearSession} style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.5 : 1, marginTop: 12 }]}>
          <Text style={[styles.ghostButtonText, { color: colors.mutedForeground }]}>New Session</Text>
        </Pressable>
      </ScrollView>

      {/* Log Peak Modal */}
      <Modal visible={showPeakModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPeakModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.background }}>
          <ScrollView contentContainerStyle={[styles.modalContent, { paddingTop: insets.top + webTop + 24, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32 }]} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log Peak</Text>
              <Pressable onPress={() => setShowPeakModal(false)}><Ionicons name="close" size={24} color={colors.foreground} /></Pressable>
            </View>
            <View style={[styles.autoCalcCard, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
              <Text style={[styles.autoCalcLabel, { color: colors.mutedForeground }]}>Time to Peak (auto-calculated on save)</Text>
              <Text style={[styles.autoCalcValue, { color: colors.foreground }]}>{formatTimeToPeak(elapsed)}</Text>
            </View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Peak pH</Text>
            <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]} placeholder="e.g. 4.2" value={peakPH} onChangeText={setPeakPH} keyboardType="decimal-pad" />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Peak Volume (mL)</Text>
            <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]} placeholder="e.g. 320" value={peakVolume} onChangeText={setPeakVolume} keyboardType="decimal-pad" />
            {session.initialVolume && peakVolume ? (
              <View style={[styles.autoCalcCard, { backgroundColor: colors.accent + "18", borderColor: colors.accent + "30", borderWidth: 1, borderRadius: colors.radius }]}>
                <Text style={[styles.autoCalcLabel, { color: colors.accent }]}>Volume Increase</Text>
                <Text style={[styles.autoCalcValue, { color: colors.accent }]}>
                  {(() => {
                    const pv = parseFloat(peakVolume); const iv = parseFloat(session.initialVolume);
                    return iv > 0 && pv > 0 ? `+${Math.round(((pv - iv) / iv) * 100 * 10) / 10}%` : "—";
                  })()}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Peak Photo</Text>
            <Pressable onPress={() => pickPhoto((uri) => { setPeakPhoto(uri); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); })} style={[styles.photoPicker, { backgroundColor: peakPhoto ? "transparent" : colors.card, borderColor: colors.border, borderRadius: colors.radius, borderStyle: peakPhoto ? "solid" : "dashed" }]}>
              {peakPhoto ? <Image source={{ uri: peakPhoto }} style={[styles.photoPreview, { borderRadius: colors.radius }]} /> : <View style={styles.photoPlaceholder}><Feather name="camera" size={24} color={colors.mutedForeground} /><Text style={[styles.photoPlaceholderText, { color: colors.mutedForeground }]}>Add peak photo</Text></View>}
            </Pressable>
            <Pressable onPress={handleSavePeak} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1, marginTop: 8 }]}>
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
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular", textAlign: 'center' }]}
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
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular", textAlign: 'center' }]}
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
                          style={[styles.input, { width: '100%', backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular", textAlign: 'center' }]}
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
                        fontFamily: "Inter_400Regular",
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
  appHeader: { marginBottom: 28 },
  appTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  appSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_500Medium", letterSpacing: 0.4, textTransform: "uppercase" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 46, paddingHorizontal: 14, fontSize: 16, borderWidth: 1 },
  calcChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  calcChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  photoPicker: { aspectRatio: 4 / 3, borderWidth: 1.5, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  photoPlaceholder: { alignItems: "center", gap: 10 },
  photoPlaceholderText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  photoPreview: { width: "100%", height: "100%" },
  primaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 52, gap: 10 },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  ghostButton: { alignItems: "center", paddingVertical: 14 },
  ghostButtonText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: 1 },
  timerText: { fontSize: 52, fontFamily: "Inter_700Bold", letterSpacing: -2, marginTop: 4 },
  ratioRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  ratioItem: { alignItems: "center", flex: 1 },
  ratioValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  ratioLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  ratioColon: { fontSize: 22, fontFamily: "Inter_400Regular" },
  ratioBadge: { textAlign: "center", marginTop: 12, fontSize: 12, fontFamily: "Inter_400Regular", letterSpacing: 0.3 },
  flourSplitRow: { flexDirection: "row", marginTop: 14, paddingTop: 14, borderTopWidth: 1, alignItems: "center" },
  flourSplitItem: { flex: 1, alignItems: "center" },
  flourSplitValue: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  flourSplitLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  flourSplitDivider: { width: 1, height: 36, marginHorizontal: 8 },
  headerCol: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  readCol: { fontSize: 14, fontFamily: "Inter_400Regular" },
  readingsRow: { flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap", gap: 16 },
  readingItem: { alignItems: "center", flex: 1 },
  readingValue: { fontSize: 22, fontFamily: "Inter_600SemiBold" },
  readingLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  peakBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start" },
  peakBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sessionPhoto: { width: "100%", height: 220, borderWidth: 1 },
  modalContent: { paddingHorizontal: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  modalTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  autoCalcCard: { padding: 14, marginBottom: 20 },
  autoCalcLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  autoCalcValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  tempRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  unitToggle: { flexDirection: "row", borderWidth: 1, padding: 3, height: 48, alignItems: "center" },
  unitBtn: { paddingHorizontal: 12, height: 36, alignItems: "center", justifyContent: "center" },
  unitBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});