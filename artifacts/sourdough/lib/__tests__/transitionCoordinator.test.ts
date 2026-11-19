// artifacts/sourdough/lib/__tests__/transitionCoordinator.test.ts
import { executeWorkspaceTransition, getCoordinatorState, setCoordinatorState, recoverTransition } from "../transitionCoordinator";
import { UDL } from "../udl";
import { getWorkspaceGeneration, getOwnerStorageKey, APP_STORAGE_KEYS, QUARANTINE_KEY } from "../storageUtils";
import { getDeviceId } from "../deviceId";
import { migrateLocalDataToAccount } from "../migrate";
import { upsertBakeRemote } from "../recipeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { authorizeNlaTransitionIntent } from "../nlaWorkspace";
import { hasStagedShares } from "../stagedShareBridge";

describe("Workspace Transition Coordinator & UDL Contract", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.mocked(hasStagedShares).mockResolvedValue(false);
    await AsyncStorage.clear();
    setCoordinatorState("IDLE");
  });

  const explicitDiscard = async () => {
    const { inventoryNlaWorkspace, buildPurgePlan, authorizeDiscardPlan } = require("../nlaWorkspace");
    const inventory = await inventoryNlaWorkspace();
    const plan = authorizeDiscardPlan(buildPurgePlan(inventory, "discard"));
    return { nlaDisposition: { mode: "discard" as const, plan, snapshotRaw: inventory.raw } };
  };

  it("parks verified account transit data and restores it to its canonical keys on return", async () => {
    const owner = "user-A";
    const recipeKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, owner);
    const bakeKey = getOwnerStorageKey(APP_STORAGE_KEYS.BAKE_HISTORY, owner);
    const otherKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-B");
    const recipe = [{ id: "recipe-A", userId: owner, name: "Loaf", phases: [] }];
    const bake = [{ id: "bake-A", userId: owner, recipeId: "recipe-A", recipeName: "Loaf", savedAt: 2, startedAt: 1, phases: [] }];
    await AsyncStorage.setItem(recipeKey, JSON.stringify(recipe));
    await AsyncStorage.setItem(bakeKey, JSON.stringify(bake));
    await AsyncStorage.setItem(otherKey, JSON.stringify([{ id: "other", userId: "user-B" }]));
    const other = await AsyncStorage.getItem(otherKey);
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue(null);
    const uploadRecipe = jest.spyOn(api.recipes, "upsert").mockResolvedValue({} as any);
    const uploadBake = jest.spyOn(api.history.bakes, "upsert").mockResolvedValue({} as any);
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockImplementation(async () => {
      expect(await AsyncStorage.getItem(recipeKey)).toBe(JSON.stringify(recipe));
      expect(await AsyncStorage.getItem(bakeKey)).toBe(JSON.stringify(bake));
      return { data: { session: null }, error: null } as any;
    });

    await executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true,
      closeRemoteSession: true,
      beforeTransition: async () => {
        const result = await migrateLocalDataToAccount(owner);
        expect(result.recipes.ok).toBe(1);
        expect(result.bakes.ok).toBe(1);
      },
    });
    expect(uploadRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-A", userId: owner }));
    expect(uploadBake).toHaveBeenCalledWith(expect.objectContaining({ id: "bake-A", userId: owner }));
    expect(await AsyncStorage.getItem(recipeKey)).toBeNull();
    expect(await AsyncStorage.getItem(bakeKey)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY(owner)))!)).toMatchObject({
      scopedRecipes: recipe, scopedBakeHistory: bake,
    });

    await executeWorkspaceTransition(null, owner, owner, { id: owner, firstName: "A", starterName: "S" }, await explicitDiscard());
    expect(await AsyncStorage.getItem(recipeKey)).toBe(JSON.stringify(recipe));
    expect(await AsyncStorage.getItem(bakeKey)).toBe(JSON.stringify(bake));
    expect(await AsyncStorage.getItem(APP_STORAGE_KEYS.RECIPES)).toBeNull();
    expect(await AsyncStorage.getItem(otherKey)).toBe(other);
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY(owner)))!)).not.toHaveProperty("scopedRecipes");
  });

  it("validates ownership correctly rejecting ownerless records", () => {
    const validRec = { id: "1", userId: "user-1", name: "Bread" };
    const invalidRec1 = { id: "2", userId: "", name: "Bad" };
    const invalidRec2 = { id: "3", name: "Missing" };

    expect(UDL.validateOwnership(validRec, "user-1")).toBe(true);
    expect(UDL.validateOwnership(validRec, "user-2")).toBe(false);
    expect(UDL.validateOwnership(invalidRec1, "user-1")).toBe(false);
    expect(UDL.validateOwnership(invalidRec2, "user-1")).toBe(false);
  });

  it("requires an explicit NLA disposition before an identity transition", async () => {
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).rejects.toThrow(/explicit Import or Discard choice is required/);

    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("refuses direct account-to-account entry before state, sync, or storage changes", async () => {
    const beforeTransition = jest.fn(async () => {});
    await AsyncStorage.setItem("bread_lab_auth_token_v1", "user-A");
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: "user-A" }));
    const generationBefore = getWorkspaceGeneration();

    await expect(executeWorkspaceTransition("user-A", "user-B", "user-B",
      { id: "user-B", firstName: "B", starterName: "S" }, { beforeTransition }))
      .rejects.toThrow(/sign out to the offline workspace/);

    expect(beforeTransition).not.toHaveBeenCalled();
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(generationBefore);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBe("user-A");
    expect(await AsyncStorage.getItem("bread_lab_auth_user_v1")).toBe(JSON.stringify({ id: "user-A" }));
  });

  it.each([true, false])("blocks only a linked Candidate and Theory before outgoing sync (linked: %s)", async linked => {
    const owner = "user-A";
    const candidateKey = "bread_lab_candidates_v1_user-A";
    const recipeKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, owner);
    const candidate = JSON.stringify([{ id: "candidate-1", extractionResult: {} }]);
    const recipe = JSON.stringify([{
      id: "theory-1", name: "Test Loaf", userId: owner, phases: [],
      provenance: { sourceCandidateId: linked ? "candidate-1" : "completed-candidate" },
    }]);
    await AsyncStorage.setItem(candidateKey, candidate);
    await AsyncStorage.setItem(recipeKey, recipe);
    const beforeTransition = jest.fn(async () => { throw new Error("Reached outgoing sync"); });

    await expect(executeWorkspaceTransition(owner, null, null, null,
      { activeFeedAcknowledged: true, beforeTransition }))
      .rejects.toThrow(linked ? /Open Candidates and retry promoting “Test Loaf”/ : /Reached outgoing sync/);

    expect(beforeTransition).toHaveBeenCalledTimes(linked ? 0 : 1);
    expect(await AsyncStorage.getItem(candidateKey)).toBe(candidate);
    expect(await AsyncStorage.getItem(recipeKey)).toBe(recipe);
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("refuses a pending native share before identity, sync, or storage changes", async () => {
    const options = await explicitDiscard();
    const beforeTransition = jest.fn(async () => {});
    jest.mocked(hasStagedShares).mockResolvedValue(true);
    const generationBefore = getWorkspaceGeneration();

    await expect(executeWorkspaceTransition("anonymous", "user-A", "user-A",
      { id: "user-A", firstName: "A", starterName: "S" }, { ...options, beforeTransition }))
      .rejects.toThrow(/shared recipe is still pending/);

    expect(beforeTransition).not.toHaveBeenCalled();
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(generationBefore);
  });

  it("refuses a share staged during outgoing sync while remaining retryable", async () => {
    const beforeTransition = jest.fn(async () => {});
    jest.mocked(hasStagedShares).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const generationBefore = getWorkspaceGeneration();

    await expect(executeWorkspaceTransition("user-A", null, null, null,
      { activeFeedAcknowledged: true, beforeTransition }))
      .rejects.toThrow(/shared recipe is still pending/);

    expect(beforeTransition).toHaveBeenCalledTimes(1);
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(generationBefore);
  });

  it("preserves NLA data and credentials when a share arrives during destination preparation", async () => {
    const { inventoryNlaWorkspace, authorizeNlaTransitionIntent, buildPurgePlan, authorizeDiscardPlan } = require("../nlaWorkspace");
    await AsyncStorage.setItem("bread_lab_candidates_v1_anonymous",
      JSON.stringify([{ id: "c-1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: { status: "single_candidate" } }]));
    const sourceBefore = await AsyncStorage.getItem("bread_lab_candidates_v1_anonymous");
    const inventory = await inventoryNlaWorkspace();
    const intent = authorizeNlaTransitionIntent("discard", inventory.raw);
    const plan = authorizeDiscardPlan(buildPurgePlan(inventory, "discard"));
    const prepareIncoming = jest.fn(async () => ({
      ownerId: "user-A", token: "user-A", user: { id: "user-A", firstName: "A", starterName: "S" },
      nlaDisposition: { mode: "discard" as const, plan, snapshotRaw: inventory.raw },
    }));
    jest.mocked(hasStagedShares).mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(executeWorkspaceTransition(null, null, null, null, {
      activeFeedAcknowledged: true, nlaTransitionIntent: intent, prepareIncoming,
    })).rejects.toThrow(/shared recipe is still pending/);

    expect(prepareIncoming).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem("bread_lab_candidates_v1_anonymous")).toBe(sourceBefore);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBeNull();
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");

    // Once the baker ingests the staged share and session recovery succeeds, retry in this process.
    expect(await recoverTransition()).toEqual({ remoteSignout: true, localClear: true });
    jest.mocked(hasStagedShares).mockResolvedValue(false);
    await expect(executeWorkspaceTransition(null, null, null, null, {
      activeFeedAcknowledged: true, nlaTransitionIntent: intent, prepareIncoming,
    })).resolves.toBeUndefined();
    expect(prepareIncoming).toHaveBeenCalledTimes(2);
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("clears the import marker but keeps NLA source when a share arrives after verified preparation", async () => {
    const { inventoryNlaWorkspace, authorizeNlaTransitionIntent, buildPurgePlan, authorizeImportPlan } = require("../nlaWorkspace");
    await AsyncStorage.setItem("bread_lab_candidates_v1_anonymous",
      JSON.stringify([{ id: "c-1", sharedAt: "2026-01-01T00:00:00.000Z", extractionResult: { status: "single_candidate" } }]));
    const sourceBefore = await AsyncStorage.getItem("bread_lab_candidates_v1_anonymous");
    const inventory = await inventoryNlaWorkspace();
    const intent = authorizeNlaTransitionIntent("import", inventory.raw);
    const plan = authorizeImportPlan(buildPurgePlan(inventory, "import", {
      recipes: [], bakeHistory: [], feedHistory: [], candidates: ["c-1"],
    }));
    const prepareIncoming = jest.fn(async () => {
      await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");
      return {
        ownerId: "user-A", token: "user-A", user: { id: "user-A", firstName: "A", starterName: "S" },
        nlaDisposition: { mode: "import" as const, plan, snapshotRaw: inventory.raw },
      };
    });
    jest.mocked(hasStagedShares).mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(executeWorkspaceTransition(null, null, null, null, {
      activeFeedAcknowledged: true, nlaTransitionIntent: intent, prepareIncoming,
    })).rejects.toThrow(/shared recipe is still pending/);

    expect(await AsyncStorage.getItem("bread_lab_migration_pending_v1")).toBeNull();
    expect(await AsyncStorage.getItem("bread_lab_candidates_v1_anonymous")).toBe(sourceBefore);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBeNull();
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("executes successful transition when prerequisites pass", async () => {
    await AsyncStorage.removeItem("bread_lab_migration_pending_v1");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" }, await explicitDiscard())
    ).resolves.toBeUndefined();

    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("blocks transition when the offline workspace changes after preflight inventory", async () => {
    const options = await explicitDiscard();
    await AsyncStorage.setItem("bread_lab_recipes_v1", "not-json");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" }, options)
    ).rejects.toThrow(/offline workspace changed/);

    expect(getCoordinatorState()).toBe("IDLE");
    expect(await AsyncStorage.getItem("bread_lab_recipes_v1")).toBe("not-json");
  });

  it("runs NLA preflight before invoking destination authentication", async () => {
    const { inventoryNlaWorkspace } = require("../nlaWorkspace");
    const inventory = await inventoryNlaWorkspace();
    const intent = authorizeNlaTransitionIntent("discard", inventory.raw);
    const prepareIncoming = jest.fn(async () => {
      throw new Error("destination authentication must not start");
    });
    const genBefore = getWorkspaceGeneration();
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");

    await expect(executeWorkspaceTransition(null, null, null, null, {
      activeFeedAcknowledged: true,
      nlaTransitionIntent: intent,
      prepareIncoming,
    })).rejects.toThrow(/migration pending marker remains present/);

    expect(prepareIncoming).not.toHaveBeenCalled();
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(genBefore);
    expect(await AsyncStorage.getItem("bread_lab_migration_pending_v1")).toBe("1");
  });

  it("does not run outgoing synchronization when mandatory preflight fails", async () => {
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");
    const beforeTransition = jest.fn(async () => {});
    const genBefore = getWorkspaceGeneration();

    await expect(
      executeWorkspaceTransition("user-A", null, null, null, { beforeTransition })
    ).rejects.toThrow(/migration pending marker remains present/);

    expect(beforeTransition).not.toHaveBeenCalled();
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(genBefore);
    expect(await AsyncStorage.getItem("bread_lab_migration_pending_v1")).toBe("1");
  });

  it("leaves existing records and credentials intact when preflight fails", async () => {
    const tokenKey = "bread_lab_auth_token_v1";
    const recipeKey = "bread_lab_recipes_v1";
    const initialToken = "token-existing";
    const initialRecipes = JSON.stringify([{ id: "rec-1", userId: "anonymous", name: "Existing Bread" }]);

    await AsyncStorage.setItem(tokenKey, initialToken);
    await AsyncStorage.setItem(recipeKey, initialRecipes);
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).rejects.toThrow();

    expect(await AsyncStorage.getItem(tokenKey)).toBe(initialToken);
    expect(await AsyncStorage.getItem(recipeKey)).toBe(initialRecipes);
  });

  it("closes and independently verifies the remote session before a sign-out transition returns to IDLE", async () => {
    const tokenKey = "bread_lab_auth_token_v1";
    const userKey = "bread_lab_auth_user_v1";
    await AsyncStorage.setItem(tokenKey, "token-A");
    await AsyncStorage.setItem(userKey, JSON.stringify({ id: "user-A" }));
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue(null);
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    const getSession = jest.spyOn(api.auth, "getSession").mockImplementation(async () => {
      expect(getCoordinatorState()).toBe("TRANSITIONING");
      expect(await AsyncStorage.getItem(tokenKey)).toBe("token-A");
      expect(await AsyncStorage.getItem(userKey)).not.toBeNull();
      return { data: { session: null }, error: null } as any;
    });

    await expect(
      executeWorkspaceTransition("user-A", null, null, null, {
        activeFeedAcknowledged: true,
        closeRemoteSession: true,
      })
    ).resolves.toBeUndefined();

    expect(api.auth.signout).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("keeps a sign-out transition in RECOVERY_REQUIRED when the session remains after a successful sign-out response", async () => {
    await AsyncStorage.setItem("bread_lab_auth_token_v1", "token-A");
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: "user-A" }));
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue(null);
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: "user-A" } } },
      error: null,
    } as any);

    await expect(
      executeWorkspaceTransition("user-A", null, null, null, {
        activeFeedAcknowledged: true,
        closeRemoteSession: true,
      })
    ).rejects.toThrow(/could not be confirmed closed/);

    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBe("token-A");
    expect(await AsyncStorage.getItem("bread_lab_pending_account_signout_v1")).not.toBeNull();
  });

  it("reconciles same-device remote active Bakes and discards local active work only after verified departure", async () => {
    const owner = "user-A";
    const deviceId = await getDeviceId();
    const scopedBake = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, owner);
    await AsyncStorage.setItem("bread_lab_auth_token_v1", owner);
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: owner }));
    await AsyncStorage.setItem(scopedBake, JSON.stringify([{ id: "active-1", userId: owner }]));
    await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_BAKE, JSON.stringify({ id: "legacy-active", userId: owner }));
    await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_FEED, JSON.stringify({ id: "feed-active", userId: owner }));

    jest.spyOn(api.history.bakes, "activeForDevice")
      .mockResolvedValueOnce({ id: "remote-active", userId: owner, deviceId, inProgress: true } as any)
      .mockResolvedValueOnce({ id: "older-active", userId: owner, deviceId, inProgress: true } as any)
      .mockResolvedValue(null);
    const removeRemote = jest.spyOn(api.history.bakes, "delete").mockResolvedValue(true);
    const verifyAbsent = jest.spyOn(api.history.bakes, "verifyAbsent").mockResolvedValue(true);
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as any);
    const uploadActive = jest.spyOn(api.history.bakes, "upsert");

    await executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true, closeRemoteSession: true,
      beforeTransition: async () => {
        const result = await migrateLocalDataToAccount(owner);
        expect(result.bakes).toEqual({ ok: 0, failed: 0, unresolved: 0 });
      },
    });

    expect(uploadActive).not.toHaveBeenCalled();
    expect(removeRemote).toHaveBeenCalledWith("remote-active", deviceId, owner);
    expect(removeRemote).toHaveBeenCalledWith("older-active", deviceId, owner);
    expect(verifyAbsent).toHaveBeenCalledWith("remote-active", deviceId, owner);
    expect(verifyAbsent).toHaveBeenCalledWith("older-active", deviceId, owner);
    expect(await AsyncStorage.getItem(scopedBake)).toBeNull();
    expect(await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_BAKE)).toBeNull();
    expect(await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY(owner))) || "{}").activeBakes).toBeUndefined();
    expect(await AsyncStorage.getItem("bread_lab_pending_account_signout_v1")).toBeNull();
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBeNull();
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("waits for an in-flight active Bake upsert before reconciling remote rows", async () => {
    const owner = "user-A";
    const deviceId = await getDeviceId();
    await AsyncStorage.setItem("bread_lab_auth_token_v1", owner);
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: owner, firstName: "A", starterName: "Starter" }));
    let releaseUpsert!: () => void;
    let signalUpsert!: () => void;
    const enteredUpsert = new Promise<void>((resolve) => { signalUpsert = resolve; });
    const heldUpsert = new Promise<void>((resolve) => { releaseUpsert = resolve; });
    let remoteRow: any = null;
    jest.spyOn(api.history.bakes, "upsert").mockImplementation(async () => {
      signalUpsert();
      await heldUpsert;
      remoteRow = { id: "race-bake", userId: owner, deviceId, inProgress: true };
      return remoteRow;
    });
    jest.spyOn(api.history.bakes, "activeForDevice").mockImplementation(async () => remoteRow);
    jest.spyOn(api.history.bakes, "delete").mockImplementation(async () => {
      remoteRow = null;
      return true;
    });
    jest.spyOn(api.history.bakes, "verifyAbsent").mockImplementation(async () => remoteRow === null);
    const signout = jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as any);

    const upsert = upsertBakeRemote({
      id: "race-bake", userId: owner, recipeId: "recipe-1", recipeName: "Loaf",
      startedAt: 1, phases: [{ key: "mix", name: "Mix", startedAt: 1 }],
    } as any);
    await enteredUpsert;
    const departure = executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true, closeRemoteSession: true,
    });
    expect(signout).not.toHaveBeenCalled();
    releaseUpsert();
    await upsert;
    await departure;
    expect(remoteRow).toBeNull();
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete a mismatched remote active Bake and retains the local original", async () => {
    const owner = "user-A";
    const deviceId = await getDeviceId();
    const scopedBake = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, owner);
    const original = JSON.stringify([{ id: "active-1", userId: owner }]);
    await AsyncStorage.setItem("bread_lab_auth_token_v1", owner);
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: owner }));
    await AsyncStorage.setItem(scopedBake, original);
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue({
      id: "foreign-active", userId: "user-B", deviceId, inProgress: true,
    } as any);
    const removeRemote = jest.spyOn(api.history.bakes, "delete");

    await expect(executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true, closeRemoteSession: true,
    })).rejects.toThrow(/unverified or repeated row/);

    expect(removeRemote).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(scopedBake)).toBe(original);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBe(owner);
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("preserves the local active Bake when remote deletion cannot be verified", async () => {
    const owner = "user-A";
    const deviceId = await getDeviceId();
    const scopedBake = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, owner);
    const original = JSON.stringify([{ id: "active-1", userId: owner }]);
    await AsyncStorage.setItem("bread_lab_auth_token_v1", owner);
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: owner }));
    await AsyncStorage.setItem(scopedBake, original);
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue({
      id: "remote-active", userId: owner, deviceId, inProgress: true,
    } as any);
    jest.spyOn(api.history.bakes, "delete").mockResolvedValue(true);
    jest.spyOn(api.history.bakes, "verifyAbsent").mockResolvedValue(false);
    const signout = jest.spyOn(api.auth, "signout");

    await expect(executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true, closeRemoteSession: true,
    })).rejects.toThrow(/could not be confirmed absent/);

    expect(signout).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(scopedBake)).toBe(original);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBe(owner);
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("retains active work and credentials when remote sign-out is unverified, then retries cleanup", async () => {
    const owner = "user-A";
    const scopedBake = getOwnerStorageKey(APP_STORAGE_KEYS.ACTIVE_BAKE, owner);
    const rawBake = JSON.stringify([{ id: "active-1", userId: owner }]);
    const rawFeed = JSON.stringify({ id: "feed-active", userId: owner });
    await AsyncStorage.setItem("bread_lab_auth_token_v1", owner);
    await AsyncStorage.setItem("bread_lab_auth_user_v1", JSON.stringify({ id: owner }));
    await AsyncStorage.setItem(scopedBake, rawBake);
    await AsyncStorage.setItem(APP_STORAGE_KEYS.ACTIVE_FEED, rawFeed);
    jest.spyOn(api.history.bakes, "activeForDevice").mockResolvedValue(null);
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    const session = jest.spyOn(api.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: owner } } }, error: null,
    } as any);

    await expect(executeWorkspaceTransition(owner, null, null, null, {
      activeFeedAcknowledged: true, closeRemoteSession: true,
    })).rejects.toThrow(/could not be confirmed closed/);

    expect(await AsyncStorage.getItem(scopedBake)).toBe(rawBake);
    expect(await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED)).toBe(rawFeed);
    expect(await AsyncStorage.getItem("bread_lab_auth_token_v1")).toBe(owner);
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");

    setCoordinatorState("IDLE"); // model a process restart losing only the in-memory state
    await expect(executeWorkspaceTransition(owner, null)).rejects.toThrow(/recovery required/);
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");

    session.mockResolvedValue({ data: { session: null }, error: null } as any);
    const recovery = await recoverTransition();
    expect(recovery).toEqual({ remoteSignout: true, localClear: true });
    expect(await AsyncStorage.getItem(scopedBake)).toBeNull();
    expect(await AsyncStorage.getItem(APP_STORAGE_KEYS.ACTIVE_FEED)).toBeNull();
    expect(await AsyncStorage.getItem("bread_lab_pending_account_signout_v1")).toBeNull();
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("returns to IDLE only after local credentials are cleared and remote session absence is confirmed", async () => {
    const tokenKey = "bread_lab_auth_token_v1";
    const userKey = "bread_lab_auth_user_v1";
    await AsyncStorage.setItem(tokenKey, "token-A");
    await AsyncStorage.setItem(userKey, JSON.stringify({ id: "user-A" }));
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    const getSession = jest.spyOn(api.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as any);
    setCoordinatorState("RECOVERY_REQUIRED");

    const recovery = await recoverTransition();

    expect(recovery).toEqual({ remoteSignout: true, localClear: true });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull();
    expect(await AsyncStorage.getItem(userKey)).toBeNull();
    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("remains RECOVERY_REQUIRED when the remote session lookup fails", async () => {
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockRejectedValue(new Error("session storage unreadable"));
    setCoordinatorState("RECOVERY_REQUIRED");

    const recovery = await recoverTransition();

    expect(recovery).toEqual({ remoteSignout: false, localClear: true });
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("does not accept a successful sign-out response while a remote session remains", async () => {
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockResolvedValue({ data: { session: { user: { id: "user-A" } } }, error: null } as any);
    setCoordinatorState("RECOVERY_REQUIRED");

    const recovery = await recoverTransition();

    expect(recovery).toEqual({ remoteSignout: false, localClear: true });
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("does not leave RECOVERY_REQUIRED when local credential removal cannot be verified", async () => {
    const tokenKey = "bread_lab_auth_token_v1";
    const userKey = "bread_lab_auth_user_v1";
    await AsyncStorage.setItem(tokenKey, "token-A");
    await AsyncStorage.setItem(userKey, JSON.stringify({ id: "user-A" }));
    (AsyncStorage.multiRemove as jest.Mock).mockImplementationOnce(async () => {});
    jest.spyOn(api.auth, "signout").mockResolvedValue({ signedOut: true });
    jest.spyOn(api.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as any);
    setCoordinatorState("RECOVERY_REQUIRED");

    const recovery = await recoverTransition();

    expect(recovery).toEqual({ remoteSignout: true, localClear: false });
    expect(await AsyncStorage.getItem(tokenKey)).toBe("token-A");
    expect(await AsyncStorage.getItem(userKey)).not.toBeNull();
    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
    jest.restoreAllMocks();
  });

  it("inspects owner-scoped records and rejects ownerless records", async () => {
    const { getOwnerStorageKey, APP_STORAGE_KEYS } = require("../storageUtils");
    const scopedKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");

    await AsyncStorage.setItem(scopedKey, JSON.stringify([{ id: "r1", name: "Ownerless" }]));
    await expect(
      executeWorkspaceTransition("user-A", null, null, null)
    ).rejects.toThrow();
  });

  it("inspects owner-scoped records and rejects foreign-owned records", async () => {
    const { getOwnerStorageKey, APP_STORAGE_KEYS } = require("../storageUtils");
    const scopedKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");

    await AsyncStorage.setItem(scopedKey, JSON.stringify([{ id: "r2", userId: "user-B", name: "Foreign" }]));
    await expect(
      executeWorkspaceTransition("user-A", null, null, null)
    ).rejects.toThrow();
  });

  it("inspects owner-scoped records and permits valid owner records", async () => {
    const { getOwnerStorageKey, APP_STORAGE_KEYS } = require("../storageUtils");
    const scopedKey = getOwnerStorageKey(APP_STORAGE_KEYS.RECIPES, "user-A");

    await AsyncStorage.setItem(scopedKey, JSON.stringify([{ id: "r3", userId: "user-A", name: "Valid", phases: [] }]));
    await expect(
      executeWorkspaceTransition("user-A", null, null, null)
    ).resolves.toBeUndefined();
  });

  it("includes candidates and inspects them in preflight", async () => {
    const candidateKey = "bread_lab_candidates_v1_anonymous";
    await AsyncStorage.setItem(candidateKey, JSON.stringify([{ id: "c1", extractionResult: { status: "single_candidate" } }]));

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" }, await explicitDiscard())
    ).resolves.toBeUndefined();

    await AsyncStorage.setItem(candidateKey, "not-json");
    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).rejects.toThrow();
  });

  it("when preflight fails before transition starts, state remains IDLE, generation is not advanced, and no mutations occur", async () => {
    const genBefore = getWorkspaceGeneration();
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");
    const tokenKey = "bread_lab_auth_token_v1";
    const recipeKey = "bread_lab_recipes_v1_user-A";
    await AsyncStorage.setItem(tokenKey, "token-A");
    await AsyncStorage.setItem(recipeKey, JSON.stringify([{ id: "r1", userId: "user-A", name: "Rec", phases: [] }]));

    await expect(
      executeWorkspaceTransition("user-A", null, null, null)
    ).rejects.toThrow();

    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(genBefore);
    expect(await AsyncStorage.getItem("bread_lab_migration_pending_v1")).toBe("1");
    expect(await AsyncStorage.getItem(tokenKey)).toBe("token-A");
    expect(await AsyncStorage.getItem(recipeKey)).not.toBeNull();
  });

  it.each(["anonymous", "user-A"])("blocks %s departure with unresolved legacy deletion intent before mutation", async (owner) => {
    const key = "bread_lab_unresolved_legacy_tombstones_v1";
    const intent = [{ id: "r-1", recordType: "recipe", owner: "unknown", sourceKey: "bread_lab_deleted_recipe_ids_v1", disposition: "unresolved" }];
    await AsyncStorage.setItem(key, JSON.stringify(intent));
    const beforeTransition = jest.fn(async () => {});
    const generationBefore = getWorkspaceGeneration();
    const options = owner === "anonymous" ? await explicitDiscard() : {};

    await expect(executeWorkspaceTransition(owner, owner === "anonymous" ? "user-A" : null,
      owner === "anonymous" ? "user-A" : null,
      owner === "anonymous" ? { id: "user-A", firstName: "A", starterName: "S" } : null,
      { ...options, beforeTransition })).rejects.toThrow(/unresolved legacy tombstone/);

    expect(beforeTransition).not.toHaveBeenCalled();
    expect(getCoordinatorState()).toBe("IDLE");
    expect(getWorkspaceGeneration()).toBe(generationBefore);
    expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(intent));
  });

  it("unverified import disposition blocks transition when migration pending is set", async () => {
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");
    const unverifiedDisposition = {
      mode: "import" as const,
      plan: { mode: "import" as const, createdAt: Date.now(), ops: [] },
      snapshotRaw: {},
    };

    await expect(
      executeWorkspaceTransition(null, "token-A", "token-A", { id: "token-A", firstName: "A", starterName: "S" }, { nlaDisposition: unverifiedDisposition })
    ).rejects.toThrow(/authorization rejection|migration pending marker remains present|readiness verification failed/);
  });

  it("rejects out-of-scope purge plan operations in applyNlaPurgeLocked", async () => {
    const { applyNlaPurgeLocked } = require("../nlaWorkspace");
    const maliciousPlan = {
      mode: "import" as const,
      createdAt: Date.now(),
      ops: [{ kind: "removeKey", key: "bread_lab_auth_token_v1" }],
    };

    await expect(applyNlaPurgeLocked(maliciousPlan)).rejects.toThrow(/Purge plan security rejection|Purge plan authorization rejection/);
  });

  it("calling buildPurgePlan alone or with fabricated verified ids cannot authorize Import", async () => {
    const { inventoryNlaWorkspace, buildPurgePlan, applyNlaPurgeLocked } = require("../nlaWorkspace");
    const inv = await inventoryNlaWorkspace();
    const fabricatedPlan = buildPurgePlan(inv, "import", { recipes: ["fake"], bakeHistory: [], feedHistory: [], candidates: [] });

    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");
    const disposition = {
      mode: "import" as const,
      plan: fabricatedPlan,
      snapshotRaw: inv.raw,
    };

    await expect(
      executeWorkspaceTransition(null, "token-A", "token-A", { id: "token-A", firstName: "A", starterName: "S" }, { nlaDisposition: disposition })
    ).rejects.toThrow();

    await expect(applyNlaPurgeLocked(fabricatedPlan)).rejects.toThrow(/Purge plan authorization rejection/);
  });

  it("a fabricated discard plan cannot authorize destructive work", async () => {
    const { inventoryNlaWorkspace, buildPurgePlan, applyNlaPurgeLocked } = require("../nlaWorkspace");
    const inventory = await inventoryNlaWorkspace();
    const fabricatedPlan = buildPurgePlan(inventory, "discard");

    await expect(applyNlaPurgeLocked(fabricatedPlan)).rejects.toThrow(/discard plan lacks valid authorized discard provenance/);
  });

  it("tampered journal or invalid operation keys/shapes fail closed during recovery", async () => {
    const { resumePendingNlaPurgeLocked, NLA_PURGE_JOURNAL_KEY } = require("../nlaWorkspace");
    const tamperedPlan = {
      mode: "import" as const,
      createdAt: Date.now(),
      ops: [{ kind: "removeKey", key: "bread_lab_auth_token_v1" }],
    };
    await AsyncStorage.setItem(NLA_PURGE_JOURNAL_KEY, JSON.stringify({ version: 1, plan: tamperedPlan }));

    await expect(resumePendingNlaPurgeLocked()).rejects.toThrow(/Purge plan security rejection|Purge plan authorization rejection/);
    expect(await AsyncStorage.getItem(NLA_PURGE_JOURNAL_KEY)).not.toBeNull();
  });
});
