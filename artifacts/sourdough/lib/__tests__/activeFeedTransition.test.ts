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
import { executeWorkspaceTransition, setCoordinatorState, getCoordinatorState, ActiveFeedNotAcknowledgedError } from "../transitionCoordinator";
import * as fs from "fs";
import * as path from "path";
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
const ACK = { activeFeedAcknowledged: true };
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

    it("a pending deletion in the DEPARTING workspace blocks the transition and leaves the active Feed untouched", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A", userId: "tokA" });
      await addToFeedTombstone("finished-feed-9"); // pending finished-record deletion for tokA
      const before = mockStore[ACTIVE];

      await expect(executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"), ACK)).rejects.toThrow(/pending deletion work/);

      expect(mockStore[ACTIVE]).toBe(before); // nothing was discarded or moved
      expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
    });

    it("the INCOMING account's own leftover pending deletions do not block entering it", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[getOwnerStorageKey(APP_STORAGE_KEYS.DELETED_FEED_IDS, "tokB")] = JSON.stringify(["old-pending"]);

      await expect(executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"), ACK)).resolves.toBeUndefined();
      expect(getCoordinatorState()).toBe("IDLE");
    });
  });

  describe("discard at the transition", () => {
    it("proceeding discards the departing workspace's active Feed and completes the transition", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A", readings: [] });

      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"), ACK);

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

      await executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"), ACK);

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

  describe("warn-first is enforced by the transition itself", () => {
    it("refuses to discard an active Feed the baker has not been warned about, and changes nothing", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A", userId: "tokA" });
      const before = { ...mockStore };

      await expect(executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"))).rejects.toBeInstanceOf(ActiveFeedNotAcknowledgedError);

      expect(mockStore).toEqual(before);
      expect(getCoordinatorState()).toBe("IDLE");
    });

    it("needs no acknowledgement when there is nothing to lose", async () => {
      await saveAuth("tokA", userOf("tokA"));
      await expect(executeWorkspaceTransition("tokA", "tokB", "tokB", userOf("tokB"))).resolves.toBeUndefined();
    });

    it("sign-out: clears credentials, discards the active Feed, sets finished data aside, and restores nothing", async () => {
      await saveAuth("tokA", userOf("tokA"));
      mockStore[ACTIVE] = JSON.stringify({ id: "feed-A", userId: "tokA" });
      mockStore[APP_STORAGE_KEYS.FEED_HISTORY] = JSON.stringify([{ id: "a-finished", userId: "tokA" }]);

      await executeWorkspaceTransition("tokA", null, null, null, ACK);

      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      expect(mockStore[ACTIVE]).toBeUndefined();
      expect(mockStore[APP_STORAGE_KEYS.FEED_HISTORY]).toBeUndefined();
      expect(JSON.parse(mockStore[QUARANTINE_KEY("tokA")]).feedHistory.map((h: any) => h.id)).toEqual(["a-finished"]);
    });

    // Source-level guarantees: the choke point cannot be bypassed by a call site added later.
    const sourceRoot = path.resolve(__dirname, "..", "..");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) return [];
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(e.name) && !/\.local\.test\./.test(e.name) ? [full] : [];
      });

    it("no production code outside the transition modules changes the workspace directly", () => {
      const allowed = new Set(["lib/storageUtils.ts", "lib/auth.ts", "lib/udl.ts", "lib/transitionCoordinator.ts"]);
      const direct = /\b(quarantineOperationalData|restoreOperationalData|saveAuth|clearAuth)\s*\(|UDL\.(quarantineData|restoreData)\s*\(/;
      const offenders = ["app", "components", "lib", "hooks", "contexts"]
        .map((d) => path.join(sourceRoot, d))
        .filter((d) => fs.existsSync(d))
        .flatMap(walk)
        .filter((f) => !allowed.has(path.relative(sourceRoot, f).split(path.sep).join("/")))
        .filter((f) => direct.test(fs.readFileSync(f, "utf8")))
        .map((f) => path.relative(sourceRoot, f));
      expect(offenders).toEqual([]);
    });

    it("every sign-in, sign-out and account-switch path in AuthModal passes the acknowledgement, and warns first where it applies", () => {
      const src = fs.readFileSync(path.join(sourceRoot, "components", "AuthModal.tsx"), "utf8");
      const calls = (src.match(/executeWorkspaceTransition\(/g) || []).length;
      const acks = (src.match(/activeFeedAcknowledged:/g) || []).length;
      expect(calls).toBeGreaterThanOrEqual(3); // import, proceed-without-import, sign-out
      expect(acks).toBe(calls);

      const body = (from: string, to: string) => {
        const start = src.indexOf(from);
        const end = src.indexOf(to, start + 1);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        return src.slice(start, end);
      };

      // Sign-out (Authenticated -> NLA): the active-Feed warning is asked before the transition.
      expect(body("const handleClearIdentity = async", "const isFind = mode")).toMatch(/ensureActiveFeedAck\(\)/);

      // NLA -> account: the baker sees the local-work panel, then chooses; both choices carry an explicit NLA disposition.
      expect(body("const handleChoiceImport = async", "const handleChoiceProceedWithoutImport = async")).toMatch(/nlaDisposition:\s*\{ mode: "import"/);
      expect(body("const handleChoiceProceedWithoutImport = async", "const handleChoiceCancel = async")).toMatch(/nlaDisposition:\s*\{ mode: "discard"/);
      expect(src).toMatch(/NLA_LOCAL_WORK_TITLE/);
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
