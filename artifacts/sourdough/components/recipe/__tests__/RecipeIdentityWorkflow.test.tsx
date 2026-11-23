import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ActiveBake, SavedRecipe } from "@/lib/recipeTypes";
import { RecipeBuilderEditView } from "../RecipeBuilderEditView";
import { RecipeRunnerActiveView } from "../RecipeRunnerActiveView";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Feather: "Feather", Ionicons: "Ionicons" }));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff", card: "#fff", border: "#ddd", foreground: "#111",
    mutedForeground: "#777", muted: "#eee", primary: "#844b1d",
    primaryForeground: "#fff", accent: "#844b1d",
  }),
}));
jest.mock("@/components/YieldPill", () => ({ YieldPill: () => null }));
jest.mock("../ContinuousListInput", () => ({ ContinuousListInput: () => null }));
jest.mock("@/components/recipe/SegmentBar", () => ({ SegmentBar: () => null }));
jest.mock("@/components/recipe/PhaseCard", () => ({
  PendingPhaseCard: () => null, DonePhaseCard: () => null, ActivePhaseCard: () => null,
}));
jest.mock("@/components/AffiliateCarousel", () => () => null);
jest.mock("@/components/SegmentedNotepad", () => () => null);
jest.mock("../BulkEstimatorSettingsModal", () => ({ BulkEstimatorSettingsModal: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const recipe = (name: string, versionLabel?: string): SavedRecipe => ({
  id: "recipe-3", name, versionLabel, createdAt: 1, phases: [],
});

function EditHarness({ initial }: { initial: SavedRecipe }) {
  const [editingRecipe, setEditingRecipe] = React.useState(initial);
  const [saved, setSaved] = React.useState<SavedRecipe | null>(null);
  return <>
    <RecipeBuilderEditView
      editingRecipe={editingRecipe} isNewRecipe={false} availablePhaseCount={0}
      onChangeName={(name) => setEditingRecipe((prev) => ({ ...prev, name }))}
      onChangeOverview={jest.fn()} onChangeYield={jest.fn()} onUpdatePhaseField={jest.fn()}
      onRemovePhase={jest.fn()} onOpenPhasePicker={jest.fn()}
      onSave={() => setSaved({ ...editingRecipe, name: editingRecipe.name.trim() })}
      onCancel={jest.fn()} onDuplicate={jest.fn()} onDelete={jest.fn()}
    />
    {saved && <>{/* Inspect the object handed to persistence by the save-shaped callback. */}
      <Text>{saved.name}|{saved.versionLabel ?? ""}</Text>
    </>}
  </>;
}

test("Edit displays the suffix but saves an edited base name with metadata separate", async () => {
  const view = await render(<EditHarness initial={recipe("Bayside 20", "v3")} />);
  expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside 20 v3");
  await fireEvent.changeText(screen.getByTestId("recipe-name-input"), "Bayside Rye v3");
  expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside Rye v3");
  await fireEvent.press(screen.getByTestId("save-recipe-button"));
  expect(screen.getByText("Bayside Rye|v3")).toBeTruthy();
});

test("Edit leaves an unversioned name unchanged and does not double a stored suffix", async () => {
  const view = await render(<EditHarness initial={recipe("Bayside 20")} />);
  expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside 20");
  await view.unmount();
  const duplicateView = await render(<EditHarness initial={recipe("Bayside 20 v3", "v3")} />);
  expect(screen.getByTestId("recipe-name-input").props.value).toBe("Bayside 20 v3");
});

const bake: ActiveBake = {
  id: "bake-1", recipeId: "recipe-3", recipeName: "Bayside 20",
  startedAt: 1, status: "active", phases: [],
};

function RunnerHarness({ recipes }: { recipes: SavedRecipe[] }) {
  const matchingRecipe = recipes.find((item) => item.id === bake.recipeId);
  return <RecipeRunnerActiveView
    bake={bake} recipeVersionLabel={matchingRecipe?.versionLabel}
    elapsed={{}} scaleMultiplier={1} refreshing={false} bakeNotes=""
    overlayDraft="" showNotesOverlay={false} activePhase={undefined}
    allDone={false} completedCount={0} recipeStale={false}
    inoculationAnchorKey={null} inoculationPercent={null}
    expandedDone={new Set()} expandedRecipeInfo={new Set()} expandedPending={new Set()}
    recentlyCompletedKey={null} nextHighlightKey={null} copiedIngredientsKey={null}
    phaseStartVolumes={{}} phaseTargetTemps={{}}
    scrollRef={React.createRef()} phaseCardYOffsets={{ current: {} }}
    phasesContainerY={{ current: 0 }}
    onScaleChange={jest.fn()} onStartPhase={jest.fn()} onCompletePhase={jest.fn()}
    onToggleExpandDone={jest.fn()} onToggleExpandRecipeInfo={jest.fn()}
    onToggleExpandPending={jest.fn()} onOpenReadingModal={jest.fn()}
    onDeleteReading={jest.fn()} onIncrementFold={jest.fn()}
    onStartVolumeChange={jest.fn()} onStartVolumeCommit={jest.fn()}
    onTargetTempChange={jest.fn()} onTargetTempCommit={jest.fn()}
    onSaveEstimatorFormula={jest.fn()} onCopyIngredients={jest.fn()}
    onShareSpec={jest.fn()} onAbandonBake={jest.fn()} onPrint={jest.fn()}
    onSharePdf={jest.fn()} onOpenNotesOverlay={jest.fn()}
    onSaveNotesOverlay={jest.fn()} onCloseNotesOverlay={jest.fn()}
    onOverlayDraftChange={jest.fn()} onRefresh={jest.fn()}
    sessionChecks={{}} onToggleLineCheck={jest.fn()}
  />;
}

test("Runner renders only the version belonging to bake.recipeId", async () => {
  const view = await render(<RunnerHarness recipes={[
    { ...recipe("Other", "v9"), id: "other" },
    recipe("Bayside 20", "v3"),
  ]} />);
  expect(screen.getByText("Bayside 20 v3")).toBeTruthy();
  expect(screen.queryByText("Bayside 20 v9")).toBeNull();
});

test.each([
  ["missing recipe", []],
  ["unversioned recipe", [recipe("Bayside 20")]],
])("Runner renders the original name for %s", async (_, recipes) => {
  const view = await render(<RunnerHarness recipes={recipes as SavedRecipe[]} />);
  expect(screen.getByText("Bayside 20")).toBeTruthy();
});
