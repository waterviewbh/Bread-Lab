# Project Knowledge Base

Welcome to the central documentation hub for Bread Lab. This directory serves as the long-term memory for the project's architecture, feature evolution, and agent instructions.

## 🤖 For AI Agents

> [!IMPORTANT]
> **Discovery Protocol**:
> 1. Always check [📔 Journal](file:///E:/Bread-Lab/docs/journal/) to see what was accomplished in the most recent session.
> 2. Consult [📜 Briefs](file:///E:/Bread-Lab/docs/briefs/) for specific instructions or constraints provided by the user.
> 3. Verify existing [🏗️ Architectural](file:///E:/Bread-Lab/docs/architectural/) plans before proposing major changes.
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

### [🎨 Walkthroughs](file:///E:/Bread-Lab/docs/walkthroughs/)
**Purpose**: Demonstrations and summaries of completed features, including UI screenshots and technical breakdowns.
- [Diagnostic Stability & PDF Naming Improvements](file:///E:/Bread-Lab/docs/walkthroughs/diagnostic_stability.artifact.md)
- [Concurrent Active Bakes (2026-09-07)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-07_concurrent_active_bakes.artifact.md)
- [Recipe Deck Navigation & Label Refinement (2026-09-07)](file:///E:/Bread-Lab/docs/walkthroughs/2026-09-07_recipe_deck_navigation.artifact.md)
- [Android Migration & Play Store Compliance](file:///E:/Bread-Lab/docs/walkthroughs/android_migration.artifact.md)
- [Expo Bundling and Dev Client Fix](file:///E:/Bread-Lab/docs/walkthroughs/expo_bundling_and_dev_client_fix.artifact.md)
- [Universal JSON Card Architecture v1.2.0](file:///E:/Bread-Lab/docs/walkthroughs/Universal%20JSON%20Card%201.2.0%20Walkthrough.artifact.md)

---

> [!TIP]
> **Agent Workflow**: When starting a new complex task, I will look in `docs/briefs/` for any specific guidance you've provided before creating an implementation plan in `docs/architectural/`.
