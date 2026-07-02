import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

// A category with its phases pre-filtered to only available (not yet added) ones
interface AvailableCategory {
  key: string;
  name: string;
  phases: { key: string; name: string; hint: string }[];
}

interface Props {
  visible: boolean;
  // Only the categories (and phases within them) not yet in the recipe
  availableCategories: AvailableCategory[];
  // Called with the ordered list of phase keys the user confirmed
  onConfirm: (keys: string[]) => void;
  onClose: () => void;
}

export function PhasePickerModal({
  visible,
  availableCategories,
  onConfirm,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();  // Selection state lives here — reset on every close
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const togglePhase = (key: string) => {
    setSelections((prev) => ({ ...prev, [key]: !prev[key] }));
    Haptics.selectionAsync();
  };
  const handleClose = () => {
    setSelections({});
    onClose();
  };
  const handleConfirm = () => {
    const keys = availableCategories
      .flatMap((cat) => cat.phases)
      .filter((p) => selections[p.key])
      .map((p) => p.key);
    setSelections({});
    onConfirm(keys);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const selectedCount = Object.values(selections).filter(Boolean).length;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={[s.sheetHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
          <Text style={[s.sheetTitle, { color: colors.foreground }]}>Add Phase</Text>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 80 }}>
          {availableCategories.map((cat) => (
            <View key={cat.key}>
              {/* Category group header */}
              <View style={[s.phaseGroupHeader, { borderBottomColor: colors.border, backgroundColor: colors.muted }]}>
                <Text style={[s.phaseGroupName, { color: colors.mutedForeground }]}>
                  {cat.name.toUpperCase()}
                </Text>
              </View>
              {cat.phases.map((def) => {
                const selected = !!selections[def.key];
                return (
                  <Pressable
                    key={def.key}
                    onPress={() => togglePhase(def.key)}
                    style={({ pressed }) => [
                      s.sheetRow,
                      { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.sheetRowName, { color: colors.foreground }]}>{def.name}</Text>
                      <Text style={[s.sheetRowHint, { color: colors.mutedForeground }]}>{def.hint}</Text>
                    </View>
                    {/* Circular checkbox — fills with accent when selected */}
                    <View style={[
                      s.pickerCheckbox,
                      {
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accent : "transparent",
                      },
                    ]}>
                      {selected && <Feather name="check" size={12} color={colors.card} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        {/* Confirm button — only visible once at least one phase is checked */}
        {selectedCount > 0 && (
          <View style={[s.pickerFooter, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              onPress={handleConfirm}
              style={[s.pickerContinueBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={[s.pickerContinueBtnText, { color: "#fff" }]}>
                Add {selectedCount} Phase{selectedCount !== 1 ? "s" : ""}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  sheetRowName: { fontSize: 16, fontFamily: "Inter_500Medium", marginBottom: 2 },
  sheetRowHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  phaseGroupHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  phaseGroupName: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  pickerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerContinueBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  pickerContinueBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});