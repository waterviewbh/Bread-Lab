import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { ActiveBakeSection } from "../ActiveBakeSection";
import { BAKE_KEY, BAKE_HISTORY_KEY, ActiveBake } from "@/lib/recipeTypes";
import { getOwnerStorageKey } from "@/lib/storageUtils";
import * as recipeStorage from "@/lib/recipeStorage";

jest.mock("@/hooks/useColors", () => ({ useColors: () => ({
  background: "#fff", foreground: "#000", card: "#fff", border: "#ccc",
  primary: "#333", mutedForeground: "#666", accent: "#888",
}) }));
jest.mock("@/components/AffiliateCarousel", () => () => null);
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(), impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 0 }, ImpactFeedbackStyle: { Light: 0, Medium: 1 },
}));
jest.mock("@/components/recipe/RecipeRunnerActiveView", () => {
  const React = require("react");
  const { Pressable, Text, View } = require("react-native");
  return { RecipeRunnerActiveView: ({ bake, onCompletePhase, onAbandonBake }: any) =>
    React.createElement(View, null,
      ...bake.phases.filter((p: any) => !p.completedAt).map((p: any) =>
        React.createElement(Pressable, { key: p.key, testID: `complete-${p.key}`, onPress: () => onCompletePhase(p.key) },
          React.createElement(Text, null, `Complete ${p.key}`))),
      React.createElement(Pressable, { testID: "abandon", onPress: onAbandonBake },
        React.createElement(Text, null, "Abandon"))),
  };
});
jest.mock("@/contexts/SyncContext", () => ({
  useSyncStatus: () => ({ reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn() }),
}));

const activeKey = getOwnerStorageKey(BAKE_KEY, "anonymous");
const historyKey = getOwnerStorageKey(BAKE_HISTORY_KEY, "anonymous");
const makeBake = (): ActiveBake => ({
  id: "transition-bake", userId: "anonymous", recipeId: "recipe", recipeName: "Loaf",
  startedAt: 100, status: "active", yieldValue: "1",
  phases: ["mixing", "baking"].map((key, index) => ({
    key, name: key, startedAt: 100 + index, completedAt: null,
    ingredients: [], instructions: [], readings: [],
  })),
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});
afterEach(cleanup);

test("earlier phase stays active; final phase archives once and removes active storage", async () => {
  const bake = makeBake();
  await AsyncStorage.setItem(activeKey, JSON.stringify([bake]));
  jest.spyOn(recipeStorage, "loadAll").mockResolvedValue({ recipes: [], bakes: [bake], bake: null } as any);
  render(<ActiveBakeSection />);
  fireEvent.press(await waitFor(() => screen.getByTestId("complete-mixing")));
  await waitFor(async () => {
    const active = JSON.parse((await AsyncStorage.getItem(activeKey))!);
    expect(active[0].phases[0].completedAt).toEqual(expect.any(Number));
    expect(active[0].status).toBe("active");
  });
  expect(await AsyncStorage.getItem(historyKey)).toBeNull();

  fireEvent.press(await waitFor(() => screen.getByTestId("complete-baking")));
  await waitFor(async () => {
    const history = JSON.parse((await AsyncStorage.getItem(historyKey)) ?? "[]");
    expect(history).toHaveLength(1);
    expect(history[0].completedAt).toEqual(expect.any(Number));
    expect(history[0].completedAt).toBe(history[0].phases[1].completedAt);
    expect(history[0].savedAt).toEqual(expect.any(Number));
    expect(JSON.parse((await AsyncStorage.getItem(activeKey))!)).toEqual([]);
  });
});

test("abandonment discards an unfinished bake without creating History", async () => {
  const bake = makeBake();
  await AsyncStorage.setItem(activeKey, JSON.stringify([bake]));
  jest.spyOn(recipeStorage, "loadAll").mockResolvedValue({ recipes: [], bakes: [bake], bake: null } as any);
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find(button => button.text === "Reset")?.onPress?.();
  });
  render(<ActiveBakeSection />);
  fireEvent.press(await waitFor(() => screen.getByTestId("abandon")));
  await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(activeKey))!)).toEqual([]));
  expect(await AsyncStorage.getItem(historyKey)).toBeNull();
});
