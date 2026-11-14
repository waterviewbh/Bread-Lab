import React from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react-native";
import AuthModal from "../AuthModal";
import { api } from "@/lib/api";
import { fakeServer } from "@/lib/testSupport/fakeApi";
import { NLA_ALL_KEYS } from "@/lib/nlaWorkspace";
import { setCoordinatorState, getCoordinatorState } from "@/lib/transitionCoordinator";

// Issue #24, fail-closed recovery: when the offline (NLA) workspace changes AFTER the baker chose
// "Import & Proceed" or "Proceed Without Importing", the transition must end unsuccessfully with the destination
// account signed out, the NLA data untouched, and no way to continue without fresh inventory and a new choice.

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
const RECIPES_KEY = "bread_lab_recipes_v1_anonymous";
const CHANGED_MESSAGE = "Your offline workspace changed while this was in progress, so nothing was changed. Please try again.";
const TWO_RECIPES = "This device has 2 recipes, 1 bake in your history, 1 feed in your history that are not in an account.";
const phases = [{ key: "mix", name: "Mix", ingredients: ["flour"], instructions: ["stir"] }];
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const nlaRaw = () => Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
const allText = () => JSON.stringify(screen.toJSON());
const expectNlaPurged = () => {
  for (const key of NLA_ALL_KEYS.filter((k) => /_anonymous$/.test(k))) expect(mockStore[key]).toBeUndefined();
};

const seedRecords = () => {
  put(RECIPES_KEY, [{ id: "r-1", name: "Loaf", userId: "anonymous", phases }]);
  put("bread_lab_bake_history_v1_anonymous", [{ id: "b-1", recipeName: "Rye", savedAt: 1, startedAt: 1, phases: [] }]);
  put("sourdough_feed_history_v1", [{ id: "f-1", userId: "anonymous", savedAt: 5, readings: [] }]);
};
// A recipe lands in the offline workspace after the counts were shown to the baker.
const addLateRecipe = () => put(RECIPES_KEY, [
  { id: "r-1", name: "Loaf", userId: "anonymous", phases },
  { id: "r-late", name: "Added late", userId: "anonymous", phases },
]);

let onClose: jest.Mock;
let onAuthChange: jest.Mock;
let alertSpy: jest.SpyInstance;

const identify = async () => {
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Jane"), "Jane");
  await fireEvent.changeText(screen.getByPlaceholderText(/^e.g. Dough/), "Doughy");
  await fireEvent.press(screen.getByText("Connect & Sync"));
  await screen.findByText("Your offline workspace");
};
const openChoiceScreen = async () => {
  await render(<AuthModal visible currentUser={null} onClose={onClose} onAuthChange={onAuthChange} />);
  await identify();
};
const reidentify = async () => {
  await fireEvent.press(screen.getByText("Connect & Sync"));
  await screen.findByText("Your offline workspace");
};

/** Everything that must be true after ANY failed transition of this kind. */
const expectFailedClosed = (expectedNla: Record<string, string | null>) => {
  expect(nlaRaw()).toEqual(expectedNla);                                     // original NLA data preserved byte for byte
  expect(api.auth.signout).toHaveBeenCalled();                               // destination session terminated
  expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();              // destination never stored as signed in
  expect(mockStore["bread_lab_auth_user_v1"]).toBeUndefined();
  expect(onAuthChange).toHaveBeenCalledWith(null);                           // app identity stays NLA
  expect(onAuthChange).not.toHaveBeenCalledWith(USER);
  expect(onClose).not.toHaveBeenCalled();                                    // no completion
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();                  // no success signal
  expect(getCoordinatorState()).toBe("IDLE");
  expect(screen.queryByText("Proceed Without Importing")).toBeNull();        // the old decision is void
  expect(screen.queryByText("Import & Proceed")).toBeNull();
};

describe("AuthModal: offline workspace changes after the baker's choice (fail closed)", () => {
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

  describe("Proceed Without Importing", () => {
    it("signs the account out, keeps every NLA record, and does not report success", async () => {
      seedRecords();
      await openChoiceScreen();
      addLateRecipe();
      const expectedNla = nlaRaw();

      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      const [title, message] = alertSpy.mock.calls[0];
      expect(title).toBe("Couldn't continue");
      expect(message).toContain(CHANGED_MESSAGE);
      expect(message).toContain("Your account session was closed.");
      expect(message).toContain("You are still in your offline workspace.");
      expectFailedClosed(expectedNla);
      expect(fakeServer.calls.filter((c) => c !== "auth.signout")).toEqual([]);
      await screen.findByText("Connect & Sync");
    });

    it("a retry needs a fresh sign-in, fresh inventory and a new choice, and then purges what is there NOW", async () => {
      seedRecords();
      await openChoiceScreen();
      addLateRecipe();
      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      await screen.findByText("Connect & Sync");

      // No choice is available until the baker signs in again.
      expect(screen.queryByText("Proceed Without Importing")).toBeNull();
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);

      await reidentify();
      expect(api.auth.identify).toHaveBeenCalledTimes(1); // presenting a new choice does not authenticate the destination
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy(); // fresh inventory includes the late recipe
      expect(onAuthChange).not.toHaveBeenCalledWith(USER); // still nothing decided

      await fireEvent.press(screen.getByText("Proceed Without Importing")); // the new, explicit decision
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));
      expectNlaPurged();
      expect(mockStore["bread_lab_auth_token_v1"]).toBe(TOKEN);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Import & Proceed", () => {
    // The change lands while the upload is running, i.e. after the baker pressed Import & Proceed.
    const changeDuringUpload = (onChanged: () => void) => {
      let done = false;
      fakeServer.failUpsert = () => {
        if (!done) { done = true; addLateRecipe(); onChanged(); }
        return null;
      };
    };

    it("signs the account out, keeps every NLA record, and does not report success", async () => {
      seedRecords();
      let expectedNla: Record<string, string | null> = {};
      changeDuringUpload(() => { expectedNla = nlaRaw(); });
      await openChoiceScreen();

      await fireEvent.press(screen.getByText("Import & Proceed"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      const [title, message] = alertSpy.mock.calls[0];
      expect(title).toBe("Import didn't complete");
      expect(message).toContain(CHANGED_MESSAGE);
      expect(message).toContain("Your account session was closed.");
      expectFailedClosed(expectedNla);
      expect(mockStore[RECIPES_KEY]).toContain("r-late"); // the late record is still there, never purged
      await screen.findByText("Connect & Sync");
    });

    it("a retry needs a fresh sign-in, fresh inventory and a new choice, and then imports everything", async () => {
      seedRecords();
      changeDuringUpload(() => {});
      await openChoiceScreen();
      await fireEvent.press(screen.getByText("Import & Proceed"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      await screen.findByText("Connect & Sync");
      expect(screen.queryByText("Import & Proceed")).toBeNull();

      await reidentify();
      expect(api.auth.identify).toHaveBeenCalledTimes(1); // the destination is authenticated only after a fresh choice
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy();
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);

      await fireEvent.press(screen.getByText("Import & Proceed"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));
      expect(fakeServer.tables.recipe.size).toBe(2); // the late recipe was imported on the retry
      expectNlaPurged();
    });
  });

  describe("interruption or failure during the recovery itself", () => {
    const changeThenPressDiscard = async (armFailure: () => void = () => {}) => {
      seedRecords();
      await openChoiceScreen();
      addLateRecipe();
      const expectedNla = nlaRaw();
      armFailure(); // armed late so sign-in itself does not consume it
      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      return expectedNla;
    };

    it("remote sign-out fails: says so, keeps the NLA data, shows fresh counts, offers no way to finish, and Cancel retries the cleanup", async () => {
      (api.auth.signout as jest.Mock).mockRejectedValueOnce(new Error("offline"));
      const expectedNla = await changeThenPressDiscard();

      expect(alertSpy.mock.calls[0][1]).toContain("Closing your account session could not be confirmed.");
      expect(nlaRaw()).toEqual(expectedNla);
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);
      expect(onAuthChange).not.toHaveBeenCalledWith(null); // identity not declared clean until it is confirmed
      expect(onClose).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
      expect(getCoordinatorState()).toBe("IDLE");
      await screen.findByText(new RegExp(CHANGED_MESSAGE)); // shown together with the recovery status
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy(); // refreshed, so the next choice is about what is really there

      // Cancel runs the cleanup again (sign-out works this time) and returns to the start.
      await fireEvent.press(screen.getByText("Cancel Transition"));
      await screen.findByText("Connect & Sync");
      expect(api.auth.signout).toHaveBeenCalledTimes(2);
      expect(onAuthChange).toHaveBeenCalledWith(null);
      expect(nlaRaw()).toEqual(expectedNla);
    });

    it("local credential cleanup fails: says so, keeps the NLA data, and does not complete", async () => {
      const expectedNla = await changeThenPressDiscard(() => {
        // A credential is on disk and cannot be removed (clearAuth verifies by reading it back).
        mockStore["bread_lab_auth_token_v1"] = "stuck";
        (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error("disk"));
        (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error("disk")).mockRejectedValueOnce(new Error("disk"));
      });

      expect(alertSpy.mock.calls[0][1]).toContain("Local sign-in cleanup could not be verified.");
      expect(nlaRaw()).toEqual(expectedNla);
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);
      expect(onClose).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });

    it("app restart after an incomplete recovery: no stored sign-in, NLA data intact, and the baker must start over", async () => {
      (api.auth.signout as jest.Mock).mockRejectedValueOnce(new Error("offline"));
      const expectedNla = await changeThenPressDiscard();

      // The app is killed here: the in-memory screen is gone, only storage survives.
      cleanup();
      await new Promise((r) => setTimeout(r, 0));
      expect(mockStore["bread_lab_auth_token_v1"]).toBeUndefined();
      expect(nlaRaw()).toEqual(expectedNla);

      onAuthChange.mockClear();
      await render(<AuthModal visible currentUser={null} onClose={onClose} onAuthChange={onAuthChange} />);
      expect(screen.getByText("Connect & Sync")).toBeTruthy();
      expect(allText()).not.toContain("Proceed Without Importing"); // no stale choice survives a restart
      await identify();
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy();

      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));
      expectNlaPurged();
    });
  });
});
