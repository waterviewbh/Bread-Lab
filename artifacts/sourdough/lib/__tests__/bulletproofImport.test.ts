// artifacts/sourdough/lib/__tests__/bulletproofImport.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLocalDataToAccount } from "../migrate";

// Mock AsyncStorage and api
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("../api", () => ({
  api: {
    history: {
      feed: { upsert: jest.fn().mockResolvedValue({}) },
      bakes: { upsert: jest.fn().mockResolvedValue({}) },
    },
    recipes: { upsert: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock("../deviceId", () => ({
  getDeviceId: jest.fn().mockResolvedValue("mock-device-id-123"),
}));

describe("Bulletproof Two-Pass Typed Import Engine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles out-of-order recipe dependencies and cross-table ID collisions with typed composite keys", async () => {
    const mockRecipes = [
      { id: "same-id", name: "Child Recipe", parentRecipeId: "same-id" }, // child before parent in input order or identical ID
      { id: "parent-id", name: "Parent Recipe" },
    ];
    const mockBakes = [
      { id: "same-id", recipeName: "Bake with same ID", recipeId: "parent-id", savedAt: 1000, startedAt: 900, phases: [] },
    ];
    const mockFeeds = [
      { id: "same-id", savedAt: 1000, data: {} },
    ];

    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      if (key.includes("bake_history")) return Promise.resolve(JSON.stringify(mockBakes));
      if (key.includes("sourdough_feed")) return Promise.resolve(JSON.stringify(mockFeeds));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("test-user-token-abc");

    expect(result.recipes.ok).toBe(2);
    expect(result.bakes.ok).toBe(1);
    expect(result.feed.ok).toBe(1);

    // Verify ledger persistence was called
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("bread_lab_import_ledger_test-user-token-abc"),
      expect.any(String)
    );
  });
});
