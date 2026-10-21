# Pre-Deployment Verification

[한국어](pre-deploy-verify.md) | **English**

English translation of the [Korean source](pre-deploy-verify.md).
The Korean document remains authoritative.

Before the first deployment through a GitHub Release, perform a destructive migration rehearsal when needed, followed by a **dry run local to the deployment EC2 server**.
Each stage must pass before proceeding to the next.
The purpose is to prevent regressions in advance: the first deployment has no `PREV_TAG`, so automatic rollback is unavailable.
[server-runbook (Korean)](./server-runbook.md) is authoritative for server access, installation, and job procedures; this document covers verification procedures only.

The root `compose.yml` is authoritative for the production stack definition (nginx / backend / postgres).
Compose nginx binds only to `127.0.0.1:8081`.
Public ports `80/443` belong to the host nginx contract.

Production-like integration verification is handled by the CI required checks (`ci` and `public-safe`) and the Jenkins release path in M7 of [server-runbook (Korean)](./server-runbook.md) (image build, `prisma migrate deploy`, `nginx -t`, and health/rollback smoke tests).
There is no separate local Compose-based integration verification procedure.

## Notation

- The environment values below for local verification are **non-secret examples**.
  Do not put actual production values in this repository; they belong in the deployment server's `.env` / Jenkins Credentials Store.
- **Check before publishing a release:** confirm whether the Jenkins `oss-hub-production-env` credential contains `AUTH_INITIAL_ROLES`.
  Because `compose.yml` maps it optionally as `${AUTH_INITIAL_ROLES:-}`, **deployment succeeds even when the key is missing, but initial role seeding is silently disabled.**
  If the decision is not to use seeding, record that decision in the release notes.
  If a value is supplied, check its format first (comma-separated `githubId:ROLE` entries, where ROLE is `ADMIN|STAFF|STUDENT`) — **an invalid format prevents the backend from starting and causes deployment verification to fail.**
  Typical invalid inputs include a nonnumeric id, `0`, an unknown role, and duplicate githubId values.
- Fill in `<...>` and `REPLACE_*` placeholders locally.

## ⓪ Destructive Migration Rehearsal

If the release diff under `apps/backend/prisma/migrations/**` contains `DROP TABLE`, `DROP COLUMN`, or `DROP CONSTRAINT`, run a rehearsal **before shipping that release**.
Prisma has no down migrations, and the deployment path does not automatically restore the DB — once destructive DDL is committed, there is no automatic way to reverse it.
Local development, E2E, and CI apply migrations to an empty database each time, so the rehearsal is the only place where the migration runs against a database containing data.

The rehearsal for the three-stage legacy-submission migration (expand → bridge → contract, 2026-08-30) consists of these two commands.
Each command starts its own disposable PostgreSQL container and removes it when finished.
Neither reads the caller's `DATABASE_URL`, so there is no path to connecting to a production or development DB.

```sh
bash scripts/rehearse-legacy-submission-migrations.sh migrate
bash scripts/rehearse-legacy-submission-migrations.sh negative
```

Read the result from the JSON on the last output line.

- `{"status":"ok","scenario":"migrate",...}` means all three stages passed against a seeded DB, the row counts and id mappings matched before and after migration, and the backup taken immediately before the destructive DDL restored the original three tables (`submissions`, `revisions`, `reviews`, and `files` are the original row counts used for comparison).
- `{"status":"ok","scenario":"negative","lanes":9}` means each of the contract's nine preflight gates stopped on data that violated its condition, and the original three tables and `SubmissionFile."submissionRevisionId"` remained after it stopped.
- All other output is a failure — `... drifted` means a mapping diverged, and `... accepted ...` means a gate allowed data it should have rejected; **do not ship the release in either case.**

The rehearsal for the canonical user phone migration (`20260906174608_add_user_phone_canonical`, `v0.6.154`) consists of these two commands.

```sh
bash scripts/rehearse-user-phone-column.sh migrate
bash scripts/rehearse-user-phone-column.sh negative
```

- `{"status":"ok","scenario":"migrate",...,"check_enforced":true,"restored":true}` means this exact migration file passed against a DB containing values in `TeamMember.phone`, created nullable `User.phone`, enforced that `User_phone_digits_check` accepts only 10 or 11 digits, preserved other columns, rows, constraints, and indexes, and restored the deleted phone numbers from the immediately preceding dump.
- `{"status":"ok","scenario":"negative",...,"rolled_back":true}` means the same file explicitly stopped when drift had already removed the column, and because the entire file is one transaction, the preceding `ADD COLUMN` and CHECK were also rolled back.

Subsequent destructive migrations must have the same two layers: one container rehearsal script and one `scripts/*.test.mjs` file that locks its static contract into required CI.
The container rehearsal itself requires PostgreSQL to start, so it runs manually at this stage rather than in required CI ([ci-path-verification](../rules/ci-path-verification.en.md)).

### Recovery When a Migration Fails

If `prisma migrate deploy` stops during deployment, first determine **where it stopped**.

1. A preflight gate rejected the migration (the log contains `... requires reconciliation`).
   Because the entire migration file is one `BEGIN`/`COMMIT`, **nothing in the database has changed**, and there is no data to restore.
   Only one failure record remains in `_prisma_migrations`; later deployments will be rejected unless that record is resolved — follow the `prisma migrate resolve --rolled-back` procedure in M11 of [server-runbook (Korean)](./server-runbook.md) exactly, using the relevant migration name.
   Reconcile the data identified by the gate before deploying again.
2. The migration failed after passing the gates.
   Destructive DDL may already have been committed.
   The only recovery source is the deployment backup from M3 of [server-runbook (Korean)](./server-runbook.md), so restore from that dump.
   After restoration, verify that what the migration removed has actually returned — for the legacy-submission migration, these are the `Submission`, `SubmissionRevision`, and `Review` tables and the `SubmissionFile."submissionRevisionId"` column.
   Resolve `_prisma_migrations` after restoration in the same way as in item 1.

## ① Deployment Server Verification

Check the current state read-only from an operations session with Docker permissions.

```sh
container_id="$(docker ps -q \
  --filter label=com.docker.compose.project=oss-hub \
  --filter label=com.docker.compose.service=backend)"
test -n "$container_id"
docker inspect --format \
  'image={{.Config.Image}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} restart={{.RestartCount}} health={{.State.Health.Status}}' \
  "$container_id"

require_status() {
  actual="$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Host: jnu-oss-hub.com' \
    -H 'X-Vercel-Forwarded-For: 192.0.2.1' \
    --request "$2" "$3")"
  test "$actual" = "$1" || { printf 'FAIL %s %s expected=%s actual=%s\n' "$2" "$3" "$1" "$actual" >&2; return 1; }
}
require_status 404 GET  http://127.0.0.1:8081/
require_status 200 GET  http://127.0.0.1:8081/api/v1/health
require_status 404 GET  http://127.0.0.1:8081/api/v1/submission-files
require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files
require_status 404 GET  http://127.0.0.1:8081/api/v1/Submission-Files
require_status 401 POST http://127.0.0.1:8081/api/v1/Submission-Files
require_status 401 GET  http://127.0.0.1:8081/api/v1/submission-files/1
```

- The backend must report running and healthy status, restart count 0, and the target Release version and exact revision.
- The reserved synthetic client header in the loopback probe reproduces the Compose contract behind authenticated host nginx.
  A loopback root 404 expresses the contract that production Compose does not serve the browser frontend, while `/api/v1/health` returning 200 also verifies the PostgreSQL connection.
- An unauthenticated POST returning 401 proves that the request passed through nginx and reached the backend `SessionGuard`.
- This verification does not change containers, volumes, or images.
  Do not use `down -v` in production.
- If Docker permissions are unavailable, use the Jenkins build's exact Release/Image ID receipt.
  Do not record process start time alone as proof of OCI identity.

## ② Next Step

Only after both ⓪ and ① pass, proceed to the parameterless Release deployment or no-op rerun in M7 of [server-runbook (Korean)](./server-runbook.md).
[ADR-002 (Korean)](../decisions/ADR-002-CI-CD-파이프라인.md) is authoritative for the automatic trigger contract.
