# Project Knowledge Base

Welcome to the central documentation hub for Bread Lab. This directory serves as the long-term memory for the project's architecture, feature evolution, and agent instructions.

## 🤖 For AI Agents

> [!IMPORTANT]
> **Orientation & Map**:
> Use the concise **[🤖 AI Project Map](file:///E:/Bread-Lab/docs/ai_project_map.md)** (<150 lines) to quickly orient yourself to the repository layout and architecture. Do not scan or traverse the rest of the `docs/` folders upon session initialization.
>
> **Session Wrap-up Protocol**:
> Before ending a session, the AI agent must:
> 1. Update the [📔 Journal](file:///E:/Bread-Lab/docs/journal/) with a new session entry.
> 2. Create or update a [🎨 Walkthrough](file:///E:/Bread-Lab/docs/walkthroughs/) for any new features or UI changes.
> 3. Mark any completed [📜 Briefs](file:///E:/Bread-Lab/docs/briefs/) with a 'Completion Status' section and link to the walkthrough.
> 4. Update this [index.md](file:///E:/Bread-Lab/docs/index.md) to link to the new artifacts.

## 📂 Directory Structure

### [📜 Briefs](file:///E:/Bread-Lab/docs/briefs/)
**Purpose**: This is the "Inbox" for the agent. Place guides, custom instructions, task parameters, or feature specifications here that you want me to follow or use as a reference for future work.
- [Multi-Bake Support (2026-09-07)](file:///E:/Bread-Lab/docs/briefs/20260907%20concurrent%20runners.md)
- [Recipe Deck Specification: Index Tabs vs Stacked (2026-09-07)](file:///E:/Bread-Lab/docs/briefs/20260907%20recipe_deck_specification_index_tabs_vs_stacked.txt)
- [APK File Storage (2026-09-07)](file:///E:/Bread-Lab/docs/briefs/20260907%20apk%20file%20storage.txt)

### [📓 Journal](file:///E:/Bread-Lab/docs/journal/)
**Purpose**: A chronological record of work sessions, obstacles encountered, and high-level progress. Use this to get a sense of the project's recent trajectory.
#### 📦 Version 2.5.2
- [Session: Recipe Runner Navigation Fix (2026-09-25)](file:///E:/Bread-Lab/docs/journal/2026-09-25_recipe_runner_navigation_fix.artifact.md)
- [Session: Diagnostic Bake Finishing & Version Numbering Fixes (2026-09-25)](file:///E:/Bread-Lab/docs/journal/2026-09-25_diagnostic_bake_finishing_and_version_numbering.artifact.md)

#### 📦 Version 2.5.1
- [Session: PD-Informed State Estimator Refactoring & Validation Harness (2026-09-25)](file:///E:/Bread-Lab/docs/journal/2026-09-25_pd_informed_state_estimator_refactoring.artifact.md)
- [Session: Feed Planner Nudge & Calibration Refinements (2026-09-20)](file:///E:/Bread-Lab/docs/journal/2026-09-20_feed_planner_nudge_and_calibration_refinements.artifact.md)
- [Session: Self-Healing Active Bake Zombie Cleanups (2026-09-20)](file:///E:/Bread-Lab/docs/journal/2026-09-20_self_healing_zombie_bake_cleanups.artifact.md)
- [Session: Automatic Removal of Reviewed Bakes (2026-09-19)](file:///E:/Bread-Lab/docs/journal/2026-09-19_automatic_removal_of_reviewed_bakes.artifact.md)
- [Session: Isolated Bulk Estimators for Concurrent Bakes (2026-09-19)](file:///E:/Bread-Lab/docs/journal/2026-09-19_isolated_bulk_estimators.artifact.md)

#### 📦 Version 2.5.0
- [Session: EAS Version Sync Failure & SDK 36 Compatibility (2026-09-18 PM)](file:///E:/Bread-Lab/docs/journal/2026-09-18_eas_version_sync_failure.artifact.md)
- [Session: Code Audit & Resilience Reinforcement (2026-09-18)](file:///E:/Bread-Lab/docs/journal/2026-09-18_code_audit_and_resilience_reinforcement.artifact.md)
- [Session: Universal Data-Driven LaTeX Equation Parser Integration (2026-09-16)](file:///E:/Bread-Lab/docs/journal/2026-09-16_universal_latex_parser.artifact.md)
- [Session: Science Hub Restructuring & Scholarly Articles Integration (2026-09-15)](file:///E:/Bread-Lab/docs/journal/2026-09-15_science_hub_restructuring.artifact.md)
- [Session: Bulk Fermentation Engine Overhaul & Thermal Modeling (2026-09-15)](file:///E:/Bread-Lab/docs/journal/2026-09-15_bulk_fermentation_engine_overhaul.artifact.md)
#### 📦 Version 2.4.0
- [Session: Advanced Diagnostics & Iteration Workflow (2026-09-13)](file:///E:/Bread-Lab/docs/journal/2026-09-13_advanced_diagnostics_and_iteration_workflow.artifact.md)
- [Session: Canonical Phase Sorting & Builder Unification (2026-09-12)](file:///E:/Bread-Lab/docs/journal/2026-09-12_canonical_phase_sorting.artifact.md)
- [Session: Diagnostic Notes Integration (2026-09-12)](file:///E:/Bread-Lab/docs/journal/2026-09-12_diagnostic_notes_integration.artifact.md)
- [Session: Android Build Stabilization (2026-09-11)](file:///E:/Bread-Lab/docs/journal/2026-09-11_aab_build_stabilization.artifact.md)
- [Session: Maestro Testing Stabilization (2026-09-10)](file:///E:/Bread-Lab/docs/journal/2026-09-10_maestro_testing_stabilization.artifact.md)
- [Session: Automated Testing Protocol (2026-09-08)](file:///E:/Bread-Lab/docs/journal/2026-09-08_automated_testing_protocol.artifact.md)
- [Session: Concurrent Active Bakes (2026-09-07 PM)](file:///E:/Bread-Lab/docs/journal/2026-09-07_concurrent_active_bakes.artifact.md)
- [Session: Recipe Deck Navigation (2026-09-07)](file:///E:/Bread-Lab/docs/journal/2026-09-07_recipe_deck_navigation.artifact.md)
- [Session: Drive Migration & Docs Organization (2026-09-06)](file:///E:/Bread-Lab/docs/journal/2026-09-06_migration_and_organization.artifact.md)

### [🏗️ Architectural](file:///E:/Bread-Lab/docs/architectural/)
**Purpose**: High-level design documents and approved implementation plans for major system changes.
- [Android Migration Plan](file:///E:/Bread-Lab/docs/architectural/android_migration_plan.artifact.md)
- [Build and Environment Refinement](file:///E:/Bread-Lab/docs/architectural/android_build_and_env_refinement.artifact.md)
- [Expo Bundling and Dev Client Fix](file:///E:/Bread-Lab/docs/architectural/expo_bundling_and_dev_client_fix.artifact.md)

### [🔍 Research & Status](file:///E:/Bread-Lab/docs/research/)
**Purpose**: Findings from investigations, current status of ongoing initiatives, and lessons learned.
- [Maestro Testing: Status and Lessons Learned](file:///E:/Bread-Lab/docs/research/maestro_testing_status.artifact.md) [OPEN ITEM]

### [🐞 Bug Tracker](file:///E:/Bread-Lab/docs/bug_tracker.md)
**Purpose**: A central log for intermittent build issues, known native flakiness, and items to watch.
- [C/C++ Configuration Timeout (Windows)](file:///E:/Bread-Lab/docs/bug_tracker.md#1-cc-configuration-timeout-windows) [WATCHLIST]
- [Active Issues & Watchlist](file:///E:/Bread-Lab/docs/bug_tracker.md)



### [🎨 Walkthroughs](file:///E:/Bread-Lab/docs/walkthroughs/)
**Purpose**: Demonstrations and summaries of completed features, including UI screenshots and technical breakdowns.
- [Recipe Runner Navigation Fix (2026-09-25)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-25_recipe_runner_navigation_fix.artifact.md)
- [Diagnostic Bake Finishing & Version Numbering (2026-09-25)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-25_diagnostic_bake_finishing_and_version_numbering.artifact.md)
- [PD-Informed State Estimator & Validation Harness (2026-09-25)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-25_pd_informed_state_estimator_refactoring.artifact.md)
- [Feed Planner Nudge & Calibration Refinements (2026-09-20)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-20_feed_planner_nudge_and_calibration_refinements.artifact.md)
- [Self-Healing Active Bake Zombie Cleanups (2026-09-20)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-20_self_healing_zombie_bake_cleanups.artifact.md)
- [Automatic Removal of Reviewed Bakes (2026-09-19)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-19_automatic_removal_of_reviewed_bakes.artifact.md)
- [Isolated Bulk Estimators for Concurrent Bakes (2026-09-19)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-19_isolated_bulk_estimators.artifact.md)
- [Android SDK 36 Device Compatibility & Versioning (2026-09-18 PM)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-18_android_sdk_36_device_compatibility.artifact.md)
- [Code Audit & Resilience Reinforcement (2026-09-18)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-18_code_audit_and_resilience_reinforcement.artifact.md)
- [Universal Data-Driven LaTeX Equation Parser (2026-09-16)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-16_universal_latex_parser.artifact.md)
- [Science Hub Restructuring & Scholarly Articles Integration (2026-09-15)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-15_science_hub_restructuring.artifact.md)
- [Advanced Diagnostics & Iteration Workflow (2026-09-13)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-13_advanced_diagnostics_and_iteration_workflow.artifact.md)
- [Diagnostic Notes Integration (2026-09-12)](file:///E:/Bread-Lab/docs/walkthroughs/diagnostic_notes_integration.artifact.md)
- [Android Build Stabilization (2026-09-11)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-11_aab_build_stabilization.artifact.md)
- [Diagnostic Stability & PDF Naming Improvements](file:///E:/Bread-Lab/docs/walkthroughs/diagnostic_stability.artifact.md)
- [Concurrent Active Bakes (2026-09-07)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-07_concurrent_active_bakes.artifact.md)
- [Recipe Deck Navigation & Label Refinement (2026-09-07)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-07_recipe_deck_navigation.artifact.md)
- [Android Migration & Play Store Compliance](file:///E:/Bread-Lab/docs/walkthroughs/android_migration.artifact.md)
- [Expo Bundling and Dev Client Fix](file:///E:/Bread-Lab/docs/walkthroughs/expo_bundling_and_dev_client_fix.artifact.md)
- [Universal JSON Card Architecture v1.2.0](file:///E:/Bread-Lab/docs/walkthroughs/Universal%20JSON%20Card%201.2.0%20Walkthrough.artifact.md)

---

> [!TIP]
> **Agent Workflow**: When starting a new complex task, I will look in `docs/briefs/` for any specific guidance you've provided before creating an implementation plan in `docs/architectural/`.
