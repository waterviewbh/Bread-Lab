import AsyncStorage from "@react-native-async-storage/async-storage";
import { appendRecipeLocal } from "@/lib/recipeStorage";
import { RECIPES_KEY } from "@/lib/recipeTypes";
import { saveCandidate, loadCandidates, updateCandidateExtraction, removeCandidate, clearCandidates } from "@/lib/candidateStorage";
import { DETERMINISTIC_TEST_CANDIDATE } from "@/constants/testCandidateFixture";
import { SavedRecipe } from "@/lib/recipeTypes";

let mockStore: Record<string, string> = {};
let mockShouldThrowReadError = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    if (mockShouldThrowReadError) {
      throw new Error("Disk read error");
    }
    console.log("Mock AsyncStorage.getItem key:", key, "value:", mockStore[key]);
    return mockStore[key] || null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    console.log("Mock AsyncStorage.setItem key:", key, "value:", value);
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  }),
}));

describe("Issue #73 — Candidate Promotion & Storage Mutex Regression Suite", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    mockShouldThrowReadError = false;
    await AsyncStorage.clear();
    await clearCandidates();
  });

  it("1. appendRecipeLocal serializes concurrent appends under storageMutex and preserves existing entries", async () => {
    const recipeA: SavedRecipe = {
      id: "recipe-a",
      name: "Recipe A",
      createdAt: Date.now(),
      phases: [],
    };
    const recipeB: SavedRecipe = {
      id: "recipe-b",
      name: "Recipe B",
      createdAt: Date.now(),
      phases: [],
    };

    console.log("RECIPES_KEY in test:", RECIPES_KEY);
    await Promise.all([
      appendRecipeLocal(recipeA),
      appendRecipeLocal(recipeB),
    ]);

    const raw = await AsyncStorage.getItem(RECIPES_KEY);
    console.log("DEBUG RAW after Promise.all:", raw, "mockStore:", mockStore);
    const parsed = JSON.parse(raw || "[]") as SavedRecipe[];
    expect(parsed.length).toBe(2);
    expect(parsed.map(r => r.id)).toContain("recipe-a");
    expect(parsed.map(r => r.id)).toContain("recipe-b");
  });

  it("2. appendRecipeLocal read failure aborts and preserves existing stored data without resetting to empty array", async () => {
    const existingRecipe: SavedRecipe = {
      id: "existing-1",
      name: "Existing Recipe",
      createdAt: Date.now(),
      phases: [],
    };
    await appendRecipeLocal(existingRecipe);

    mockShouldThrowReadError = true;

    const newRecipe: SavedRecipe = {
      id: "new-1",
      name: "New Recipe",
      createdAt: Date.now(),
      phases: [],
    };

    await expect(appendRecipeLocal(newRecipe)).rejects.toThrow("Disk read error");

    mockShouldThrowReadError = false;
    const raw = await AsyncStorage.getItem(RECIPES_KEY);
    const parsed = JSON.parse(raw || "[]") as SavedRecipe[];
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe("existing-1");
  });

  it("3. Candidate draft round-trip serialization preserves edits via updateCandidateExtraction", async () => {
    const candidate = await saveCandidate(DETERMINISTIC_TEST_CANDIDATE);

    const modifiedExtraction = JSON.parse(JSON.stringify(candidate.extractionResult));
    if (modifiedExtraction.status === "single_candidate") {
      modifiedExtraction.candidate.name = "Modified Candidate Draft Name";
    }

    await updateCandidateExtraction(candidate.id, modifiedExtraction);

    const loaded = await loadCandidates();
    expect(loaded.length).toBe(1);
    const res = loaded[0].extractionResult;
    if (res.status === "single_candidate") {
      expect(res.candidate.name).toBe("Modified Candidate Draft Name");
    } else {
      fail("Expected single candidate");
    }
  });

  it("4. Discarding a candidate removes it cleanly from storage", async () => {
    const candidate = await saveCandidate(DETERMINISTIC_TEST_CANDIDATE);
    let loaded = await loadCandidates();
    expect(loaded.length).toBe(1);

    await removeCandidate(candidate.id);
    loaded = await loadCandidates();
    expect(loaded.length).toBe(0);
  });
});
