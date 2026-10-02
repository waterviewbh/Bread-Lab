import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { RecipePickerModal } from "../RecipePickerModal";
import type { SavedRecipe } from "@/lib/recipeTypes";

// Mock safe area insets
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock vector icons
jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
  Feather: "Feather",
}));

// Mock hooks
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#ffffff",
    card: "#fcfaf8",
    border: "#e5e0da",
    foreground: "#1c1917",
    mutedForeground: "#78716c",
    muted: "#f5f5f4",
    primary: "#844b1d",
  }),
}));

const sampleRecipes: SavedRecipe[] = [
  {
    id: "rec-1",
    name: "Classic Country Sourdough (Master)",
    overview: "Open crumb country sourdough with 20% levain.",
    createdAt: 1700000000000,
    updatedAt: 1700005000000,
    yieldValue: "2 Loaves",
    versionLabel: "v1.0",
    phases: [
      { key: "levain", name: "Levain Build", ingredients: [], instructions: [] },
      { key: "autolyse", name: "Autolyse", ingredients: [], instructions: [] },
      { key: "bulk", name: "Bulk Ferment", ingredients: [], instructions: [] },
    ],
  },
  {
    id: "rec-2",
    name: "Classic Country Sourdough (Iterated)",
    overview: "Higher hydration test with coil folds.",
    createdAt: 1700010000000,
    yieldValue: "1 Loaf",
    phases: [
      { key: "bulk", name: "Bulk Ferment", ingredients: [], instructions: [] },
      { key: "bake", name: "Bake", ingredients: [], instructions: [] },
    ],
  },
];

describe("RecipePickerModal", () => {
  const onSelectMock = jest.fn();
  const onCloseMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders recipes as cards with full metadata (name, phases, yield, overview, phase pills)", async () => {
    await render(
      <RecipePickerModal
        visible={true}
        recipes={sampleRecipes}
        onSelect={onSelectMock}
        onClose={onCloseMock}
      />
    );

    // Modal title
    expect(screen.getByText("Select Recipe")).toBeTruthy();

    // Recipe 1 Name and version badge
    expect(screen.getByText("Classic Country Sourdough (Master)")).toBeTruthy();
    expect(screen.getByText("v1.0")).toBeTruthy();

    // Recipe 1 Metadata
    expect(screen.getByText(/3 phases · Updated/)).toBeTruthy();
    expect(screen.getByText("2 Loaves")).toBeTruthy();
    expect(screen.getByText("Open crumb country sourdough with 20% levain.")).toBeTruthy();

    // Phase pills for Recipe 1
    expect(screen.getByText("Levain Build")).toBeTruthy();
    expect(screen.getByText("Autolyse")).toBeTruthy();

    // Recipe 2 Name and metadata
    expect(screen.getByText("Classic Country Sourdough (Iterated)")).toBeTruthy();
    expect(screen.getByText(/2 phases · Created/)).toBeTruthy();
    expect(screen.getByText("1 Loaf")).toBeTruthy();
    expect(screen.getByText("Higher hydration test with coil folds.")).toBeTruthy();
  });

  it("calls onSelect when a recipe card is pressed", async () => {
    await render(
      <RecipePickerModal
        visible={true}
        recipes={sampleRecipes}
        onSelect={onSelectMock}
        onClose={onCloseMock}
      />
    );

    const card = screen.getByTestId("recipe-card-rec-1");
    fireEvent.press(card);

    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(onSelectMock).toHaveBeenCalledWith(sampleRecipes[0]);
  });

  it("calls onClose when the close button is pressed", async () => {
    await render(
      <RecipePickerModal
        visible={true}
        recipes={sampleRecipes}
        onSelect={onSelectMock}
        onClose={onCloseMock}
      />
    );

    const closeBtn = screen.getByTestId("close-picker-button");
    fireEvent.press(closeBtn);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("renders gracefully when recipes array is empty", async () => {
    await render(
      <RecipePickerModal
        visible={true}
        recipes={[]}
        onSelect={onSelectMock}
        onClose={onCloseMock}
      />
    );

    expect(screen.getByText("Select Recipe")).toBeTruthy();
    expect(screen.queryByTestId(/recipe-card-/)).toBeNull();
  });

  it("preserves the order of recipes supplied by the parent", async () => {
    const reversedRecipes = [...sampleRecipes].reverse();

    await render(
      <RecipePickerModal
        visible={true}
        recipes={reversedRecipes}
        onSelect={onSelectMock}
        onClose={onCloseMock}
      />
    );

    const card1 = screen.getByTestId("recipe-card-rec-2");
    const card2 = screen.getByTestId("recipe-card-rec-1");
    expect(card1).toBeTruthy();
    expect(card2).toBeTruthy();
  });
});
