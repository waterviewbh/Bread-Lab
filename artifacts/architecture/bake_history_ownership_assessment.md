# Architectural Assessment: Recipe Runner & Bake History Ownership (Assessment 3 — Final Verified Pass)

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural assessment.  
**Scope:** Evaluation of active bake sessions, lifecycle transitions, bake history ownership, persistence, remote synchronization, failure boundaries, and resolution of Issue #69 across Bench and Log in Bread Lab (`artifacts/sourdough/`).

---

## 1. Active Bake Lifecycle & Ordered Trace

Source tracing of `components/bench/ActiveBakeSection.tsx`, `app/(tabs)/recipe.tsx`, and `lib/recipeStorage.ts` establishes the ordered lifecycle of an active bake:

1. **Creation & Initial Persistence (`ActiveBakeSection.tsx` / `recipe.tsx`)**:
   - Trigger: Baker selects a recipe in `RecipeRunnerSetupView` and taps "Start Bake".
   - Mutation: Creates an `ActiveBake` object (`id`, `recipeId`, `recipeName`, `startedAt`, `status: 'active'`, `phases`, `estimatorState`).
   - Persistence: Written to local storage under `bread_lab_bake_v2` (`BAKE_KEY`, `lib/recipeTypes.ts`) via `writeBakesLocal()` or `writeBakeLocal()`, and upserted remotely via `upsertBakeRemote()`.
2. **Recovery / Restoration**:
   - Trigger: Component mount or screen focus (`useFocusEffect` calling `loadData()` in `ActiveBakeSection.tsx`).
   - Persistence: Reads `BAKE_KEY` from AsyncStorage and hydrates active bakes. If local storage is empty, queries Supabase via `api.history.bakes.active()`.
3. **Runtime Updates**:
   - Triggers: Baker starts a phase (`startPhase`), completes a phase (`completePhase`), records a reading (`ReadingModal`), logs folds, or edits notes.
   - Persistence: Mutates active bake state and immediately persists via `writeBakeLocal()` and `upsertBakeRemote()`.
4. **Abandonment / Reset / Exit (`resetBake()`, `ActiveBakeSection.tsx` / `recipe.tsx`)**:
   - Trigger: Baker taps "New Bake" / Reset.
   - Persistence: Archives the abandoned bake to history via `archiveBakeWithDiagnostics()`, removes it from `BAKE_KEY`, and persists the next active bake or nulls active state.
5. **Completion & Transition to History (`archiveBakeWithDiagnostics()`, `lib/recipeStorage.ts`, lines 319–365)**:
   - Trigger: All phases of an active bake are completed (`status: 'completed'`) or archived.
   - Persistence: Reads `bread_lab_bake_history_v1` (`BAKE_HISTORY_KEY`), prepends the completed history item (stamping `savedAt` and updating `status`), trims history to 500 items, and writes back to AsyncStorage inside `storageMutex.run()`.
   - Remote Sync: Invokes `api.history.bakes.upsert({ ..., inProgress: false })` non-blockingly.
   - Cleanup: Active bake state is cleared from active storage (`BAKE_KEY`) by callers after archival.

---

## 2. Resolution of Issue #69 (Start vs. Completion Evidence)

- **Issue #69 Question**: Does a bake enter History when the Runner is started or only when it is completed?
- **Source & Test Evidence**: 
  - Starting a bake writes an `ActiveBake` record solely to `BAKE_KEY` (`bread_lab_bake_v2`), **not** to `BAKE_HISTORY_KEY` (`bread_lab_bake_history_v1`).
  - A record is written to `BAKE_HISTORY_KEY` strictly when the bake is completed or explicitly reset/abandoned via `archiveBakeWithDiagnostics()` (`lib/recipeStorage.ts`, lines 319–365).
  - **Clarification on Concern**: Issue #69's concern is specifically addressed by documenting this existing behavior: active bakes reside in `BAKE_KEY` during execution, while completed or abandoned/reset bakes enter History upon termination.
- **Recommendation regarding Issue #69**: **Clarify / Documentation Correction**. Issue #69 is fully answered by documenting source behavior: bakes do not enter history upon start; they enter history upon completion or explicit reset/abandonment.

---

## 3. Archival Failure Boundaries (`archiveBakeWithDiagnostics()`)

- **Order of Operations**: 
  1. Local history persistence (`AsyncStorage.setItem(BAKE_HISTORY_KEY, ...)`) runs inside `storageMutex.run()`.
  2. Remote sync callback (`callbacks.reportSyncStart()`) and Supabase upsert (`api.history.bakes.upsert`) execute afterwards.
- **Local Persistence Failure**: If local history write throws, the `try/catch` block inside `storageMutex.run()` catches the error (`console.error("[recipeStorage] Archive failed local", e)`), but does *not* rethrow. Execution continues to remote upsert. *Consequence*: Local history write failure is silently swallowed and remote upsert proceeds with whatever local state was cached.
- **Remote Synchronization Failure**: If remote upsert fails, `.catch()` triggers `callbacks.reportSyncFailure()`. **There is no automated retry or background reconciliation queue** in `archiveBakeWithDiagnostics()` to eventually synchronize a locally archived bake. The local record remains saved in `BAKE_HISTORY_KEY`, but remote synchronization is unresolved until subsequent app reloads / focus synchronization (`loadHistory()`).

---

## 4. Corrected Finding Ledger

| Finding | Description & Source Evidence | Classification | Recommendation |
| :--- | :--- | :--- | :--- |
| **Start vs. Completion Bake Separation** | Bakes reside in active storage (`BAKE_KEY`) during execution and enter history (`BAKE_HISTORY_KEY`) only upon completion, abandonment, or reset. Disproves Issue #69 assumption. | **Intentional design** | Documentation correction (Clarify Issue #69). |
| **Local-First History Archival & Silent Catch** | `archiveBakeWithDiagnostics()` commits locally inside `storageMutex`, but catches local write errors silently without rethrowing. | **Bounded reliability concern** | Documentation correction. |
| **Unresolved Remote Synchronization Retry** | Remote upsert failure triggers `reportSyncFailure()`, but lacks an automated retry queue; synchronization relies on subsequent focus reload reconciliation. | **Unresolved architectural decision** | Documented for later prioritization. |

---

## 5. Documentation Discrepancies & Corrections

- **Artifact**: `artifacts/architecture/cross_hub_data_flow.md`
- **Correction Needed**: Updated Section 1 and Section 2 to explicitly distinguish `bread_lab_bake_v2` (`BAKE_KEY`) from `bread_lab_bake_history_v1` (`BAKE_HISTORY_KEY`).
