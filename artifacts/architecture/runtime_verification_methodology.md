# Architectural Atlas: Phase 3A — Runtime Verification Methodology (Success Toast Case Study)

**Branch:** `the-bakers-bench`  
**Scope:** Read-only architectural methodology and runtime verification design for baker-facing workflows in Bread Lab (`artifacts/sourdough/`).

---

## 1. Source-Evidenced Lifecycle Trace (Success Toast Case Study)

Tracing the success toast lifecycle establishes how notification feedback is triggered, managed in state, rendered, and automatically scheduled for dismissal.

### A. Trigger & State Management (`artifacts/sourdough/contexts/ShareCandidateContext.tsx`)
- **Trigger & Function**: When a candidate is successfully extracted and saved via `processExtractionAndSave()` (lines 169–191) or `processShareInput()` (lines 193–215), `showSuccessToast()` (lines 149–156) is invoked with `options?.showToast === true`.
- **State Updates**:
  ```ts
  const showSuccessToast = useCallback((msg?: string) => {
    setToastText(msg || SUCCESS_TOAST_TEXT); // SUCCESS_TOAST_TEXT defined at line 39
    setToastVisible(true);

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 4000); // 4,000 ms scheduled hide operation
  }, []);
  ```
- **Rendered Component (`ShareSuccessToast`, lines 41–125)**: Mounted at the root provider level inside `ShareCandidateProvider` (`artifacts/sourdough/contexts/ShareCandidateContext.tsx`, lines 264–268):
  ```tsx
  <ShareSuccessToast
    visible={toastVisible}
    text={toastText}
    onDismiss={() => setToastVisible(false)}
  />
  ```
- **Dismissal Paths**:
  1. **Timer Expiration**: The 4,000 ms `setTimeout` callback executes `setToastVisible(false)`.
  2. **Manual Dismissal**: User interaction triggering `onDismiss={() => setToastVisible(false)}`.
  3. **Provider Unmount**: Unmounting `ShareCandidateProvider` (anchored at root layout `app/_layout.tsx`, line 86).

---

## 2. Hypothesis Ledger (Distinguishing Source-Confirmed, Runtime-Confirmed, and Unverified)

| Claim / Hypothesis | Verification Status | Source Evidence & Reference |
| :--- | :--- | :--- |
| **The success toast state and timer are managed by `ShareCandidateContext`**. | **Source-Confirmed** | `artifacts/sourdough/contexts/ShareCandidateContext.tsx`, lines 127–156 (`showSuccessToast`, `toastVisible`, `toastTimerRef`). |
| **A 4,000 ms timeout is scheduled when the success toast appears**. | **Source-Confirmed** | `artifacts/sourdough/contexts/ShareCandidateContext.tsx`, line 154 (`setTimeout(..., 4000)`). |
| **The success toast remains visibly rendered on screen for a guaranteed duration of 4 seconds**. | **Unverified** | While source code guarantees a 4,000 ms scheduled hide operation, runtime visibility is subject to UI thread interleaving, frame drops, layout clipping, and real-device execution behavior (**Pending Real-Phone Test**). |
| **All tab routes are active in bottom navigation**. | **Source-Confirmed** | `artifacts/sourdough/app/(tabs)/_layout.tsx`, lines 183–189: Legacy routes (`recipe.tsx`, `history.tsx`, `graph.tsx`, `about.tsx`) are explicitly hidden via `href: null`. Active entry is `lab.tsx` → `LabHub`. |

---

## 3. Active-Route Verification & Entry Trace

To establish active-route verification as an explicit acceptance criterion:
- **Entry Route**: `app/(tabs)/_layout.tsx` (Expo Router bottom tab navigator).
- **Active Lab Route**: `app/(tabs)/lab.tsx` renders `LabHub` (`artifacts/sourdough/components/lab/labHub.tsx`).
- **Rendered Component Tree**: `LabHub` → Section Toggle (`analytics` | `feed planner` | `recipe builder`) → Subcard Toggle (`candidates` | `theories`) → `RecipeBuilderListView` or Candidate Inbox → `CandidateReviewController` / `BakerReviewModal`.
- **Action Callbacks**: Tapping "Review" on a candidate card invokes `handleOpenCandidateReview(record)` (`labHub.tsx`), rendering `BakerReviewModal` with pre-populated `ExtractionResult`.

---

## 4. Minimal Runtime Verification Procedure

| Step | Action / Input | Expected Result (Source-Evidenced) | Observed Result / Verification Status |
| :--- | :--- | :--- | :--- |
| **1. Trigger Acquisition** | Paste a valid recipe in `PasteCandidateModal.tsx`. | Candidate is saved locally (`candidateStorage.ts`) and `showSuccessToast()` fires. | **Pending Real-Device Test**: Visual confirmation of toast appearance. |
| **2. Timer Inspection** | Inspect `setTimeout` duration in source code. | A scheduled hide operation of 4,000 ms is configured (`ShareCandidateContext.tsx`, line 154). | **Source-Confirmed** (4,000 ms scheduled hide; actual visible duration **Unverified** pending phone test). |
| **3. Dismissal Test** | Tap the visible success toast or wait for timer. | `onDismiss` fires or timer executes `setToastVisible(false)`. | **Pending Real-Device Test**. |

---

## 5. Reusable Verification Checklist for Baker Workflows

- [ ] **Active Route Binding Audit**: Verify the target feature is mounted by active file-based routing (`_layout.tsx` / `lab.tsx`), not hidden via `href: null`.
- [ ] **Static vs. Runtime Evidence Distinction**: Clearly label what is proven by static source analysis versus what requires physical device/emulator observation.
- [ ] **Trigger & State Flow Trace**: Trace user action → callback → state update → storage persistence (`storageMutex`).
- [ ] **Visible UI Outcome**: Confirm target components render correctly in the active component tree.
- [ ] **Persistence & Dismissal Contracts**: Verify local storage commits, modal cleanup, and timeout cleanups.

---

## 6. Methodological Post-Mortem: Guarding Against Route/UI Discrepancies

### How This Method Would Have Caught the Earlier LabHub Mistake
Earlier, candidate import UI was implemented in `app/(tabs)/recipe.tsx` (a hidden legacy tab file), while the active Lab tab pointed to `components/lab/labHub.tsx`. 

**Applying this Runtime Verification Methodology prevents this error through**:
1. **Active Route Binding Check**: Requiring an explicit trace from `_layout.tsx` through the rendered component tree (`lab.tsx` → `LabHub`), explicitly ruling out hidden legacy files (`recipe.tsx` with `href: null`).
2. **Static vs. Runtime Discipline**: Distinguishing between the mere existence of component code on disk and its active presence in the running app's rendered tree.

---

## 7. Real-Device / Emulator Follow-Up Observations Needed
- Verify toast animation smoothness and exact visible duration under React Native Reanimated on physical hardware.
- Confirm background-to-foreground app state transitions correctly ingest staged shares and refresh the Candidate UI.

---

## 8. Summary of Findings, Evidence References & Unresolved Questions
- **Deliverable Path**: `artifacts/architecture/runtime_verification_methodology.md`
- **Findings**: The success toast timer is a 4,000 ms scheduled hide operation, not an empirical guarantee of visible duration. Active route binding requires tracing entry points (`lab.tsx` → `LabHub`) rather than relying on hidden routes.
- **Evidence References**: `artifacts/sourdough/contexts/ShareCandidateContext.tsx` (lines 39, 41–125, 149–156, 264–268); `artifacts/sourdough/app/(tabs)/_layout.tsx` (lines 183–189).
- **Unresolved Questions**: Exact physical device render latency and display persistence time under heavy UI thread load (pending real-phone test).
