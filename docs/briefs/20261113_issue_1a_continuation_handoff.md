# Issue 1A Continuation Handoff (2026-11-13)

## Objective and boundaries

Continue Issue 1A: make NLA-to-Authenticated transitions perform mandatory readiness preflight before destination authentication, transition-state changes, or local-data mutation. This is a work item under Defect A in the A–D family, as currently understood. Completing 1A alone does not close Defect A or parent Issue #24.

Use the root [AGENTS.md](../../AGENTS.md), [AI Project Map](../ai_project_map.md), canonical issue requirements, and relevant briefs as the working context. Avoid broad re-investigation; verify prior findings against current source before acting.

## Product transition contract

- The only workspace states are Authenticated and NLA.
- Account changes pass through NLA: sign out of A into NLA, then use the normal NLA-to-Authenticated flow for B. There is no direct A-to-B transition.
- NLA has local-storage access only. Authenticated workspace identity is tied to the authenticated Supabase account.
- Treat the coordinator as the transition boundary. Preserve existing contracts and fail closed when readiness, authorization, or recovery cannot be verified.

## Work completed in this session

- Moved NLA Import and Discard choice handling behind coordinator preflight. Destination authentication and import/discard preparation now start only after preflight succeeds.
- Bound the explicit choice to an NLA inventory snapshot and kept import purge dependent on verified import results.
- Made the import path callable while the coordinator holds the storage mutex without reacquiring that mutex.
- Corrected the real-coordinator discard test setup to call `authorizeDiscardPlan` for explicit baker choices. Forged-plan rejection tests remain separate.
- Updated the Bug Tracker: BT-001's test-fixture failure is resolved; production impact remains unverified. BT-002 remains unresolved.

## Verification

- `pnpm.cmd exec jest --runInBand --silent lib/__tests__/nlaTransition.test.ts` — 1 suite, 22 tests passed.
- Focused transition/AuthModal/import run — 5 suites, 90 tests passed:
  `pnpm.cmd exec jest --runInBand --silent lib/__tests__/transitionCoordinator.test.ts components/__tests__/AuthModal.incompleteRecovery.test.tsx components/__tests__/AuthModal.outgoingIdentity.test.tsx components/__tests__/AuthModal.nla.test.tsx lib/__tests__/nlaImport.test.ts`
- `git diff --check` passed; Git reported existing LF-to-CRLF warnings.
- Last full TypeScript check reported 173 errors in 34 files. No diagnostics were reported in the edited transition files in that run; rerun after later TypeScript edits if type-check evidence is needed.
- `lib/__tests__/bulletproofImport.test.ts` remains a known failure: 9 failed, 49 passed. See [BT-002 in the Bug Tracker](../bug_tracker.md#bt-002-operational-cleanup-validation-test-failures).
- Maestro E2E was not run. It requires explicit execution authorization and separate confirmation that the emulator is on each flow's required starting screen.

## Repository state at handoff

- Branch: `the-bakers-bench`
- HEAD: `bbc0025515f67c0efed5b7a1264f7d17c33971c0`
- No commit was created.
- The Bug Tracker and index were staged before this handoff. The implementation and test changes, plus other pre-existing user changes and untracked artifacts, remain in the working tree. Inspect `git status --short` before editing or staging; preserve unrelated work.

## Recommended next step

Triage BT-002 against the intended data-preservation contract. Determine for each failing assertion whether the implementation or test expectation is wrong, and verify zero mutation on rejected cleanup. Do not treat the remaining failures as confirmed production defects until that comparison is complete.
