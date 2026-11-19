import React, { useMemo, useState } from "react";
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
import { RecipeDeck } from "@/components/recipe/RecipeDeck";
import { KeycapKey } from "@/components/recipe/KeycapKey";
import { resolveRootMasterId } from "@/lib/recipeUtils";
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
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  const lineages = useMemo(() => {
    const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));
    const groups = new Map<string, { master: SavedRecipe; iterations: SavedRecipe[] }>();

    for (const recipe of recipes) {
      const rootId = resolveRootMasterId(recipe, recipes);
      const master = byId.get(rootId) || recipe;
      if (!groups.has(rootId)) groups.set(rootId, { master, iterations: [] });
      if (recipe.id !== rootId) groups.get(rootId)!.iterations.push(recipe);
    }

    return Array.from(groups.values()).map(group => ({
      ...group,
      iterations: group.iterations.sort((a, b) => b.createdAt - a.createdAt),
    }));
  }, [recipes]);

  const letters = useMemo(
    () => Array.from(new Set(lineages.map(({ master }) => master.name[0]?.toUpperCase() || "#"))).sort(),
    [lineages],
  );
  const visibleLineages = letterFilter
    ? lineages.filter(({ master }) => (master.name[0]?.toUpperCase() || "#") === letterFilter)
    : lineages;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
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

        {letters.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.index}>
            <KeycapKey
              label="All"
              active={letterFilter === null}
              onPress={() => setLetterFilter(null)}
              faceFill={letterFilter === null ? colors.secondary : colors.card}
              ledgeFill={colors.muted}
              stroke={colors.border}
              textColor={letterFilter === null ? colors.foreground : colors.mutedForeground}
            />
            {letters.map(letter => {
              const active = letterFilter === letter;
              return (
                <KeycapKey
                  key={letter}
                  label={letter}
                  active={active}
                  onPress={() => setLetterFilter(active ? null : letter)}
                  faceFill={active ? colors.secondary : colors.card}
                  ledgeFill={colors.muted}
                  stroke={colors.border}
                  textColor={active ? colors.foreground : colors.mutedForeground}
                />
              );
            })}
          </ScrollView>
        )}

        <ScrollView
          contentContainerStyle={{
            paddingTop: 16,
            paddingBottom: insets.bottom + 24,
          }}
        >
          {visibleLineages.map(({ master, iterations }) => (
            <RecipeDeck
              key={master.id}
              master={master}
              iterations={iterations}
              onSelect={onSelect}
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
    paddingHorizontal: spacing.lg - 4,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
  },
  index: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
