import React from "react";
import { Alert } from "react-native";
import { render, waitFor, cleanup } from "@testing-library/react-native";

// Deliberately not RNTL act(): wrapping our async flows in act() leaves React 19 in a state where
// later renders in this file never flush. Plain invocation + waitFor settles the same flows.
const act = (fn: () => unknown) => Promise.resolve(fn());
import { ActiveFeedSection } from "../ActiveFeedSection";
import { getFeedTombstone } from "@/lib/recipeStorage";
import { advanceWorkspaceGeneration } from "@/lib/storageUtils";
import { api } from "@/lib/api";

// Issue #24 / Omicron_CLI-1: Abandon Feed must obey the durable deletion contract.
// These tests drive the real onClearSession handler against the real tombstone + processor code.

const STORAGE_KEY = "sourdough_feed_session_v1";
const DECLINED_KEY = "bread_lab_declined_tutorial_v1";

let mockStore: Record<string, string> = {};
let mockEvents: string[] = [];
let mockFailSetKey: ((key: string) => boolean) | null = null;
let mockFailRemoveKey: ((key: string) => boolean) | null = null;
let mockSetGate: { match: (key: string) => boolean; promise: Promise<void> } | null = null;
let mockViewProps: any = null;
let mockSetupProps: any = null;
let spies: jest.SpyInstance[] = [];

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => (key in mockStore ? mockStore[key] : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    if (mockSetGate && mockSetGate.match(key)) await mockSetGate.promise;
    if (mockFailSetKey && mockFailSetKey(key)) throw new Error(`setItem failed for ${key}`);
    // Only count writes that record a pending deletion, not the emptying after acknowledgement.
    if (key.includes("deleted_feed") && JSON.parse(value).length > 0) mockEvents.push("tombstone:set");
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    if (mockFailRemoveKey && mockFailRemoveKey(key)) throw new Error(`removeItem failed for ${key}`);
    if (key === "sourdough_feed_session_v1") mockEvents.push("session:removed");
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  }),
}));

jest.mock("@/lib/api", () => ({
  api: {
    recipes: { delete: jest.fn(), verifyAbsent: jest.fn() },
    history: {
      bakes: { delete: jest.fn(), verifyAbsent: jest.fn() },
      feed: {
        get: jest.fn(),
        upsert: jest.fn(),
        active: jest.fn(),
        delete: jest.fn(),
        verifyAbsent: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/deviceId", () => ({ getDeviceId: jest.fn(async () => "device-1") }));
jest.mock("@/lib/auth", () => ({
  getStoredToken: jest.fn(async () => null), // signed-out (anonymous) workspace
  getStoredUser: jest.fn(async () => null),
}));
jest.mock("@/hooks/useColors", () => ({ useColors: () => new Proxy({}, { get: () => "#000" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/contexts/SyncContext", () => {
  const sync = { reportSyncStart: jest.fn(), reportSyncSuccess: jest.fn(), reportSyncFailure: jest.fn() };
  return { useSyncStatus: () => sync };
});
jest.mock("@/contexts/PreferencesContext", () => {
  const prefs = {
    starterTutorialMode: false,
    setStarterTutorialMode: jest.fn(),
    tutorialDay: 1,
    setTutorialDay: jest.fn(),
    baselineVolume: 0,
    setBaselineVolume: jest.fn(),
    tutorialMetadata: {},
    setTutorialMetadata: jest.fn(),
  };
  return { usePreferences: () => prefs };
});
jest.mock("@/components/AuthModal", () => () => null);
jest.mock("@/components/feed/FeedActiveSessionView", () => (props: any) => {
  mockViewProps = props;
  return null;
});
jest.mock("@/components/feed/FeedSetupView", () => (props: any) => {
  mockSetupProps = props;
  return null;
});

const feedApi = api.history.feed as unknown as Record<string, jest.Mock>;

const makeSession = (id: string) => ({
  id,
  starterWeight: "50",
  flourWeight: 50,
  waterWeight: 50,
  wwPercent: 0,
  initialPH: "",
  initialTemp: "",
  initialTempUnit: "F",
  initialVolume: "100",
  fedPhoto: null,
  ratioStr: "1:1:1",
  savedAt: 1000,
  updatedAt: 1000,
  readings: [],
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const seedActive = (id: string) => {
  mockStore[STORAGE_KEY] = JSON.stringify(makeSession(id));
};

const mountWithSession = async (id: string) => {
  const utils = render(<ActiveFeedSection />);
  await waitFor(() => expect(mockViewProps?.session?.id).toBe(id));
  return utils;
};

/** Presses "Abandon Feed", then confirms "Discard". Resolves when the whole operation finishes. */
const abandon = async (): Promise<void> => {
  (Alert.alert as jest.Mock).mockClear();
  act(() => {
    mockViewProps.onClearSession();
  });
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === "Abandon Feed?");
  const discard = call![2].find((b: any) => b.text === "Discard");
  await act(async () => {
    await discard.onPress();
  });
};

/** Opens the dialog and returns the confirm action without pressing it yet. */
const openAbandonDialog = () => {
  (Alert.alert as jest.Mock).mockClear();
  act(() => {
    mockViewProps.onClearSession();
  });
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === "Abandon Feed?");
  return call![2].find((b: any) => b.text === "Discard").onPress as () => Promise<void>;
};

describe("ActiveFeedSection — Abandon Feed durable deletion contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = { [DECLINED_KEY]: "true" };
    mockEvents = [];
    mockFailSetKey = null;
    mockFailRemoveKey = null;
    mockSetGate = null;
    mockViewProps = null;
    mockSetupProps = null;
    spies = [
      jest.spyOn(Alert, "alert").mockImplementation(() => {}),
      jest.spyOn(console, "warn").mockImplementation(() => {}),
      jest.spyOn(console, "log").mockImplementation(() => {}),
      jest.spyOn(console, "error").mockImplementation(() => {}),
    ];
    feedApi.get.mockResolvedValue(null);
    feedApi.upsert.mockResolvedValue(undefined);
    feedApi.active.mockResolvedValue(null);
    feedApi.delete.mockImplementation(async () => {
      mockEvents.push("api:delete");
      return true;
    });
    feedApi.verifyAbsent.mockResolvedValue(false);
  });

  afterEach(async () => {
    cleanup(); // unmount before anything else is torn down
    await new Promise((r) => setTimeout(r, 0)); // let pending continuations settle
    // Restore only our spies; restoreAllMocks would also wipe the module mocks' implementations.
    spies.forEach((s) => s.mockRestore());
  });

  it("1. writes the tombstone before clearing the local session, then deletes remotely via the processor", async () => {
    seedActive("feed-A");
    await mountWithSession("feed-A");

    await abandon();

    expect(mockEvents).toEqual(["tombstone:set", "session:removed", "api:delete"]);
    expect(feedApi.delete).toHaveBeenCalledWith("feed-A", "device-1", undefined);
    expect(mockStore[STORAGE_KEY]).toBeUndefined();
    expect(await getFeedTombstone()).toEqual([]); // acknowledged deletion clears the tombstone
    await waitFor(() => expect(mockViewProps).toBeTruthy());
  });

  it("2. a tombstone write failure keeps the session and makes no remote delete attempt", async () => {
    seedActive("feed-A");
    await mountWithSession("feed-A");
    mockFailSetKey = (key) => key.includes("deleted_feed");

    await abandon();

    expect(mockStore[STORAGE_KEY]).toBeDefined();
    expect(JSON.parse(mockStore[STORAGE_KEY]).id).toBe("feed-A");
    expect(mockViewProps.session.id).toBe("feed-A");
    expect(feedApi.delete).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Couldn't abandon this feed", expect.any(String));
  });

  it("3. a failed remote delete leaves the tombstone for a later retry", async () => {
    seedActive("feed-A");
    await mountWithSession("feed-A");
    feedApi.delete.mockRejectedValue(new Error("offline"));

    await abandon();

    expect(mockStore[STORAGE_KEY]).toBeUndefined();
    expect(await getFeedTombstone()).toEqual(["feed-A"]);

    // Later the cloud is reachable again: the ordinary processor finishes the job.
    feedApi.delete.mockResolvedValue(true);
    const { processPendingDeletions } = require("@/lib/recipeStorage");
    await processPendingDeletions();
    expect(await getFeedTombstone()).toEqual([]);
  });

  it("4. a failed local clear keeps the tombstone and the session does not come back as live", async () => {
    seedActive("feed-A");
    const first = await mountWithSession("feed-A");
    mockFailRemoveKey = (key) => key === STORAGE_KEY;
    feedApi.delete.mockRejectedValue(new Error("offline"));

    await abandon();

    expect(await getFeedTombstone()).toEqual(["feed-A"]);
    expect(mockStore[STORAGE_KEY]).toBeDefined(); // local clear really failed
    expect(Alert.alert).not.toHaveBeenCalledWith(expect.stringMatching(/couldn't|error/i), expect.anything());

    // Baker reopens the screen. Storage can be written again; the cloud is still unreachable.
    mockFailRemoveKey = null;
    mockViewProps = null;
    mockSetupProps = null; // so we wait for the NEW mount, not the first one
    feedApi.upsert.mockClear();
    first.rerender(<ActiveFeedSection key="reopened" />); // remount in the same root

    await waitFor(() => expect(mockStore[STORAGE_KEY]).toBeUndefined()); // the retry cleared it
    await waitFor(() => expect(mockSetupProps).toBeTruthy()); // setup view, not the active session
    expect(mockViewProps).toBeNull();
    expect(feedApi.upsert).not.toHaveBeenCalled();
    expect(await getFeedTombstone()).toEqual(["feed-A"]);
  });

  it("5. an in-flight sync cannot land after the remote delete (no resurrection)", async () => {
    seedActive("feed-A");
    const upsert = deferred<void>();
    feedApi.upsert.mockImplementation(() => {
      mockEvents.push("upsert:start");
      return upsert.promise.then(() => {
        mockEvents.push("upsert:end");
      });
    });
    await mountWithSession("feed-A"); // init() kicks off a sync
    await waitFor(() => expect(feedApi.upsert).toHaveBeenCalledTimes(1));

    const discard = openAbandonDialog();
    let finished = false;
    const op = act(async () => {
      await discard();
      finished = true;
    });

    await waitFor(() => expect(mockEvents).toContain("session:removed"));
    expect(feedApi.delete).not.toHaveBeenCalled(); // waiting for the in-flight upsert
    expect(finished).toBe(false);

    upsert.resolve();
    await op;

    expect(mockEvents.indexOf("upsert:end")).toBeLessThan(mockEvents.indexOf("api:delete"));
    expect(feedApi.delete).toHaveBeenCalledTimes(1);
  });

  it("6. a cloud copy that is still pending deletion is not rehydrated as the live session", async () => {
    seedActive("feed-A");
    const first = await mountWithSession("feed-A");
    feedApi.delete.mockRejectedValue(new Error("offline"));
    await abandon();

    // Cloud delete never completed, so the cloud still reports it as the active session.
    feedApi.active.mockResolvedValue({ id: "feed-A", data: makeSession("feed-A") });
    mockViewProps = null;
    mockSetupProps = null; // so we wait for the NEW mount, not the first one
    feedApi.upsert.mockClear();
    feedApi.active.mockClear();
    first.rerender(<ActiveFeedSection key="reopened" />); // remount in the same root

    await waitFor(() => expect(feedApi.active).toHaveBeenCalled()); // hydration was attempted...
    await new Promise((r) => setTimeout(r, 25)); // ...let init() finish acting on the answer
    await waitFor(() => expect(mockSetupProps).toBeTruthy());
    expect(mockViewProps).toBeNull(); // ...but the abandoned session was not adopted
    expect(mockStore[STORAGE_KEY]).toBeUndefined();
    expect(feedApi.upsert).not.toHaveBeenCalled();
  });

  it("7. a stale Discard (session ended or replaced while the dialog was open) deletes nothing and leaves the new session alone", async () => {
    seedActive("feed-A");
    await mountWithSession("feed-A");
    const staleDiscard = openAbandonDialog(); // dialog bound to feed-A

    // While the dialog is open, feed-A ends and the baker starts feed-B.
    await act(async () => {
      await mockViewProps.onProgressDay();
    });
    await waitFor(() => expect(mockSetupProps).toBeTruthy());
    await act(async () => {
      await mockSetupProps.onStartFeed({ starterWeight: "50", flourWeight: 50, waterWeight: 50, initialVolume: "100" });
    });
    await waitFor(() => expect(mockViewProps?.session?.id).toBeTruthy());
    const newId = mockViewProps.session.id;
    expect(newId).not.toBe("feed-A");
    feedApi.delete.mockClear();

    await act(async () => {
      await staleDiscard();
    });

    expect(feedApi.delete).not.toHaveBeenCalled();
    expect(await getFeedTombstone()).toEqual([]);
    expect(JSON.parse(mockStore[STORAGE_KEY]).id).toBe(newId);
    expect(mockViewProps.session.id).toBe(newId);
  });

  it("8. a workspace change while the tombstone is being written does not clear or delete anything", async () => {
    seedActive("feed-A");
    await mountWithSession("feed-A");
    const gate = deferred<void>();
    mockSetGate = { match: (key) => key.includes("deleted_feed"), promise: gate.promise };

    const discard = openAbandonDialog();
    const op = act(async () => {
      await discard();
    });

    advanceWorkspaceGeneration(); // sign-in/out style transition mid-operation
    mockSetGate = null;
    gate.resolve();
    await op;

    expect(feedApi.delete).not.toHaveBeenCalled();
    expect(JSON.parse(mockStore[STORAGE_KEY]).id).toBe("feed-A"); // not cleared
    expect(await getFeedTombstone()).toEqual([]); // stray tombstone taken back out
    expect(mockViewProps.session.id).toBe("feed-A");
  });
});
