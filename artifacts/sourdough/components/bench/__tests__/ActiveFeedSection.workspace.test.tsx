import React from "react";
import { Alert } from "react-native";
import { render, waitFor, cleanup } from "@testing-library/react-native";
import { ActiveFeedSection } from "../ActiveFeedSection";
import { saveAuth } from "@/lib/auth";
import { executeWorkspaceTransition } from "@/lib/transitionCoordinator";
import { quarantineOperationalData, restoreOperationalData } from "@/lib/storageUtils";
import { getFeedTombstone } from "@/lib/recipeStorage";
import { api } from "@/lib/api";

// Omicron_CLI-2: Active Feed work is device-local. It is never synced, never tombstoned, never
// carried across a workspace transition, and is only ever persisted while it still belongs to the
// workspace it was loaded or created in.
//
// These tests drive the REAL auth, transition coordinator, quarantine/restore, and tombstone code.
// Only storage (in memory), the network API, and presentational pieces are mocked.

const ACTIVE = "sourdough_feed_session_v1";
const HISTORY = "sourdough_feed_history_v1";
const DECLINED = "bread_lab_declined_tutorial_v1";

let mockStore: Record<string, string> = {};
let mockViewProps: any = null;
let mockSetupProps: any = null;
let mockFailRemoveKey: ((key: string) => boolean) | null = null;
let mockDeviceGate: Promise<void> | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => {
    if (mockFailRemoveKey && mockFailRemoveKey(k)) throw new Error(`removeItem failed for ${k}`);
    delete mockStore[k];
  }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));
jest.mock("@/lib/api", () => ({
  api: {
    auth: { signout: jest.fn() },
    recipes: { delete: jest.fn(), verifyAbsent: jest.fn() },
    history: {
      bakes: { delete: jest.fn(), verifyAbsent: jest.fn() },
      feed: { get: jest.fn(), upsert: jest.fn(), active: jest.fn(), list: jest.fn(), delete: jest.fn(), verifyAbsent: jest.fn() },
    },
  },
}));
jest.mock("@/lib/deviceId", () => ({
  getDeviceId: jest.fn(async () => {
    if (mockDeviceGate) await mockDeviceGate;
    return "device-1";
  }),
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
    starterTutorialMode: false, setStarterTutorialMode: jest.fn(), tutorialDay: 1, setTutorialDay: jest.fn(),
    baselineVolume: 0, setBaselineVolume: jest.fn(), tutorialMetadata: {}, setTutorialMetadata: jest.fn(),
  };
  return { usePreferences: () => prefs };
});
jest.mock("@/components/AuthModal", () => () => null);
jest.mock("@/components/feed/FeedActiveSessionView", () => (props: any) => { mockViewProps = props; return null; });
jest.mock("@/components/feed/FeedSetupView", () => (props: any) => { mockSetupProps = props; return null; });

const feedApi = api.history.feed as unknown as Record<string, jest.Mock>;
const userOf = (t: string) => ({ id: t, firstName: t, starterName: "Starter" });
const START = { starterWeight: "50", flourWeight: 50, waterWeight: 50, initialVolume: "100" };
const READING = { id: "r1", timestamp: 2, volume: "120" } as any;
const PEAK = { volume: "200", timestamp: 3 } as any;

const activeId = () => (mockStore[ACTIVE] ? JSON.parse(mockStore[ACTIVE]).id : null);
const storageHas = (needle: string) => Object.values(mockStore).some((v) => v.includes(needle));

/** Mounts the screen in the given workspace (null = NLA / signed out) and starts a Feed there. */
const mountAndStartFeed = async (token: string | null) => {
  if (token) await saveAuth(token, userOf(token));
  await render(<ActiveFeedSection />);
  await waitFor(() => expect(mockSetupProps).toBeTruthy());
  await mockSetupProps.onStartFeed({ ...START });
  await waitFor(() => expect(mockViewProps?.session?.id).toBeTruthy());
  return { id: mockViewProps.session.id as string, view: mockViewProps };
};

const mountEmpty = async (token: string | null) => {
  if (token) await saveAuth(token, userOf(token));
  await render(<ActiveFeedSection />);
  await waitFor(() => expect(mockSetupProps).toBeTruthy());
};

// Two ways the app moves from Account A to Account B. Both run the real implementations.
const transitions: Record<string, (from: string, to: string) => Promise<void>> = {
  "executeWorkspaceTransition": (from, to) => executeWorkspaceTransition(from, to, to, userOf(to)),
  "AuthModal path (quarantine -> restore -> saveAuth)": async (from, to) => {
    await quarantineOperationalData(from);
    await restoreOperationalData(to);
    await saveAuth(to, userOf(to));
  },
};

/** Presses "Abandon Feed" then confirms "Discard". Resolves when the operation finishes. */
const abandon = async (view: any): Promise<void> => {
  (Alert.alert as jest.Mock).mockClear();
  view.onClearSession();
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === "Abandon Feed?");
  await call![2].find((b: any) => b.text === "Discard").onPress();
};

describe("ActiveFeedSection — device-local active Feed and workspace isolation", () => {
  let spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = { [DECLINED]: "true" };
    mockViewProps = null;
    mockSetupProps = null;
    mockFailRemoveKey = null;
    mockDeviceGate = null;
    spies = [
      jest.spyOn(Alert, "alert").mockImplementation(() => {}),
      jest.spyOn(console, "warn").mockImplementation(() => {}),
      jest.spyOn(console, "log").mockImplementation(() => {}),
      jest.spyOn(console, "error").mockImplementation(() => {}),
    ];
    feedApi.get.mockResolvedValue(null);
    feedApi.upsert.mockResolvedValue(undefined);
    feedApi.active.mockResolvedValue(null);
    feedApi.list.mockResolvedValue([]);
    feedApi.delete.mockResolvedValue(true);
    feedApi.verifyAbsent.mockResolvedValue(false);
  });

  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    spies.forEach((s) => s.mockRestore());
  });

  // ───────────────────────── A. Mounted-screen A -> B transition ─────────────────────────
  describe("A. Account A -> Account B while the Feed screen stays mounted", () => {
    Object.entries(transitions).forEach(([label, transition]) => {
      it(`${label}: A's session is never displayed, persisted, or uploaded under B`, async () => {
        const { id: aId, view: staleView } = await mountAndStartFeed("tokA");
        expect(activeId()).toBe(aId);

        await transition("tokA", "tokB");

        // The transition itself discards A's active Feed: it is nowhere in storage (no quarantine bucket).
        expect(mockStore[ACTIVE]).toBeUndefined();
        expect(storageHas(aId)).toBe(false);

        // The mounted screen still holds A's session in memory. A handler rendered for A tries to write.
        await staleView.onLogReading(READING);
        expect(mockStore[ACTIVE]).toBeUndefined();
        expect(storageHas(aId)).toBe(false);
        expect(feedApi.upsert).not.toHaveBeenCalled();

        // The stale session is dropped from view; an empty B workspace shows no Feed.
        await waitFor(() => expect(mockSetupProps).toBeTruthy());
        mockViewProps = null;
        await mockSetupProps.onRefresh();
        expect(mockViewProps).toBeNull();
        expect(storageHas(aId)).toBe(false);
      });

      it(`${label}: a refresh alone resets the screen to B's (empty) workspace`, async () => {
        const { id: aId, view } = await mountAndStartFeed("tokA");
        await transition("tokA", "tokB");

        // The baker returns to the Feed tab / pulls to refresh. Nothing has tried to write yet.
        mockSetupProps = null;
        await view.onRefresh();
        await waitFor(() => expect(mockSetupProps).toBeTruthy()); // reset to B's empty workspace
        expect(storageHas(aId)).toBe(false);
        expect(feedApi.upsert).not.toHaveBeenCalled();
      });
    });

    it("signed-out (NLA) baker's active Feed is discarded on sign-in and never appears for B", async () => {
      const { id: nlaId } = await mountAndStartFeed(null);
      await executeWorkspaceTransition(null as any, "tokB", "tokB", userOf("tokB"));
      expect(mockStore[ACTIVE]).toBeUndefined();
      expect(storageHas(nlaId)).toBe(false); // not parked in the "unknown" bucket either
    });

    it("A's discarded session does not come back when A returns", async () => {
      const { id: aId } = await mountAndStartFeed("tokA");
      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));
      await executeWorkspaceTransition("tokB", "tokA", "tokA", userOf("tokA"));
      expect(mockStore[ACTIVE]).toBeUndefined();
      expect(storageHas(aId)).toBe(false);
    });
  });

  // ───────────────────────── B. Ownership fence ─────────────────────────
  describe("B. Ownership fence", () => {
    it("a stale completion (handler rendered for A) writes nothing into B's history and uploads nothing", async () => {
      const { id: aId, view: staleView } = await mountAndStartFeed("tokA");
      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));

      await staleView.onSavePeak(PEAK);

      expect(mockStore[HISTORY]).toBeUndefined();
      expect(storageHas(aId)).toBe(false);
      expect(feedApi.upsert).not.toHaveBeenCalled();
    });

    it("stale handlers never touch B's own active session (no overwrite of destination data)", async () => {
      const { id: aId, view: staleView } = await mountAndStartFeed("tokA");
      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));

      // B resets the screen and starts a Feed of their own.
      await mockViewProps.onRefresh();
      await waitFor(() => expect(mockSetupProps).toBeTruthy());
      await mockSetupProps.onStartFeed({ ...START });
      await waitFor(() => expect(mockViewProps?.session?.id).toBeTruthy());
      const bId = mockViewProps.session.id;
      expect(bId).not.toBe(aId);
      const before = mockStore[ACTIVE];

      // Every handler rendered for A is now stale.
      await staleView.onLogReading(READING);
      await staleView.onSavePeak(PEAK);
      await abandon(staleView);
      await staleView.onProgressDay();

      expect(mockStore[ACTIVE]).toBe(before); // B's session is byte-for-byte unchanged
      expect(activeId()).toBe(bId);
      expect(mockStore[HISTORY]).toBeUndefined();
      expect(feedApi.upsert).not.toHaveBeenCalled();
    });

    it("a workspace change DURING an asynchronous completion cannot let the stale write through", async () => {
      const { id: aId, view } = await mountAndStartFeed("tokA");

      let release!: () => void;
      mockDeviceGate = new Promise<void>((r) => { release = r; });
      const pending = view.onSavePeak(PEAK); // paused inside getDeviceId()

      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));
      release();
      await pending;

      expect(mockStore[HISTORY]).toBeUndefined();
      expect(storageHas(aId)).toBe(false);
      expect(feedApi.upsert).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────── C. Remote isolation ─────────────────────────
  describe("C. Active Feed never touches the cloud", () => {
    it("create, log, refresh and abandon make no remote active-feed read, upsert or delete", async () => {
      const { view } = await mountAndStartFeed("tokA");
      await view.onLogReading(READING);
      await mockViewProps.onRefresh();
      await abandon(mockViewProps);

      expect(feedApi.active).not.toHaveBeenCalled();
      expect(feedApi.get).not.toHaveBeenCalled();
      expect(feedApi.upsert).not.toHaveBeenCalled();
      expect(feedApi.delete).not.toHaveBeenCalled();
      expect(feedApi.verifyAbsent).not.toHaveBeenCalled();
    });

    it("a legacy remote inProgress:true row is never hydrated as the active session", async () => {
      feedApi.active.mockResolvedValue({ id: "legacy-1", inProgress: true, data: { id: "legacy-1", readings: [] } });
      await mountEmpty("tokA");
      await mockSetupProps.onRefresh(); // run init() to completion

      expect(feedApi.active).not.toHaveBeenCalled();
      expect(mockViewProps).toBeNull();
      expect(mockStore[ACTIVE]).toBeUndefined();
    });

    it("an autoStart Feed survives init() finishing afterwards (a slow reload never clobbers a newer local edit)", async () => {
      await saveAuth("tokA", userOf("tokA"));
      await render(<ActiveFeedSection autoStart incomingStarter="50" incomingFlour="50" incomingWater="50" />);
      await waitFor(() => expect(mockViewProps?.session?.id).toBeTruthy());
      const id = mockViewProps.session.id;
      await mockViewProps.onRefresh();
      expect(mockViewProps.session.id).toBe(id);
      expect(activeId()).toBe(id);
    });
  });

  // ───────────────────────── D. Abandon ─────────────────────────
  describe("D. Abandon = local discard", () => {
    it("clears the session locally with no tombstone and no remote delete", async () => {
      const { id, view } = await mountAndStartFeed("tokA");
      await abandon(view);

      expect(mockStore[ACTIVE]).toBeUndefined();
      await waitFor(() => expect(mockSetupProps).toBeTruthy());
      expect(await getFeedTombstone()).toEqual([]);
      expect(storageHas("deleted_feed")).toBe(false);
      expect(storageHas(id)).toBe(false);
      expect(feedApi.delete).not.toHaveBeenCalled();
    });

    it("a failed local clear is reported honestly: the session stays, and no success is claimed", async () => {
      const { id, view } = await mountAndStartFeed("tokA");
      mockFailRemoveKey = (k) => k === ACTIVE;
      mockSetupProps = null;

      await abandon(view);

      expect(activeId()).toBe(id); // still on the device
      expect(mockSetupProps).toBeNull(); // the screen did not move on as if it had worked
      expect(Alert.alert).toHaveBeenCalledWith("Couldn't abandon this feed", expect.any(String));
      expect(feedApi.delete).not.toHaveBeenCalled();
      expect(await getFeedTombstone()).toEqual([]);
    });
  });

  // ───────────────────────── Owner stamp ─────────────────────────
  describe("Owner stamp: every workspace state has a userId", () => {
    it("a new feed is stamped with the account id when signed in", async () => {
      await mountAndStartFeed("tokA");
      expect(JSON.parse(mockStore[ACTIVE]).userId).toBe("tokA");
      expect(mockViewProps.session.userId).toBe("tokA");
    });

    it("a new feed is stamped 'anonymous' for a signed-out (NLA) baker", async () => {
      await mountAndStartFeed(null);
      expect(JSON.parse(mockStore[ACTIVE]).userId).toBe("anonymous");
      expect(mockViewProps.session.userId).toBe("anonymous");
    });

    it("a stored session stamped for a different workspace is not adopted, and storage is left alone", async () => {
      await saveAuth("tokA", userOf("tokA"));
      const foreign = JSON.stringify({
        id: "foreign-1", userId: "someone-else", starterWeight: "50", ratioStr: "1:1:1", flourWeight: 50,
        waterWeight: 50, wwPercent: 0, initialPH: "", initialVolume: "100", fedPhoto: null, savedAt: 1, readings: [],
      });
      mockStore[ACTIVE] = foreign;

      await render(<ActiveFeedSection />);
      await waitFor(() => expect(mockSetupProps).toBeTruthy());
      await mockSetupProps.onRefresh();

      expect(mockViewProps).toBeNull();          // never shown
      expect(mockStore[ACTIVE]).toBe(foreign);   // never touched
      expect(feedApi.upsert).not.toHaveBeenCalled();
    });

    it("a session saved before stamping existed is adopted and gets stamped on its next change", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({
        id: "legacy-1", starterWeight: "50", ratioStr: "1:1:1", flourWeight: 50, waterWeight: 50, wwPercent: 0,
        initialPH: "", initialVolume: "100", fedPhoto: null, savedAt: 1, readings: [],
      });

      await render(<ActiveFeedSection />);
      await waitFor(() => expect(mockViewProps?.session?.id).toBe("legacy-1"));
      expect(JSON.parse(mockStore[ACTIVE]).userId).toBeUndefined(); // reading alone writes nothing

      await mockViewProps.onLogReading(READING);
      expect(JSON.parse(mockStore[ACTIVE]).userId).toBe("tokA");
    });

    it("the finished record carries the session's stamp", async () => {
      const { view } = await mountAndStartFeed("tokA");
      await view.onSavePeak(PEAK);
      expect(JSON.parse(mockStore[HISTORY])[0].userId).toBe("tokA");
      expect(feedApi.upsert.mock.calls[0][0].data.userId).toBe("tokA");
    });
  });

  // ───────────────────────── E. Completion boundary ─────────────────────────
  describe("E. Completing a Feed produces the one finished (cloud) record", () => {
    it("signed in: uploads exactly one finished record owned by the session's account", async () => {
      const { id, view } = await mountAndStartFeed("tokA");
      await view.onSavePeak(PEAK);

      expect(feedApi.upsert).toHaveBeenCalledTimes(1);
      const body = feedApi.upsert.mock.calls[0][0];
      expect(body).toMatchObject({ id, deviceId: "device-1", userId: "tokA", inProgress: false });
      expect(body.data.peak).toEqual(PEAK);
      const history = JSON.parse(mockStore[HISTORY]);
      expect(history[0]).toMatchObject({ id, userId: "tokA" });
      expect(mockStore[ACTIVE]).toBeUndefined();
    });

    it("signed out (NLA): the finished record is stamped anonymous locally and uploaded without an account", async () => {
      const { id, view } = await mountAndStartFeed(null);
      await view.onSavePeak(PEAK);

      const body = feedApi.upsert.mock.calls[0][0];
      expect(body).toMatchObject({ id, inProgress: false });
      expect(body.userId).toBeUndefined();
      expect(JSON.parse(mockStore[HISTORY])[0]).toMatchObject({ id, userId: "anonymous" });
    });

    it("a legacy in-progress row with the same id is replaced by the finished representation", async () => {
      // Model of the cloud table: upsert rewrites every column of the row with this id.
      const remote: Record<string, any> = {};
      feedApi.upsert.mockImplementation(async (b: any) => { remote[b.id] = { ...b }; });

      const { id, view } = await mountAndStartFeed("tokA");
      remote[id] = { id, inProgress: true, data: { legacy: true }, userId: "tokA", deviceId: "device-1" };

      await view.onSavePeak(PEAK);

      // The payload carries every column that distinguishes the two representations.
      const body = feedApi.upsert.mock.calls[0][0];
      ["id", "deviceId", "userId", "savedAt", "startedAt", "updatedAt", "inProgress", "data"].forEach((k) =>
        expect(body).toHaveProperty(k)
      );
      expect(remote[id].inProgress).toBe(false);
      expect(remote[id].data.legacy).toBeUndefined();
      expect(remote[id].data.peak).toEqual(PEAK);
    });
  });
});
