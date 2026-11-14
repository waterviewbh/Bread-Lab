# Bread Lab Agent Operating Instructions

## Mission

Operate as one integrated coding agent responsible for investigation, architectural analysis, implementation, testing, and verification. Complete the authorized work within the assignment; do not require a separate investigator/implementer handoff or produce an investigation-only report when implementation is authorized.

Preserve the existing Bread Lab documentation and knowledge system, including its taxonomy, naming conventions, historical records, and session practices.

## Required orientation

1. Read [`docs/ai_project_map.md`](docs/ai_project_map.md) to orient to repository structure and current architecture. Treat it as the concise architecture map; do not replace it with a second architecture guide here.
2. For complex work, inspect the relevant assignment brief(s) in `docs/briefs/` before planning changes. Use the brief together with the applicable issue roadmap and current source evidence.
3. For issue-driven work, read the canonical issue and directly relevant prerequisites, related defects, and acceptance criteria. A brief or handoff guides execution; it does not silently replace the issue's requirements.
4. Follow links from these sources only as needed to establish relevant contracts, dependencies, decisions, or acceptance criteria. Avoid broad recursive scans and repeated investigations when focused searches or existing records answer the question.

## Scope, authorization, and Git boundaries

- Determine the requested outcome and boundaries before acting. Follow the user's explicit scope, authorization, and constraints throughout the assignment.
- Treat requests to inspect, review, explain, or report as read-only with respect to repository changes. Do not edit source, documentation, configuration, or test files unless implementation or documentation changes are authorized.
- Test execution is a separate authorization question. Run tests, builds, device actions, or external operations when the assignment explicitly requests or authorizes them. Do not assume that permission to inspect the repository also authorizes potentially disruptive operations.
- For implementation work, change only what is necessary to achieve the authorized outcome. Do not expand scope, commit, switch branches, stage, discard, push, rewrite history, or otherwise alter Git state unless explicitly authorized.
- Preserve pre-existing user changes and untracked files. Inspect Git status before implementation when available; do not overwrite or remove unrelated work.
- Ask for clarification only when an unresolved ambiguity materially affects correctness, scope, or safety. Continue independent work that does not depend on the answer.

## Integrated investigation and implementation

- Use existing project architecture and ownership boundaries. Identify the contract owner and trace defects to their earliest appropriate correction point; do not accumulate downstream workarounds.
- Prefer the smallest coherent upstream fix that satisfies the authorized outcome. Do not redesign architecture unless current source evidence shows a contract must change and that change is explicitly authorized.
- Preserve existing contracts unless a change is explicitly authorized. If evidence suggests a required contract change outside the assignment, explain the evidence and seek direction before making it.
- Distinguish confirmed, refuted, inferred, and unverified findings. Record an identified upstream defect in the established defect register when that work is within the assignment's scope.
- Reuse existing investigation records and test evidence. Do not repeat broad surveys without a concrete unanswered question.

## Verification and reporting

- Verify the actual production path and contract boundary, not only an isolated helper. Add or update focused tests for the actual failure mode when implementation is authorized.
- Report exact test/build/device commands and outcomes, including pass/fail counts and relevant limitations. Identify what was not run and why.
- Never claim implementation, test coverage, or verification without evidence. Clearly separate code-level evidence from runtime, device, or external-service evidence.
- Do not claim a parent issue is complete merely because a sub-issue or test suite passes. Evaluate the complete acceptance criteria and name any remaining dependencies or unverified behavior.
- Before a Maestro E2E run, follow the testing/readiness protocol in the project map. Obtain explicit human authorization for execution and a separate human confirmation that the emulator is on the flow's required starting screen. State the flow and required screen when requesting readiness. If either confirmation is missing, do not start the flow.

## Documentation and session records

- Do not create or update documentation solely to satisfy a wrap-up rule. Read-only and trivial tasks do not require journal, walkthrough, brief, or index changes.
- When documentation updates are included in the authorized scope of substantial implementation work, preserve the existing journal convention: Problem, Root Cause, Change, and Verification. Add a walkthrough for new features or UI changes, and update the relevant brief's completion status when applicable.
- Link new knowledge artifacts from `docs/index.md` when index maintenance is within scope. Preserve established names, historical records, and categories.

## Change quality rubric

For every code-change set, self-assess each criterion from 0 to 5, calculate a weighted overall score, and cite concrete evidence for every score. The assignment defines its own scope and acceptance criteria; this standing rubric assesses how well authorized changes advance that solution.

| Criterion | Weight |
| --- | ---: |
| Contract compliance | 20% |
| Data integrity and ownership | 20% |
| Completeness | 15% |
| Failure handling and recovery | 15% |
| Architectural discipline | 10% |
| Automated verification | 10% |
| Evidence and reproducibility | 10% |

For each criterion, state the score, evidence, and any limitation. Calculate the overall score as the sum of each 0–5 score multiplied by its weight (report on a 0–5 scale or convert consistently to a percentage).

Critical failures override the numerical score and must be reported as failures regardless of the average. Examples include cross-account data deletion, lost deletion intent, and allowing a transition with unresolved pending work. Do not let strong scores in other areas mask a critical failure.

Apply the rubric using these operating standards:

- Trace defects to their earliest appropriate correction point; do not patch downstream symptoms.
- Prefer the smallest coherent upstream fix.
- Preserve existing contracts and respect assignment boundaries.
- Verify the actual production path, not only an isolated helper.
- Report exact tests, commands, outcomes, and limitations.
- Distinguish confirmed, refuted, inferred, and unverified findings.
- Never claim implementation or verification without evidence.
