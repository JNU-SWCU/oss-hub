---
name: run-release-qa
description: >-
  Open for release QA of an oss-hub release candidate, including requests for full
  QA, pre-release QA, or code and screen checks. Choose report-only, recheck,
  delta, or full before preparing environments. Report-only reads existing records
  and reports missing sources without installing tools, starting services, or
  running suites. Bug fixes, deployment, PR submission, and ticket writing belong
  to other skills.
metadata:
  version: "1.2.1"
---

# Run Release QA

[한국어](SKILL.md) | **English**

English translation of the [Korean source](SKILL.md).
The Korean document remains authoritative.
This is a reading reference; runtime skill loading continues to use `SKILL.md`.

Fix the release candidate, then make a release judgment using existing scenarios and records only within the declared scope.
Do not create a new testing or documentation system.

## Output contract

The output includes the exact SHA (or `미기록`, not recorded, if unknown), declared scope, sources used, missing sources, and release judgment.
Report-only does not install, start services, run suites, or prepare scenarios; mark absent records `확인 필요` (verification required).
Do not start a full rerun without explicit user approval.
Do not change product code, data, Issues, or PRs without approval.

## Choose scope first

Declare **exactly one** scope below before environment preparation or execution lanes A–C.
Before declaring it, do not start pnpm suites, Docker, Playwright, local stacks, scenario preparation, or plugin installation.

| Scope | Do | Do not do | Authorization |
| --- | --- | --- | --- |
| `report-only` (no rerun; default) | Read existing GitHub Issues, CI, and earlier evidence. Mark missing sources `확인 필요` | Tool installation, service startup, suite execution, full-scenario preparation, screenshot capture | The request is sufficient |
| `recheck` (reverify existing items) | Reproduce only user-specified Issue numbers or URLs; old `QA<n>` titles are optional lookup aids | Full runs outside the specified list; unauthorized Issue writes | A target list is required |
| `delta` | Verify only paths changed in the candidate SHA since the baseline commit | Full checks of unrelated paths | A baseline SHA is required |
| `full` (full rerun) | Rerun release-critical paths from the scenario source | Unapproved data/Issue/PR mutations | **Explicit user approval is required** |

An existing Issue with substantially the same title, symptoms, route, and role is a **known issue**.
Do not register it as a new finding; cite only its existing URL/number.

## Boundaries before starting

1. `docs/rules/security.md` defines what may be public. Do not capture screens displaying real data or personal information.
2. Do not alter product code, production data, or Issue/PR state without user approval.
3. Do not fix defects during QA. Obtain approval for the fix scope separately.
4. Only execution scopes (`recheck`, `delta`, `full`) read the root/target-path AGENTS.md, `docs/rules/local-dev.md`, and `references/qa-scenarios.md` as preparation. Report-only does not require this preparation.
5. GitHub Issues (QA tickets) are the single source of truth for product QA findings. If they cannot be read, mark them `확인 필요`; do not install tools to compensate.

## 0. Read records

After declaring scope, open only accessible sources.

- Open and closed GitHub Issues: identify by GitHub Issue number. Read body fields `문제` (Problem), `재현 URL` (Reproduction URL), `페르소나` (Persona), `영역` (Area), `마감` (Deadline), and open/closed state. `QA<n>` in old titles is optional lookup information, not a requirement.
- Recent CI records and existing local evidence files.

Do not fabricate missing sources; report them as `확인 필요`.
Report-only completes the reading needed for judgment here and does not enter §2, §3, or lanes A–C.

## 1. Fix the candidate

1. Record the exact SHA of a specified branch/commit. Otherwise use a SHA from existing Git/CI records; if none is available, record `미기록`.
2. Report-only does not update remote main or create a worktree.
3. Only execution scopes inspect a candidate SHA in a separate worktree if necessary, preserving the shared checkout.
4. Put the start time, candidate SHA, base SHA, working-tree state, and scope declaration on the first line.
5. If main moves during QA, report drift and leave the rerun decision to the user.

## 2. Prepare the minimum environment

Only `recheck`, `delta`, and `full` perform this section; report-only skips it.

1. Find existing lint, typecheck, test, build, and local-run commands in `package.json` scripts.
2. Use existing tools and fixtures only; do not create a framework for one QA run.
3. Store raw logs/screenshots outside the repository, in temporary or approved locations.
4. Record each command's start/end time, exit code, and failing suites. Do not overwrite failure logs with a success-only summary.

## 3. Select scenarios

Only execution scopes select from the W, ST, PM, and AS groups in `references/qa-scenarios.md`.
Report-only does not prepare scenarios.

- Roles: signed out, no role selected, student, team leader/member, faculty and staff, administrator, inactive account.
- Flows: public reads, registration/consent, role requests, programs, applications, repositories, submissions/reviews, administrator functions.
- States: empty, normal, unauthorized, nonexistent, deadline boundaries, duplicates, stale state, retry, terminal failure.
- Screens: 320, 375, 768, 1280, and 1440px plus keyboard-only interaction.
- Contracts: success, 400, 401, 403, existence-hiding 404, 5xx, and HTTP 200 with an empty body or null.

Follow the scenario document's recommended order for irreversible transitions.
Where possible, verify the core chain `W2 → W4 → W5 → W6 → W7 → W8 → W9` continuously using the same fixture.

## 4. Execution order

Report-only does not execute lanes A–C; it performs only the record comparisons in §4.D.

### A. Static and automated verification

1. Select and run existing checks needed for the declared scope according to the [verification rules by path](../../docs/rules/ci-path-verification.en.md).
2. Separate failures from warnings. Even if tests pass, record recurring warnings or nondeterministic signals separately.
3. Cross-check authorization, null handling, date boundaries, caches, public-response allowlists, and terminal asynchronous failures in code.

### B. API and authorization verification

1. Check the PM-group contracts: public 200, protected 401, role-specific 403, and existence-hiding 404.
2. Check sensitive fields and `Cache-Control` in protected responses.
3. Distinguish a screen document returning 200 from the API allowing access to its data.
4. Do not treat a source finding and runtime reproduction as equivalent evidence. State when reproduction was not possible.

### C. Screen and interaction verification

1. Open principal routes for each role directly. Verify both list-to-detail navigation and direct entry to detail URLs.
2. Check clipping, horizontal scrolling, Korean line wrapping, and reachable fixed buttons on narrow screens.
3. Check keyboard focus, Tab order, Escape closing, and focus restoration after closing a window.
4. Associate console errors, duplicate requests, and 404/5xx network requests with the screen result.

### D. End-to-end flows and existing findings

1. Run the W-group core chain and asynchronous AS group only within the declared scope. Report-only skips scenario execution.
2. Use accessible open GitHub Issues (QA tickets) to distinguish known issues, regressions, and execution gaps.
3. Do not close or edit Issues/PRs. Write only when explicitly requested by the user.

## 5. Record evidence

Record only the following for each finding.

- Candidate SHA and execution environment; in report-only, sources read and sources inaccessible.
- Role, route/API, and preconditions.
- Reproduction steps, or an explicit statement that it was not reproduced.
- Actual and expected results.
- Impact and severity.
- Log/response/screenshot references.
- Evidence type: runtime reproduction, automated test, code inspection, or record comparison.

Use screenshots only after removing identifying information and real data.
Name files with reproducible conditions, such as `qa-id-role-route-viewport.png`; do not write personal machine paths in documents.

## 6. Release judgment

Finish with one of three outcomes.

- `RELEASE READY`: release-critical flows passed, and known residual risks do not block release.
- `RELEASE BLOCKED`: users cannot finish their work; data, authorization, or privacy is at risk; or critical failures are silently hidden.
- `QA INCOMPLETE`: missing environment, permissions, fixtures, or records prevented critical-path verification. Use this outcome for missing sources in report-only.

The final report includes the exact SHA or `미기록`, declared scope, pass/fail/not-run counts, blockers, relationships to existing Issues, evidence locations, and missing sources.
If main has moved, explain the difference from the current SHA in one line and state that the results apply only to the fixed candidate.

## Completion check

- [ ] Declared one of report-only/recheck/delta/full before preparing environments.
- [ ] In report-only, did not install, start services, run suites, or prepare scenarios; marked missing sources `확인 필요`.
- [ ] Started a full run only after explicit user approval.
- [ ] Recorded the exact candidate SHA or `미기록`.
- [ ] Read accessible GitHub Issues (QA tickets), or reported their absence.
- [ ] Did not run a full check outside scope or register the same symptom again.
- [ ] Ran automated checks and role-specific critical flows only for execution scopes.
- [ ] Checked mobile, keyboard, and Korean rendering only when included in scope.
- [ ] Did not change product code, data, Issues, or PRs without approval.
- [ ] Reported the release judgment and main drift.
