import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HistorySection } from "../log";
import { BAKE_HISTORY_KEY } from "@/lib/recipeTypes";
import { getOwnerStorageKey } from "@/lib/storageUtils";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("@/hooks/useColors", () => ({ useColors: () => ({
  background: "#fff", foreground: "#000", card: "#fff", border: "#ccc",
  primary: "#333", primaryForeground: "#fff", mutedForeground: "#666", accent: "#888",
}) }));
jest.mock("@/components/AffiliateCarousel", () => () => null);
jest.mock("@/contexts/SyncContext", () => ({
  useSyncStatus: () => ({ reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn() }),
}));

afterEach(cleanup);

test("History screen loads three owner-archived bakes without changing their persisted records", async () => {
  await AsyncStorage.clear();
  const key = getOwnerStorageKey(BAKE_HISTORY_KEY, "anonymous");
  const base = Date.now() - 60_000;
  const entries = ["A", "B", "C"].map((id, index) => ({
    id, userId: "anonymous", recipeId: `recipe-${id}`, recipeName: `History Loaf ${id}`,
    startedAt: base + index * 100, completedAt: base + 50 + index * 100,
    savedAt: base + 100 + index * 100, status: "completed",
    phases: [{ key: "baking", name: "Baking", startedAt: base + index * 100,
      completedAt: base + 50 + index * 100, ingredients: [], instructions: [], readings: [] }],
  }));
  const before = JSON.stringify(entries);
  await AsyncStorage.setItem(key, before);
  render(<HistorySection />);
  await waitFor(() => expect(screen.getByText("History Loaf C")).toBeTruthy());
  expect(JSON.parse((await AsyncStorage.getItem(key))!)).toHaveLength(3);
  expect(await AsyncStorage.getItem(key)).toBe(before);
});
