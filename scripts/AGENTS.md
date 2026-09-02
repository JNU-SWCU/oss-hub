<!-- init:managed id=craft-init-4.0.0-scripts sha256=cfe71a2926eba71ba640ff37fa5dc76fe353d7b4bb80df984ab83399ae669044 -->
# scripts

## Ownership

- `scripts/` owns executable repository checks, local orchestration, diagnostics, hooks, and Jenkins support—not the policy those executables enforce.
- Keep command entry behavior in the named script and keep the governing rule in `../docs/rules/` or `../docs/deploy/`.
- Match existing shell and Node conventions instead of creating a second runner or fixture framework.

## Execution boundaries

- `check-*.sh` and `check-*.mjs` are static or contract checks; pair external-facing behavior with the adjacent `*.test.sh` or `*.test.mjs` fixture-based coverage.
- Contract tests use synthetic inputs only: never connect fixtures to production, GitHub write APIs, live secrets, or real personal data.
- `run-backend-integration.sh` creates isolated integration infrastructure; preserve its explicit `BACKEND_INTEGRATION_TEST_PATTERN` boundary.
- `docker-verify-local.sh`, `_compose-lib.sh`, and `dev.sh` can start or modify local infrastructure; make side effects explicit and fail closed.
- `diagnose-collection.sh` and related helpers are read-only diagnostics; do not print repository identifiers, student identifiers, credentials, or connection values.
- `setup-hooks.sh` changes local Git hook configuration; `tidy-branches.sh` changes local branch state—do not fold either into validation scripts.

## Production-sensitive paths

- `prune-deploy-backups.sh` can delete production backups and runs only on its approved Jenkins-success path; preserve the deletion guard and test it through its synthetic companion.
- `jenkins/validate-production-env.mjs`, `jenkins/validate-github-app-credentials.mjs`, and `check-jenkinsfile.sh` are deployment-boundary checks; never weaken fail-closed validation or expose credential material.
- `check-public-safe.sh` enforces public-safe scanning; its deny-list authority is `../docs/rules/security.md`.
- `team-state-check.mjs` reads GitHub state; keep its read-only behavior and separate it from append-only journal writes.

## Important paths

- `check-jenkinsfile.sh` — Jenkinsfile contract inspection.
- `check-public-safe.sh` — tracked-content public-safety scan.
- `run-backend-integration.sh` — isolated backend integration entry point.
- `docker-verify-local.sh` — local Compose verification boundary.
- `prune-deploy-backups.sh` — Jenkins-only destructive backup retention action.
- `../docs/rules/ci-path-verification.md` — canonical changed-path verification mapping.
<!-- /init:managed id=craft-init-4.0.0-scripts -->
