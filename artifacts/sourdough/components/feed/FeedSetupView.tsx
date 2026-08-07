// artifacts/sourdough/components/feed/FeedSetupView.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TourStep, CopilotView } from "@/components/TourStep";
import { useTour } from '@/contexts/TourContext';

import { useColors } from "@/hooks/useColors";
import FlourSlider from "@/components/FlourSlider";
import AffiliateCarousel from "@/components/AffiliateCarousel";
import { calcRatioStr } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";

import { FeedSession } from "@/types/feed";
import { fonts, spacing, radius, typography } from "@/constants/theme";

import { useLocalSearchParams } from "expo-router";

interface Props {
  historyData: FeedSession[];
  onStartFeed: (data: {
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
  }) => void;
}

export default function FeedSetupView({ onStartFeed, historyData }: Props) {
  const params = useLocalSearchParams<{ starter?: string, flour?: string, water?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { tempUnit } = usePreferences();

  // --- Local State ---
  const [starterWeight, setStarterWeight] = useState("");
  const [flourWeightStr, setFlourWeightStr] = useState("");
  const [waterWeightStr, setWaterWeightStr] = useState("");
  const [sugarEnabled, setSugarEnabled] = useState(false);
  const [sugarWeightStr, setSugarWeightStr] = useState("");
  const [wwPercent, setWwPercent] = useState(0);
  const [initialPH, setInitialPH] = useState("");
  const [initialTemp, setInitialTemp] = useState("");
  const [initialVolume, setInitialVolume] = useState("");
  const [fedPhoto, setFedPhoto] = useState<string | null>(null);

  // Auto-fill weights if they arrive via navigation from Lab Hub
  useEffect(() => {
    if (params.starter) setStarterWeight(params.starter);
    if (params.flour) setFlourWeightStr(params.flour);
    if (params.water) setWaterWeightStr(params.water);
  }, [params]);

  const { registerScrollView } = useTour();
  const tourScrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    registerScrollView(tourScrollViewRef.current);
    return () => registerScrollView(null);
  }, [registerScrollView]);

  // --- Derived ---
  const sw = parseFloat(starterWeight);
  const fw = parseFloat(flourWeightStr);
  const ww = parseFloat(waterWeightStr);
  const flourWeight = fw > 0 ? fw : null;
  const sugarWeight = sugarEnabled ? parseFloat(sugarWeightStr) : undefined;
  const derivedRatioStr =
    sw > 0 && fw > 0 && ww > 0 ? calcRatioStr(sw, fw, ww, sugarWeight) : null;

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

  const handleStart = () => {
    if (!sw || sw <= 0 || !fw || fw <= 0 || !ww || ww <= 0) {
      Alert.alert("Missing info", "Enter valid starter, flour and water weights.");
      return;
    }

    if (!initialVolume.trim() || isNaN(parseFloat(initialVolume)) || parseFloat(initialVolume) <= 0) {
      Alert.alert("Missing Volume", "Please enter an initial volume (mL) to start tracking.");
      return;
    }

    onStartFeed({
      starterWeight,
      flourWeight: fw,
      waterWeight: ww,
      wwPercent,
      initialPH,
      initialTemp,
      initialTempUnit: tempUnit,
      initialVolume,
      fedPhoto,
      sugarWeight: sugarEnabled && sugarWeight && sugarWeight > 0 ? sugarWeight : undefined,
    });
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const tabBarPad = Platform.OS === "web" ? 84 : 60;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={tourScrollViewRef}
          contentContainerStyle={{
            paddingTop: insets.top + webTop + 16,
            paddingBottom: insets.bottom + tabBarPad + 24,
            paddingHorizontal: 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn.duration(400)} style={styles.appHeader}>
            <Text style={[styles.appTitle, { color: colors.foreground }]}>Feed Tracker</Text>
            <Text style={[styles.appSubtitle, { color: colors.mutedForeground }]}>Refreshes and Levains</Text>
          </Animated.View>

          {/* Feed Amounts */}
          <Animated.View entering={FadeInDown.delay(60).duration(400)}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Feed Amounts</Text>
            <TourStep order={4} name="feed-ratios-input">
              <CopilotView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.inputRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Starter (g)</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                      placeholder="e.g., 10"
                      placeholderTextColor={colors.mutedForeground}
                      value={starterWeight}
                      onChangeText={setStarterWeight}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Flour (g)</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                      placeholder="e.g., 75"
                      placeholderTextColor={colors.mutedForeground}
                      value={flourWeightStr}
                      onChangeText={setFlourWeightStr}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Water (g)</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                      placeholder="e.g., 75"
                      placeholderTextColor={colors.mutedForeground}
                      value={waterWeightStr}
                      onChangeText={setWaterWeightStr}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                {/* Optional sugar field */}
                <View style={[styles.sugarRow, { borderTopColor: colors.border }]}>
                  <Pressable
                    onPress={() => { setSugarEnabled((v) => !v); if (sugarEnabled) setSugarWeightStr(""); }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flex: 1 })}
                  >
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>Sugar (optional)</Text>
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
                        fontFamily: fonts.mono,
                      }]}
                      placeholder="e.g., 50"
                      placeholderTextColor={colors.mutedForeground}
                      value={sugarWeightStr}
                      onChangeText={setSugarWeightStr}
                      keyboardType="decimal-pad"
                    />
                  </View>
                )}

                {derivedRatioStr ? (
                  <Animated.View entering={FadeIn.duration(250)} style={styles.calcRow}>
                    <View style={[styles.calcChip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "28" }]}>
                      <Feather name="sliders" size={13} color={colors.primary} />
                      <Text style={[styles.calcChipText, { color: colors.primary }]}>ratio {derivedRatioStr}</Text>
                    </View>
                  </Animated.View>
                ) : (
                  <Text style={[styles.calcHint, { color: colors.mutedForeground }]}>Enter all three weights to see ratio</Text>
                )}
              </CopilotView>
            </TourStep>
          </Animated.View>

          {/* Flour Type Slider */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Flour Type</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <FlourSlider wwPercent={wwPercent} onChange={setWwPercent} flourWeight={flourWeight} />
            </View>
          </Animated.View>

          {/* Initial Readings */}
          <Animated.View entering={FadeInDown.delay(160).duration(400)} style={{ marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Initial Readings</Text>
            <TourStep order={5} name="live-data-log">
              <CopilotView>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.inputRow, { gap: 12 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                        placeholder="e.g., 4.8"
                        placeholderTextColor={colors.mutedForeground}
                        value={initialPH}
                        onChangeText={setInitialPH}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Temp (°{tempUnit})</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                        placeholder="e.g., 76"
                        value={initialTemp}
                        onChangeText={setInitialTemp}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Volume (mL)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: fonts.mono }]}
                        placeholder="e.g., 200"
                        placeholderTextColor={colors.mutedForeground}
                        value={initialVolume}
                        onChangeText={setInitialVolume}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                </View>
              </CopilotView>
            </TourStep>
          </Animated.View>

          {/* Just Fed Photo */}
          <Animated.View entering={FadeInDown.delay(220).duration(400)} style={{ marginTop: 20 }}>
            <TourStep order={6} name="just-fed-photo">
              <CopilotView>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Just Fed Photo</Text>
                <Pressable
                  onPress={() => pickPhoto((uri) => { setFedPhoto(uri); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); })}
                  style={({ pressed }) => [styles.photoPicker, { backgroundColor: fedPhoto ? "transparent" : colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.8 : 1, borderStyle: fedPhoto ? "solid" : "dashed" }]}
                >
                  {fedPhoto ? (
                    <View>
                      <Image source={{ uri: fedPhoto }} style={[styles.photoPreview, { borderRadius: colors.radius }]} />
                      <View style={[styles.photoChangeOverlay, { borderRadius: colors.radius }]}><Feather name="refresh-cw" size={18} color="#fff" /></View>
                    </View>
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Feather name="camera" size={28} color={colors.mutedForeground} />
                      <Text style={[styles.photoPlaceholderText, { color: colors.mutedForeground }]}>Add a photo of your starter</Text>
                    </View>
                  )}
                </Pressable>
              </CopilotView>
            </TourStep>
          </Animated.View>

          {/* Start Button */}
          <Animated.View entering={FadeInDown.delay(280).duration(400)} style={{ marginTop: 28 }}>
            <TourStep order={7} name="start-feed-btn">
              <CopilotView>
                <Pressable onPress={handleStart} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}>
                  <Ionicons name="timer-outline" size={20} color={colors.primaryForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Start Feed Timer</Text>
                </Pressable>
              </CopilotView>
            </TourStep>
          </Animated.View>

          <AffiliateCarousel />

          <TourStep order={10} name="next-chapter-is-graph">
            <CopilotView>
              <View style={{ height: 0 }} />
            </CopilotView>
          </TourStep>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  appHeader: {
    marginBottom: 28,
  },
  appTitle: {
    ...typography.headlineLgMobile,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  sectionTitle: {
    ...typography.sectionLabel,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  inputRow: {
    flexDirection: "row",
  },
  fieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    height: 46,
    paddingHorizontal: 10,
    fontSize: 15,
    fontFamily: fonts.sans,
    borderWidth: 1,
  },
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
    borderRadius: radius.full,
    borderWidth: 1,
  },
  calcChipText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
  },
  calcHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    marginTop: 12,
  },
  photoPicker: {
    aspectRatio: 4 / 3,
    borderWidth: 1.5,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  photoPlaceholder: {
    alignItems: "center",
    gap: 10,
  },
  photoPlaceholderText: {
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
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
  primaryButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
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
});