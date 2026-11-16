# Bug Tracker & Known Issues

This file is Bread Lab's central tracker for confirmed defects, unresolved test failures, intermittent build issues, native flakiness, and items to watch.

## Triage Dashboard

| ID | Finding | Status | Next step |
| --- | --- | --- | --- |
| BT-001 | NLA transition test authorization failures | Test setup fixed; production impact unverified | Continue the remaining Issue 1A acceptance verification |
| BT-002 | Operational cleanup validation test failures | Cleanup preflight corrected; focused tests pass | Keep cleanup validation bound to the legacy keys it mutates; retain transition regression coverage |
| BT-003 | Account feed charts remain visible in NLA Analytics | Focused tests pass; initial device retest supports fix | Verify charts remain empty after refocus or fresh NLA launch |
| BT-004 | NLA Proceed Without Importing crashed during identification | Code and device retest passed | Continue remaining Issue 1A acceptance checks; track workspace-change test failures separately |
| BT-005 | Offline sign-in failure suggests incorrect credentials | Code and baker-run device retest passed | Decide whether expected offline failures should trigger Expo error overlays |
| BT-006 | NLA workspace change after choice escaped the coordinator snapshot check | Code fixed; focused tests pass | Verify interrupted import/recovery behavior on device when practical |
| BT-007 | Unstarted bake blocks sign-out until remote deletion | Fresh unstarted-bake path fixed; automated and device retest passed | Handle legacy remote rows and lifecycle labels under Issue #94 |
| BT-008 | Coordinator permits direct account-to-account transition | Code fixed; focused tests pass | Verify account switching on device through A → NLA → B |
| BT-009 | Account Feed History preflight inspected a scoped key while production writes the global key | Preflight fixed; coordinator tests pass | Reconcile the #90 key model and migration accounting; verify on device |
| BT-010 | Unfinished Bake and Feed could cross or be lost at identity transition | Coordinated source fix; focused tests pass | Verify on device and deployed Supabase; retain Issue #24 parent work |

### BT-001 NLA transition test authorization failures

- **First observed**: 2026-11-13
- **Initial evidence**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaImport.test.ts lib/__tests__/nlaTransition.test.ts components/__tests__/AuthModal.nla.test.tsx` produced 12 failed and 57 passed tests; the two other suites passed.
- **Confirmed cause**: The failing discard cases supplied plans from `buildPurgePlan` without calling `authorizeDiscardPlan`, so the coordinator correctly rejected them before reaching the assertions under test.
- **Change**: Updated the transition test helper and direct discard cases to authorize the explicit discard choice. Existing forged-plan rejection coverage in `transitionCoordinator.test.ts` remains unchanged.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaTransition.test.ts` — 1 suite passed, 22 tests passed.
- **Manual Issue 1A test 5 (2026-11-14)**: In NLA, the baker created one-phase recipe NLA-003, started an account transition, chose Cancel Transition, swiped the app away, and let Metro rebundle. NLA-003 remained in the offline workspace afterward. This supports cancellation preserving NLA recipe data across restart. No independent credential or storage snapshot was captured during this test.
- **Manual Issue 1A test 6 (2026-11-14)**: With NLA-003 present, the baker reached the Import choice while online, disabled the network, and chose Import & Proceed. Account sign-in failed with `Network request failed`; the UI reported that the account session was closed and the baker remained in NLA. After reconnecting and leaving the sign-in screen, NLA-003 was present; it also persisted after the app was swiped away and Metro rebundled. No recovery prompt appeared after reconnecting. This confirms visible NLA recipe preservation across the failed attempt and restart; remote session absence and exact storage bytes were not independently inspected.
- **Manual Issue 1A test 7 (2026-11-14)**: With NLA recipe NLA-004 and an active Feed, the baker opened the Import choice while online, disabled the network, and chose Import & Proceed. The dialog said the account could not be reached and reported return to the offline workspace. After backing out, both the recipe and active Feed were visible. After reconnecting and reloading through Metro, both remained visible. Expo displayed network and coordinator error overlays. This supports data preservation across failed sign-in and reload; no independent remote-session or exact storage snapshot was captured.
- **Assessment**: The test-fixture failures are resolved. The observed Cancel and failed Import paths preserved NLA recipes; test 7 also preserved an active Feed. This does not establish that all Issue 1A production acceptance criteria are met; those remain subject to their own verification.

### BT-002 Operational cleanup validation test failures

- **First observed**: 2026-11-13
- **Root cause**: `clearOperationalData()` mutated legacy global operational keys, while its pre-validation read owner-scoped keys for collections and active bakes. Malformed data on the keys actually being cleaned could therefore evade preflight.
- **Contract**: Cleanup rejects malformed, unreadable, pending-deletion, and unknown-owner state before mutation. Foreign-owned records are retained; they are not purged as another workspace's data. The NLA transition path remains separately authorized to discard device-local active Feed work.
- **Change**: Added a cleanup-only validation option so preflight reads the same legacy keys that cleanup mutates. Collection and active-record ownership checks allow foreign-owned records in this cleanup mode so they can be retained safely; missing ownership and malformed values still reject. Updated tests to cover the protective outcomes and exact zero-mutation behavior.
- **Verification**:
  - `pnpm.cmd exec jest --runInBand --silent lib/__tests__/bulletproofImport.test.ts` — 1 suite passed, 58 tests passed.
  - `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaTransition.test.ts lib/__tests__/activeFeedTransition.test.ts lib/__tests__/transitionCoordinator.test.ts` — 3 suites passed, 65 tests passed.
- **Assessment**: BT-002's focused cleanup validation and the tested transition paths pass. Broader Issue #24 acceptance and runtime/device verification remain open.

### BT-003 Account feed charts remain visible in NLA Analytics

- **First observed**: 2026-11-14, during manual Issue 1A transition tests.
- **Observed behavior**: After testing sign-in with two accounts and sign-out to NLA, Vitality Analytics displayed completed feed charts even though the sign-in inventory had reported no offline records. The baker subsequently reported that the charts were gone and recalled that they appeared after authenticating one of the tested accounts. The exact action that cleared them was not established.
- **Confirmed source defect**: `components/lab/labHub.tsx` keeps feed history in React state. `loadData()` calls `setHistory` only when `sourdough_feed_history_v1` has a truthy stored value, so an absent key leaves the previous history visible. The same conditional pattern affects bake history. LabHub does not subscribe to the existing workspace-change notification, and its asynchronous loads do not check workspace identity/generation before publishing results.
- **Assessment**: Stale account state is a supported explanation for the observed charts. The screenshot and later disappearance do not prove that account feeds were persisted in NLA, missed by import, or left behind by sign-out. No storage snapshot was captured; persisted ownership leakage remains unverified.
- **Required behavior**: On account-to-NLA or other workspace changes, charts must immediately stop displaying the departing workspace's records. Missing history must produce empty state. Results from loads started in an earlier workspace must not populate the current workspace. Preserve legitimate NLA history and account-owned storage.
- **Change**: LabHub now clears feed and bake history, recipes, and candidates on workspace notification, then reloads after the transition mutex is released. History loads publish only if the captured workspace identity and request are still current. Missing history keys produce empty arrays.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent components/lab/__tests__/labHub.workspace.test.tsx` — 1 suite, 2 tests passed. The tests keep LabHub mounted through the production account-to-NLA coordinator path, check an empty NLA chart, reject a delayed account read, and load genuine NLA history.
- **Manual device retest (2026-11-14)**: After manually deleting a separate unstarted bake record in Supabase, the baker could sign out. In the resulting NLA workspace, account-associated feed analytics did not appear. This supports the account-to-NLA chart clearing fix. The report does not establish whether LabHub stayed mounted during sign-out, whether charts remained empty after refocus or fresh launch, or whether storage contained any account feed records.
- **Next verification**: Confirm charts remain empty after LabHub refocus or a fresh NLA launch. Investigate persisted data only if account records survive a fresh app launch in NLA.
- **Status**: Focused automated tests pass and the initial device retest supports the fix; the refocus/fresh-launch check remains. The earlier screenshot does not prove persisted ownership leakage or a failed transition.

### BT-004 NLA Proceed Without Importing crashed during identification

- **First observed**: 2026-11-14, manual Issue 1A test 4 with an active NLA Feed. Cancel preserved the Feed. Choosing Proceed Without Importing later failed with `Cannot read property 'trim' of undefined`; coordinator recovery closed the session and returned to IDLE.
- **Confirmed cause**: `AuthModal` passed `handleChoiceProceedWithoutImport` directly to `Pressable.onPress` after that handler gained optional pending-data and inventory parameters. React Native supplied the press event as the first argument, overriding the stored identification data. `api.auth.identify` then received an undefined first name.
- **Change**: The button invokes the handler through a zero-argument callback. The active-work explanation now names the Feed or Bake counted in the captured NLA inventory.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent components/__tests__/AuthModal.nla.test.tsx` — 1 suite, 11 tests passed, including a Proceed Without Importing press with an explicit event payload. After a Metro reload, the baker confirmed the active NLA Feed survived Cancel; Proceed Without Importing signed into Luke's account with the coordinator returning to IDLE. No active Feed appeared in that account. Subsequent sign-out returned to NLA with no active Feed. The console showed no Feed upsert during account sign-out. This verifies the observed device flow, though no independent storage or Supabase snapshot was taken. Existing `AuthModal.workspaceChanged.test.tsx` failures remain separately unresolved.
- **Status**: Code and manual device retest passed for the reported flow; Issue 1A remains open.

### BT-005 Offline sign-in failure suggests incorrect credentials

- **First observed**: 2026-11-14, manual Issue 1A test 6.
- **Observed behavior**: An intentionally disconnected Import attempt displayed `Account sign-in failed: Network request failed` followed by advice to check names or create a new account. Expo showed network and coordinator failure overlays. The transition reported session cleanup, and NLA-003 remained visible after restart.
- **Confirmed source cause**: `lib/api.ts` uses the last sign-in error message and always appends credential and registration advice when `isSignUp` is false. It does not distinguish transport failure from rejected credentials.
- **Required behavior**: Report connection failures as such and offer a retry after reconnecting. Credential advice should appear only for an actual credential rejection. Preserve the transition's fail-closed handling and NLA data.
- **Change**: `api.auth.identify` now stops at the first returned or thrown connection failure and reports a connection/retry message. It does not retry alternate passwords or attempt signup while offline. Name and registration advice is limited to invalid-credential responses; other errors retain their own cause without credential advice.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/authError.test.ts components/__tests__/AuthModal.nla.test.tsx components/__tests__/AuthModal.incompleteRecovery.test.tsx` — 3 suites, 49 tests passed. Returned and thrown network failures, both account modes, no implicit signup, credential rejection, and NLA recovery paths are covered. The combined Issue #24 transition command (the three listed suites plus `transitionCoordinator`, `activeFeedTransition`, `nlaTransition`, `nlaImport`, `AuthModal.workspaceChanged`, `AuthModal.outgoingIdentity`, `ActiveFeedSection.workspace`, and `labHub.workspace`) passed 11 suites and 200 tests. One Active Feed integration case initially exceeded Jest's default five-second limit in the combined run; it passed alone and after its timeout was set to 15 seconds (the full run took 8.039 seconds for that suite). `pnpm.cmd exec tsc --noEmit --pretty false` still reports 172 project diagnostics, the same count as before this change. In manual test 7, the offline dialog gave connection/retry advice without credential advice, and NLA-004 plus the active Feed remained after reconnect and Metro reload. Expo still displayed network and coordinator error overlays; their effect on a production build has not been checked.
- **Status**: Code and baker-run device retest passed for the message and visible NLA data preservation; dev error overlays remain to assess.

### BT-006 NLA workspace change after choice escaped the coordinator snapshot check

- **First observed**: 2026-11-14, while resolving `AuthModal.workspaceChanged.test.tsx` failures under Issue 1A.
- **Root cause**: The coordinator compared the prepared disposition's saved snapshot with the choice's saved snapshot but did not reread the current NLA keys after destination authentication/import preparation. A record added during that interval could pass the saved-snapshot comparison before cleanup.
- **Contract**: Any NLA change after the choice and before cleanup must prevent credential activation and preserve the changed workspace. Recovery must confirm remote session closure before declaring IDLE.
- **Change**: Recheck the live NLA keys against the authorized snapshot after `prepareIncoming()` and before tombstone retirement, purge, restore, or credential activation. Corrected the incomplete-recovery test fixture to return an active session on independent lookup after a failed sign-out request; a rejected request followed by a verified null session is successful recovery.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent components/__tests__/AuthModal.workspaceChanged.test.tsx lib/__tests__/transitionCoordinator.test.ts components/__tests__/AuthModal.nla.test.tsx` — 3 suites, 41 tests passed. `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaImport.test.ts lib/__tests__/nlaTransition.test.ts` — 2 suites, 58 tests passed. These include before-choice, during-authentication, during-upload, retry, and recovery cases. Device interruption during upload was not reproduced.
- **Status**: Code fixed and focused tests pass; broader Issue 1A acceptance remains open.

### BT-007 Unstarted bake blocks sign-out until remote deletion

- **First observed**: 2026-11-14, during Issue 1A device testing.
- **Observed behavior**: The baker reported that a bake which had been opened in Recipe Runner but had no phase started prevented account sign-out. Sign-out succeeded only after the baker manually deleted that bake record in Supabase. An earlier sign-out attempt reported missing or unknown ownership metadata on an active bake record. It is not yet confirmed that both observations concern the same record or cause.
- **Contract used for this fix**: The baker's Issue #94 lifecycle definition says opening Recipe Runner does not start a bake; a phase must start first. The broader status and completion lifecycle remains Issue #94 work.
- **Confirmed code path**: Both runners created a bake with no phase started and immediately called `upsertBakeRemote`. Reset removed the local copy, while `loadAll` could fetch the stale remote `in_progress` row and restore it. The API row mapper omitted `userId`; the restored local row therefore lacked the ownership metadata required by sign-out preflight. This explains the observed refusal and reset resurrection at code level; the exact historical Supabase row was not inspected in this assignment.
- **Change**: `upsertBakeRemote` now leaves an unstarted bake local. `loadAll` restores only a phase-started remote bake with an explicit matching account owner, and stamps that owner into local storage. The API mapper now carries the remote owner and timestamps. Unknown or foreign ownership is never inferred from the current session.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/ownerScopedStorage.test.ts lib/__tests__/apiOwnership.test.ts lib/__tests__/bakeLifecycle.test.ts` — 3 suites, 42 tests passed. Tests cover no upload before a phase starts, no resurrection after local reset, owner-preserving restore, foreign-owner refusal, and API mapping. `pnpm.cmd exec tsc --noEmit --pretty false` still reports 172 existing diagnostics; no new diagnostic was introduced by this change. Baker device retest (2026-11-14): added an unstarted Recipe Runner bake, reset it, reloaded via Metro, and signed out. Logs show authenticated readiness passed, reconciliation of six recipes and two completed bakes with no failures, successful quarantine, verified credential removal, and transition to NLA/IDLE. No failed sign-out was reported in this retest.
- **Additional baker observation**: Recipe Runner remained empty after the Metro reload, and the baker saw no Supabase row for the newly created unstarted bake. This is device/UI and Supabase-console evidence for the fresh-bake path, not a database query or proof about older rows.
- **Remaining limits**: Legacy unstarted rows may remain in Supabase and can still be returned by the active endpoint; this change ignores them locally. The runner's local `startedAt` and `status` labels still precede the first phase and need Issue #94 lifecycle work.
- **Status**: Fresh unstarted-bake path fixed; automated and baker-run device retest passed. Legacy-row cleanup and lifecycle labels remain Issue #94 work.

### BT-008 Coordinator permits direct account-to-account transition

- **First observed**: 2026-11-14, while aligning Issue #24 active Feed tests with the explicit NLA choice.
- **Contract**: The Issue 1A handoff states that account changes pass through NLA; there is no direct A-to-B transition.
- **Source evidence**: `executeWorkspaceTransition` rejects unauthenticated NLA-to-account calls without a choice but has no corresponding refusal for authenticated A-to-B input. Production `AuthModal` calls the coordinator for account-to-NLA sign-out and deferred NLA-to-account sign-in; no production direct A-to-B caller was found in the focused call-site search. Several tests still invoke A-to-B directly to exercise isolation.
- **Root cause**: The coordinator checked the NLA-to-account choice but did not reject a call with both an authenticated outgoing owner and authenticated incoming owner.
- **Change**: Refuse direct authenticated-to-authenticated input before readiness, synchronization, state change, or storage mutation. Updated active Feed isolation fixtures to sign out into NLA and then use an authorized Discard choice for entry into B. The tests continue to check pending-work refusal, active Feed discard, stale handlers, and destination isolation.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/transitionCoordinator.test.ts lib/__tests__/activeFeedTransition.test.ts lib/__tests__/nlaTransition.test.ts lib/__tests__/nlaImport.test.ts components/bench/__tests__/ActiveFeedSection.workspace.test.tsx components/__tests__/AuthModal.nla.test.tsx components/__tests__/AuthModal.workspaceChanged.test.tsx components/lab/__tests__/labHub.workspace.test.tsx` — 8 suites, 153 tests passed. The new coordinator test confirms refusal leaves credentials, generation, state, and outgoing synchronization untouched. No device account-switch run was performed.
- **Status**: Code fixed and focused tests pass; production device verification of A → NLA → B remains.

### BT-009 Account Feed History escaped departure preflight

- **First observed**: 2026-11-16, during Issue #24 per-store reconciliation.
- **Root cause**: `validateOperationalData(account)` read a scoped Feed History key, while the Feed production path and `migrateLocalDataToAccount` use `sourdough_feed_history_v1`. An ownerless or foreign row at the actual key could pass sign-out readiness and be excluded from upload without appearing as unresolved.
- **Change**: For account departures, inspect the actual global Feed History key and reject ownerless, foreign, or conflicting ownership before synchronization or identity mutation. Preserve the source record on refusal.
- **Verification**: `npx.cmd jest --runInBand lib/__tests__/activeFeedTransition.test.ts` — 1 suite, 22 tests passed, including two new real-coordinator preflight cases. `npx.cmd jest --runInBand lib/__tests__/ownerScopedStorage.test.ts lib/__tests__/transitionCoordinator.test.ts` — 2 suites, 39 tests passed. `npx.cmd jest --runInBand --silent lib/__tests__/bulletproofImport.test.ts` — 1 suite, 58 tests passed. No device or Supabase test was run.
- **Remaining**: #90's canonical Feed key model, mixed-owner reconciliation, and migration accounting still need work. Parent Issue #24 remains open.

### BT-010 Active work crossed or was lost at an identity threshold

- **First observed**: 2026-11-16, while reconciling Issue #24 active-work policy.
- **Root cause**: Sign-out migration uploaded active Bakes; warning and cleanup covered Feed unevenly; quarantine could revive active Bakes; remote active rows could restore from another device; NLA purge could precede a failed credential activation. Fire-and-forget Bake upserts could race sign-out reconciliation.
- **Change**: Exclude active Bake upload; warn for both types; reconcile only remote rows matching account and device, confirming absence; verify remote sign-out before local cleanup; keep a durable sign-out phase marker; snapshot NLA active bytes for failed/interrupted purge; serialize active Bake remote writes with the transition lock.
- **Verification**: `npx.cmd jest --runInBand --silent --testTimeout=15000 lib/__tests__/activeFeedTransition.test.ts lib/__tests__/transitionCoordinator.test.ts lib/__tests__/bulletproofImport.test.ts lib/__tests__/ownerScopedStorage.test.ts lib/__tests__/nlaTransition.test.ts lib/__tests__/nlaImport.test.ts components/__tests__/AuthModal.nla.test.tsx components/__tests__/AuthModal.workspaceChanged.test.tsx lib/__tests__/bakeLifecycle.test.ts` — 9 suites, 204 tests passed. A further identity/race command over `transitionCoordinator.test.ts`, `log.identity.test.tsx`, and `ownerScopedStorage.test.ts` passed 61 tests. TypeScript remains blocked by 174 existing diagnostics, none on the new transition/migration/warning code.
- **Remaining**: Device and deployed Supabase verification, full account cycle, older local active copies without a stale marker, and parent #24's per-store requirements remain open.

## Active Issues

### 1. C/C++ Configuration Timeout (Windows)
- **Status**: Monitoring
- **Symptom**: "Compiler command timed out during compiler information collection" for `expo-modules-core`.
- **First Observed**: 2026-09-12
- **Mitigation**:
    - Increased `Compiler information collection timeout` to 120 seconds in Android Studio Advanced Settings.
    - Recommended: Add Android SDK path to Windows Defender exclusion list.
- **Notes**: Common on Windows due to slow process invocation. Often clears after a manual Gradle sync or cache invalidation.
