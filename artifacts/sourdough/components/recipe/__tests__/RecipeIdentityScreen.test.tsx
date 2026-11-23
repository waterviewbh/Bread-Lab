import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import RecipeScreen from "@/app/(tabs)/recipe";
import type { ActiveBake, SavedRecipe } from "@/lib/recipeTypes";
import { writeRecipesLocal, loadAll } from "@/lib/recipeStorage";

jest.setTimeout(20000);

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(), impactAsync: jest.fn(), notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("@/lib/recipeStorage", () => {
  const actual = jest.requireActual("@/lib/recipeStorage");
  return {
    ...actual,
    loadAll: jest.fn(),
    writeRecipesLocal: jest.fn(async () => undefined),
    upsertRecipeRemote: jest.fn(async () => undefined),
  };
});
jest.mock("@/components/recipe/RecipeBuilderListView", () => ({
  RecipeBuilderListView: ({ recipes, onEditRecipe }: any) => {
    const { Pressable, Text } = require("react-native");
    return <Pressable testID="open-iteration" onPress={() => onEditRecipe(recipes.find((r: SavedRecipe) => r.id === "recipe-3"))}>
      <Text>Open iteration</Text>
    </Pressable>;
  },
}));
jest.mock("@/components/recipe/SegmentBar", () => ({ SegmentBar: () => null }));
jest.mock("@/components/recipe/PhaseCard", () => ({
  PendingPhaseCard: () => null, DonePhaseCard: () => null, ActivePhaseCard: () => null,
}));
jest.mock("@/components/AffiliateCarousel", () => () => null);
jest.mock("@/components/SegmentedNotepad", () => () => null);
jest.mock("@/components/YieldPill", () => ({ YieldPill: () => null }));
jest.mock("@/components/recipe/ContinuousListInput", () => ({ ContinuousListInput: () => null }));
jest.mock("@/components/recipe/BulkEstimatorSettingsModal", () => ({ BulkEstimatorSettingsModal: () => null }));

const iteration: SavedRecipe = { id: "recipe-3", name: "Bayside 20", versionLabel: "v3", parentRecipeId: "master", createdAt: 1, phases: [] };
const other: SavedRecipe = { id: "other", name: "Other", versionLabel: "v9", createdAt: 1, phases: [] };
const bake: ActiveBake = { id: "bake-1", recipeId: "recipe-3", recipeName: "Bayside 20", startedAt: 1, status: "active", phases: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (loadAll as jest.Mock).mockResolvedValue({ recipes: [other, iteration], bakes: [bake] });
});

test("RecipeScreen selects the active bake recipe version for Runner", async () => {
  await render(<RecipeScreen />);
  await waitFor(() => expect(screen.getByText("Recipe Runner")).toBeTruthy());
  await fireEvent.press(screen.getByText("Recipe Runner"));
  await waitFor(() => expect(screen.getByText("Bayside 20 v3")).toBeTruthy());
  expect(screen.queryByText("Bayside 20 v9")).toBeNull();
});

test("RecipeScreen Edit save persists base name and existing version separately", async () => {
  await render(<RecipeScreen />);
  await waitFor(() => expect(screen.getByTestId("open-iteration")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("open-iteration"));
  await waitFor(() => expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside 20 v3"));
  await fireEvent.changeText(screen.getByTestId("recipe-name-input"), "Bayside Rye v3");
  await waitFor(() => expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside Rye v3"));
  await fireEvent.press(screen.getByTestId("save-recipe-button"));
  await waitFor(() => expect(writeRecipesLocal).toHaveBeenCalled());
  const saved = (writeRecipesLocal as jest.Mock).mock.calls[0][0].find((r: SavedRecipe) => r.id === "recipe-3");
  expect(saved).toEqual(expect.objectContaining({ name: "Bayside Rye", versionLabel: "v3" }));
});
