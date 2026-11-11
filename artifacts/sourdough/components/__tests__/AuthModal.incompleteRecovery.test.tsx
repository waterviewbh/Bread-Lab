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

// Issue #24, CLI-6. Two gaps in fail-closed recovery:
//  1. When recovery cannot confirm BOTH the remote sign-out and the local credential removal, the old choices
//     (made about a workspace/session that is no longer certain) must be void: only the cleanup retry remains.
//  2. A Supabase session can survive a failed sign-out AND an app restart (the client persists it on its own).
//     An empty local credential store is not proof that no remote session exists.

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
// Records each Pressable's onPress by function name (handleChoiceImport, ...), so a test can keep the handler the
// baker's old choice was bound to and call it later, which pressing a no-longer-mounted button cannot do.
const mockHandlers: Record<string, () => Promise<void>> = {};
jest.mock("react-native/Libraries/Components/Pressable/Pressable", () => {
  const ReactLib = require("react");
  const actual = jest.requireActual("react-native/Libraries/Components/Pressable/Pressable");
  const Real = actual.default ?? actual;
  const Recording = ReactLib.forwardRef((props: any, ref: any) => {
    if (typeof props.onPress === "function" && props.onPress.name) mockHandlers[props.onPress.name] = props.onPress;
    return ReactLib.createElement(Real, { ...props, ref });
  });
  return { __esModule: true, default: Recording };
});
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
const TOKEN_KEY = "bread_lab_auth_token_v1";
const phases = [{ key: "mix", name: "Mix", ingredients: ["flour"], instructions: ["stir"] }];
const TWO_RECIPES = "This device has 2 recipes, 1 bake in your history, 1 feed in your history that are not in an account.";
const put = (key: string, value: unknown) => { mockStore[key] = JSON.stringify(value); };
const nlaRaw = () => Object.fromEntries(NLA_ALL_KEYS.map((k) => [k, mockStore[k] ?? null]));
const expectNlaPurged = () => {
  for (const key of NLA_ALL_KEYS.filter((k) => /_anonymous$/.test(k))) expect(mockStore[key]).toBeUndefined();
};
const seedRecords = () => {
  put(RECIPES_KEY, [{ id: "r-1", name: "Loaf", userId: "anonymous", phases }]);
  put("bread_lab_bake_history_v1_anonymous", [{ id: "b-1", recipeName: "Rye", savedAt: 1, startedAt: 1, phases: [] }]);
  put("sourdough_feed_history_v1", [{ id: "f-1", userId: "anonymous", savedAt: 5, readings: [] }]);
};
const addLateRecipe = () => put(RECIPES_KEY, [
  { id: "r-1", name: "Loaf", userId: "anonymous", phases },
  { id: "r-late", name: "Added late", userId: "anonymous", phases },
]);

let onClose: jest.Mock;
let onAuthChange: jest.Mock;
let alertSpy: jest.SpyInstance;

const fillAndConnect = async () => {
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Jane"), "Jane");
  await fireEvent.changeText(screen.getByPlaceholderText(/^e.g. Dough/), "Doughy");
  await fireEvent.press(screen.getByText("Connect & Sync"));
};
const identify = async () => {
  await fillAndConnect();
  await screen.findByText("Your offline workspace");
};
const mountModal = () => render(<AuthModal visible currentUser={null} onClose={onClose} onAuthChange={onAuthChange} />);

// What the real Supabase client holds in its own persisted storage, independent of the app's credentials.
let remoteSession: { user: { id: string } } | null = null;

/** Common to every state in which the transition did not finish. */
const expectNothingCompleted = () => {
  expect(onAuthChange).not.toHaveBeenCalledWith(USER);
  expect(onClose).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  expect(mockStore[TOKEN_KEY]).not.toBe(TOKEN);
  expect(getCoordinatorState()).toBe("IDLE");
};

describe("AuthModal: incomplete recovery voids the old choices; surviving remote sessions are not ignored", () => {
  beforeEach(() => {
    mockStore = {};
    remoteSession = null;
    fakeServer.reset();
    setCoordinatorState("IDLE");
    jest.clearAllMocks();
    // clearAllMocks keeps implementations; undo the "cannot remove" failures a previous test installed.
    (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (ks: string[]) => { ks.forEach((k) => delete mockStore[k]); });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (k: string) => { delete mockStore[k]; });
    onClose = jest.fn();
    onAuthChange = jest.fn();
    (api.auth.identify as jest.Mock).mockImplementation(async () => {
      remoteSession = { user: { id: TOKEN } }; // signing in opens a persisted remote session
      return { token: TOKEN, user: USER };
    });
    (api.auth.getSession as jest.Mock).mockImplementation(async () => ({ data: { session: remoteSession }, error: null }));
    (api.auth.signout as jest.Mock).mockImplementation(async () => { remoteSession = null; return { signedOut: true }; });
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

  describe("1. old choices are void while recovery is incomplete", () => {
    // Each way a choice can fail, then a recovery that cannot be confirmed.
    const triggers: Array<{ name: string; button: string; arm: () => void; expectedNla: () => Record<string, string | null> }> = [
      {
        name: "workspace changed (Proceed Without Importing)",
        button: "Proceed Without Importing",
        arm: () => addLateRecipe(),
        expectedNla: () => nlaRaw(),
      },
      {
        name: "import not verified (Import & Proceed)",
        button: "Import & Proceed",
        arm: () => { fakeServer.fetchError = new Error("Network request failed"); },
        expectedNla: () => nlaRaw(),
      },
    ];
    const breakers: Array<{ name: string; message: string; arm: () => void }> = [
      {
        name: "remote sign-out cannot be confirmed",
        message: "Closing your account session could not be confirmed.",
        arm: () => { (api.auth.signout as jest.Mock).mockRejectedValue(new Error("offline")); },
      },
      {
        name: "local credential removal cannot be verified",
        message: "Local sign-in cleanup could not be verified.",
        arm: () => {
          mockStore[TOKEN_KEY] = "stuck"; // a credential on disk that cannot be removed (clearAuth reads it back)
          (AsyncStorage.multiRemove as jest.Mock).mockRejectedValue(new Error("disk"));
          (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error("disk"));
        },
      },
    ];

    for (const t of triggers) {
      for (const b of breakers) {
        it(`${t.name}, then ${b.name}: neither choice can be used, counts are refreshed, only Cancel remains`, async () => {
          seedRecords();
          await mountModal();
          await identify();
          // The handlers the baker's old choices were bound to (the buttons are gone from the screen afterwards).
          const staleImport = mockHandlers["handleChoiceImport"];
          const staleProceed = mockHandlers["handleChoiceProceedWithoutImport"];
          expect(typeof staleImport).toBe("function");
          expect(typeof staleProceed).toBe("function");

          t.arm();
          const expectedNla = t.expectedNla();
          b.arm();
          await fireEvent.press(screen.getByText(t.button));
          await waitFor(() => expect(alertSpy).toHaveBeenCalled());

          const message = alertSpy.mock.calls[0][1] as string;
          expect(message).toContain(b.message);
          expect(message).not.toContain("You are still in your offline workspace"); // not declared safe while uncertain
          expect(nlaRaw()).toEqual(expectedNla);

          // The old choices are gone from the screen...
          expect(screen.queryByText("Import & Proceed")).toBeNull();
          expect(screen.queryByText("Proceed Without Importing")).toBeNull();
          expect(screen.getByText("Cancel Transition")).toBeTruthy();
          // ...and the displayed counts are the current ones, not the ones the baker chose about.
          if (t.name.startsWith("workspace changed")) expect(screen.getByText(TWO_RECIPES)).toBeTruthy();

          // ...and even a stale handle on the old buttons cannot start anything.
          // A handler that ran would go through the failure path again (another alert, another sign-out attempt)
          // or touch the server; none of that may happen.
          const callsBefore = [...fakeServer.calls];
          const alerts = alertSpy.mock.calls.length;
          const signouts = (api.auth.signout as jest.Mock).mock.calls.length;
          const identifyCalls = (api.auth.identify as jest.Mock).mock.calls.length;
          await staleImport();
          await staleProceed();
          await new Promise((r) => setTimeout(r, 0));
          expect(fakeServer.calls).toEqual(callsBefore);
          expect(alertSpy.mock.calls.length).toBe(alerts);
          expect((api.auth.signout as jest.Mock).mock.calls.length).toBe(signouts);
          expect((api.auth.identify as jest.Mock).mock.calls.length).toBe(identifyCalls);
          expect(nlaRaw()).toEqual(expectedNla);
          expectNothingCompleted();
          expect(onAuthChange).not.toHaveBeenCalledWith(null); // identity is not declared clean while uncertain
        });
      }
    }

    it("Cancel that still cannot confirm keeps the choices void; once it confirms, a fresh sign-in, fresh counts and a NEW choice are required", async () => {
      seedRecords();
      await mountModal();
      await identify();
      addLateRecipe();
      const expectedNla = nlaRaw();
      (api.auth.signout as jest.Mock).mockRejectedValue(new Error("offline"));
      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      // Cancel while the network is still down: still locked.
      await fireEvent.press(screen.getByText("Cancel Transition"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
      expect(screen.queryByText("Proceed Without Importing")).toBeNull();
      expect(screen.queryByText("Import & Proceed")).toBeNull();
      expect(nlaRaw()).toEqual(expectedNla);
      expectNothingCompleted();

      // Network back: Cancel confirms the cleanup and returns to the start. No choice survives.
      (api.auth.signout as jest.Mock).mockImplementation(async () => { remoteSession = null; return { signedOut: true }; });
      await fireEvent.press(screen.getByText("Cancel Transition"));
      await screen.findByText("Connect & Sync");
      expect(screen.queryByText("Proceed Without Importing")).toBeNull();
      expect(remoteSession).toBeNull();
      expect(onAuthChange).toHaveBeenCalledWith(null);
      expect(nlaRaw()).toEqual(expectedNla);
      expect(onAuthChange).not.toHaveBeenCalledWith(USER);

      await identify(); // Cancel clears the form, so the baker types their name again
      expect(api.auth.identify).toHaveBeenCalledTimes(2);
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy();
      expect(screen.getByText("Proceed Without Importing")).toBeTruthy(); // available again, but only as a new decision

      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));
      expectNlaPurged();
    });
  });

  describe("2. a remote session that survives sign-out and an app restart", () => {
    it("baseline fact: the fake and the real client keep the remote session when sign-out fails", async () => {
      seedRecords();
      await mountModal();
      await identify();
      (api.auth.signout as jest.Mock).mockRejectedValue(new Error("offline"));
      addLateRecipe();
      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      expect(remoteSession).toEqual({ user: { id: TOKEN } }); // remote session is alive...
      expect(mockStore[TOKEN_KEY]).toBeUndefined();           // ...while the local credential store is empty
    });

    it("on restart the leftover session is closed and confirmed BEFORE anything is decided; the baker then gets the normal choice screen", async () => {
      remoteSession = { user: { id: "acct-previous" } };      // survived the earlier failed sign-out
      seedRecords();
      const expectedNla = nlaRaw();
      await mountModal();
      await fillAndConnect();
      await screen.findByText("Your offline workspace");

      const order = [(api.auth.signout as jest.Mock).mock.invocationCallOrder[0], (api.auth.identify as jest.Mock).mock.invocationCallOrder[0]];
      expect(order[0]).toBeLessThan(order[1]);                // leftover closed first
      expect(fakeServer.calls.filter((c) => c !== "auth.signout")).toEqual([]); // nothing was uploaded to the leftover's account
      expect(nlaRaw()).toEqual(expectedNla);
      expect(screen.getByText("Import & Proceed")).toBeTruthy(); // treated as offline -> account, not account -> account
      expect(screen.getByText("Proceed Without Importing")).toBeTruthy();
      expectNothingCompleted();
    });

    it("on restart, if the leftover session cannot be closed, nothing is decided: no sign-in, no choice screen, NLA data intact", async () => {
      remoteSession = { user: { id: "acct-previous" } };
      seedRecords();
      const expectedNla = nlaRaw();
      (api.auth.signout as jest.Mock).mockRejectedValue(new Error("offline"));
      await mountModal();
      await fillAndConnect();
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      expect(alertSpy.mock.calls[0][1]).toContain("could not be closed");
      expect(api.auth.identify).not.toHaveBeenCalled();         // a second account is never opened on top of an uncertain one
      expect(screen.queryByText("Your offline workspace")).toBeNull();
      expect(screen.getByText("Connect & Sync")).toBeTruthy();
      expect(remoteSession).not.toBeNull();                      // still uncertain, and we say so rather than hide it
      expect(nlaRaw()).toEqual(expectedNla);
      expectNothingCompleted();
      expect(onAuthChange).not.toHaveBeenCalled();
    });

    it("a sign-out that reports success but leaves a session behind is not accepted as closed", async () => {
      remoteSession = { user: { id: "acct-previous" } };
      seedRecords();
      (api.auth.signout as jest.Mock).mockImplementation(async () => ({ signedOut: true })); // lies: session remains
      await mountModal();
      await fillAndConnect();
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      expect(api.auth.identify).not.toHaveBeenCalled();
      expect(screen.queryByText("Your offline workspace")).toBeNull();
      expectNothingCompleted();
    });

    it("if the session cannot even be re-checked after sign-out, it is not assumed closed", async () => {
      remoteSession = { user: { id: "acct-previous" } };
      seedRecords();
      (api.auth.getSession as jest.Mock)
        .mockResolvedValueOnce({ data: { session: remoteSession }, error: null }) // the lookup that finds the leftover
        .mockRejectedValueOnce(new Error("storage unreadable"));                  // the re-check after sign-out
      await mountModal();
      await fillAndConnect();
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      expect(alertSpy.mock.calls[0][1]).toContain("could not be closed");
      expect(api.auth.identify).not.toHaveBeenCalled();
      expect(screen.queryByText("Your offline workspace")).toBeNull();
      expectNothingCompleted();
    });

    it("end to end: failed recovery, app restart, still offline (refused), network back (leftover closed, fresh choice, success)", async () => {
      seedRecords();
      await mountModal();
      await identify();
      addLateRecipe();
      const expectedNla = nlaRaw();
      (api.auth.signout as jest.Mock).mockRejectedValue(new Error("offline"));
      await fireEvent.press(screen.getByText("Proceed Without Importing"));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(remoteSession).not.toBeNull();

      // App killed. Only storage (local credentials: none; remote session: alive) survives.
      cleanup();
      await new Promise((r) => setTimeout(r, 0));
      alertSpy.mockClear();
      onAuthChange.mockClear();
      (api.auth.identify as jest.Mock).mockClear();

      await mountModal();
      expect(screen.queryByText("Proceed Without Importing")).toBeNull(); // no stale choice after a restart
      await fillAndConnect();
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());           // still offline: refused
      expect(api.auth.identify).not.toHaveBeenCalled();
      expect(nlaRaw()).toEqual(expectedNla);
      expect(onAuthChange).not.toHaveBeenCalled();

      (api.auth.signout as jest.Mock).mockImplementation(async () => { remoteSession = null; return { signedOut: true }; });
      await fireEvent.press(screen.getByText("Connect & Sync"));          // network back
      await screen.findByText("Your offline workspace");
      expect(screen.getByText(TWO_RECIPES)).toBeTruthy();                 // fresh inventory
      await fireEvent.press(screen.getByText("Proceed Without Importing")); // new explicit decision
      await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(USER));
      expectNlaPurged();
    });
  });
});
