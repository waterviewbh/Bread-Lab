import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { RecipePickerModal } from "../RecipePickerModal";
import type { SavedRecipe } from "@/lib/recipeTypes";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
  Feather: "Feather",
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#ffffff", card: "#fcfaf8", border: "#e5e0da",
    foreground: "#1c1917", mutedForeground: "#78716c", muted: "#f5f5f4",
    primary: "#844b1d", accent: "#844b1d", secondary: "#f0e4d8",
  }),
}));

const recipe = (id: string, name: string, createdAt: number, parentRecipeId?: string, versionLabel?: string): SavedRecipe => ({
  id, name, createdAt, parentRecipeId, versionLabel, yieldValue: "1 Loaf",
  phases: [{ key: "mixing", name: "Mixing", ingredients: [], instructions: [] }],
});

const recipes = [
  recipe("master", "Yum Food", 1, undefined, "v1.0 (Text Selection Import)"),
  recipe("old", "Yum Food (Iterated)", 2, "master", "v1.1"),
  recipe("middle", "Yum Food", 3, "master", "v1.2"),
  recipe("latest", "Yum Food", 4, "master", "v4"),
  recipe("other", "Loafy Loaf Bread", 5),
];

describe("RecipePickerModal", () => {
  it("groups existing iterations and shows master plus two newest tabs", () => {
    const onSelect = jest.fn();
    render(<RecipePickerModal visible recipes={recipes} onSelect={onSelect} onClose={jest.fn()} />);

    expect(screen.getByText("Select Recipe")).toBeTruthy();
    expect(screen.getByText("Master")).toBeTruthy();
    expect(screen.getByText(/v3/)).toBeTruthy();
    expect(screen.getByText(/v4/)).toBeTruthy();
    expect(screen.queryByText(/v2/)).toBeNull();
    expect(screen.queryByText(/Iterated/)).toBeNull();
    expect(screen.queryByText(/Text Selection Import/)).toBeNull();

    fireEvent.press(screen.getByText(/v3/));
    fireEvent.press(screen.getByText("Yum Food"));
    expect(onSelect).toHaveBeenCalledWith(recipes[2]);
  });

  it("filters complete lineages by master initial", () => {
    render(<RecipePickerModal visible recipes={recipes} onSelect={jest.fn()} onClose={jest.fn()} />);
    fireEvent.press(screen.getByText("L"));
    expect(screen.getByText("Loafy Loaf Bread")).toBeTruthy();
    expect(screen.queryByText("Yum Food")).toBeNull();
  });

  it("closes and handles an empty list", () => {
    const onClose = jest.fn();
    render(<RecipePickerModal visible recipes={[]} onSelect={jest.fn()} onClose={onClose} />);
    expect(screen.getByText("Select Recipe")).toBeTruthy();
    fireEvent.press(screen.getByTestId("close-picker-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
