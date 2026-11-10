import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  APP_STORAGE_KEYS,
  getOwnerStorageKey,
  validateOperationalData,
  quarantineOperationalData,
  restoreOperationalData,
  UNKNOWN_QUARANTINE_KEY,
  QUARANTINE_KEY,
} from "../storageUtils";
import { saveAuth } from "../auth";
import { addToFeedTombstone } from "../recipeStorage";
import { executeWorkspaceTransition, setCoordinatorState, getCoordinatorState } from "../transitionCoordinator";
import {
  hasActiveFeed,
  confirmDiscardActiveFeed,
  confirmActiveFeedTransition,
  ACTIVE_FEED_TRANSITION_TITLE,
  ACTIVE_FEED_TRANSITION_MESSAGE,
} from "../activeWork";

// Omicron_CLI-2: Active Feed work is device-local. At a workspace transition it is warned about,
// then discarded. It never blocks the transition and is never carried to the destination workspace.
// Pending deletion work for FINISHED records still blocks a transition.

let mockStore: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));
jest.mock("../api", () => ({ api: { auth: { signout: jest.fn() } } }));

const ACTIVE = APP_STORAGE_KEYS.ACTIVE_FEED;
const userOf = (t: string) => ({ id: t, firstName: t, starterName: "Starter" });
const anyKeyContains = (needle: string) => Object.values(mockStore).some((v) => v.includes(needle));

describe("Active Feed at a workspace transition", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockStore = {};
    setCoordinatorState("IDLE");
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe("the transition gate", () => {
    it("an unstamped active Feed (as the Feed screen creates it) does not block the transition gate", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1", readings: [] }); // no userId
      await expect(validateOperationalData(null, { discardActiveFeed: true })).resolves.toBeUndefined();
    });

    it("a corrupt active Feed does not block the transition gate either", async () => {
      mockStore[ACTIVE] = "{not-json";
      await expect(validateOperationalData(null, { discardActiveFeed: true })).resolves.toBeUndefined();
    });

    it("a stamped active Feed passes even the strict purge gate, for both NLA and an account", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1", userId: "anonymous" });
      await expect(validateOperationalData(null)).resolves.toBeUndefined();
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-2", userId: "tokA" });
      await expect(validateOperationalData("tokA")).resolves.toBeUndefined();
    });

    it("the strict purge path (without the flag) is unchanged", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1" });
      await expect(validateOperationalData(null)).rejects.toThrow(/active feed record has unknown or missing ownership/);
    });

    it("pending deletion work for FINISHED records still blocks the transition, active Feed or not", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1" });
      await addToFeedTombstone("finished-feed-9"); // signed out => anonymous owner
      await expect(validateOperationalData(null, { discardActiveFeed: true })).rejects.toThrow(/pending deletion work/);
    });

    it("a blocked transition leaves the active Feed untouched (nothing is discarded until it proceeds)", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A" });
      // The coordinator's readiness check inspects the INCOMING account's pending deletions.
      mockStore[getOwnerStorageKey(APP_STORAGE_KEYS.DELETED_FEED_IDS, "tokB")] = JSON.stringify(["finished-feed-9"]);
      const before = mockStore[ACTIVE];

      await expect(executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"))).rejects.toThrow(/pending deletion work/);

      expect(mockStore[ACTIVE]).toBe(before);
      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
    });
  });

  describe("discard at the transition", () => {
    it("proceeding discards the departing workspace's active Feed and completes the transition", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A", readings: [] });

      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));

      expect(getCoordinatorState()).toBe("IDLE");
      expect(mockStore[ACTIVE]).toBeUndefined();
      expect(anyKeyContains("feed-A")).toBe(false); // not parked in any quarantine bucket
      expect(mockStore[UNKNOWN_QUARANTINE_KEY]).toBeUndefined();
      expect(mockStore[QUARANTINE_KEY("tokA")]).toBeUndefined();
    });

    it("the discard is scoped to the departing workspace: the destination's other data is restored untouched", async () => {
      // B previously quarantined finished data (and, under an older version, an active Feed).
      mockStore[QUARANTINE_KEY("tokB")] = JSON.stringify({
        feedHistory: [{ id: "b-finished", userId: "tokB" }],
        activeFeed: { id: "b-legacy-active", userId: "tokB" },
      });
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A" });
      mockStore[APP_STORAGE_KEYS.FEED_HISTORY] = JSON.stringify([{ id: "a-finished", userId: "tokA" }]);

      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"));

      const history = JSON.parse(mockStore[APP_STORAGE_KEYS.FEED_HISTORY]);
      expect(history.map((h: any) => h.id)).toEqual(["b-finished"]); // B's finished data is back, A's is not
      expect(mockStore[ACTIVE]).toBeUndefined(); // nothing active is restored from any bucket
      expect(anyKeyContains("feed-A")).toBe(false);
      expect(JSON.parse(mockStore[QUARANTINE_KEY("tokA")]).feedHistory.map((h: any) => h.id)).toEqual(["a-finished"]);
    });

    it("an active Feed is never restored into the destination, even from an older quarantine bucket", async () => {
      mockStore[QUARANTINE_KEY("tokB")] = JSON.stringify({ activeFeed: { id: "old-active", userId: "tokB" } });
      await restoreOperationalData("tokB");
      expect(mockStore[ACTIVE]).toBeUndefined();
    });

    it("a signed-out (NLA) baker's active Feed is discarded on sign-in, not parked as 'unknown'", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "nla-feed" });
      await quarantineOperationalData(null);
      expect(mockStore[ACTIVE]).toBeUndefined();
      expect(anyKeyContains("nla-feed")).toBe(false);
    });
  });

  describe("the warning", () => {
    it("detects an active Feed on the device", async () => {
      expect(await hasActiveFeed()).toBe(false);
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1" });
      expect(await hasActiveFeed()).toBe(true);
    });

    it("does not interrupt the baker when there is nothing to lose", async () => {
      await expect(confirmActiveFeedTransition()).resolves.toBe(true);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it("warns, and the baker can continue (the warning never blocks)", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1" });
      alertSpy.mockImplementation((_t: string, _m: string, buttons: any[]) => {
        buttons.find((b) => b.text === "Continue").onPress();
      });

      await expect(confirmActiveFeedTransition()).resolves.toBe(true);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const [title, message] = alertSpy.mock.calls[0];
      expect(title).toBe(ACTIVE_FEED_TRANSITION_TITLE);
      expect(message).toBe(ACTIVE_FEED_TRANSITION_MESSAGE);
      expect(message).toMatch(/finishing it before signing in or out/);
      expect(message).toMatch(/discarded and cannot be recovered/);
    });

    it("lets the baker go back, and treats dismissing the dialog as going back", async () => {
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-1" });

      alertSpy.mockImplementationOnce((_t: string, _m: string, buttons: any[]) => {
        buttons.find((b) => b.text === "Go back").onPress();
      });
      await expect(confirmActiveFeedTransition()).resolves.toBe(false);

      alertSpy.mockImplementationOnce((_t: string, _m: string, _b: any[], options: any) => {
        options.onDismiss();
      });
      await expect(confirmDiscardActiveFeed()).resolves.toBe(false);

      // Going back changes nothing on the device.
      expect(mockStore[ACTIVE]).toBeDefined();
    });
  });
});
