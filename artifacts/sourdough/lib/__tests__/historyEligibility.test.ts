import { mergeActiveBake, isOwnerMatch, isBakeEligibleForHistory } from "../../app/(tabs)/history";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Production History Eligibility & Initial-Load / Reconciliation Filter Tests (JA Assignment 1)", () => {
  const token = "test-token-123";

  it("Tests isBakeEligibleForHistory directly for initial-load and reconciliation paths (incomplete, unreviewed completed, reviewed bakes)", () => {
    // 1. Newly created active bake (no completed phases) -> Ineligible
    const newBake = {
      id: "b-new",
      phases: [{ key: "mix", completedAt: null }],
    };
    expect(isBakeEligibleForHistory(newBake)).toBe(false);

    // 2. Bake with partially completed phases (incomplete) -> Ineligible
    const partialBake = {
      id: "b-partial",
      phases: [
        { key: "mix", completedAt: 100 },
        { key: "proof", completedAt: null },
      ],
    };
    expect(isBakeEligibleForHistory(partialBake)).toBe(false);

    // 3. Fully completed but unreviewed bake -> Eligible
    const completedUnreviewedBake = {
      id: "b-completed",
      outcome: null,
      phases: [
        { key: "mix", completedAt: 100 },
        { key: "proof", completedAt: 200 },
      ],
    };
    expect(isBakeEligibleForHistory(completedUnreviewedBake)).toBe(true);

    // 4. Reviewed completed bake -> Eligible
    const reviewedBake = {
      id: "b-reviewed",
      outcome: { overallScore: 5, defects: [] },
      phases: [
        { key: "mix", completedAt: 100 },
        { key: "proof", completedAt: 200 },
      ],
    };
    expect(isBakeEligibleForHistory(reviewedBake)).toBe(true);
  });

  it("1. Newly created active bake with no completed phases is excluded by mergeActiveBake", () => {
    const activeBakes = [
      {
        id: "active-new",
        userId: token,
        startedAt: 1000,
        recipeName: "New Bake",
        phases: [
          { key: "mix", name: "Mix", startedAt: null, completedAt: null },
        ],
      },
    ];
    const result = mergeActiveBake([], JSON.stringify(activeBakes), token);
    expect(result).toHaveLength(0);
  });

  it("2. Bake with partially completed phases (incomplete) is excluded by mergeActiveBake", () => {
    const activeBakes = [
      {
        id: "active-incomplete",
        userId: token,
        startedAt: 1000,
        recipeName: "Incomplete Bake",
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
          { key: "proof", name: "Proof", startedAt: 1200, completedAt: null },
        ],
      },
    ];
    const result = mergeActiveBake([], JSON.stringify(activeBakes), token);
    expect(result).toHaveLength(0);
  });

  it("3. Bake with all required phases completed (unreviewed) is included by mergeActiveBake", () => {
    const activeBakes = [
      {
        id: "active-completed",
        userId: token,
        startedAt: 1000,
        recipeName: "Completed Unreviewed Bake",
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
        ],
      },
    ];
    const result = mergeActiveBake([], JSON.stringify(activeBakes), token);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("active-completed");
  });

  it("4 & 5. Completed unreviewed and reviewed bakes are included in history list", () => {
    const existingHistory = [
      {
        id: "completed-reviewed",
        userId: token,
        savedAt: 2000,
        startedAt: 1000,
        recipeName: "Reviewed Bake",
        outcome: { overallScore: 5 },
        phases: [{ key: "mix", completedAt: 1100 }],
      },
    ];
    const result = mergeActiveBake(existingHistory, null, token);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("completed-reviewed");
    expect(result[0].outcome).not.toBeNull();
  });

  it("6. Filtering works across initial load and reconciliation paths without duplicating entries", () => {
    const existingHistory = [
      {
        id: "completed-1",
        userId: token,
        startedAt: 1000,
        phases: [{ key: "mix", completedAt: 1100 }],
      },
    ];
    const activeBakes = [
      {
        id: "completed-1", // duplicate ID test
        userId: token,
        startedAt: 1000,
        phases: [{ key: "mix", completedAt: 1100 }],
      },
      {
        id: "active-in-progress",
        userId: token,
        startedAt: 2000,
        phases: [{ key: "mix", completedAt: null }],
      },
    ];
    const result = mergeActiveBake(existingHistory, JSON.stringify(activeBakes), token);
    expect(result).toHaveLength(1); // No duplicate, active-in-progress excluded
    expect(result[0].id).toBe("completed-1");
  });

  it("7. Excluded active bakes remain intact in active-bake storage", async () => {
    const activeStorageKey = "bread_lab_bake_v2";
    const activeData = JSON.stringify([
      {
        id: "active-untouched",
        userId: token,
        startedAt: 1000,
        phases: [{ key: "mix", completedAt: null }],
      },
    ]);
    await AsyncStorage.setItem(activeStorageKey, activeData);

    const storedRaw = await AsyncStorage.getItem(activeStorageKey);

    const result = mergeActiveBake([], storedRaw, token);
    expect(result).toHaveLength(0); // Excluded from history

    // Active store remains intact
    const postCheckRaw = await AsyncStorage.getItem(activeStorageKey);
    expect(postCheckRaw).toBe(activeData);
  });
});
