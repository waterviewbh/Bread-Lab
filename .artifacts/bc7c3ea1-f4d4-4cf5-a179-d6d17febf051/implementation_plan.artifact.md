# Bulk Ferment Estimator & Clock Enhancement (v2)

This plan outlines the steps to "turn on" the Bulk Ferment estimator logic that already exists in the project and enhance the UI to match the Feed tab's prominent clock style.

## User Review Required

> [!IMPORTANT]
> This revision follows the user's requirement to use existing logic rather than creating new functions. The estimator will be initialized directly in the phase start handler using `lookupExpectedDuration`.

## Proposed Changes

### Core Logic Integration

#### [MODIFY] [recipe.tsx](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/app/(tabs)/recipe.tsx)
- In the `startPhase` function, when the `bulk_fermenting` phase is started:
    - Call `lookupExpectedDuration` from `bulkFermentEngine.ts` with a default temperature of 76°F and the pre-calculated `inoculationPercent`.
    - Initialize `bulkFermentState` with the resulting `projectedTargetAt` (startedAt + duration) and `activeInoculationPercent`.
    - This "turns on" the estimator immediately without waiting for the first reading.

### UI & Display Enhancement

#### [MODIFY] [PhaseCard.tsx](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/components/recipe/PhaseCard.tsx)
- **Prominent Bulk Clock:**
    - Update `ActivePhaseCard` to detect if the phase is `bulk_fermenting`.
    - If active and bulk, display a large clock centered in the card, using `fonts.serifBold`, size 52, and color `#5d3a26` (matching the Feed tab).
    - Display an eyebrow label above the large clock (e.g., "EST. REMAINING" or "PAST TARGET") using data from `useBulkFermentTimer`.
    - Move the standard phase elapsed timer (`formatTimer(elapsedMs)`) to a secondary, smaller position within the card.

#### [MODIFY] [bulkFermentUtils.ts](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/lib/bulkFermentUtils.ts)
- Update `getBulkTimerDisplay` to include an `eyebrow` field in its return object to support the new UI labels.

## Verification Plan

### Manual Verification
- Start the Bulk Ferment phase and verify the large clock appears immediately with an estimate.
- Ensure the clock styling (font, size, color) matches the Feed tab exactly.
- Log a check-in and verify the clock updates based on the PD engine velocity.
