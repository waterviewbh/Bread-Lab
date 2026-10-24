# Architectural Assessment: Hub Refresh, Synchronization, and Route Boundaries (Assessment 4)

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural assessment.  
**Scope:** Evaluation of focus-triggered refreshes (`useFocusEffect`), synchronization vs. local persistence, concurrent mutation handling, failure behavior, and route boundaries across Lab, Bench, and Log in Bread Lab (`artifacts/sourdough/`).

---

## 1. Focus-Triggered Refreshes Analysis

Expo Router `useFocusEffect` hooks are utilized across active hub screens to trigger asynchronous data loading whenever a screen gains focus:

- **Lab Hub (`components/lab/labHub.tsx`, lines 185–190)**:
  - **Trigger**: Screen focus via `useFocusEffect(useCallback(() => { loadData(); }, [loadData]))`.
  - **Data Reloaded**: Feeds feed history (`HISTORY_KEY`), bake history (`BAKE_HISTORY_KEY`), and recipe storage (`loadRecipeData()` reading `RECIPES_KEY` and Supabase recipes), along with reloading staged candidates (`reloadCandidates()`).
  - **Left Untouched**: Component-local transient UI states (such as active tab filter chips, letter filters, or uncommitted modal inputs).
- **Bench Hub / Active Bake Section (`components/bench/ActiveBakeSection.tsx`, lines 145–150)**:
  - **Trigger**: Screen focus via `useFocusEffect(useCallback(() => { load(); }, [load]))`.
  - **Data Reloaded**: Recipes (`RECIPES_KEY`) and active bakes (`BAKE_KEY`) via `loadData()`, updating active bake state and timer references.
  - **Left Untouched**: Transient expanded card collapse/expansion sets (`expandedDone`, `expandedRecipeInfo`) and draft note text before state hydration.
- **Log Hub / History Section (`components/log/log.tsx`, lines 365–375)**:
  - **Trigger**: Screen focus via `useFocusEffect(useCallback(() => { loadHistory(); getStoredUser()...; getDeviceId()...; }, [loadHistory]))`.
  - **Data Reloaded**: Feed session history (`HISTORY_KEY`), bake history (`BAKE_HISTORY_KEY`), current user identity, and local device ID.
  - **Left Untouched**: Selected calendar day filter (`selectedDay`), feed filter chips (`feedFilter`), and active modal detail views (`selectedFeedDetail`, `selectedBakeDetail`).

---

## 2. Refresh vs. Synchronization Boundaries

- **Local Storage Reads**: All focus reloads initiate with local AsyncStorage reads (`AsyncStorage.getItem(...)`).
- **Remote Synchronization Integration**: In Log (`log.tsx`, lines 376–495) and Lab (`lib/recipeStorage.ts`), focus reloads also trigger asynchronous remote fetches (`api.history.feed.list`, `api.history.bakes.list`, `api.recipes.list`), reconciling local storage with remote payloads while honoring deletion tombstones (`DELETED_FEED_IDS_KEY`, `DELETED_BAKE_IDS_KEY`, `DELETED_RECIPE_IDS_KEY`).
- **Classification**: **Source-Confirmed** for local reloads and hybrid remote reconciliation; **Runtime-Unverified** regarding network latency impact during rapid tab transitions.

---

## 3. Concurrent Mutation & Race Condition Evaluation

- **Code Paths**: If a baker performs an asynchronous mutation (e.g., saving a recipe or logging a feed reading) while a `useFocusEffect` reload is actively awaiting AsyncStorage or Supabase responses, race conditions can theoretically occur if an older async read resolves *after* a newer local mutation commits.
- **Evidence**: Mutex locks (`storageMutex` in `lib/storageUtils.ts`) protect low-level AsyncStorage writes (`writeRecipesLocal`, `appendRecipeLocal`, tombstone updates), but React component state setters (`setRecipes`, `setBakes`, `setHistory`) do not implement optimistic locking or request sequencing.
- **Classification**: **Plausible but unproven risk** (relies on single-threaded JavaScript execution and asynchronous promise queue ordering).

---

## 4. Failure Behavior & Offline Resilience

- **Local Read Failures**: Wrapped in `try/catch` blocks (e.g., `log.tsx`, `recipeStorage.ts`), returning empty arrays or graceful fallbacks rather than throwing runtime crashes.
- **Remote Request Failures**: Caught silently or via `.catch()` handlers (`reportSyncFailure()`), allowing the app to continue functioning fully offline using local AsyncStorage caches.
- **Classification**: **Source-Confirmed** intentional offline-first resilience.

---

## 5. Route Boundaries & Legacy Route Audit

- **Active Hub Navigation (`app/(tabs)/_layout.tsx`, lines 100–120)**:
  - Configures bottom tab navigation for `lab` (`lab.tsx`), `bench` (`index.tsx` / `bench.tsx`), and `log` (`log.tsx`).
- **Hidden Legacy Routes (`app/(tabs)/recipe.tsx`, `history.tsx`, `graph.tsx`, `about.tsx`)**:
  - Configured with `options={{ href: null }}` in `_layout.tsx` (lines 180–190).
  - **Reachability Analysis**: While hidden from the bottom tab bar UI, these route files remain part of the Expo Router file-based routing tree. They can be reached directly via deep links (`router.push('/recipe')` or URL schemes) or if other components programmatically push to their pathnames. They are **not** dead code in terms of bundle inclusion or deep-linkability.
- **Classification**: **Source-Confirmed**.

---

## 6. Findings Ledger

| Finding / Area | Classification | Source Evidence & Reference |
| :--- | :--- | :--- |
| **Focus-Triggered Hub Reloads** | **Source-Confirmed** | `labHub.tsx` (line 188), `ActiveBakeSection.tsx` (line 146), `log.tsx` (line 367) execute `useFocusEffect` reloads. |
| **Hybrid Local & Remote Reconciliation on Focus** | **Source-Confirmed** | `log.tsx` (`loadHistory()`, lines 376–495) and `recipeStorage.ts` (`loadAll()`, lines 70–130) fetch remote data upon focus. |
| **Concurrent Mutation Race Conditions** | **Plausible but unproven** | React component state updates lack request sequencing during concurrent `useFocusEffect` reloads and user mutations. |
| **Local-First Offline Resilience** | **Source-Confirmed** | `try/catch` fallback blocks and `storageMutex` locking in `lib/storageUtils.ts` and `log.tsx`. |
| **Hidden Legacy Route Reachability** | **Source-Confirmed** | `app/(tabs)/_layout.tsx` (lines 180–190) hides legacy routes (`recipe.tsx`, `history.tsx`, `graph.tsx`) via `href: null`, remaining deep-linkable. |

---

## 7. Deliverable Summary & Recommendations
- **Assessment Status**: Completed successfully with all six assessment areas addressed and cited with exact repository-relative paths and line numbers.
- **Recommendation**: **No action / documentation recording**. The architectural patterns follow deliberate local-first offline designs. Hidden routes remain accessible via deep-linking intentionally for migration and compatibility.
