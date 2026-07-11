// components/recipe/ReadingModal.tsx
// ─── Reading log modal — generic and bulk-ferment modes ──────────────────────
//   Generic mode (isBulkPhase = false): pH, temp, volume string, note.
//   Bulk mode (isBulkPhase = true):  volume_ml (number), dough temp, ambient
//   temp, sensory tap-scores, post-intervention flag. pH and note are hidden
//   in bulk mode — they add noise and slow down the check-in.
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  type Reading,
  type BulkFermentReading,
  type BulkSensoryScores,
} from "@/lib/recipeTypes";
import { fonts, spacing, radius, typography } from "@/constants/theme";

// ─── Sensory dimension config ──────────────────────────────────────────────────
// Each entry drives one SegmentedPicker row in the bulk form.
const SENSORY_DIMS: {
  key: keyof BulkSensoryScores;
  label: string;
  options: { value: 1 | 2 | 3; label: string }[];
}[] = [
  {
    key: "surfaceShape",
    label: "Surface",
    options: [
      { value: 1, label: "Flat" },
      { value: 2, label: "Curved" },
      { value: 3, label: "Domed" },
    ],
  },
  {
    key: "bubbles",
    label: "Bubbles",
    options: [
      { value: 1, label: "None" },
      { value: 2, label: "Edges" },
      { value: 3, label: "Surface" },
    ],
  },
  {
    key: "puffiness",
    label: "Puffiness",
    options: [
      { value: 1, label: "Dense" },
      { value: 2, label: "Airy" },
      { value: 3, label: "Very puffy" },
    ],
  },
  {
    key: "stickiness",
    label: "Stickiness",
    options: [
      { value: 1, label: "Very sticky" },
      { value: 2, label: "Slightly" },
      { value: 3, label: "Clean" },
    ],
  },
];

// ─── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  /* The name of the phase being logged — shown as subtitle */
  phaseName: string | undefined;
  /* True when the generic string-volume field should be shown (building_levain, cold_retarding) */
  showVolumeField: boolean;
  /* True when this is the bulk_fermenting phase — swaps form into bulk mode */
  isBulkPhase: boolean;
  onSave: (reading: Reading) => void;
  onClose: () => void;
}

// ─── Reusable segmented picker row ────────────────────────────────────────────
function SegmentedPicker<T extends number>({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={sp.row}>
      <Text style={[sp.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={sp.options}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                sp.option,
                {
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accent + "18" : colors.card,
                },
              ]}
            >
              <Text
                style={[
                  sp.optionText,
                  { color: selected ? colors.accent : colors.mutedForeground },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const sp = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  label: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: 6,
  },
  options: {
    flexDirection: "row",
    gap: 6,
  },
  option: {
    flex: 1,                                 // each button takes an equal share of the row
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
    alignItems: "center",                    // center the label text within the expanded button
  },
  optionText: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — segmented picker choice
    fontSize: 13,
  },
});

// ─── Main modal ────────────────────────────────────────────────────────────────
export function ReadingModal({
  visible,
  phaseName,
  showVolumeField,
  isBulkPhase,
  onSave,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  // ── Generic form state ──────────────────────────────────────────────────────
  const [pH, setPH] = useState("");
  const [temp, setTemp] = useState("");
  const [tempUnit, setTempUnit] = useState<"F" | "C">("F");
  const [note, setNote] = useState("");
  const [volume, setVolume] = useState("");
  // ── Bulk-specific form state ────────────────────────────────────────────────
  const [volumeMl, setVolumeMl] = useState("");
  const [doughTemp, setDoughTemp] = useState("");
  const [ambientTemp, setAmbientTemp] = useState("");
  const [sensory, setSensory] = useState<Partial<BulkSensoryScores>>({});
  const [postIntervention, setPostIntervention] = useState(false);
  const resetForm = () => {
    // Generic fields
    setPH("");
    setTemp("");
    setNote("");
    setVolume("");
    // Bulk fields
    setVolumeMl("");
    setDoughTemp("");
    setAmbientTemp("");
    setSensory({});
    setPostIntervention(false);
  };
  const handleClose = () => {
    resetForm();
    onClose();
  };
  const handleSave = () => {
    if (isBulkPhase) {
      // Bulk mode: volume_ml is required so the engine has a data point
      const ml = parseFloat(volumeMl);
      if (isNaN(ml) || ml <= 0) {
        alert("Enter the current container volume in ml.");
        return;
      }
      const reading: BulkFermentReading = {
        id: Date.now().toString(),
        // Base Reading fields — temp/pH carry dough temp so ReadingRow still renders cleanly
        temp: doughTemp,
        tempUnit,
        pH: "",
        note: "",
        volume: volumeMl,        // legacy string field kept for display consistency
        loggedAt: Date.now(),
        // Bulk-specific fields
        volume_ml: ml,
        doughTemp: doughTemp ? parseFloat(doughTemp) : undefined,
        ambientTemp: ambientTemp ? parseFloat(ambientTemp) : undefined,
        sensory: Object.keys(sensory).length > 0 ? (sensory as BulkSensoryScores) : undefined,
        postIntervention: postIntervention || undefined,
      };
      resetForm();
      onSave(reading);
      return;
    }
    // Generic mode
    if (!temp && !pH) {
      alert("Enter at least a temperature or pH.");
      return;
    }
    const reading: Reading = {
      id: Date.now().toString(),
      temp,
      tempUnit,
      pH,
      note,
      volume,
      loggedAt: Date.now(),
    };
    resetForm();
    onSave(reading);
  };
return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScrollView
          contentContainerStyle={[
            s.modalContent,
            { paddingTop: insets.top + webTop + 24, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header: close / title / save ──────────────────────────────── */}
          <View style={s.modalHeader}>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>
                {isBulkPhase ? "Bulk Check-In" : "Log Reading"}
              </Text>
              {phaseName && (
                <Text style={[s.modalSubtitle, { color: colors.mutedForeground }]}>
                  {phaseName}
                </Text>
              )}
            </View>
          {/* Spacer keeps the title centered now that Save moved to a bottom button */}
          <View style={{ width: 24 }} />
          </View>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* BULK MODE FORM                                                 */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {isBulkPhase ? (
            <>
              {/* Container volume — required; feeds volume_ml to the engine */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
                Container Volume (ml) *
              </Text>
              <TextInput
                style={[
                  s.input,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                ]}
                placeholder="e.g., 1200"
                placeholderTextColor={colors.mutedForeground}
                value={volumeMl}
                onChangeText={setVolumeMl}
                keyboardType="decimal-pad"
              />
              {/* Dough temp + unit toggle */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
                Dough Temp
              </Text>
              <View style={s.tempRow}>
                <TextInput
                  style={[
                    s.input,
                    { flex: 1, backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                  ]}
                  placeholder="e.g., 76"
                  placeholderTextColor={colors.mutedForeground}
                  value={doughTemp}
                  onChangeText={setDoughTemp}
                  keyboardType="decimal-pad"
                />
                <View style={[s.unitToggle, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 10 }]}>
                  {(["F", "C"] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setTempUnit(u)}
                      style={[
                        s.unitBtn,
                        { backgroundColor: tempUnit === u ? colors.primary : "transparent", borderRadius: 8 },
                      ]}
                    >
                      <Text style={[s.unitBtnText, { color: tempUnit === u ? colors.primaryForeground : colors.mutedForeground }]}>
                        °{u}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* Ambient temp */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
                Ambient Temp
              </Text>
              <TextInput
                style={[
                  s.input,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                ]}
                placeholder="e.g., 72"
                placeholderTextColor={colors.mutedForeground}
                value={ambientTemp}
                onChangeText={setAmbientTemp}
                keyboardType="decimal-pad"
              />
              {/* Sensory scores section */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 20, marginBottom: 12 }]}>
                Sensory Observations
              </Text>
              {SENSORY_DIMS.map((dim) => (
                <SegmentedPicker
                  key={dim.key}
                  label={dim.label}
                  options={dim.options}
                  value={(sensory as BulkSensoryScores)[dim.key]}
                  onChange={(v) => setSensory((prev) => ({ ...prev, [dim.key]: v }))}
                  colors={colors}
                />
              ))}
              {/* Post-intervention toggle */}
              <View style={[s.interventionRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.interventionLabel, { color: colors.foreground }]}>
                    After a fold / intervention?
                  </Text>
                  <Text style={[s.interventionHint, { color: colors.mutedForeground }]}>
                    Flags any temporary volume dip as structural, not a fermentation slowdown.
                  </Text>
                </View>
                <Switch
                  value={postIntervention}
                  onValueChange={setPostIntervention}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.card}
                />
              </View>
              {/* Primary save CTA — matches Feed tab's "Save Reading" button style */}
              <Pressable
                onPress={handleSave}
                style={({ pressed }) => [
                  s.saveReadingBtn,
                  { backgroundColor: colors.primary, borderRadius: 10, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[s.saveReadingBtnText, { color: colors.primaryForeground }]}>
                  Save Reading
                </Text>
              </Pressable>
            </>
          ) : (

            /* ══════════════════════════════════════════════════════════════ */
            /* GENERIC MODE FORM                                              */
            /* ══════════════════════════════════════════════════════════════ */
            <>
              {/* pH field */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, textTransform: "none" }]}>pH</Text>
              <TextInput
                style={[
                  s.input,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                ]}
                placeholder="e.g., 5.2"
                placeholderTextColor={colors.mutedForeground}
                value={pH}
                onChangeText={setPH}
                keyboardType="decimal-pad"
              />
              {/* Temperature + unit toggle */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Temperature</Text>
              <View style={s.tempRow}>
                <TextInput
                  style={[
                    s.input,
                    { flex: 1, backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                  ]}
                  placeholder="e.g., 76"
                  placeholderTextColor={colors.mutedForeground}
                  value={temp}
                  onChangeText={setTemp}
                  keyboardType="decimal-pad"
                />
                <View style={[s.unitToggle, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 10 }]}>
                  {(["F", "C"] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setTempUnit(u)}
                      style={[
                        s.unitBtn,
                        { backgroundColor: tempUnit === u ? colors.primary : "transparent", borderRadius: 8 },
                      ]}
                    >
                      <Text style={[s.unitBtnText, { color: tempUnit === u ? colors.primaryForeground : colors.mutedForeground }]}>
                        °{u}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* Legacy string-volume field — building_levain, cold_retarding */}
              {showVolumeField && (
                <>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Volume</Text>
                  <TextInput
                    style={[
                      s.input,
                      { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                    ]}
                    placeholder="e.g., 450 mL"
                    placeholderTextColor={colors.mutedForeground}
                    value={volume}
                    onChangeText={setVolume}
                    keyboardType="decimal-pad"
                  />
                </>
              )}
              {/* Note field */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Note (optional)</Text>
              <TextInput
                style={[
                  s.inputMulti,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: 10 },
                ]}
                placeholder="e.g., dough is extensible, nice window pane"
                placeholderTextColor={colors.mutedForeground}
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={2}
                returnKeyType="done"
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  modalContent: {
    paddingHorizontal: spacing.lg - 4,       // 20
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  modalTitle: {
    fontFamily: fonts.serifBold,             // LibreCaslonText_700Bold — modal title in serif
    fontSize: 20,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  modalSubtitle: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — phase name subtitle
    fontSize: 13,
    marginTop: 2,
    textAlign: "center",
  },
  saveLink: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — "Save" tappable link
    fontSize: 16,
  },
  fieldLabel: {
    ...typography.sectionLabel,              // HankenGrotesk_600SemiBold, 11px, uppercase
    marginBottom: spacing.sm,               // 8
  },
  input: {
    height: 48,
    paddingHorizontal: 10,                   // changed from 14 when added comma to e.g.
    fontSize: 15,                            // changed from 16 at the same time
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    borderWidth: 1,
  },
  inputMulti: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular
    borderWidth: 1,
    minHeight: 72,
    textAlignVertical: "top",
  },
  tempRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
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
  unitBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — °F / °C toggle
    fontSize: 14,
  },
  interventionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    padding: 14,
    borderRadius: radius.md,                 // 8
    borderWidth: 1,
  },
  interventionLabel: {
    fontFamily: fonts.sansMedium,            // HankenGrotesk_500Medium — toggle row title
    fontSize: 14,
    marginBottom: 3,
  },
  interventionHint: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — helper text
    fontSize: 12,
    lineHeight: 17,
  },
  saveReadingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    marginTop: 24,
    marginBottom: 8,
  },
  saveReadingBtnText: {
    fontFamily: fonts.sansSemiBold,          // HankenGrotesk_600SemiBold — primary action
    fontSize: 16,
  },
});