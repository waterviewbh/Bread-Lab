import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  processPendingDeletions,
  addToFeedTombstone,
  addToBakeTombstone,
  addToRecipeTombstone,
  getFeedTombstone,
  getBakeTombstone,
  getRecipeTombstone,
} from "../recipeStorage";
import { api } from "../api";

// Pending-deletion lifecycle, split by workspace (Omicron_CLI-4):
//  - AUTHENTICATED ACCOUNT: unchanged semantics. Remote delete, absence verification and tombstone retention all
//    run exactly as before, scoped to the account (the owner token is passed to every call).
//  - NLA (signed out): knows nothing about Supabase. It never calls delete or verify; its pending deletions are
//    retired locally. Account-owned tombstones are never touched from NLA.

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

const ACCT = "acct-1";
const signIn = (id = ACCT) => {
  mockStore["bread_lab_auth_token_v1"] = id;
  mockStore["bread_lab_auth_user_v1"] = JSON.stringify({ id, firstName: "A", starterName: "S" });
};
const allApiMocks = () => [
  api.recipes.delete, api.recipes.verifyAbsent,
  api.history.bakes.delete, api.history.bakes.verifyAbsent,
  api.history.feed.delete, api.history.feed.verifyAbsent,
] as jest.Mock[];

describe("Authenticated-account Pending Deletion Processing Suite (existing semantics, owner-scoped)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    await AsyncStorage.clear();
    signIn();
  });

  it("1. Processing pending deletions attempts remote deletion and removes tombstone on success", async () => {
    await addToFeedTombstone("feed-tomb-1");
    expect(await getFeedTombstone()).toContain("feed-tomb-1");

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    await processPendingDeletions();

    expect(api.history.feed.delete).toHaveBeenCalledWith("feed-tomb-1", expect.any(String), ACCT);
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

  it("4. Recipes and bakes follow the same lifecycle: delete, then owner-scoped absence verification", async () => {
    await addToRecipeTombstone("rec-1");
    await addToBakeTombstone("bake-1");
    (api.recipes.delete as jest.Mock).mockResolvedValueOnce(false);
    (api.recipes.verifyAbsent as jest.Mock).mockResolvedValueOnce(true);
    (api.history.bakes.delete as jest.Mock).mockResolvedValueOnce(true);

    await processPendingDeletions();

    expect(api.recipes.delete).toHaveBeenCalledWith("rec-1", expect.any(String), ACCT);
    expect(api.recipes.verifyAbsent).toHaveBeenCalledWith("rec-1", expect.any(String), ACCT);
    expect(api.history.bakes.delete).toHaveBeenCalledWith("bake-1", expect.any(String), ACCT);
    expect(await getRecipeTombstone()).toEqual([]);
    expect(await getBakeTombstone()).toEqual([]);
  });

  it("5. A tombstone is kept when absence cannot be verified (delete false, verify false) and when verification throws", async () => {
    await addToFeedTombstone("feed-a");
    await addToRecipeTombstone("rec-a");
    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(false);
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValueOnce(false);
    (api.recipes.delete as jest.Mock).mockResolvedValueOnce(false);
    (api.recipes.verifyAbsent as jest.Mock).mockRejectedValueOnce(new Error("offline"));

    await processPendingDeletions();

    expect(await getFeedTombstone()).toEqual(["feed-a"]);
    expect(await getRecipeTombstone()).toEqual(["rec-a"]);
  });

  it("6. Only the active account's tombstones are processed; another account's stay put", async () => {
    mockStore["bread_lab_deleted_feed_ids_v1_acct-2"] = JSON.stringify(["theirs"]);
    await addToFeedTombstone("mine");
    (api.history.feed.delete as jest.Mock).mockResolvedValue(true);

    await processPendingDeletions();

    expect(api.history.feed.delete).toHaveBeenCalledTimes(1);
    expect(api.history.feed.delete).toHaveBeenCalledWith("mine", expect.any(String), ACCT);
    expect(JSON.parse(mockStore["bread_lab_deleted_feed_ids_v1_acct-2"])).toEqual(["theirs"]);
  });
});

describe("NLA Pending Deletion Processing Suite (no Supabase)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    await AsyncStorage.clear();
  });

  it("N1. NLA never calls delete or verify; its pending deletions are retired locally", async () => {
    await addToFeedTombstone("n-feed");
    await addToBakeTombstone("n-bake");
    await addToRecipeTombstone("n-rec");
    expect(await getFeedTombstone()).toEqual(["n-feed"]);

    await processPendingDeletions();

    for (const mock of allApiMocks()) expect(mock).not.toHaveBeenCalled();
    expect(await getFeedTombstone()).toEqual([]);
    expect(await getBakeTombstone()).toEqual([]);
    expect(await getRecipeTombstone()).toEqual([]);
  });

  it("N2. Even a failing or hanging API cannot be reached: nothing is awaited from Supabase", async () => {
    await addToFeedTombstone("n-feed-2");
    (api.history.feed.delete as jest.Mock).mockReturnValue(new Promise(() => {})); // would hang forever if called
    await expect(processPendingDeletions()).resolves.toBeUndefined();
    expect(api.history.feed.delete).not.toHaveBeenCalled();
    expect(await getFeedTombstone()).toEqual([]);
  });

  it("N3. NLA never touches account-owned tombstones (they keep their existing lifecycle)", async () => {
    mockStore["bread_lab_deleted_feed_ids_v1_acct-1"] = JSON.stringify(["acct-pending"]);
    mockStore["bread_lab_deleted_recipe_ids_v1_acct-1"] = JSON.stringify(["acct-rec"]);
    await addToFeedTombstone("n-feed-3");

    await processPendingDeletions();

    expect(JSON.parse(mockStore["bread_lab_deleted_feed_ids_v1_acct-1"])).toEqual(["acct-pending"]);
    expect(JSON.parse(mockStore["bread_lab_deleted_recipe_ids_v1_acct-1"])).toEqual(["acct-rec"]);
    for (const mock of allApiMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("N4. Tombstone CREATION is unchanged for NLA (the marker is written, then retired on the next pass)", async () => {
    await addToFeedTombstone("n-feed-4");
    expect(JSON.parse(mockStore["bread_lab_deleted_feed_ids_v1_anonymous"])).toEqual(["n-feed-4"]);
    await processPendingDeletions();
    expect(JSON.parse(mockStore["bread_lab_deleted_feed_ids_v1_anonymous"])).toEqual([]); // queue emptied, as for accounts
  });

  it("N5. Concurrent passes are still safe for NLA", async () => {
    await addToFeedTombstone("n-feed-5");
    await Promise.all([processPendingDeletions(), processPendingDeletions()]);
    expect(await getFeedTombstone()).toEqual([]);
    for (const mock of allApiMocks()) expect(mock).not.toHaveBeenCalled();
  });
});
