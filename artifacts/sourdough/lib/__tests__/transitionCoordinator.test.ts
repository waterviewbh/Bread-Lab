// artifacts/sourdough/lib/__tests__/transitionCoordinator.test.ts
import { executeWorkspaceTransition, getCoordinatorState, setCoordinatorState, recoverTransition } from "../transitionCoordinator";
import { UDL } from "../udl";
import { getWorkspaceGeneration } from "../storageUtils";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Workspace Transition Coordinator & UDL Contract", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setCoordinatorState("IDLE");
  });

  const explicitDiscard = async () => {
    const { inventoryNlaWorkspace, buildPurgePlan, authorizeDiscardPlan } = require("../nlaWorkspace");
    const inventory = await inventoryNlaWorkspace();
    const plan = authorizeDiscardPlan(buildPurgePlan(inventory, "discard"));
    return { nlaDisposition: { mode: "discard" as const, plan, snapshotRaw: inventory.raw } };
  };

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

  it("recovers from interrupted state via recoverTransition()", async () => {
    setCoordinatorState("RECOVERY_REQUIRED");
    await expect(recoverTransition()).resolves.toBeUndefined();
    expect(getCoordinatorState()).toBe("IDLE");
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
