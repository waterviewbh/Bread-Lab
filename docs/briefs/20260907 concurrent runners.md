# Feature Request: Multi-Bake Support in Recipe Runner

## Context & User Need
Bakers frequently plan starter refreshes to yield enough peak starter for multiple distinct bakes simultaneously (e.g., preparing two different loaf types in parallel). Currently, the **Recipe Runner** only supports a single active bake at a time, forcing users to rely on paper prints for concurrent bakes.

To solve this, we are implementing a **Horizontal Tabbed Bakes Bar** pattern on the **Recipe Runner** screen.

---

## 1. UI Structural Changes

### A. Bake Selector Tab Bar (Top Section)
* **Position:** Placed directly below the main sub-header (`Feed Tracker` | `Recipe Runner`).
* **Components:**
  * Horizontal scrollable pill/tab container.
  * Active Bake Tabs displaying:
    * **Bake Name / Title** (e.g., *Country Sourdough*, *Jalapeño Cheddar*) — *Note: Replace generic labels like "Open Bake #2" with actual recipe names.*
    * **Status / Active Phase Badge** (e.g., *Bulk Fermenting*, *Phase 3/9*).
  * **`+ New Bake`** persistent action tab at the end of the scroll container to initiate concurrent bakes.

### B. Inactive Tab State (Live Glanceability)
* When a bake tab is inactive, it should display a compact progress indicator or active timer summary (e.g., `Bake #2 • S&F 2/4 (04:12)`).
* Allows the baker to monitor overlapping steps across both breads without fully switching views.

---

## 2. Updated Screen Hierarchy

1. **Top Navigation:**
   * Segmented Control: `Feed Tracker` | `Recipe Runner`
2. **Active Bakes Bar (New):**
   * `[ 🟢 Country White • Bulk ]` `[ Jalapeño Cheddar • Fold 2 ]` `[ + New Bake ]`
3. **Active Bake Utility Bar:**
   * Recipe Name, Status (`Bake complete` / `In Progress`), Scale Selector (`0.5x`, `1x`, `2x`), Action Icons (`Share`, `Print`).
4. **Phase Steps List (Current Core View):**
   * Phase progress bar (e.g., `9/9 PHASES`).
   * Vertical list of expandable phase cards with time stamps/durations.

---

## 3. Design Guidelines & Micro-Interactions

* **Visual Polish:** Match existing warm beige/brown earth-tone aesthetic (`#5C4033` / warm neutral fills).
* **Active vs. Inactive Tabs:** 
  * Active Tab: High contrast fill (dark brown text/border or filled pill), elevated.
  * Inactive Tab: Subtle muted background with secondary text for quick timer reads.
* **Notification / Alert Overlay:** If a timer alerts on an inactive bake, highlight that tab with a soft accent pulse/badge so the user knows an action is required on the other loaf.

---

## Completion Status
**Implemented**: 2026-09-07
- [x] Horizontal Tabbed Bakes Bar
- [x] Inactive Tab Live Glanceability
- [x] Persistence & Auto-migration
- [x] Bench Hub Integration

See the [Walkthrough](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-07_concurrent_active_bakes.artifact.md) for full details.
