import AsyncStorage from "@react-native-async-storage/async-storage";
import { processPendingDeletions, addToFeedTombstone, addToBakeTombstone, getFeedTombstone } from "../recipeStorage";
import { api } from "../api";

let mockStore: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore[key] || null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  }),
}));

jest.mock("../api", () => ({
  api: {
    recipes: {
      delete: jest.fn().mockResolvedValue(true),
      verifyAbsent: jest.fn().mockResolvedValue(true),
    },
    history: {
      bakes: {
        delete: jest.fn().mockResolvedValue(true),
        verifyAbsent: jest.fn().mockResolvedValue(true),
      },
      feed: {
        delete: jest.fn().mockResolvedValue(false),
        verifyAbsent: jest.fn().mockResolvedValue(false),
      },
    },
  },
}));

describe("Ordinary-Workspace Pending Deletion Processing Suite", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    await AsyncStorage.clear();
  });

  it("1. Processing pending deletions attempts remote deletion and removes tombstone on success", async () => {
    await addToFeedTombstone("feed-tomb-1");
    expect(await getFeedTombstone()).toContain("feed-tomb-1");

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    await processPendingDeletions();

    expect(api.history.feed.delete).toHaveBeenCalledWith("feed-tomb-1", expect.any(String), undefined);
    expect(await getFeedTombstone()).not.toContain("feed-tomb-1");
  });

  it("2. A processing failure does not remove or discard the pending tombstone", async () => {
    await addToFeedTombstone("feed-fail-1");
    expect(await getFeedTombstone()).toContain("feed-fail-1");

    // Simulate delete failure and remote absence verification failure
    (api.history.feed.delete as jest.Mock).mockRejectedValueOnce(new Error("Network error"));
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValueOnce(false);

    await processPendingDeletions();

    // Tombstone must be preserved on error
    expect(await getFeedTombstone()).toContain("feed-fail-1");
  });

  it("3. Repeated focus/refresh events do not introduce unsafe concurrent processing or duplicate deletion work", async () => {
    await addToFeedTombstone("feed-coalesce-1");

    let resolveDelete: (val: boolean) => void = () => {};
    const deletePromise = new Promise<boolean>((resolve) => {
      resolveDelete = resolve;
    });
    (api.history.feed.delete as jest.Mock).mockReturnValueOnce(deletePromise);

    // Trigger two concurrent processPendingDeletions calls
    const p1 = processPendingDeletions();
    const p2 = processPendingDeletions(); // Should coalesce / skip overlapping execution

    resolveDelete(true);
    await Promise.all([p1, p2]);

    expect(api.history.feed.delete).toHaveBeenCalledTimes(1);
    expect(await getFeedTombstone()).not.toContain("feed-coalesce-1");
  });
});
