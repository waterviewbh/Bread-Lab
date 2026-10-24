# Architectural Assessment: Feed Session & History Ownership (Assessment 2 — Final Close-Out)

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural assessment.  
**Scope:** Evaluation of feed session ownership, active vs. completed persistence separation, `handleSavePeak()` failure semantics, Log hub management, reconciliation, and refresh mechanisms.

---

## 1. Feed Lifecycle & `handleSavePeak()` Execution Trace

Source tracing of `components/bench/ActiveFeedSection.tsx` (lines 235–285) establishes the exact order of operations during session completion:

1. **Local History Write**: 
   - Reads `HISTORY_KEY` (`sourdough_feed_history_v1`), parses existing history, prepends the `completed` session record (attaching `peak` data and `completedAt` timestamp), trims to 500 items, and writes back via `await AsyncStorage.setItem(HISTORY_KEY, ...)`.
   - *Failure behavior*: If local history write throws, execution halts. Active session removal and remote upsert do not run; active session remains staged in `sourdough_feed_session_v1`.
2. **Active Session Removal**:
   - If not in tutorial mode (`!starterTutorialMode`), removes the active session via `await AsyncStorage.removeItem(STORAGE_KEY)` (`sourdough_feed_session_v1`) and sets `setSession(null)`.
   - *Failure behavior (Unresolved Reliability Edge Case)*: If active-session removal throws an error after a successful local history write, execution halts before reaching remote session upsert. Consequently, local history is successfully saved, but the active session key (`STORAGE_KEY`) remains present locally and remote completion upsert (`inProgress: false`) is skipped.
3. **Remote Upsert (Non-Blocking for Local Success)**:
   - Invokes `api.history.feed.upsert()` with `inProgress: false` and the completed session payload.
   - *Failure behavior*: If remote upsert fails, `reportSyncFailure()` is triggered, but local history persistence and active session clearing are preserved (local-first durability).

---

## 2. Refined Finding Ledger & Error Handling Analysis

| Finding | Description & Source Evidence | Classification | Recommendation |
| :--- | :--- | :--- | :--- |
| **Separation of Active vs. Completed Storage** | `ActiveFeedSection.tsx` clearly partitions ongoing telemetry (`STORAGE_KEY`, `sourdough_feed_session_v1`) from completed history (`HISTORY_KEY`, `sourdough_feed_history_v1`). | **Intentional reuse** | Retain |
| **`loadHistory()` Local Read Failure** | `log.tsx` (lines 350–375) catches local AsyncStorage read failures with an empty catch block (`catch {}`). State remains initial empty arrays (`[]`), presenting an empty history state to the user without crashing. | **Bounded reliability concern** | No action (intentional local-first fallback). |
| **`loadHistory()` Remote Fetch Failure** | `log.tsx` (lines 376–495) catches remote Supabase API failures with an empty catch block (`catch {}`). If remote fetch fails, previously loaded local history data is retained and displayed. | **Intentional fallback behavior** | Retain (standard offline-first resilience). |
| **Active-Session Removal Failure in `handleSavePeak()`** | If `AsyncStorage.removeItem(STORAGE_KEY)` throws, local history is saved but active session key remains and remote completion is skipped. | **Unresolved architectural decision** | Documented for later prioritization. |

---

## 3. Cross-Hub Data-Flow Documentation Reference

- **Active Session**: `sourdough_feed_session_v1` (`STORAGE_KEY`) tracking ongoing telemetry in Bench.
- **Completed Feed History**: `sourdough_feed_history_v1` (`HISTORY_KEY`) appended by `handleSavePeak()` and read by Log History.
- **Cross-Hub Reference**: Detailed navigation handoffs and persistence boundaries are maintained in `artifacts/architecture/cross_hub_data_flow.md`.

---

## 4. Final Recommendation for Assessment 2
- **Recommendation**: **Documentation correction**. The underlying architecture correctly separates active execution from completed history and enforces local-first durability. The active-session-removal edge case is documented for later prioritization without requiring immediate code changes.
