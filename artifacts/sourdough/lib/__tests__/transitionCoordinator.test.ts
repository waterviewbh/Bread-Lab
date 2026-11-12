// artifacts/sourdough/lib/__tests__/transitionCoordinator.test.ts
import { executeWorkspaceTransition, getCoordinatorState, setCoordinatorState, recoverTransition } from "../transitionCoordinator";
import { UDL } from "../udl";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("Workspace Transition Coordinator & UDL Contract", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setCoordinatorState("IDLE");
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

  it("blocks transition when pending-item gate fails", async () => {
    await AsyncStorage.setItem("bread_lab_migration_pending_v1", "1");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).rejects.toThrow(/UDL readiness verification failed|pending items detected|Operational wipe verification failed/);

    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
  });

  it("executes successful transition when prerequisites pass", async () => {
    await AsyncStorage.removeItem("bread_lab_migration_pending_v1");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).resolves.toBeUndefined();

    expect(getCoordinatorState()).toBe("IDLE");
  });

  it("blocks transition when preflight encounters malformed or indeterminate storage state", async () => {
    await AsyncStorage.setItem("bread_lab_recipes_v1", "not-json");

    await expect(
      executeWorkspaceTransition("anonymous", "user-A", "user-A", { id: "user-A", firstName: "A", starterName: "S" })
    ).rejects.toThrow();

    expect(getCoordinatorState()).toBe("RECOVERY_REQUIRED");
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
});
