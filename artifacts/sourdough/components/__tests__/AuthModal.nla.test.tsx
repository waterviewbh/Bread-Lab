import React from "react";
import { Alert } from "react-native";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react-native";
import AuthModal from "../AuthModal";
import { api } from "@/lib/api";
import { fakeServer } from "@/lib/testSupport/fakeApi";
import { NLA_ALL_KEYS } from "@/lib/nlaWorkspace";
import { setCoordinatorState } from "@/lib/transitionCoordinator";
import { NLA_LOCAL_WORK_TITLE, NLA_LOCAL_WORK_PARAGRAPHS } from "@/lib/activeWork";

// The real sign-in screen, driven the way a baker would: type a name and starter, tap "Connect & Sync".
// Coming from the offline (NLA) workspace the baker is ALWAYS offered the three choices, shown a neutral count,
// and (only when active Feed/Bake work exists) the agreed "Local work on this device" panel.

let mockStore: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); }),
  getAllKeys: jest.fn(async () => Object.keys(mockStore)),
  multiGet: jest.fn(async (ks: string[]) => ks.map((k) => [k, k in mockStore ? mockStore[k] : null])),
  multiRemove: jest.fn(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); }),
  clear: jest.fn(async () => { mockStore = {}; }),
}));
jest.mock("@/lib/api", () => require("@/lib/testSupport/fakeApi").makeApiModule());
jest.mock("@/lib/deviceId", () => ({ getDeviceId: jest.fn(async () => "device-1") }));
jest.mock("@/hooks/useColors", () => ({ useColors: () => new Proxy({}, { get: () => "#000" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" }, NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/contexts/MigrationToastContext", () => ({
  useMigrationToast: () => ({ isMigrationActive: false, startMigration: jest.fn(), finishMigration: jest.fn() }),
}));

const TOKEN = "acct-1";
const USER = { id: TOKEN, firstName: "Jane", starterName: "Doughy" };
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const phases = [{ key: "mix", name: "Mix", ingredients: ["flour"], instructions: ["stir"] }];
const nlaRaw = () => Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));

const seedRecords = () => {
  put("bread_lab_recipes_v1", [{ id: "r-legacy", name: "Legacy", phases }]);                                        // fixed-name, unstamped
  put("bread_lab_recipes_v1_anonymous", [{ id: "r-1", name: "Loaf", userId: "anonymous", phases }]);                // owner-named
  put("bread_lab_bake_history_v1_anonymous", [{ id: "b-1", recipeName: "Rye", savedAt: 1, startedAt: 1, phases: [] }]);
  put("sourdough_feed_history_v1", [{ id: "f-1", userId: "anonymous", savedAt: 5, readings: [] }]);
  put("bread_lab_candidates_v1_anonymous", [{ id: "c-1", sharedAt: "2026-02-02T00:00:00.000Z", extractionResult: { s: 1 } }]);
};

let onClose: jest.Mock;
let onAuthChange: jest.Mock;
let alertSpy: jest.SpyInstance;

const openChoiceScreen = async () => {
  await render(<AuthModal visible currentUser={null} onClose={onClose} onAuthChange={onAuthChange} />);
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Jane"), "Jane");
  await fireEvent.changeText(screen.getByPlaceholderText(/^e.g. Dough/), "Doughy");
  await fireEvent.press(screen.getByText("Connect & Sync"));
  try {
    await screen.findByText("Your offline workspace");
  } catch (e) {
    // Surface any message the app tried to show (the Alert spy would otherwise swallow it).
    throw new Error(`Choice screen did not appear. Alerts shown: ${JSON.stringify(alertSpy.mock.calls)}`);
  }
};

const allText = () => JSON.stringify(screen.toJSON());

describe("AuthModal: NLA -> account choice screen", () => {
  beforeEach(() => {
    mockStore = {};
    fakeServer.reset();
    setCoordinatorState("IDLE");
    jest.clearAllMocks();
    onClose = jest.fn();
    onAuthChange = jest.fn();
    (api.auth.identify as jest.Mock).mockResolvedValue({ token: TOKEN, user: USER });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    jest.restoreAllMocks();
  });

  describe("always offered", () => {
    it("offers all three choices even when NOTHING was detected on the device", async () => {
      await openChoiceScreen();
      expect(screen.getByText("No offline records were found on this device.")).toBeTruthy();
      expect(screen.getByText("Import & Proceed")).toBeTruthy();
      expect(screen.getByText("Proceed Without Importing")).toBeTruthy();
      expect(screen.getByText("Cancel Transition")).toBeTruthy();
      expect(screen.queryByText(NLA_LOCAL_WORK_TITLE)).toBeNull();
    });

    it("detects records in BOTH storage cabinets, unstamped ones included, and counts them neutrally", async () => {
      seedRecords();
      await openChoiceScreen();
      expect(
        screen.getByText("This device has 2 recipes, 1 bake in your history, 1 feed in your history, 1 recipe draft that are not in an account.")
      ).toBeTruthy();
      expect(allText()).not.toMatch(/anonymous|lost|permanent|warning/i);
    });

    it("does not show the local-work panel when there is no active work", async () => {
      seedRecords();
      await openChoiceScreen();
      expect(screen.queryByText(NLA_LOCAL_WORK_TITLE)).toBeNull();
    });
  });

  describe("the 'Local work on this device' panel (agreed wording, NLA -> account only)", () => {
    const expectPanel = () => {
      expect(screen.getByText(NLA_LOCAL_WORK_TITLE)).toBeTruthy();
      expect(NLA_LOCAL_WORK_TITLE).toBe("Local work on this device");
      expect([...NLA_LOCAL_WORK_PARAGRAPHS]).toEqual([
        "You have active Feed or Bake work on this device.",
        "This work is not included in your account and will be discarded when you leave the offline workspace.",
        "Your saved recipes, bake history, feed history, and other eligible records will be handled according to your choice below.",
      ]);
      for (const paragraph of NLA_LOCAL_WORK_PARAGRAPHS) expect(screen.getByText(paragraph)).toBeTruthy();
    };

    it("appears for an active BAKE (stored in the owner-named cabinet)", async () => {
      put("bread_lab_bake_v2_anonymous", [{ id: "ab", recipeName: "Active", userId: "anonymous", phases: [] }]);
      await openChoiceScreen();
      expectPanel();
    });

    it("appears for an active FEED", async () => {
      put("sourdough_feed_session_v1", { id: "af", userId: "anonymous", savedAt: 1 });
      await openChoiceScreen();
      expectPanel();
    });
  });

  describe("Proceed Without Importing", () => {
    it("cleans the offline workspace, signs in, and makes no Supabase data call at all", async () => {
      seedRecords();
      put("bread_lab_bake_v2_anonymous", [{ id: "ab", userId: "anonymous", phases: [] }]);
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));

      expect(onClose).toHaveBeenCalled();
      for (const key of NLA_ALL_KEYS.filter((k) => /_anonymous$/.test(k))) expect(mockStore[key]).toBeUndefined();
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
      expect(fakeServer.calls).toEqual([]);
    });
  });

  describe("Import & Proceed", () => {
    it("uploads, confirms, cleans up, and signs in", async () => {
      seedRecords();
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Import & Proceed"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));

      expect(fakeServer.tables.recipe.size).toBe(2);
      expect(fakeServer.tables.bake.size).toBe(1);
      expect(fakeServer.tables.feed.size).toBe(1);
      for (const key of NLA_ALL_KEYS.filter((k) => /_anonymous$/.test(k))) expect(mockStore[key]).toBeUndefined();
      expect(onClose).toHaveBeenCalled();
    });

    it("on failure: plain explanation with counts, nothing changed on the device, the account session is closed", async () => {
      seedRecords();
      const before = nlaRaw();
      fakeServer.fetchError = new Error("Network request failed");
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Import & Proceed"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      const [title, message] = alertSpy.mock.calls[0];
      expect(title).toBe("Import didn't complete");
      expect(message).toContain("Nothing on this device was changed. You are still in your offline workspace and can try again.");
      expect(message).toContain("0 of 4 records were confirmed in your account");
      expect(nlaRaw()).toEqual(before);
      expect(api.auth.signout).toHaveBeenCalled();
      expect(onAuthChange).toHaveBeenCalledWith(null);
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      await screen.findByText("Connect & Sync"); // back to the start, ready to try again
    });
  });

  describe("Cancel", () => {
    it("stays in the offline workspace with everything intact", async () => {
      seedRecords();
      const before = nlaRaw();
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Cancel Transition"));
      expect(api.auth.identify).not.toHaveBeenCalled();

      expect(nlaRaw()).toEqual(before);
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);
    });
  });

  describe("safety", () => {
    // The "workspace changed after the choice" cases (both choices, retry, recovery failures) live in
    // AuthModal.workspaceChanged.test.tsx; the old test here asserted the session stayed open, which was the defect.

    it("tells the baker what stayed behind (a conflict is kept and reported, the rest completes)", async () => {
      put("bread_lab_recipes_v1", [{ id: "dup", name: "A" }, { id: "ok", name: "Fine", phases }]);
      put("bread_lab_recipes_v1_anonymous", [{ id: "dup", name: "B", userId: "anonymous", phases }]);
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));

      expect(alertSpy).toHaveBeenCalledWith(
        "Some items stayed on this device",
        expect.stringContaining("1 record has two different copies and will be left on this device")
      );
      expect(mockStore["bread_lab_recipes_v1_anonymous"]).toBeDefined(); // the conflicting copy was not deleted
    });
  });
});
