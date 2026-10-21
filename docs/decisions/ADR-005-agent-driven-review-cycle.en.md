---
slug: ADR-005-agent-driven-review-cycle
date: 2026-07-15
author: GoBeromsu
status: Accepted
references:
  - ADR-002-CI-CD-파이프라인
refines: []
---

# ADR-005: Agent-Driven Review Cycle

[한국어](ADR-005-agent-driven-review-cycle.md) | **English**

English translation of the [Korean source](ADR-005-agent-driven-review-cycle.md).
The Korean document remains authoritative.

## Status

Accepted

## Context

When people and agents collaborate on PRs, notifications and local state can lag behind actual GitHub state.
Merging the latest changes using reviews or CI results from an earlier commit makes the judgment irreproducible.

## Decision

Use GitHub PRs, commits, reviews, and checks as the basis for development changes and merge decisions.
Notifications and messaging are only signals to begin work.

Every review and merge decision is tied to the exact head SHA, target base ref, and full base SHA.
If the head, base ref, or base SHA changes, recheck rather than reusing previous results.

Technical, policy, and implementation decisions within the PRD, IA, Accepted ADRs, and root/applicable nested `AGENTS` are made within Jeonnam's exact-head independent review and the Tech Lead's delegated autonomy.
Do not impose confirmation by a particular PM on every PR as a general merge condition.

State the target feature and owner in the PR body, notify that owner by requesting their review, and claim the work through an Issue before starting.
An owner's after-the-fact confirmation comment is not a merge condition.

PR #407 acknowledges a procedural violation: it began from direct UI feedback and was implemented without first claiming an Issue.
Because implementation and exact-head technical verification were already complete, do not reuse the incorrectly created #480; instead, use retrospective tracking Issue #484 as the canonical implementation record preserving actual scope, owner, and PR relationships.
This one-time exception applies only to #407 and does not permit retrospective Issues as a general substitute for claiming work in advance.
Subsequent changes of the same scale must declare scope and owner in an Issue before work begins; omission is a blocker regardless of implementation completion.

Jeonnam (전남) is the code-review agent assigned independent PR review in this repository; @GoBeromsu, @Lumiere001, or the dedicated review-evidence account @Lumeire002 posts its results as PR review comments.
Ponytail is a review lens limited to reuse of existing libraries, duplication, and unnecessary complexity; it does not determine whether features exist or work and does not replace actual QA.

Jeonnam's independent review checks compliance with applicable `AGENTS.md` and team conventions, duplicate implementation, unnecessary reimplementation of existing features, correctness, security, explicit contract violations, and actual UI/API QA, and records results in PR review comments using the classifications below.
This review is a substantive quality practice, but not a prerequisite for merging — merge eligibility is determined only by required-check success as specified in “Merge gates” below.

`CLI:` evidence is reproducible verification in the repository; a dedicated checker script is only one form of it.
Prefer mechanisms for enforcing the same invariant in this order: (1) structure — types, schema, and generation make violations unrepresentable; (2) application test suites; (3) dedicated checker scripts; (4) documentation rules.
Do not create a lower-priority mechanism when a higher-priority mechanism enforces the invariant.
A PR introducing a dedicated checker must state which invariant it protects and why the first two mechanisms cannot enforce it.
Moving a dedicated checker into a higher-priority mechanism is an equivalent transfer, not weaker verification; treat it as an ordinary change when `CLI:` evidence proves the same invariant holds in the higher-priority mechanism.
Keep fail-closed security and deployment gates as exceptions to this priority: public-safe/gitleaks scans and ADR-002 Release deployment verification.
Changes narrowing, bypassing, or weakening those exception paths remain high risk.

| Classification | Meaning | Merge impact | Handling |
| --- | --- | --- | --- |
| `blocker` | Correctness, security, or explicit contract violation | Resolution is strongly recommended — no separate automatic gate exists | Fix in the current PR and review the new head |
| `fix-now` | Small, substantive improvement within current scope | Non-adoption alone does not block merging | Recommend incorporating it in the current PR |
| `follow-up` | Valid follow-up that expands current scope | Does not block the current PR | Split into an Issue with evidence |
| `reject` | Suggestion conflicts with facts, decisions, or repository conventions | Do not apply | Record the rejection reason |

Classify the following as high risk — this classification signals additional care at kickoff and review, but does not introduce a separate comment-enforced merge gate.

- Authentication, sessions, RBAC, and permission models.
- Personal data, consent, and public/private data boundaries.
- DB schema migrations, data backfills, deletion, or irreversible data changes.
- CI, Jenkins, deployment/rollback, branch protection, CODEOWNERS, and security policies.
- Privileged external integrations such as OAuth, GitHub Apps, and webhooks.
- Cross-cutting design changes that alter contracts across multiple domains.

Determine high risk by the actual effect on authority, data, operations, and shared contracts, not by file path.
CODEOWNERS paths signal review candidates; they do not themselves establish a high-risk classification.
Changes that create, expand, narrow, bypass, or weaken checks on the listed boundaries are high risk regardless of path; treat ambiguous cases as high risk.
Equivalent transfers that preserve an invariant while moving verification to a higher-priority mechanism are not weakening — but fail-closed exception paths remain high risk.
Mechanical documentation, test, or refactoring changes without behavioral effects may be ordinary changes even on matching paths; changing the actual contract in a policy document is high risk.
PRs touching these paths are defined as deployment-contract changes: `Jenkinsfile`, `compose.yml`, `.env.example`, `deploy/**`, `apps/*/Dockerfile`, `.dockerignore`, `scripts/check-jenkinsfile.sh`, `scripts/check-jenkinsfile.test.sh`, and `scripts/jenkins/**`.
`scripts/jenkins/**` is included in advance so protection follows procedural logic extracted from the Jenkinsfile into scripts — extraction must not become a way to reduce review scrutiny.
In the manual pilot, CODEOWNERS candidates or changes with ambiguous classification default to `HIGH_RISK`.

PRs authored by @GoBeromsu are exempt from all review requirements — no person's review is required, including @Lumiere001's.
The exemption is based solely on author identity; do not apply it if identity cannot be confirmed (fail-closed).

### Merge gates (decision of 2026-08-04)

Determine merge eligibility solely from actual success of required checks (`ci` and `public-safe`) and the mergeable state shown by GitHub.

Previously, Jeonnam declared merge readiness through a PR comment in the form `MERGE_READY head=<sha> base=<ref> base_sha=<sha> risk=<GENERAL|HIGH_RISK>`, combining code/contract review, Ponytail, actual UI/API QA, `CLI:` evidence, and CI results.
The `merge-policy` evaluator (workflow `.github/workflows/merge-policy.yml`, scripts `scripts/merge-policy-check*.mjs`) validated that comment's actor, format, pinned head/base, and evidence markers (`CODE_CONTRACT:`, `PONYTAIL:`, `QA:`, `CLI:`, `CI:`) and enforced them as a required check.

That approach is abolished.
The repository owner's rationale is that readiness declared in human/agent comments is a second source of truth that can diverge from actual CI results, and its existence is itself risky — deployability must be judged only from actual test, lint, and build success.
The concrete evidence is the incident on 2026-08-04: PR #586 merged before required `ci` completed (an administrator bypassed required checks with `enforce_admins=false`), introducing seven backend ESLint errors into main.
Release v0.6.22 built from that state was only stopped fail-closed at Jenkins deployment time in the `빌드·테스트 검증` (“Build/test verification”) stage (no production impact; resolved by PR #589).
The incident repeatedly demonstrated that decisions made separately from actual CI results — whether through comment state at merge time or verification at deployment time — can allow divergent state through the gap.
Consequently, PR #591 (run `ci` on main pushes), #593 (force all scopes on main pushes), and #596 (fail-closed `ci` status gate before Jenkins deployment) moved deployment-pipeline verification responsibility to the CI layer.
The merge gate follows the same principle: required-check success, not a comment protocol.
The `merge-policy` workflow and evaluator scripts, and the `MERGE_READY`, evidence-marker, and accept-comment protocols have all been deleted.
Jeonnam's independent review, Ponytail, and actual UI/API QA remain recommended working practices, recorded only as PR review comments; no comment format is a merge prerequisite.
GitHub repository settings (branch protection, merge permissions, and so on) determine who can execute a merge; this ADR does not replace access control with a comment protocol.
Branch protection's required contexts were already only `ci` and `public-safe`; `merge-policy` was not a required check, so this deletion does not require changes to GitHub repository settings.
Jenkins retains ADR-002's deployment contract for stopping on failure, preserving evidence, and restoring existing images; this ADR decides no separate rollback behavior changes.

Merge only PRs satisfying all of the following:

- No Draft status or merge conflicts.
- Applicable CI and required checks (`ci` and `public-safe`) have passed.
- Root and applicable nested `AGENTS` have been followed.
- GitHub shows the PR as mergeable.

The merge conditions are identical for every PR regardless of author or risk classification — required-check success and GitHub mergeability.
Do not merge when GitHub state is unavailable or ambiguous, and do not bypass gates using admin bypass.

Under ADR-002, production deployment is a separate step through a release tag.
Its authorization, trigger, and execution-verification contract follows ADR-002.

Record the verified head SHA, check results, and review URL.
If merged, also record the merge SHA.

## Consequences

- Verification evidence for the latest changes can be rechecked on GitHub.
- Verification must be repeated when the head, base ref, or base SHA changes.
- With merge gates narrowed to required checks (`ci` and `public-safe`) alone, GitHub repository settings (branch protection and merge permissions), rather than this ADR, determine who can execute merges (decision of 2026-08-04).
- No PR requires a person's review beyond required-check success — the former exemption limited to @GoBeromsu-authored PRs now applies to every author.
  Remaining controls are required checks (`ci` and `public-safe`) and ADR-002's Jenkins technical verification (full SemVer, main ancestry, running metadata, rollback, and smoke tests).
  Removing comment-based state such as `MERGE_READY` and accept eliminates a second source of truth that can diverge from actual verification, but also removes an enforced mechanism for detecting correctness/security defects not covered by automation; the repository owner accepted this trade-off (decision of 2026-08-04).
- The default mechanism for new contracts shifts from dedicated checkers to structure and application tests.
  Checker counts need not grow monotonically; they may shrink as higher-priority mechanisms absorb them.
- New checkers incur the cost of documenting their justification.
- Fail-closed security/deployment gates (public-safe/gitleaks scans and ADR-002 Release deployment verification) remain exceptions independent of the priority order — their enforcement level is unchanged.

## References

- [AGENTS.md](../../AGENTS.en.md)
- [ADR-002: CI/CD Pipeline](ADR-002-CI-CD-파이프라인.en.md)
- [Pull request template](../translations/pull-request-template.en.md)

## Changelog

- 2026-08-01: Recorded PR #407's missing advance Issue claim as a procedural violation and accepted a one-time exception using retrospective tracking Issue #484 instead of incorrectly created #480 to preserve scope, owner, and PR relationships.
  Explicitly limited the exception to #407 and prohibited future retrospective Issues from replacing advance claims.
- 2026-08-04: Under Issue #574 and operational approval, added @Lumeire002 as a Jeonnam `MERGE_READY` recording account.
  Authority was limited to independent-review evidence; `PM_ACCEPT`, `TECH_LEAD_ACCEPT`, `RISK_ACCEPT`, merge authority, and the deployment contract's PM-exclusive authorization were unchanged.
- 2026-08-04: By repository-owner decision, abolished all comment-based state evaluation (accept comments `PM_ACCEPT`, `TECH_LEAD_ACCEPT`, `RISK_ACCEPT`, and the `MERGE_READY` comment protocol) and deleted the `merge-policy` evaluator (workflow/scripts), unifying merge gates around actual required-check (`ci`, `public-safe`) success and GitHub mergeability.
  Rationale: a merge-readiness declaration in comments is a second source of truth that can diverge from actual CI, and its existence is risky; for simplicity as well, delegate access control to GitHub platform features (branch protection, merge permissions, and so on), not a bespoke comment protocol, and judge deployability only through test/lint/build success.
  Jeonnam's independent review, Ponytail, and actual UI/API QA remain recommended practices recorded as PR review comments, but are not merge prerequisites.
  Deleted `.github/workflows/merge-policy.yml`, `scripts/merge-policy-check.mjs`, `scripts/merge-policy-check-lib.mjs`, and `scripts/merge-policy-check.test.mjs`.
  No GitHub repository configuration change was needed because branch protection already required only `ci` and `public-safe`, not `merge-policy`.
  High-risk classification, deployment-contract path definitions, and CLI evidence priorities remain review/checker-authoring practices.
- 2026-08-04: Added the v0.6.22 incident (PR #586 merged before `ci` completed, bringing seven backend ESLint errors into main; Release v0.6.22 was stopped fail-closed only during Jenkins deployment) as concrete evidence of second-source-of-truth risk, and noted that the same incident already led to the deployment pipeline CI-status gates in PR #591, #593, and #596.
  The conclusion did not change; the existing decision's rationale was strengthened.
- 2026-07-17: Under Issue #37, linked conditional Draft/Ready status and independent-review classifications into operational rules in root `AGENTS.md` and the PR template.
  Authority boundaries and merge conditions were unchanged.
- 2026-07-16: Incorporated the approval scope of Code Owner review #4705528344 and ADR-002's deployment boundary, and changed status to `Accepted`.
- 2026-07-16: Accepted the Tech Lead delegation boundary and independent-review classifications in owner comment #4991669947.
- 2026-07-17: Separated merge review conditions into required review and Code Owner review for CODEOWNERS paths, aligning them with actual CODEOWNERS coverage.
- 2026-07-17: Defined blocker classification once in the independent-review paragraph and explicitly required no unresolved blockers for merging.
- 2026-07-23: Replaced mutual Code Owner review for ordinary PRs with Jeonnam's exact-head `MERGE_READY`.
  Added same-SHA manual accept by PM @GoBeromsu and Tech Lead @Lumiere001 for high-risk PRs and production releases.
- 2026-07-25: Under Issue #257, added a one-time emergency PM code-approval issuance window limited to PR #256; recorded PR #258, merged without the existing gates, as inactive history and prevented authority from taking effect until separate remediation passed the existing dual high-risk gates.
- 2026-07-28: Under Issue #274, relaxed high-risk merge accept to either the PM or Tech Lead while keeping deployment-contract paths PM-exclusive.
  Downgrading to `GENERAL` follows the same rule.
  Explicitly abolished after-the-fact owner confirmation.
- 2026-07-28: Under Issue #199, changed production release/redeployment approval to @GoBeromsu-only `RELEASE_ACCEPT role=PM` and abolished `RELEASE_ACCEPT role=TECH_LEAD` and `RELEASE_OVERRIDE role=PM`.
- 2026-07-28: Deleted the one-time emergency PM code-approval path limited to PR #256 (PM_EMERGENCY_ACCEPT·OWNER_CONFIRM) — introducing single accept removed the reason for a `TECH_LEAD_ACCEPT` replacement.
- 2026-07-30: Exempted PRs authored by @GoBeromsu from all review, `MERGE_READY`, and accept requirements — @Lumiere001's review is not a condition either.
  Only required checks (`ci` and `public-safe`) remain merge conditions; the exemption is based solely on author identity and does not apply when unconfirmed (fail-closed).
  Head/base SHA format and default-branch checks are not exempted.
- 2026-07-30: Made @GoBeromsu the sole owner for all `.github/CODEOWNERS` paths — keeping @Lumiere001 as co-owner causes GitHub to request review automatically on every @GoBeromsu-authored PR, delaying merges.
  The `merge-policy` evaluator reads only CODEOWNERS path patterns, not owner handles, so candidate-path detection is unchanged (the same 25 patterns).
  @Lumiere001 retains `MERGE_READY` and `TECH_LEAD_ACCEPT` authority — this change removes automatic requests, not review authority.
- 2026-07-30: Changed the definition of `CLI:` evidence from “repository-declared CLI verification” to “reproducible contract verification” and documented the priority order (structure → application tests → dedicated checkers → documentation rules).
  Requiring dedicated checkers as the only qualifying merge evidence had caused monotonically growing checker counts, so equivalent transfers into higher-priority mechanisms were excluded from weakening checks.
  Fail-closed security/deployment approval gates (public-safe/gitleaks, Jenkins release approval binding, and `merge-policy`) remained exceptions; marker names, formats, actors, and accept rules were unchanged.
- 2026-07-31: Following the ADR-002 amendment that publishing a production Release itself grants deployment authorization, removed current-contract descriptions of Jenkins comment-marker approval binding and identified the remaining controls as required checks and Jenkins technical verification.
  Historical marker contracts and their abolition remain preserved in this Changelog.
