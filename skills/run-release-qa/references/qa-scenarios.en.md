# QA Scenarios — Persona Interaction Matrix

[한국어](qa-scenarios.md) | **English**

English translation of the [Korean source](qa-scenarios.md).
The Korean document remains authoritative.

This document is the authoritative source for repeatable manual QA procedures.
It contains **workflows derived from interactions between personas**, not a list of screens: scanning screen by screen misses cases where each part works alone but the connected workflow breaks.
The authoritative decisions and contracts live in their respective ADRs and `docs/rules/`; this document retains only links and IDs.

## Eight personas

The Korean codes are preserved because the scenario matrices refer to them.

| Code | Persona | Notes |
| --- | --- | --- |
| 외 | Signed-out visitor (outsider) | Public surfaces only |
| 미 | role=null | Registered but has not selected a role |
| 학 | Student (individual) | Individual application |
| 장 | Student (team leader) | Creates a team and issues a join code |
| 원 | Student (team member) | Joins with a join code |
| 교 | Faculty and staff (STAFF) | Contest operation and review |
| 타교 | STAFF for another program | Currently has global access ([#548](https://github.com/JNU-SWCU/oss-hub/issues/548)) |
| 관 | Administrator (ADMIN) | Access administration, auditing, and collection |
| 비 | Inactive account | `AUT_003` |

## Execution-order warning — irreversible transitions

The transitions below cannot be reversed on the same row.
Triggering them early in QA blocks later scenarios, so **run them last and use separate fixtures for each terminal branch**.

`Role null→non-null` · terminal RoleRequest · Application `APPROVED/REJECTED` · Review creation · Submission `APPROVED/REJECTED` · GithubRepository `visibility: PUBLIC` (publication confirmation) · SubmissionFile `DELETED` · Outbox `PROCESSED/FAILED` · provision/invitation `SUCCEEDED/FAILED_FINAL` · terminal canonical run.

Recommended order: reads, validation, stale cases, retryable cases, and `CHANGES_REQUESTED` → final decisions → publication confirmation → file deletion → final failures.

`AccountStatus` is not irreversible because an administrator can reactivate an account; collection `presence/visibility` is also reversible through the next complete observation.

## W group — core interactions between personas (15)

**Core chain**: run `W2 → W4 → W5 → W6 → W7 → W8 → W9` together without interruption.
This is the full path: a contest created by faculty/staff becomes visible to a student; the student applies, is approved, gets a repository, submits a file; faculty/staff receive and review it, reject it; the student sees the rejection and resubmits.

| ID | Interaction | Happy path | Derived branches | Basis |
| --- | --- | --- | --- | --- |
| W1 | 관·교 → 교 | Role request approved by an administrator or faculty/staff → STAFF access granted | Rejection / access blocked after revocation / access blocked while pending / faculty/staff receive 403 for roster or role changes | `users/admin-access.service.ts` |
| W2 | 교 → contest | Create contest → **visible in the student list** | Visibility before registration, during registration, and after closing; edits reflected; removed from the list when archived | `programs.controller.ts` |
| W3 | 교 → milestone | Create → reflected in student checklist | Three types: `FILE`, `TEXT`, `REPOSITORY_RELEASE`; deadline changes; block deletion of a milestone with submissions | `milestones.controller.ts` |
| W4 | 학·장·원 → application | Complete an individual application | Create team → join by code → enter member details / block duplicate applications / **block applications below the minimum team size (`APP_019`)** | `applications.service.ts` |
| W5 | 교 → application decision | Approve → trigger provisioning | Reject with a visible reason / reapply after rejection / applicant edits or cancels before a decision | `applications.controller.ts` |
| W6 | Provisioning → 학 | Repository created → invitation → visible in `my-repos` | **Is final failure visible on the student screen?** / does invitation acceptance converge to the corresponding state? | `repository-provision.worker.ts` |
| W7 | 학 → submission | **Successful file upload** | Block after deadline / not submitted / `TEXT` and `RELEASE` types / **replacement before the deadline** | `submissions.controller.ts` |
| W8 | 교 → review | **Download file** → decision | `APPROVED` / `REJECTED` / `CHANGES_REQUESTED` / concurrent-review race | `submission-reviews.controller.ts` |
| W9 | Rejection → resubmission | **Student sees the rejection** → resubmits → new revision | Preserve earlier history / faculty/staff review again / resubmission form fails closed | `submissions.service.ts` |
| W10 | Final rejection | Confirm `REJECTED` | **Is resubmission actually blocked?** | `submissions.service.ts` |
| W11 | 교 → publication confirmation | Pass all five gates → publish | Visible in `archive` while signed out / blocked when a gate is unmet | `submission-reviews/AGENTS.md` |
| W12 | Deadline approaching → notification | Faculty/staff digest **actually received** | Student reminder / accuracy of the list of non-submitters / Asia/Seoul display | `deadline-digest.service.ts` |
| W13 | Activity collection → ranking | Registered users' real names displayed | Unregistered users show `githubLogin` plus a '미가입' (“unregistered”) badge / signed-out access | `ranking.service.ts` |
| W14 | 관 → account state | Deactivate → access blocked | Reactivate → restored / block self-deactivation / block removal of the last administrator | `admin-access-mutation-policy.ts` |
| W15 | Audit log | Record decisions, publication, and permission changes | View in administrator screen / **three missing categories tracked in [#547](https://github.com/JNU-SWCU/oss-hub/issues/547)** | `audit-log.service.ts` |

## ST group — state transitions and error-code branches (19)

These are actions that trigger error codes users may actually encounter.
The backend defines 75 domain error codes; the table groups those reproducible through user actions.

| ID | Interaction | Happy path | Derived branches (error codes) |
| --- | --- | --- | --- |
| ST1 | 미 → role selection | `null→STUDENT` with current required consents and a completed profile | Old policy or missing required consent `CON_002/003`; incomplete profile `USR_002`; already confirmed `ROL_002` |
| ST2 | 관 → inactive user | Restore `DEACTIVATED→ACTIVE` | State changed after reading `ROL_013`; access while inactive `AUT_003` |
| ST3 | Rejected faculty/staff request → 관 | Preserve existing `REJECTED` + create new `PENDING` | Already `PENDING`/`APPROVED`/`REVOKED` → `ROL_003/002/008` |
| ST4 | Sign-in/sign-out → 관 | Only successful `LOGIN` updates the last-login value | Failed `LOGIN` and `LOGOUT` leave the sort value unchanged |
| ST5 | 학 → team join | Add member with a valid code and available capacity | Incorrect code, capacity exceeded, change after application, or already on another team → `TEAM_009/007/008/006` |
| ST6 | Undersized team → 교 | Create application only when minimum size is met | Block with `APP_019` when below minimum |
| ST7 | 교 changes form → open application | Accept current version and valid answers | Old version, invalid fields, team specified for individual application, or another team specified → `APP_016/015/013/014` |
| ST8 | 교 edits program/milestone | Valid period change before an application is reflected | Type change after applications, reversed period, reversed deadline, or deletion of a milestone with submissions → `PRG_006~010` |
| ST9 | 학 uploads file → 교 downloads | `PENDING→ATTACHED`, then `DELETE_PENDING→DELETED` after retention expiry | Input, format, over 5MB, no end date, or storage failure → `SUB_017~021` |
| ST10 | 학 submits release → 교 | Matching type and tag/release URL for the linked repository | Type mismatch, repository not ready, or URL for another repository → `SUB_007/008/009` |
| ST11 | 학 resubmission ↔ 교 concurrent review | One Review against the latest revision | Student wins first `SUB_003`; another faculty/staff reviewer wins first `SUB_004`; no comment `SUB_005` |
| ST12 | Approval → worker → team member | Outbox `PENDING→PROCESSING→PROCESSED`, successful job and invitation | Retry after `FAILED_RETRYABLE`; terminal `FAILED_FINAL` |
| ST13 | 관 → access-state change | Atomic transition when expected state matches | Concurrent change, self-deactivation, or removal of last administrator → `ROL_013/017/018` |
| ST14 | 관 collection trigger → public ranking | Replace active generation only when run is `SUCCEEDED` | Terminal `INCOMPLETE/RATE_LIMITED/FAILED`; App unconfigured, concurrent run, or cutover → `COL_007/006/008` |
| ST15 | Collection worker → system status | `PARTIAL→NORMAL` as `READY` streams increase | Retry pending `FAILED`; stale READY `DELAYED` |
| ST16 | GitHub org administrator → 외 | Public aggregation when complete inventory observes `PUBLIC+PRESENT` | Immediately exclude on `PRIVATE` or `ABSENT`; restore on the next observation |
| ST17 | 외 → public project/profile | Read eligible public data only | Private, ineligible, and nonexistent all return the same `PPJ_001/002`; tampered cursor `PPJ_003` |
| ST18 | 관·학 → administrative API | Administrator audit reads; faculty/staff notification settings | Reversed period `AUD_002`; student notification settings `NOT_001` |
| ST19 | Legacy webhook enum | — | No runtime writer. Dead-contract classification is tracked in [#549](https://github.com/JNU-SWCU/oss-hub/issues/549) |

## PM group — permission boundaries and public scope (31)

The figures below were **measured on production v0.6.14 on 2026-08-03**.

### What signed-out users should see — 6/6 passed

`GET /health` · `GET /programs` · `GET /programs/application-templates` · `GET /programs/:id` · `GET /projects` · `GET /ranking` all return 200.

Public frontend routes `/` · `/ranking` · `/programs` · `/archive` · `/signup` · `/programs/:id` all return 200.

### What must be blocked while signed out — 25/25 passed (all 401)

`/auth/me` · `/users/me/profile` · `PATCH /users/me/profile` · `/consents/current` · `POST /consents` · `/users/me/login-history` · `/users/me/notification-email` · `PATCH /users/me/notification-email` · `/repositories/me` · `/dashboard/student` · `/dashboard/staff/summary` · `/role-requests/me` · `POST /onboarding/role` · `POST /programs` · `/programs/:id/edit` · `PATCH /programs/:id` · `/programs/:id/applications` GET/POST · `/programs/:id/teams/me` · `POST /programs/:id/teams` · `/audit-logs` · `/system-status` · `POST /admin/collection/trigger` · `/users/access` · `POST /submission-files`.

### Identical 404 responses — existence concealment passed

| Target | Nonexistent | Exists but ineligible |
| --- | --- | --- |
| Public project | `404 PPJ_001` | `404 PPJ_001` |
| Public profile | `404 PPJ_002` | `404 PPJ_002` |

The response does not reveal whether the target exists.
An eligible public project returns 200 normally.

### No excessive blocking of sibling paths

`/submission-files-export` · `/submission-filesXYZ` · `/submissions` all return 404, not 403.
`/health` returns 200.

### Public fields in unauthenticated program detail

```
id · name · organizer · category · description
applicationPeriod{startsAt, endsAt}
viewer{role, applicationStatus}
milestones[]{id, name, dueAt, dDay, deadlineLabel, description,
             submissionType, viewerSubmissionStatus, applicationSubmissionSummary}
```

For anonymous viewers, `viewer.*`, `viewerSubmissionStatus`, and `applicationSubmissionSummary` are all `null`.
`programs.service.ts:110` populates them only with staff application data, so the current behavior is safe.
Locking this allowlist into a contract is tracked in [#552](https://github.com/JNU-SWCU/oss-hub/issues/552).

### Paths that static checks miss

Program creation/editing, teams, application creation, submission/resubmission, activity timeline, submission matrix, file upload/download, administrator access, auditing, and system status check roles **in the service**, not in a guard.
Scanning only `@UseGuards(SessionGuard)` misses the actual 403 paths.

### Observation

Protected routes (`/dashboard`, `/my-repos`, `/settings`, `/dashboard/users`) also return 200 HTML from the server.
Data does not leak: the API layer is the final security boundary, and the client `RoleGate` performs redirects.
Follow-up is tracked in [#555](https://github.com/JNU-SWCU/oss-hub/issues/555).

## AS group — asynchronous work, notifications, and auditing (10)

These paths are most often missed in QA because they do not respond immediately.

| ID | Path | Wait time / explicit trigger |
| --- | --- | --- |
| AS1 | Approval → Outbox | Poll ≤5 seconds; `PROCESSING` lease 5 minutes |
| AS2 | Outbox → provision job | Up to 5 attempts; backoff 1, 2, 4, 8 minutes; final failure around 15 minutes |
| AS3 | Worker → GitHub invitation | Send ≤5 seconds. Check acceptance every 15 minutes, up to 96 times (24 hours) |
| AS4 | File upload `PENDING→ATTACHED` | Immediately on submission. Orphans: 24 hours plus hourly cron |
| AS5 | Retention expiry → `DELETE_PENDING→DELETED` | `Program.endAt+1년` (one year), cron ≤1 hour, claim lease 10 minutes |
| AS6 | Failed-deletion retry | 6 attempts at 1, 2, 4, 8, 24 hours. Explicit trigger: `SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED=1 pnpm --filter backend submissions:retry-file-cleanup -- <fileId>` |
| AS7 | Deadline email → Notification | Daily at 09:00 KST. Explicit trigger: `MAIL_MODE=send pnpm --filter backend notifications:send-digest`; isolate with `DIGEST_FORCE_TO` |
| AS8 | Activity collection | Every hour on the hour or `POST /api/v1/admin/collection/trigger`. Lease 10 minutes, budget 45 minutes |
| AS9 | Webhook | No processing path (intentional contract); only REST reconciliation is active |
| AS10 | Audit log | In the same transaction immediately after the action |

### Failures users do not know about

These points must be exercised during QA.

- All 6 file-deletion retries exhausted: only server logs remain ([#545](https://github.com/JNU-SWCU/oss-hub/issues/545)).
- Actual run failure or lease skip after the ADMIN collection trigger returns 202 ([#546](https://github.com/JNU-SWCU/oss-hub/issues/546)).
- A collection stream failure is not reflected in system status because `lastErrorCode` was not recorded ([#546](https://github.com/JNU-SWCU/oss-hub/issues/546)).

## Reuse procedure

1. **Before every run**, check whether this document's measured values match the currently deployed version.
   If deployment changed, measure the PM group again and update the figures.
2. Read the **irreversible-transition warning** first and separate fixtures.
3. Run the W-group core chain continuously.
   If this chain is blocked, the remaining scenarios are not meaningful.
4. For ST and AS, first identify coverage from automated verification and spend manual effort on the remainder.
   Backend unit tests and isolated integration tests cover much of the state-transition and asynchronous chains.
5. Classify newly discovered defects as blockers or follow-ups and record them.
   The decision criterion is: “Does this prevent someone from finishing the task, corrupt data, or fail silently?”

## Related documents

- Deployment contracts, backups, and rollback: [ADR-002](../../../docs/decisions/ADR-002-CI-CD-파이프라인.en.md)
- Review and merge gates: [ADR-005](../../../docs/decisions/ADR-005-agent-driven-review-cycle.en.md)
- GitHub App integration and collection: [ADR-006](../../../docs/decisions/ADR-006-github-app-integration.en.md)
- public-safe deny-list and public strict-read: [security.md](../../../docs/rules/security.en.md)
- Server access and recovery procedures: [server-runbook.md](../../../docs/deploy/server-runbook.en.md)
