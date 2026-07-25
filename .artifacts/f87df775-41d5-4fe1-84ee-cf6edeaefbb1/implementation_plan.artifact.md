# Implementation Plan - Fix Checkmark Persistence and Rendering Stability

This plan addresses the issue where checkmarks and strikethroughs are out of sync in the Recipe Runner and ensures progress is persisted across tab switches.

## User Review Required

> [!IMPORTANT]
> **State Persistence**: I am moving the "session progress" (which items are checked) from the `RecipeRunnerActiveView` up to the main `RecipeScreen`. This ensures that your work isn't lost if you switch to the Builder tab or if the app re-renders.

> [!WARNING]
> **ID Stability**: I discovered that legacy recipes are being "migrated" to the new format on every app load with **random IDs**. This causes React to lose track of which item is which. I will switch this to use deterministic IDs based on the text content to ensure stability.

## Proposed Changes

### [Component] UI State Management

#### [MODIFY] [recipe.tsx](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/app/(tabs)/recipe.tsx)
- Add `sessionChecks` state to the main `RecipeScreen` component.
- Move `toggleLineCheck` logic here and pass it down as a prop.
- **Fix `textToCheckableLines`**: Instead of `Math.random()`, use a simple index-based ID for migrated lines. Since these are legacy "flat" recipes being promoted, this is safe and provides the stability React needs.

#### [MODIFY] [RecipeRunnerActiveView.tsx](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/components/recipe/RecipeRunnerActiveView.tsx)
- Remove local `sessionChecks` state.
- Accept `sessionChecks` and `onToggleLineCheck` as props from the parent.

### [Component] Rendering Stability

#### [MODIFY] [PhaseCard.tsx](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/components/recipe/PhaseCard.tsx)
- Refactor `CheckRow` styling to use a more robust conditional object. This prevents a common layout engine bug where strikethroughs sometimes "stick" or fail to appear.

## Verification Plan

### Manual Verification
1. Open Recipe Runner.
2. Check several items.
3. **Verify** all checked items immediately get a strikethrough.
4. Switch to "Recipe Builder" tab and then back to "Recipe Runner".
5. **Verify** your checkmarks are still exactly as you left them.
6. Trigger an app refresh (pull to refresh or background/foreground).
7. **Verify** IDs remain stable and checkmarks don't disappear.
