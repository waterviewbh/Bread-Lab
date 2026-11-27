# Bake Completion and History Lifecycle — Version 2.6.1

## Problem
A finished bake did not become a durable History record when its final phase ended. It could appear in History only through a display workaround, and Diagnostic Review could perform the actual archival transition. This made review a prerequisite in practice and allowed a review to change the bake's History date.

## Root Cause
The final-phase handler previously marked the bake complete without archiving it. History merged completed active-bake records into its display, masking the missing archive. Diagnostic outcome persistence could then move an active record into History and replace its remote `savedAt`. Diagnostic candidate loading also admitted active bakes, allowing review before archival.

## Change
Across the v2.6.1 epsilon-1 through epsilon-3 work, final-phase completion now sets `completedAt`, writes the completed bake locally, archives it under the current owner's History key, and removes the active record only after the local History write succeeds. The archive helper reuses the existing History record on retry, preserving its ID and original `savedAt`; it attempts remote synchronization after local archival. Ordinary phase completion keeps the bake active, and reset or abandonment does not archive it.

History and Diagnostic candidate loading now use archived History records rather than promoting active bakes. Diagnostic review updates an existing archived outcome and rejects a bake absent from History. It preserves `completedAt` (the actual finish time) and `savedAt` (the original archival time), including on remote review updates. History dates use `completedAt`, falling back to `savedAt` for legacy records that lack it. No database schema change was made.

The epsilon-3 Jest additions exercise the final-phase handler with seeded History records A and B and active bake C, then check C's archival, A and B's preservation, Diagnostic selection and review, and timestamp stability. Other focused tests cover earlier-phase completion, abandonment, retry and failure paths, and History loading. This journal entry records that coverage without claiming those suites were rerun during the Maestro verification.

For the isolated Android smoke test, updated `maestro/flows/bake_history_archive_smoke.yaml` to select the operator's seeded `NLA-Loaf-002` instead of the flow's original placeholder name. No production code or Jest tests changed during that smoke-test step.

## Verification
The operator confirmed that emulator-5554 used isolated test data and separately confirmed the Bench → Recipe Runner starting screen. A pre-run screenshot of `com.waterviewbakehouse.breadlab/.MainActivity` showed `NLA-Loaf-002`, two of three phases complete, the final Baking phase started, and `Complete Phase` visible. `maestro --version` returned `2.10.0`. From `E:\Bread-Lab`, `maestro test maestro/flows/bake_history_archive_smoke.yaml` exited 0: it completed the final phase, opened Log, and found `NLA-Loaf-002`. A post-run screenshot showed Log → History with that loaf listed at 7:08 PM on November 26, 2026.

The Maestro run proves the visible completion-to-History path on isolated Android data. It does not inspect AsyncStorage or Supabase, establish remote sync success, or prove the absence of duplicate persisted rows. The Jest files provide focused automated coverage for those contracts, but no Jest or TypeScript command was run during this final smoke-test step.
