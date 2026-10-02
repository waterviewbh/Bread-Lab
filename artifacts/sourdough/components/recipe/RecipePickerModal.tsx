import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import type { SavedRecipe } from "@/lib/recipeTypes";
import { fonts, spacing } from "@/constants/theme";

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
            accessibilityLabel="Close"
            testID="close-picker-button"
          >
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Recipe list */}
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingVertical: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
        >
          {recipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              onPress={() => onSelect(r)}
            />
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
});
