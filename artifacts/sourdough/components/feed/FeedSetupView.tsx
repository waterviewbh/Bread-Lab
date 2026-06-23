import React, { useState } from "react";
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
import Animated, {
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TourStep, CopilotView } from "@/components/TourStep"; // red-tagged for webapp-0.1 rmv in 3 revs

import { useColors } from "@/hooks/useColors";
import FlourSlider from "@/components/FlourSlider";
import { calcRatioStr } from "@/lib/feedUtils";
import { usePreferences } from "@/contexts/PreferencesContext";

import PeakWindowAdvisor from "./PeakWindowAdvisor";
import { PlannedRecipe } from "@/lib/predictions";
import { FeedSession } from "@/types/feed";

// const CopilotView = walkthroughable(View); red-tagged for webapp-0.1 rmv in 3 revs

interface Props {
  historyData: FeedSession[];
  onStartFeed: (data: {
    starterWeight: string;
    flourWeight: number;
    waterWeight: number;
    wwPercent: number;
    initialPH: string;
    initialTemp: string;
    initialVolume: string;
    fedPhoto: string | null;
    sugarWeight?: number;
  }) => void;
}

export default function FeedSetupView({ onStartFeed, historyData }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { tempUnit } = usePreferences();

  const handleApplyRecipe = (recipe:PlannedRecipe) => {
      setStarterWeight(recipe.starter.toString());
      setFlourWeightStr(recipe.flour.toString());
      setWaterWeightStr(recipe.water.toString());
      setSection("track"); // Switch tab
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);  // haptic feedback? not a fan.
  };

  // --- Local State ---
  const [section, setSection] = useState<"track" | "plan">("track");
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

    // Require volume for an initial read
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
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Top section toggle ── */}
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
      ><View style={[styles.sectionToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["track", "plan"] as const).map((sec) => (
            <TourStep
              key={sec}
              text={sec === "track" ? "Start here to monitor a live refresh." : "Click here to estimate when a refresh will peak..."}
              order={sec === "track" ? 2 : 3}
              name={sec === "track" ? "track-feed-btn" : "plan-feed-btn"}
            ><CopilotView
                style={[
                  styles.sectionBtn,
                  section === sec && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                ]}
              ><Pressable
                  onPress={() => { setSection(sec); Haptics.selectionAsync(); }}
                  style={{ width: '100%', alignItems: 'center' }}
                ><Text style={[styles.sectionBtnText,
                    { color: section === sec ? colors.foreground : colors.mutedForeground,
                      fontFamily: section === sec ? "Inter_600SemiBold" : "Inter_400Regular" }
                  ]}>
                    {sec === "track" ? "Track a Feed" : "Plan a Feed"}
                  </Text>
                </Pressable>
              </CopilotView>
            </TourStep>
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
              paddingTop: 16,
              paddingBottom: insets.bottom + tabBarPad + 24,
              paddingHorizontal: 20,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeIn.duration(400)} style={styles.appHeader}>
              <TourStep
                name="app-name"
                order={1}
                text="Welcome to the Bread Lab! This app helps turn bakers into scientists, and back again. Start here by logging your starter's feeds."
              ><CopilotView>
                 <Text style={[styles.appTitle, { color: colors.foreground }]}>Bread Lab</Text>
                 <Text style={[styles.appSubtitle, { color: colors.mutedForeground }]}>log a feed</Text>
               </CopilotView>
              </TourStep>
            </Animated.View>

            {/* Feed Amounts */}
            <Animated.View entering={FadeInDown.delay(60).duration(400)}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Feed Amounts</Text>
              <TourStep text="Enter your starter, flour, and water weights here." order={5} name="feed-ratios-input">
                <CopilotView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.inputRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Starter (g)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]}
                        placeholder="e.g. 50"
                        placeholderTextColor={colors.mutedForeground}
                        value={starterWeight}
                        onChangeText={setStarterWeight}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Flour (g)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]}
                        placeholder="e.g. 100"
                        placeholderTextColor={colors.mutedForeground}
                        value={flourWeightStr}
                        onChangeText={setFlourWeightStr}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none", textAlign: 'center' }]}>Water (g)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]}
                        placeholder="e.g. 100"
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
                    ><Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>Sugar (optional)</Text>
                      <View style={[styles.sugarToggle, { backgroundColor: sugarEnabled ? colors.accent : colors.border }]}>
                        <View style={[styles.sugarThumb, { alignSelf: sugarEnabled ? "flex-end" : "flex-start" }]} />
                      </View>
                    </Pressable>
                  </View>
                  {sugarEnabled && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                        placeholder="Sugar (g)"
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
              <TourStep text="A log of your temperature, pH, and rise data during the refresh." order={6} name="live-data-log">
                <CopilotView>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Initial Readings</Text>
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.inputRow, { gap: 12 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]}
                          placeholder="e.g. 4.8"
                          placeholderTextColor={colors.mutedForeground}
                          value={initialPH}
                          onChangeText={setInitialPH}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      {/* Temp unit here pulls from global setting */}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Temp (°{tempUnit})</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
                          placeholder="e.g. 76"
                          value={initialTemp}
                          onChangeText={setInitialTemp}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>Volume (mL)</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, fontFamily: "Inter_400Regular" }]}
                          placeholder="e.g. 200"
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
              <TourStep text="Capture or upload an image of your starter right after feeding it." order={7} name="just-fed-photo">
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
              <TourStep text="Tap this to begin the refresh timer." order={8} name="start-feed-btn">
                <CopilotView>
                  <Pressable onPress={handleStart} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}>
                    <Ionicons name="timer-outline" size={20} color={colors.primaryForeground} />
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Start Feed Timer</Text>
                  </Pressable>
                </CopilotView>
              </TourStep>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

            {/* Plan Section */}
            {section === "plan" && (
              <Animated.View
                entering={FadeIn.duration(400)}
                style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }}
              >
                <PeakWindowAdvisor
                  history={historyData}
                  onApplyRecipe={handleApplyRecipe}
                  defaultTemp={initialTemp}
                />
              </Animated.View>
            )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionToggleWrap: { paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionToggle: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 3, gap: 3 },
  sectionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionBtnText: { fontSize: 14 },
  appHeader: { marginBottom: 28 },
  appTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  appSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2, letterSpacing: 0.2 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  inputRow: { flexDirection: "row" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 46, paddingHorizontal: 14, fontSize: 16, borderWidth: 1 },
  calcRow: { flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap" },
  calcChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  calcChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  calcHint: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 12 },
  photoPicker: { aspectRatio: 4 / 3, borderWidth: 1.5, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  photoPlaceholder: { alignItems: "center", gap: 10 },
  photoPlaceholderText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  photoPreview: { width: "100%", height: "100%" },
  photoChangeOverlay: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.45)", padding: 6, borderRadius: 20 },
  primaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 52, gap: 10 },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sugarRow: { flexDirection: "row", alignItems: "center", marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  sugarToggle: { width: 36, height: 20, borderRadius: 10, padding: 2, justifyContent: "center" },
  sugarThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: "white" },
});