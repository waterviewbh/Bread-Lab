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

describe("Bulletproof Two-Pass Typed Import Engine & Issue #24 Outcome Compatibility", () => {
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

    // Make first remote upsert fail
    const upsertMock = api.history.feed.upsert as jest.Mock;
    upsertMock.mockRejectedValueOnce(new Error("Network connection lost"));

    // First migration attempt results in partial failure (feed failed: 1)
    const firstResult = await migrateLocalDataToAccount("fail-retry-token");
    expect(firstResult.feed.failed).toBe(1);

    // Verify assigned local ID was persisted in local session
    expect(storedFeedJson).toBeDefined();
    const parsedLocalSession = JSON.parse(storedFeedJson!);
    expect(parsedLocalSession.id).toBeDefined();
    const assignedLocalId = parsedLocalSession.id;

    // Subsequent upsert succeeds
    upsertMock.mockResolvedValueOnce({});

    // Retry migration with same account
    const retryResult = await migrateLocalDataToAccount("fail-retry-token");
    expect(retryResult.feed.ok).toBe(1);

    // Verify the remote target ID reused the ledger entry for the same assigned ID
    const secondCallArg = upsertMock.mock.calls[1][0];
    const firstCallLedgerKey = `feed:${assignedLocalId}`;
    const ledgerParsed = JSON.parse(storedLedgerJson!);
    expect(secondCallArg.id).toBe(ledgerParsed[firstCallLedgerKey]);
  });

  it("preserves ordinary outcome objects including those with an 'outcome' property", () => {
    const ordinaryOutcomeObj = { rating: 5, outcome: "success", notes: "Great open crumb" };
    const packed = packBakeOutcome(ordinaryOutcomeObj, undefined, undefined);
    expect(packed).toEqual(ordinaryOutcomeObj);

    const unpacked = unpackBakeOutcome(packed);
    expect(unpacked.outcome).toEqual(ordinaryOutcomeObj);
    expect(unpacked.estimatorState).toBeUndefined();
    expect(unpacked.bulkCheckInHistory).toBeUndefined();
  });

  it("retains backward compatibility for legacy wrapped records without _bread_lab_wrapped marker", () => {
    const legacyWrapped = {
      outcome: "good",
      estimatorState: { flourG: "300" },
      bulkCheckInHistory: [{ checkInId: "legacy-1" }],
    };

    const unpacked = unpackBakeOutcome(legacyWrapped);
    expect(unpacked.outcome).toBe("good");
    expect(unpacked.estimatorState).toEqual({ flourG: "300" });
    expect(unpacked.bulkCheckInHistory).toEqual([{ checkInId: "legacy-1" }]);
  });

  it("tests the actual conversion path through rowToApiBakeSession", () => {
    const mockRow = {
      id: "row-123",
      device_id: "dev-1",
      user_id: "user-1",
      recipe_id: "rec-1",
      recipe_name: "Test Bake",
      saved_at: 1000,
      started_at: 900,
      phases: [],
      in_progress: true,
      created_at: new Date().toISOString(),
      yield_value: 2,
      completed_at: null,
      status: "active",
      outcome: {
        _bread_lab_wrapped: true,
        outcome: "active",
        estimatorState: { targetTemp: "75" },
        bulkCheckInHistory: [{ id: "snap-1" }],
      },
      notes: "some notes",
    };

    const apiSession = rowToApiBakeSession(mockRow as any);
    expect(apiSession.id).toBe("row-123");
    expect(apiSession.outcome).toBe("active");
    expect(apiSession.estimatorState).toEqual({ targetTemp: "75" });
    expect(apiSession.bulkCheckInHistory).toEqual([{ id: "snap-1" }]);

    // Test with ordinary outcome object row
    const ordinaryRow = {
      ...mockRow,
      outcome: { outcome: "delicious", rating: 5 },
    };
    const apiSessionOrdinary = rowToApiBakeSession(ordinaryRow as any);
    expect(apiSessionOrdinary.outcome).toEqual({ outcome: "delicious", rating: 5 });
    expect(apiSessionOrdinary.estimatorState).toBeUndefined();
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
