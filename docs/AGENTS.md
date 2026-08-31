<!-- init:managed id=craft-init-4.0.0-docs sha256=32e84084e7a823bf63071d1f201f9ac1ac8753e41d8df18a520a6dd71d0d4493 -->
# docs

## Ownership

- `docs/` is the canonical home for repository rules, decisions, runbooks, handoff records, and execution plans; link to a source instead of duplicating its policy.
- `architecture.md` maps components, `design.md` owns frontend visual-system rules, and `onboarding.md` owns newcomer guidance.
- Keep one fact in its owning document; implementation state belongs in GitHub Issue/PR rather than a parallel status narrative.

## Canonical stores

- `decisions/README.md` indexes ADRs; the affected ADR is the canonical record for an architectural or operational decision.
- `rules/security.md`, `rules/frontend.md`, `rules/local-dev.md`, `rules/pr-scope.md`, and `rules/ci-path-verification.md` each own their named contracts.
- `deploy/server-runbook.md`, `deploy/pre-deploy-verify.md`, and `deploy/demo-runbook.md` own deployment procedure; do not restate commands or approval flows elsewhere.
- `exec-plan/active/` contains owner-scoped live plans and `exec-plan/archive/` retains completed ones; preserve their separation.
- `handoff/TEAM-STATE.md` is only the journal index; append work updates only to `handoff/team-state/<handle>.md`.
- `handoff/TEAM-STATE.archive.md` is frozen and must not be edited.
- `research/<slug>.md` records evidence for a decision; promote a decision into its ADR rather than treating research as authority.

## High-risk documentation constraints

- This is a public repository: apply `rules/security.md` before adding examples, logs, screenshots, fixture text, credentials, host details, or personal data.
- Do not manufacture status, verification, incidents, ownership, dates, or command results; cite durable repository paths or GitHub records.
- Preserve Markdown link targets when moving canonical material and update inbound indexes only when their source changes.
- Write policy once at the narrowest owning path; child documents may link upward but must not shadow a more specific source.

## Important paths

- `decisions/README.md` — ADR index and lifecycle.
- `rules/security.md` — public-safe content boundary.
- `rules/ci-path-verification.md` — required verification by changed path.
- `handoff/TEAM-STATE.md` and `handoff/team-state/` — index and append-only member journals.
- `deploy/server-runbook.md` — production operation authority.
- `design.md` — frontend design-system contract.
<!-- /init:managed id=craft-init-4.0.0-docs -->
