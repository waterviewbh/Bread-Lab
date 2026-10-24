// artifacts/sourdough/lib/__tests__/bulletproofImport.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLocalDataToAccount, clearMigrationPending } from "../migrate";
import { api, packBakeOutcome, unpackBakeOutcome, rowToApiBakeSession } from "../api";

// Mock AsyncStorage and api
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("../api", () => {
  const actualApi = jest.requireActual("../api");
  return {
    ...actualApi,
    api: {
      history: {
        feed: { upsert: jest.fn().mockResolvedValue({}) },
        bakes: { upsert: jest.fn().mockResolvedValue({}) },
      },
      recipes: { upsert: jest.fn().mockResolvedValue({}) },
    },
  };
});

jest.mock("../deviceId", () => ({
  getDeviceId: jest.fn().mockResolvedValue("mock-device-id-123"),
}));

describe("Bulletproof Two-Pass Typed Import Engine & Issue #24 Final Correction: Legacy Wrapper Ambiguity Closure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles out-of-order recipe dependencies and cross-table ID collisions with typed composite keys", async () => {
    const mockRecipes = [
      { id: "same-id", name: "Child Recipe", parentRecipeId: "same-id" },
      { id: "parent-id", name: "Parent Recipe" },
    ];
    const mockBakes = [
      { id: "same-id", recipeName: "Bake with same ID", recipeId: "parent-id", savedAt: 1000, startedAt: 900, phases: [] },
    ];
    const mockFeeds = [
      { id: "same-id", savedAt: 1000, data: {} },
    ];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation(function(key) {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      if (key.includes("bake_history")) return Promise.resolve(JSON.stringify(mockBakes));
      if (key.includes("sourdough_feed_history")) return Promise.resolve(JSON.stringify(mockFeeds));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("test-user-token-abc");

    expect(result.recipes.ok).toBe(2);
    expect(result.bakes.ok).toBe(1);
    expect(result.feed.ok).toBe(1);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("bread_lab_import_ledger_test-user-token-abc"),
      expect.any(String)
    );
  });

  it("succeeds as an empty migration when local data is genuinely absent", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockResolvedValue(null);

    const result = await migrateLocalDataToAccount("empty-user-token");

    expect(result).toEqual({
      feed: { ok: 0, failed: 0 },
      bakes: { ok: 0, failed: 0 },
      recipes: { ok: 0, failed: 0 },
    });
  });

  it("surfaces actual AsyncStorage read rejections as errors", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockRejectedValue(new Error("Disk hardware failure"));

    await expect(migrateLocalDataToAccount("error-token")).rejects.toThrow(/Disk hardware failure/);
  });

  it("reports malformed JSON as failures (throws error)", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve("{malformed-json");
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("malformed-token")).rejects.toThrow(/Malformed JSON/);
  });

  it("blocks safe migration when migration ledger is invalid or unreadable", async () => {
    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("import_ledger")) return Promise.resolve("[1, 2, 3]");
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("invalid-ledger-token")).rejects.toThrow(/Invalid migration ledger shape/);
  });

  it("preserves complete active bake state including estimatorState, bulkCheckInHistory, and bulkFermentState", async () => {
    const activeBake = {
      id: "active-bake-full",
      recipeName: "Complete Bake",
      startedAt: 5000,
      estimatorState: { flourG: "500", targetTemp: "78" },
      bulkCheckInHistory: [{ checkInId: "c-1", timestamp: 5100 }],
      phases: [
        {
          key: "bulk_fermenting",
          name: "Bulk Ferment",
          startedAt: 5000,
          completedAt: null,
          readings: [{ id: "r-1", temp: "78", loggedAt: 5050 }],
          foldTimestamps: [120],
          bulkFermentState: { startVolume_ml: 1000, maxVolume_ml: 1500 },
        },
      ],
    };

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_bake_v2") return Promise.resolve(JSON.stringify([activeBake]));
      return Promise.resolve(null);
    });

    const result = await migrateLocalDataToAccount("complete-state-token");

    expect(result.bakes.ok).toBe(1);

    expect(api.history.bakes.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: "Complete Bake",
        inProgress: true,
        estimatorState: { flourG: "500", targetTemp: "78" },
        bulkCheckInHistory: [{ checkInId: "c-1", timestamp: 5100 }],
        phases: expect.arrayContaining([
          expect.objectContaining({
            key: "bulk_fermenting",
            bulkFermentState: { startVolume_ml: 1000, maxVolume_ml: 1500 },
            foldTimestamps: [120],
          }),
        ]),
      })
    );
  });

  it("persists active bake missing ID as an object without converting object-shaped value to array", async () => {
    const objectShapedBake = { recipeName: "Single Object Bake", startedAt: 1000, phases: [] };
    let storedBakeJson: string | null = JSON.stringify(objectShapedBake);

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    const setItemMock = AsyncStorage.setItem as jest.Mock;

    getItemMock.mockImplementation((key) => {
      if (key === "bread_lab_bake_v2") return Promise.resolve(storedBakeJson);
      return Promise.resolve(null);
    });

    setItemMock.mockImplementation((key, val) => {
      if (key === "bread_lab_bake_v2") {
        storedBakeJson = val;
      }
      return Promise.resolve();
    });

    await migrateLocalDataToAccount("object-bake-token");

    expect(storedBakeJson).toBeDefined();
    const parsedStored = JSON.parse(storedBakeJson!);
    expect(Array.isArray(parsedStored)).toBe(false);
    expect(parsedStored.id).toBeDefined();
    expect(parsedStored.recipeName).toBe("Single Object Bake");
  });

  it("tests a genuine failed migration and retry with assigned ID persistence and ID reuse, keeping local session intact", async () => {
    const activeFeedWithoutId = { savedAt: 1234, data: { pH: "4.0" } };
    let storedFeedJson: string | null = JSON.stringify(activeFeedWithoutId);
    let storedLedgerJson: string | null = null;

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    const setItemMock = AsyncStorage.setItem as jest.Mock;

    setItemMock.mockImplementation((key, val) => {
      if (key === "sourdough_feed_session_v1") {
        storedFeedJson = val;
      }
      if (key.includes("import_ledger")) {
        storedLedgerJson = val;
      }
      return Promise.resolve();
    });

    getItemMock.mockImplementation((key) => {
      if (key === "sourdough_feed_session_v1") return Promise.resolve(storedFeedJson);
      if (key.includes("import_ledger")) return Promise.resolve(storedLedgerJson);
      return Promise.resolve(null);
    });

    const upsertMock = api.history.feed.upsert as jest.Mock;
    upsertMock.mockRejectedValueOnce(new Error("Network connection lost"));

    const firstResult = await migrateLocalDataToAccount("fail-retry-token");
    expect(firstResult.feed.failed).toBe(1);

    expect(storedFeedJson).toBeDefined();
    const parsedLocalSession = JSON.parse(storedFeedJson!);
    expect(parsedLocalSession.id).toBeDefined();
    const assignedLocalId = parsedLocalSession.id;

    upsertMock.mockResolvedValueOnce({});

    const retryResult = await migrateLocalDataToAccount("fail-retry-token");
    expect(retryResult.feed.ok).toBe(1);

    const secondCallArg = upsertMock.mock.calls[1][0];
    const firstCallLedgerKey = `feed:${assignedLocalId}`;
    const ledgerParsed = JSON.parse(storedLedgerJson!);
    expect(secondCallArg.id).toBe(ledgerParsed[firstCallLedgerKey]);
  });

  it("correctly preserves ordinary objects colliding with state-like property names and unpacks explicitly marked wrappers", () => {
    // 1. Explicitly marked new wrapper
    const markedWrapper = packBakeOutcome("completed", { targetTemp: "76" }, [{ id: "s-1" }]);
    expect(markedWrapper._bread_lab_wrapped).toBe(true);
    const unpackedMarked = unpackBakeOutcome(markedWrapper);
    expect(unpackedMarked).toEqual({
      outcome: "completed",
      estimatorState: { targetTemp: "76" },
      bulkCheckInHistory: [{ id: "s-1" }],
    });

    // 2. Ordinary object containing bulkCheckInHistory: [] with unrelated user data
    const ordWithHistory = { outcome: "success", rating: 5, bulkCheckInHistory: [] };
    const unpackedHistory = unpackBakeOutcome(ordWithHistory);
    expect(unpackedHistory).toEqual({ outcome: ordWithHistory });

    // 3. Ordinary object containing estimatorState with custom user data
    const ordWithEstimator = { outcome: "good", rating: 4, estimatorState: { targetTemp: "custom user data" } };
    const unpackedEstimator = unpackBakeOutcome(ordWithEstimator);
    expect(unpackedEstimator).toEqual({ outcome: ordWithEstimator });

    // 4. Ordinary object containing both state-like property names in a colliding shape
    const ordWithBoth = { outcome: "ok", estimatorState: { targetTemp: "custom" }, bulkCheckInHistory: [] };
    const unpackedBoth = unpackBakeOutcome(ordWithBoth);
    expect(unpackedBoth).toEqual({ outcome: ordWithBoth });

    // 5. null, strings, standard outcome objects
    expect(unpackBakeOutcome(null)).toEqual({ outcome: null });
    expect(unpackBakeOutcome("success")).toEqual({ outcome: "success" });
    const stdOutcome = { overallScore: 5, defects: [] };
    expect(unpackBakeOutcome(stdOutcome)).toEqual({ outcome: stdOutcome });
  });

  it("exercises the real conversion boundary through rowToApiBakeSession for marked wrappers and colliding ordinary objects", () => {
    const baseRow = {
      id: "row-789",
      device_id: "dev-2",
      user_id: "user-2",
      recipe_id: "rec-2",
      recipe_name: "Collision Test Bake",
      saved_at: 2000,
      started_at: 1900,
      phases: [],
      in_progress: false,
      created_at: new Date().toISOString(),
      yield_value: 1,
      completed_at: 2500,
      status: "completed",
      notes: "notes",
    };

    // Row with marked wrapper
    const wrappedRow = {
      ...baseRow,
      outcome: packBakeOutcome("success", { flourG: "500" }, [{ id: "h-2" }]),
    };
    const sessionWrapped = rowToApiBakeSession(wrappedRow as any);
    expect(sessionWrapped.outcome).toBe("success");
    expect(sessionWrapped.estimatorState).toEqual({ flourG: "500" });
    expect(sessionWrapped.bulkCheckInHistory).toEqual([{ id: "h-2" }]);

    // Row with ordinary colliding object
    const collidingRow = {
      ...baseRow,
      outcome: { outcome: "delicious", estimatorState: { targetTemp: "custom user data" }, bulkCheckInHistory: [] },
    };
    const sessionColliding = rowToApiBakeSession(collidingRow as any);
    expect(sessionColliding.outcome).toEqual({
      outcome: "delicious",
      estimatorState: { targetTemp: "custom user data" },
      bulkCheckInHistory: [],
    });
    expect(sessionColliding.estimatorState).toBeUndefined();
    expect(sessionColliding.bulkCheckInHistory).toBeUndefined();
  });

  it("rejects malformed records or missing/invalid identity fields before migration", async () => {
    const invalidRecipes = [{ name: "Missing ID Recipe" }];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(invalidRecipes));
      return Promise.resolve(null);
    });

    await expect(migrateLocalDataToAccount("validation-token")).rejects.toThrow(/Invalid record found/);
  });

  it("persists ledger before first remote write and prevents remote uploads if ledger write fails", async () => {
    const mockRecipes = [{ id: "rec-1", name: "Valid Recipe" }];

    const getItemMock = AsyncStorage.getItem as jest.Mock;
    getItemMock.mockImplementation((key) => {
      if (key.includes("recipes")) return Promise.resolve(JSON.stringify(mockRecipes));
      return Promise.resolve(null);
    });

    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockImplementation((key, val) => {
      if (key.includes("import_ledger")) {
        throw new Error("Ledger storage write failed");
      }
      return Promise.resolve();
    });

    await expect(migrateLocalDataToAccount("ledger-fail-token")).rejects.toThrow(/Ledger storage write failed/);

    expect(api.recipes.upsert).not.toHaveBeenCalled();
    expect(api.history.bakes.upsert).not.toHaveBeenCalled();
  });
});
