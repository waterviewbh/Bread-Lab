import React from "react";
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
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/recipeUtils";
import type { SavedRecipe } from "@/lib/recipeTypes";

interface Props {
  visible: boolean;
  recipes: SavedRecipe[];
  onSelect: (recipe: SavedRecipe) => void;
  onClose: () => void;
}

export function RecipePickerModal({ visible, recipes, onSelect, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
        <View style={[s.sheetHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 20 }]}>
          <Text style={[s.sheetTitle, { color: colors.foreground }]}>Select Recipe</Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        {/* Recipe list */}
        <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 24 }}>
          {recipes.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onSelect(r)}
              style={({ pressed }) => [
                s.sheetRow,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: pressed ? colors.muted : "transparent",
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.sheetRowName, { color: colors.foreground }]}>{r.name}</Text>
                <Text style={[s.sheetRowHint, { color: colors.mutedForeground }]}>
                  {r.phases.length} phase{r.phases.length !== 1 ? "s" : ""} · {formatDate(r.createdAt)}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
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
});