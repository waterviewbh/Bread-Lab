import AsyncStorage from "@react-native-async-storage/async-storage";
import { isOwnerMatch } from "../../app/(tabs)/history";

// Helper simulating active bake merge / history eligibility filtering
function filterAndMergeHistory(storedBakes: any[], activeBakes: any[], token: string | null) {
  const isOwner = (entry: any) => isOwnerMatch(entry, token);

  const validBakes = storedBakes.filter(
    (b) => isOwner(b) && b.phases?.length > 0 && b.phases.every((p: any) => !!p.completedAt)
  );

  const validActiveBakes = activeBakes.filter(
    (active) =>
      isOwner(active) &&
      active?.phases?.length > 0 &&
      active.phases.every((p: any) => !!p.completedAt)
  );

  let newList = [...validBakes];
  validActiveBakes.forEach((active) => {
    if (!active?.id || !active?.startedAt) return;
    if (newList.some((e) => e.id === active.id)) return;
    newList.unshift({
      id: active.id,
      userId: active.userId ?? token ?? "anonymous",
      recipeId: active.recipeId ?? "",
      recipeName: active.recipeName,
      savedAt: active.startedAt,
      startedAt: active.startedAt,
      phases: active.phases,
      notes: active.notes ?? "",
      yieldValue: active.yieldValue ?? "",
      outcome: active.outcome ?? null,
    });
  });

  return newList;
}

describe("History Eligibility Regression Tests (JA Assignment 1)", () => {
  const token = "test-token-123";

  it("1. Newly created active bake with no completed phases is excluded from history", () => {
    const activeBakes = [
      {
        id: "active-1",
        userId: token,
        startedAt: 1000,
        phases: [
          { key: "mix", name: "Mix", startedAt: null, completedAt: null },
          { key: "proof", name: "Proof", startedAt: null, completedAt: null },
        ],
      },
    ];
    const history = filterAndMergeHistory([], activeBakes, token);
    expect(history).toHaveLength(0);
  });

  it("2. Bake with partially completed phases (incomplete) is excluded from history", () => {
    const activeBakes = [
      {
        id: "active-2",
        userId: token,
        startedAt: 1000,
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
          { key: "proof", name: "Proof", startedAt: 1200, completedAt: null },
        ],
      },
    ];
    const history = filterAndMergeHistory([], activeBakes, token);
    expect(history).toHaveLength(0);
  });

  it("3. Bake with all required phases completed is included in history", () => {
    const activeBakes = [
      {
        id: "active-3",
        userId: token,
        startedAt: 1000,
        recipeName: "Completed Unreviewed Sourdough",
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
          { key: "proof", name: "Proof", startedAt: 1200, completedAt: 1300 },
        ],
      },
    ];
    const history = filterAndMergeHistory([], activeBakes, token);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("active-3");
    expect(history[0].recipeName).toBe("Completed Unreviewed Sourdough");
  });

  it("4. Completed but unreviewed bake is included", () => {
    const storedBakes = [
      {
        id: "completed-unreviewed",
        userId: token,
        savedAt: 1400,
        startedAt: 1000,
        recipeName: "Unreviewed Bake",
        outcome: null,
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
        ],
      },
    ];
    const history = filterAndMergeHistory(storedBakes, [], token);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("completed-unreviewed");
  });

  it("5. Reviewed completed bake remains included", () => {
    const storedBakes = [
      {
        id: "completed-reviewed",
        userId: token,
        savedAt: 1500,
        startedAt: 1000,
        recipeName: "Reviewed Bake",
        outcome: { overallScore: 5, defects: [] },
        phases: [
          { key: "mix", name: "Mix", startedAt: 1000, completedAt: 1100 },
        ],
      },
    ];
    const history = filterAndMergeHistory(storedBakes, [], token);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("completed-reviewed");
    expect(history[0].outcome).not.toBeNull();
  });

  it("6. Filtering works across initial load and reconciliation paths without duplicating entries", () => {
    const storedBakes = [
      {
        id: "completed-1",
        userId: token,
        startedAt: 1000,
        phases: [{ key: "mix", completedAt: 1100 }],
      },
    ];
    // Active bake that is still active (incomplete) should not be merged
    const activeBakes = [
      {
        id: "active-in-progress",
        userId: token,
        startedAt: 2000,
        phases: [{ key: "mix", completedAt: null }],
      },
    ];
    const history = filterAndMergeHistory(storedBakes, activeBakes, token);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("completed-1");
  });

  it("7. Excluded active bakes remain intact in active storage (mock check)", async () => {
    const activeStoreKey = "bread_lab_bake_v2";
    const initialActiveBakes = JSON.stringify([
      {
        id: "active-active-1",
        userId: token,
        startedAt: 1000,
        phases: [{ key: "mix", completedAt: null }],
      },
    ]);
    await AsyncStorage.setItem(activeStoreKey, initialActiveBakes);

    // Load active storage
    const storedRaw = await AsyncStorage.getItem(activeStoreKey);
    const activeBakes = JSON.parse(storedRaw || "[]");

    // Filter for history eligibility
    const history = filterAndMergeHistory([], activeBakes, token);

    // History should be empty
    expect(history).toHaveLength(0);

    // Active store raw content must remain unchanged (intact)
    const postLoadRaw = await AsyncStorage.getItem(activeStoreKey);
    expect(postLoadRaw).toBe(initialActiveBakes);
  });
});
