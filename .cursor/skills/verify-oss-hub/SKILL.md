---
name: verify-oss-hub
description: >-
  Drive the OSS Hub Next.js app and NestJS API on an isolated local Postgres
  17 database. Use when launching oss-hub from an empty database, checking that
  a local instance is worth driving, exercising a mapped feature, capturing
  proof, or tearing that instance down.
---

# Verify OSS Hub

The primary surface is the Next.js app. The NestJS API is served at `/api/v1` on the backend port and again through the frontend rewrite. Public pages such as the program list and ranking need no GitHub login. Signed-in pages use the `oss_session_dev` cookie that `verify-oss-hub session` mints for a seeded user. That cookie is the same session the HTTP tests issue. Do not complete the GitHub OAuth callback and do not call the real GitHub API.

Read `features/README.md` before driving. Run one feature file as written. A missing precondition is a failed run. Record the command and the missing precondition in that feature's Gotchas. Do not skip an assertion to make the run pass.

## Launch

From the repository root, with Node.js 24 or newer, pnpm 11, and a running Docker daemon:

```bash
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub launch
```

`pnpm install` must already have succeeded. The command does not install Node, Docker, or dependencies.

Launch creates a private Compose project from `compose.dev.yml`. It does not use the default project name, so it does not attach to a developer's `pgdata_dev` volume. Postgres and the S3 mock bind on `127.0.0.1` at free ports. The database name is `oss_hub_verify`. The app ports are also free ports, not 3000 or 4000.

The command then runs `prisma migrate deploy`, loads the demo seed with `SEED_PROFILE=demo`, and applies `scripts/seed-verification.ts`. That scaffold writes only when `DATABASE_URL` names `oss_hub_verify` on `127.0.0.1`. It is not a Prisma seed profile and it is not part of the demo seed that can run in production. It adds two ranking students with no profile columns set, one repository on the internship team, and daily contribution counts on the program's Seoul start day. It checks that `seed:demo:user:staff-lead` is already an approved staff profile. Then launch starts `nest start` and `next dev`. GitHub App variables are unset for this process. OAuth client values are the non-working placeholders from `.envrc.example`. `MAIL_MODE=dry-run`.

Ready is this stderr line:

```text
verify-oss-hub: ready frontend=http://127.0.0.1:<frontend-port> backend=http://127.0.0.1:<backend-port> evidence=<evidence-dir>
```

Before that line, `GET /api/v1/health` returns `{"status":"ok"}`, `GET /api/v1/programs` includes `2026 하계 SW 현장실습 연계 프로그램`, and `GET /programs` on the frontend returns 200. A health response alone is not ready.

If a recorded instance still has live server pids, launch exits 2 and does not start another one. Two verification runs must not share a database. If the state file exists but the pids are dead, launch deletes that instance and starts a new one.

A failed launch runs the same cleanup as `verify-oss-hub cleanup`.

## Doctor

Run this before trusting an instance, and whenever a drive looks wrong:

```bash
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub doctor
```

Doctor is read-only. It passes only when all of these are true.

- Node.js is 24 or newer.
- The state file says the instance is ready.
- The recorded backend and frontend pids are alive.
- `/proc/net/tcp` and `/proc/net/tcp6` show the backend and frontend ports in `LISTEN`, and the socket inode belongs to the recorded pid or one of its children.
- `GET /api/v1/health` is JSON `{"status":"ok"}`.
- `GET /api/v1/programs?page=1&pageSize=20&status=all&search=` contains the seeded program name.
- `DATABASE_URL` is `127.0.0.1` or `localhost` and the database name is `oss_hub_verify`.
- The Compose project for this run has a running `postgres` service.

Success prints `doctor ok` with the frontend URL, backend URL, and Compose project name. Anything else is a failed doctor. Do not drive that instance.

## Drive

Install Playwright's Chromium once before the first browser drive:

```bash
pnpm --filter frontend exec playwright install chromium
```

The browser script launches Playwright Chromium headless with `--no-sandbox`.

Mapped commands:

```bash
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive browse-programs
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive activity-ranking
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive team-management
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive team-activity
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive github-ledger
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub session seed:demo:user:kim-doyoon
```

`drive` runs doctor first. `session` also runs doctor, then prints one line, `oss_session_dev=<token>`, and nothing else. Put that cookie on `127.0.0.1` for a signed-in browser. Do not print the token into a committed file.

`github-ledger` runs `CollectionSyncService` against an in-memory GitHub client, the same boundary as `collection-sync.member-filter.integration.spec.ts`. The client never opens a socket to `api.github.com`. The collector writes the old fact tables. The command then runs `apps/backend/prisma/github-ledger-copy.sql` and `apps/backend/prisma/github-ledger-verify.sql` inside the verification database. Every verify row must have equal expected and actual counts. `latest_commit_sum`, `latest_pull_request_sum`, `latest_issue_sum`, and `latest_star_sum` must also be greater than zero.

Selectors, URLs, and the pass condition for each feature are in `features/`.

## Evidence

Proof goes under `.cursor/skills/verify-oss-hub/evidence/<run-id>/`. That directory is gitignored. Cleanup does not delete it.

A passing `browse-programs` drive writes `browse-programs/list.png`, `search.png`, `detail.png`, `list.txt`, `detail.txt`, `search-api.json`, and `program-row.txt`. The screenshots show the list, the filtered list, and the detail page. `search-api.json` is the search response. `program-row.txt` is the `Program` row.

A passing `activity-ranking` drive writes `activity-ranking/ranking.png`, `ranking.txt`, `ranking-api.json`, `asserted.txt`, and `activity-rows.txt`. The first two public rows are `verify-rank-alpha` then `verify-rank-beta`, with totals 18 and 8.

A passing `team-management` drive writes `team-management/student.png`, `staff.png`, `anonymous.png`, the matching text files, `staff-api.json`, and `team-row.txt`.

A passing `team-activity` drive writes `team-activity/chart.png`, `chart.txt`, `activity-api.json`, `asserted.txt`, and `contribution-rows.txt`. The chart totals match the scaffold contribution counts.

A passing `github-ledger` drive writes `github-ledger/collector.json`, `old-tables.txt`, `copy.log`, `verify.tsv`, and `activity-copy.txt`. `collector.json` records at least one commit fact and one pull request fact. `verify.tsv` has one tab-separated row per check, and the last two columns match. `activity-copy.txt` shows the old history row and the ledger row both at commit 11, pull request 2, issue 1, and star 3.

Capture the action and the result. A final screenshot without the API body or the database row is not proof. For a read, the second view is the API response plus the SQL row. For the ledger, the second view is `verify.tsv` after the copy.

## Cleanup

```bash
.cursor/skills/verify-oss-hub/scripts/verify-oss-hub cleanup
```

Cleanup sends `SIGTERM` to the recorded backend and frontend process groups, then runs `docker compose down -v` for the recorded project name only. It deletes `.cursor/skills/verify-oss-hub/run/` and leaves `.cursor/skills/verify-oss-hub/evidence/`. It does not kill processes by name. With no state file it prints `no instance state to clean` and exits 0.

Run cleanup after a failed launch too. The launch command already does that when startup fails before ready.

## Helpers

| Command | What it does |
| --- | --- |
| `scripts/verify-oss-hub launch` | Starts the isolated stack from an empty database. |
| `scripts/verify-oss-hub doctor` | Read-only check that this instance is the one to drive. |
| `scripts/verify-oss-hub drive browse-programs` | Drives the seeded program list, search, and detail. |
| `scripts/verify-oss-hub drive activity-ranking` | Drives the public ranking and checks the scaffold order. |
| `scripts/verify-oss-hub drive team-management` | Drives the student directory, the staff list, and the anonymous gate. |
| `scripts/verify-oss-hub drive team-activity` | Drives the weekly chart and checks the scaffold counts. |
| `scripts/verify-oss-hub drive github-ledger` | Runs the synthetic collector, copy SQL, and verify SQL. |
| `scripts/verify-oss-hub session <user-id>` | Prints an `oss_session_dev` cookie for a seeded user. |
| `scripts/verify-oss-hub cleanup` | Stops the recorded instance and keeps evidence. |
| `scripts/verify-oss-hub.test.sh` | Checks usage, a missing instance, and the Node.js 24 guard. |

Paths are relative to `.cursor/skills/verify-oss-hub/`. From the repository root, prefix them with `.cursor/skills/verify-oss-hub/`.
