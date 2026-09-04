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
import { fonts, spacing, radius } from "@/constants/theme";

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
          {recipes
            .sort((a, b) => (Math.max(b.updatedAt || 0, b.createdAt)) - (Math.max(a.updatedAt || 0, a.createdAt)))
            .map((r) => (
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={[s.sheetRowName, { color: colors.foreground, marginBottom: 0 }]}>{r.name}</Text>
                  {r.versionLabel && (
                    <View style={[s.versionBadge, { backgroundColor: colors.muted }]}>
                      <Text style={[s.versionText, { color: colors.mutedForeground }]}>{r.versionLabel}</Text>
                    </View>
                  )}
                </View>
                <Text style={[s.sheetRowHint, { color: colors.mutedForeground }]}>
                  {r.phases.length} phase{r.phases.length !== 1 ? "s" : ""} · {r.updatedAt && r.updatedAt > r.createdAt ? `Updated ${formatDate(r.updatedAt)}` : `Created ${formatDate(r.createdAt)}`}
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
    paddingHorizontal: spacing.lg - 4, // 20
    paddingBottom: spacing.md, // 16
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontFamily: fonts.serifBold, // LibreCaslonText_700Bold — modal title in serif
    fontSize: 18,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg - 4, // 20
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  sheetRowName: {
    fontFamily: fonts.sansMedium, // HankenGrotesk_500Medium — recipe name
    fontSize: 16,
    marginBottom: 2,
  },
  sheetRowHint: {
    fontFamily: fonts.sans, // HankenGrotesk_400Regular — phase count + date
    fontSize: 12,
  },
  versionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  versionText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "600",
  },
});
