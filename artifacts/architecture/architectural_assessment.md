# Architectural Assessment: Recipe Persistence & Promotion (Assessment 1)

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural assessment.  
**Scope:** Evaluation of ordinary recipe creation/editing in Lab, imported-candidate promotion through Candidate Review, shared persistence utilities, and remote synchronization.

---

## 1. Executive Summary & Architecture Overview

Bread Lab supports two primary write paths for creating and persisting `SavedRecipe` records into local AsyncStorage (`bread_lab_recipes_v1` / `RECIPES_KEY`) and synchronizing them with Supabase:
1. **Write Path A (Ordinary Recipe Saves)**: Initiated from the Lab Hub Recipe Builder (`LabHub.tsx` / `RecipeBuilderEditView.tsx`), where bakers manually create or edit structured recipes.
2. **Write Path B (Candidate Promotion)**: Initiated from the Candidate Inbox (`CandidateReviewController.tsx` / `BakerReviewModal.tsx`), where unstructured or semi-structured imported candidate recipes are reviewed, validated, normalized, and promoted into canonical saved recipes.

Both paths share local-first persistence principles and storage mutex protection (`storageMutex`), but differ in validation rigor, normalization requirements, and staging cleanup duties.

---

## 2. Detailed Write-Path Traces

### Write Path A: Ordinary Recipe Saves (`LabHub.tsx` → `lib/recipeStorage.ts`)
- **Entry Point & Validation**: Initiated in `components/lab/labHub.tsx` via `saveRecipe()`. Validates only that `editingRecipe.name.trim()` is non-empty (`Alert.alert("Name required", ...)`).
- **Local Persistence Helper**: `writeRecipesLocal(updated)` (`lib/recipeStorage.ts`, line 223), which executes `storageMutex.run(() => AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(recipes)))`.
- **Mutex Protection**: Fully protected by `storageMutex` (read-modify-write guarded via `AsyncMutex`).
- **Remote Synchronization**: Asynchronous call to `upsertRecipeRemote(saved)` (`lib/recipeStorage.ts`, lines 260–288) coupled with `SyncContext` reports (`reportSyncStart`, `reportSyncSuccess`, `reportSyncFailure`).
- **Failure Semantics**: Local write failure surfaces an alert. Remote sync failure triggers `.catch()` logging and reports sync failure without rolling back local storage (local-first resilience). No staging record cleanup is required.
- **Tested Behavior**: Covered by integration and unit tests in `lib/__tests__/` (e.g., `candidatePromotion.test.ts`, `candidateShareFlow.test.ts`).

### Write Path B: Candidate Promotion (`CandidateReviewController.tsx` → `lib/recipeStorage.ts`)
- **Entry Point & Validation**: Initiated in `components/recipe/CandidateReviewController.tsx` via `handlePromote()`. Enforces strict validation via `validateRecipeForCommit(portableRecipe)` (`lib/recipeImport.ts`), rejecting recipes with unassigned material in `UNCLASSIFIED_STAGING_KEY`.
- **Normalization**: Applies `normalizePortableRecipe()` to assign canonical IDs, device metadata, and schema versioning.
- **Local Persistence Helper**: Uses `appendRecipeLocal(newRecipe)` (`lib/recipeStorage.ts`, lines 225–234), which runs under `storageMutex.run(...)`, reading existing recipes, prepending the new recipe, and writing back atomically.
- **Mutex Protection**: Fully protected by `storageMutex` (following the Issue #73 hardening pass).
- **Remote Synchronization**: Conditionally calls `api.recipes.upsert(normalizedPayload)` if authenticated (`userId` present), catching errors non-blockingly.
- **Failure Semantics**: Local write failure throws an error (`Local recipe commit failed: ...`), halting promotion and retaining the candidate in staging. Remote sync failure preserves local commit success. Candidate removal (`removeCandidate(candidateId)`) executes last; if removal throws, a warning alert informs the baker while preserving the committed recipe.
- **Tested Behavior**: Covered by `candidatePromotion.test.ts`.

---

## 3. Comparative Analysis of Guarantees

| Guarantee / Attribute | Write Path A (Ordinary Saves) | Write Path B (Candidate Promotion) |
| :--- | :--- | :--- |
| **Input Validation** | Minimal (`name.trim()` check). | Strict (`validateRecipeForCommit()` enforcing zero unassigned material). |
| **Data Normalization** | Relies on user input structure and basic phase sorting. | Rigorous normalization (`normalizePortableRecipe()`). |
| **Local Persistence** | `writeRecipesLocal()` (`storageMutex`-guarded). | `appendRecipeLocal()` (`storageMutex`-guarded). |
| **Concurrency Protection** | Mutex-protected (`storageMutex`). | Mutex-protected (`storageMutex`). |
| **Remote Sync** | `upsertRecipeRemote()` with sync status reporting. | `api.recipes.upsert()` with non-blocking error warning. |
| **Staging Cleanup** | N/A (not originating from candidate inbox). | `removeCandidate(candidateId)` with non-blocking warning fallback. |

---

## 4. Findings Ledger & Dispositions

| Finding | Description | Classification | Disposition |
| :--- | :--- | :--- | :--- |
| **Different Validation Rigor** | Ordinary saves allow unvalidated structure, whereas promotion enforces strict commit boundaries (`validateRecipeForCommit`). | **Intentional design** | **Retain**: Ordinary saves are for manual lab editing where flexibility is required; promotion is for external imports where strict schema guarantees are mandatory. |
| **Shared Persistence Mutex** | Both paths now utilize `storageMutex` (`writeRecipesLocal` and `appendRecipeLocal`). | **Intentional design** | **Retain**: Resolves the previous `storageMutex` bypass identified in Issue #73. |
| **Staging Cleanup Warning Handling** | Candidate removal failure preserves local recipe commit but warns the user. | **Intentional design** | **Retain**: Protects local-first durability without falsely signaling total failure when inbox cleanup encounters a storage issue. |
| **Documentation Drift in Atlas** | Earlier architecture documents did not fully document `appendRecipeLocal` or the nuanced error boundaries of promotion vs. ordinary saves. | **Documentation drift** | **Documentation correction**: Updated via implementation inventory and runtime data flow map. |

---

## 5. Explicit Unresolved Questions & Runtime Checks

1. **Orphaned Staging Records**: If candidate removal fails after a successful local commit, how frequently does this occur under low-storage device conditions, and should a background cleanup job sweep orphaned staged records? (Runtime-unverified).
2. **Concurrent Remote Upsert Collisions**: If an ordinary save and a candidate promotion execute concurrently against Supabase while offline-first sync flushes, how does Supabase handle upsert ordering? (Runtime-unverified).
