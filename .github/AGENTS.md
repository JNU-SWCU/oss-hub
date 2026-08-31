<!-- init:managed id=craft-init-4.0.0-github sha256=ec37461eb44c2955fc687144e11bf69035e9c381f2cb599315d942a4c8754659 -->
# .github

## Ownership

- `.github/` owns GitHub workflow definitions, CODEOWNERS routing, and issue/PR templates.
- `workflows/ci.yml` is the CI execution contract; `workflows/deploy.yml` is the release-to-Jenkins trigger boundary.
- `CODEOWNERS` routes high-risk review candidates but does not replace the final risk decision in `../docs/decisions/ADR-005-agent-driven-review-cycle.md`.

## CI trust boundaries

- Keep `pull_request` workflows safe for fork-controlled code: do not inject secrets or write-capable credentials into PR jobs.
- Pass PR-controlled text to commands through environment variables rather than inline GitHub expression interpolation.
- Preserve the always-created required `ci` and `public-safe` checks and their names; merge status is determined by their actual GitHub results.
- Keep workflow-level path filters out of `workflows/ci.yml`; inner `dorny/paths-filter` conditions select affected lanes while retaining a check for every PR.
- `team-state-drift` is advisory; do not make it a substitute for GitHub Issue/PR state.
- `public-safe-issue` scans Issue and comment text; preserve its public-input handling and deny-list enforcement.
- `workflows/deploy.yml` only triggers the approved Jenkins release flow; do not add checkout, build, migration, rollback, or production mutations there.

## Templates and routing

- Keep `pull_request_template.md` focused on PR evidence and preserve public-safe wording.
- `ISSUE_TEMPLATE/work-ticket.md` is the work-ticket template; do not turn it into a second policy store.
- In `CODEOWNERS`, retain GitHub pattern semantics and ordering: later matching rules take precedence.
- When adding a CI path category, update the canonical mapping in `../docs/rules/ci-path-verification.md` in the same change.

## Important paths

- `workflows/ci.yml` — PR CI, commitlint, public-safe, and advisory drift jobs.
- `workflows/deploy.yml` — release-trigger handoff to Jenkins.
- `CODEOWNERS` — review-candidate routing patterns.
- `pull_request_template.md` — PR body baseline.
- `ISSUE_TEMPLATE/work-ticket.md` — scoped work-ticket input.
- `../docs/rules/security.md` — canonical public-safe deny-list.
<!-- /init:managed id=craft-init-4.0.0-github -->
