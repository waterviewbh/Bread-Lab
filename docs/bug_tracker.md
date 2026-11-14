# Bug Tracker & Known Issues

This file is Bread Lab's central tracker for confirmed defects, unresolved test failures, intermittent build issues, native flakiness, and items to watch.

## Triage Dashboard

| ID | Finding | Status | Next step |
| --- | --- | --- | --- |
| BT-001 | NLA transition test authorization failures | Test setup fixed; production impact unverified | Continue the remaining Issue 1A acceptance verification |
| BT-002 | Operational cleanup validation test failures | Cleanup preflight corrected; focused tests pass | Keep cleanup validation bound to the legacy keys it mutates; retain transition regression coverage |

### BT-001 NLA transition test authorization failures

- **First observed**: 2026-11-13
- **Initial evidence**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaImport.test.ts lib/__tests__/nlaTransition.test.ts components/__tests__/AuthModal.nla.test.tsx` produced 12 failed and 57 passed tests; the two other suites passed.
- **Confirmed cause**: The failing discard cases supplied plans from `buildPurgePlan` without calling `authorizeDiscardPlan`, so the coordinator correctly rejected them before reaching the assertions under test.
- **Change**: Updated the transition test helper and direct discard cases to authorize the explicit discard choice. Existing forged-plan rejection coverage in `transitionCoordinator.test.ts` remains unchanged.
- **Verification**: `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaTransition.test.ts` — 1 suite passed, 22 tests passed.
- **Assessment**: The test-fixture failures are resolved. This does not establish that all Issue 1A production acceptance criteria are met; those remain subject to their own verification.

### BT-002 Operational cleanup validation test failures

- **First observed**: 2026-11-13
- **Root cause**: `clearOperationalData()` mutated legacy global operational keys, while its pre-validation read owner-scoped keys for collections and active bakes. Malformed data on the keys actually being cleaned could therefore evade preflight.
- **Contract**: Cleanup rejects malformed, unreadable, pending-deletion, and unknown-owner state before mutation. Foreign-owned records are retained; they are not purged as another workspace's data. The NLA transition path remains separately authorized to discard device-local active Feed work.
- **Change**: Added a cleanup-only validation option so preflight reads the same legacy keys that cleanup mutates. Collection and active-record ownership checks allow foreign-owned records in this cleanup mode so they can be retained safely; missing ownership and malformed values still reject. Updated tests to cover the protective outcomes and exact zero-mutation behavior.
- **Verification**:
  - `pnpm.cmd exec jest --runInBand --silent lib/__tests__/bulletproofImport.test.ts` — 1 suite passed, 58 tests passed.
  - `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaTransition.test.ts lib/__tests__/activeFeedTransition.test.ts lib/__tests__/transitionCoordinator.test.ts` — 3 suites passed, 65 tests passed.
- **Assessment**: BT-002's focused cleanup validation and the tested transition paths pass. Broader Issue #24 acceptance and runtime/device verification remain open.

## Active Issues

### 1. C/C++ Configuration Timeout (Windows)
- **Status**: Monitoring
- **Symptom**: "Compiler command timed out during compiler information collection" for `expo-modules-core`.
- **First Observed**: 2026-09-12
- **Mitigation**:
    - Increased `Compiler information collection timeout` to 120 seconds in Android Studio Advanced Settings.
    - Recommended: Add Android SDK path to Windows Defender exclusion list.
- **Notes**: Common on Windows due to slow process invocation. Often clears after a manual Gradle sync or cache invalidation.
