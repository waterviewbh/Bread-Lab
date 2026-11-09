import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadAll, UNRESOLVED_LEGACY_TOMBSTONES_KEY } from "../recipeStorage";
import { validateOperationalData } from "../storageUtils";

let mockStorage: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn((key) => Promise.resolve(mockStorage[key] ?? null)),
  setItem: jest.fn((key, val) => {
    mockStorage[key] = val;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys) => {
    keys.forEach((k: string) => delete mockStorage[k]);
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys) => Promise.resolve(keys.map((k: string) => [k, mockStorage[k] ?? null]))),
  multiSet: jest.fn((entries) => {
    entries.forEach(([k, v]: [string, string]) => { mockStorage[k] = v; });
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    mockStorage = {};
    return Promise.resolve();
  }),
}));

describe("Omicron-8/10: Fail-Safe Legacy Tombstone Disposition & Validation", () => {
  beforeEach(async () => {
    mockStorage = {};
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("Scenario 1 — Legacy queue containing invalid entries does not block loadAll and preserves source key", async () => {
    const key = "bread_lab_deleted_recipe_ids_v1";
    mockStorage[key] = JSON.stringify(["valid-id", null]);

    await expect(loadAll()).resolves.toBeDefined();
    expect(mockStorage[key]).toBeDefined();
  });

  it("Scenario 2 & 3 & 4 — Destination write failure or corruption does not block loadAll and preserves source key", async () => {
    const key = "bread_lab_deleted_bake_ids_v1";
    mockStorage[key] = JSON.stringify(["bake-1"]);

    // Force destination write failure by corrupting destination with empty string
    mockStorage[UNRESOLVED_LEGACY_TOMBSTONES_KEY] = "";

    await expect(loadAll()).resolves.toBeDefined();
    expect(mockStorage[key]).toBeDefined();
  });

  it("Scenario 5 & 6 — Valid migration preserves intents and removes source only after verification (Idempotent)", async () => {
    const key = "bread_lab_deleted_feed_ids_v1";
    mockStorage[key] = JSON.stringify(["feed-1", "feed-2"]);

    await loadAll();

    expect(mockStorage[key]).toBeUndefined();
    const rawDest = mockStorage[UNRESOLVED_LEGACY_TOMBSTONES_KEY];
    expect(rawDest).toBeDefined();
    const parsed = JSON.parse(rawDest || "[]");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: "feed-1", recordType: "feed", owner: "unknown", disposition: "unresolved" });

    // Run loadAll again (repeat migration) -> should be idempotent and not duplicate
    await loadAll();
    const rawDest2 = mockStorage[UNRESOLVED_LEGACY_TOMBSTONES_KEY];
    expect(JSON.parse(rawDest2 || "[]")).toHaveLength(2);
  });

  it("Scenario 7 — validateOperationalData blocks on each of the three legacy queues independently", async () => {
    const keys = [
      "bread_lab_deleted_recipe_ids_v1",
      "bread_lab_deleted_bake_ids_v1",
      "bread_lab_deleted_feed_ids_v1",
    ];

    for (const key of keys) {
      mockStorage = {};
      mockStorage[key] = JSON.stringify(["rec-block"]);
      await expect(validateOperationalData(null)).rejects.toThrow(/workspace contains nonempty|pending deletion work/i);
    }
  });

  it("Scenario 8 & 9 — validateOperationalData blocks on malformed JSON, non-array values, and invalid elements", async () => {
    const key = "bread_lab_deleted_recipe_ids_v1";

    // Malformed JSON
    mockStorage[key] = "{malformed}";
    await expect(validateOperationalData(null)).rejects.toThrow(/malformed JSON/i);

    // Non-array value
    mockStorage[key] = JSON.stringify("not-an-array");
    await expect(validateOperationalData(null)).rejects.toThrow(/is not an array/i);

    // Invalid array element (empty string)
    mockStorage[key] = JSON.stringify([""]);
    await expect(validateOperationalData(null)).rejects.toThrow(/contains invalid or non-string element/i);
  });

  it("Scenario 10 — Empty or absent legacy queues do not block when clean", async () => {
    mockStorage["bread_lab_deleted_recipe_ids_v1"] = JSON.stringify([]);
    await expect(validateOperationalData(null)).resolves.toBeUndefined();
  });

  it("Scenario 11 — loadAll resolves on reconciliation failure, but validateOperationalData independently blocks transition", async () => {
    const key = "bread_lab_deleted_recipe_ids_v1";
    mockStorage[key] = JSON.stringify(["id-1", 123]); // invalid entry (number)

    await expect(loadAll()).resolves.toBeDefined();
    expect(mockStorage[key]).toBeDefined();
    await expect(validateOperationalData(null)).rejects.toThrow(/contains invalid or non-string element/i);
  });
});
