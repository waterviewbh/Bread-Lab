import React from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react-native";
import AuthModal from "../AuthModal";
import { api } from "@/lib/api";
import { fakeServer } from "@/lib/testSupport/fakeApi";
import { setCoordinatorState } from "@/lib/transitionCoordinator";

// Issue #89: the OUTGOING identity of an account switch comes from the validated stored credentials, never from the
// `currentUser` prop (which starts null and is hydrated asynchronously). No destination account is authenticated while
// the outgoing identity is uncertain, and the remote session can never end up as B while the local sign-in still says A.

let mockStore: Record<string, string> = {};
let mockAuthReadFails = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => {
    if (mockAuthReadFails && k.startsWith("bread_lab_auth_")) throw new Error("Disk read error");
    return k in mockStore ? mockStore[k] : null;
  }),
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

const TOKEN_KEY = "bread_lab_auth_token_v1";
const USER_KEY = "bread_lab_auth_user_v1";
const A = { id: "acct-A", firstName: "Ann", starterName: "Levain" };
const B = { id: "acct-B", firstName: "Bea", starterName: "Rye" };
const storeValid = (u: { id: string; firstName: string; starterName: string }) => {
  mockStore[TOKEN_KEY] = u.id;
  mockStore[USER_KEY] = JSON.stringify(u);
};

let remoteSession: { user: { id: string } } | null = null;
let onClose: jest.Mock;
let onAuthChange: jest.Mock;
let alertSpy: jest.SpyInstance;

const connectAsB = async () => {
  await render(<AuthModal visible currentUser={null} onClose={onClose} onAuthChange={onAuthChange} />);
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Jane"), "Bea");
  await fireEvent.changeText(screen.getByPlaceholderText(/^e.g. Dough/), "Rye");
  await fireEvent.press(screen.getByText("Connect & Sync"));
};
const settle = () => new Promise((r) => setTimeout(r, 50));

/** After any refusal: B was never authenticated and nothing about A changed. */
const expectRefusedBeforeDestination = (storeBefore: Record<string, string>) => {
  expect(api.auth.identify).not.toHaveBeenCalled();         // destination never authenticated
  expect(api.auth.signout).not.toHaveBeenCalled();          // outgoing remote session untouched
  expect(mockStore).toEqual(storeBefore);                   // local credentials and data byte-identical
  expect(onAuthChange).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
};

describe("AuthModal: outgoing identity is resolved from the validated stored credentials", () => {
  beforeEach(() => {
    mockStore = {};
    mockAuthReadFails = false;
    remoteSession = { user: { id: "acct-A" } };
    fakeServer.reset();
    setCoordinatorState("IDLE");
    jest.clearAllMocks();
    onClose = jest.fn();
    onAuthChange = jest.fn();
    (api.auth.getSession as jest.Mock).mockImplementation(async () => ({ data: { session: remoteSession }, error: null }));
    (api.auth.identify as jest.Mock).mockImplementation(async () => { remoteSession = { user: { id: B.id } }; return { token: B.id, user: B }; });
    (api.auth.signout as jest.Mock).mockImplementation(async () => { remoteSession = null; return { signedOut: true }; });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 0)); jest.restoreAllMocks(); });

  it("valid stored A, currentUser === null (not yet hydrated): a normal A -> B switch; the stored identity was validated BEFORE B was authenticated", async () => {
    storeValid(A);
    await connectAsB();
    await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(B));

    const firstCredentialRead = (AsyncStorage.getItem as jest.Mock).mock.invocationCallOrder[
      (AsyncStorage.getItem as jest.Mock).mock.calls.findIndex(([k]) => k === TOKEN_KEY)
    ];
    expect(firstCredentialRead).toBeLessThan((api.auth.identify as jest.Mock).mock.invocationCallOrder[0]);
    expect(api.auth.identify).toHaveBeenCalledTimes(1);
    expect(mockStore[TOKEN_KEY]).toBe(B.id);                   // local and remote agree on B
    expect(JSON.parse(mockStore[USER_KEY])).toEqual(B);
    expect(remoteSession).toEqual({ user: { id: B.id } });
    expect(onClose).toHaveBeenCalled();
  });

  it("why the prop cannot contradict the stored identity: the connect form exists only while currentUser is null", async () => {
    storeValid(A);
    await render(<AuthModal visible currentUser={A} onClose={onClose} onAuthChange={onAuthChange} />);
    expect(screen.queryByPlaceholderText("e.g. Jane")).toBeNull();
    expect(screen.queryByText("Connect & Sync")).toBeNull();
    expect(screen.getByText("Sign Out / Remove Name")).toBeTruthy();
  });

  const invalidStates: Array<{ name: string; arm: () => void }> = [
    { name: "mismatched token and profile", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = JSON.stringify(B); } },
    { name: "token present, profile absent", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; } },
    { name: "profile present, token absent", arm: () => { mockStore[USER_KEY] = JSON.stringify(A); remoteSession = null; } },
    { name: "malformed profile JSON", arm: () => { mockStore[TOKEN_KEY] = "acct-A"; mockStore[USER_KEY] = "not-json"; } },
    { name: "credential storage unreadable", arm: () => { storeValid(A); mockAuthReadFails = true; } },
  ];
  for (const state of invalidStates) {
    it(`invalid stored identity (${state.name}): refused before B is authenticated; no success, nothing changed`, async () => {
      state.arm();
      const before = JSON.parse(JSON.stringify(mockStore));
      await connectAsB();
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      await settle();

      expect(alertSpy.mock.calls[0][0]).toBe("Switch Failed");
      expectRefusedBeforeDestination(before);
    });
  }
});
