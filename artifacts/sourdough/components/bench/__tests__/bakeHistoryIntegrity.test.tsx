import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActiveBakeSection } from "../ActiveBakeSection";
import { DiagnosticSection } from "@/components/log/logDiagnostic";
import { BAKE_KEY, BAKE_HISTORY_KEY, type ActiveBake, type BakeHistoryItem } from "@/lib/recipeTypes";
import { getOwnerStorageKey } from "@/lib/storageUtils";
import * as recipeStorage from "@/lib/recipeStorage";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("@/hooks/useColors", () => ({ useColors: () => ({
  background: "#fff", foreground: "#000", card: "#fff", border: "#ccc",
  primary: "#333", primaryForeground: "#fff", mutedForeground: "#666", accent: "#888",
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

const owner = "anonymous";
const activeKey = getOwnerStorageKey(BAKE_KEY, owner);
const historyKey = getOwnerStorageKey(BAKE_HISTORY_KEY, owner);
const historyBake = (id: string, name: string, savedAt: number): BakeHistoryItem => ({
  id, userId: owner, recipeId: `recipe-${id}`, recipeName: name,
  startedAt: savedAt - 1000, completedAt: savedAt - 100, savedAt, status: "completed",
  notes: `notes-${id}`, yieldValue: "1", outcome: { overallScore: 4, defects: [] },
  phases: [{ key: "baking", name: "Baking", startedAt: savedAt - 500, completedAt: savedAt - 100,
    ingredients: [], instructions: [], readings: [] }],
});
const activeBake = (): ActiveBake => ({
  id: "C", userId: owner, recipeId: "recipe-C", recipeName: "New Loaf C",
  startedAt: 3000, status: "active", yieldValue: "1", notes: "C notes",
  phases: ["mixing", "baking"].map((key, index) => ({
    key, name: key, startedAt: 3000 + index, completedAt: null,
    ingredients: [], instructions: [], readings: [],
  })),
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});
afterEach(cleanup);

test("seeded A and B survive C completion and Diagnostic review unchanged", async () => {
  const A = historyBake("A", "Existing A", 1000);
  const B = historyBake("B", "Existing B", 2000);
  const C = activeBake();
  const aBytes = JSON.stringify(A);
  const bBytes = JSON.stringify(B);
  await AsyncStorage.setItem(historyKey, JSON.stringify([A, B]));
  await AsyncStorage.setItem(activeKey, JSON.stringify([C]));
  jest.spyOn(recipeStorage, "loadAll").mockResolvedValue({ recipes: [], bakes: [C], bake: null } as any);

  render(<ActiveBakeSection />);
  fireEvent.press(await waitFor(() => screen.getByTestId("complete-mixing")));
  await waitFor(async () => {
    const active = JSON.parse((await AsyncStorage.getItem(activeKey))!);
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");
    expect(active[0].phases[0].completedAt).toEqual(expect.any(Number));
  });
  expect(JSON.parse((await AsyncStorage.getItem(historyKey))!)).toHaveLength(2);

  fireEvent.press(await waitFor(() => screen.getByTestId("complete-baking")));
  await waitFor(async () => {
    expect(JSON.parse((await AsyncStorage.getItem(activeKey))!)).toEqual([]);
    expect(JSON.parse((await AsyncStorage.getItem(historyKey))!)).toHaveLength(3);
  });
  let history = JSON.parse((await AsyncStorage.getItem(historyKey))!);
  expect(history.filter((item: BakeHistoryItem) => item.id === "C")).toHaveLength(1);
  expect(JSON.stringify(history.find((item: BakeHistoryItem) => item.id === "A"))).toBe(aBytes);
  expect(JSON.stringify(history.find((item: BakeHistoryItem) => item.id === "B"))).toBe(bBytes);
  const archivedC = history.find((item: BakeHistoryItem) => item.id === "C");
  expect(archivedC.completedAt).toBe(archivedC.phases[1].completedAt);
  const { completedAt, savedAt } = archivedC;

  cleanup();
  render(<DiagnosticSection bakeId="C" />);
  await waitFor(() => expect(screen.getByText("New Loaf C")).toBeTruthy());
  fireEvent.press(screen.getByText("LOG & FINISH"));
  await waitFor(async () => {
    history = JSON.parse((await AsyncStorage.getItem(historyKey))!);
    expect(history.find((item: BakeHistoryItem) => item.id === "C").outcome).toBeDefined();
  });
  expect(history).toHaveLength(3);
  expect(history.filter((item: BakeHistoryItem) => item.id === "C")).toHaveLength(1);
  expect(JSON.stringify(history.find((item: BakeHistoryItem) => item.id === "A"))).toBe(aBytes);
  expect(JSON.stringify(history.find((item: BakeHistoryItem) => item.id === "B"))).toBe(bBytes);
  expect(history.find((item: BakeHistoryItem) => item.id === "C")).toMatchObject({ completedAt, savedAt });

});

