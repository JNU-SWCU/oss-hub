#!/usr/bin/env bash
# Two sessions against the collector ledger write, plus a Seoul fact-timestamp pin.
# Postgres 17.11. No production data.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
backend="$root/apps/backend"
activity_ts="$backend/src/github/repository-provision-job.repository.ts"
fact_ts="$backend/src/github/collection-incremental.repository.ts"
db="ledger_collector_race_$$"
container=""
holder_pid=""
port=""

psql_db() {
  psql -h 127.0.0.1 -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  status=$?
  if [ -n "$holder_pid" ]; then
    kill "$holder_pid" >/dev/null 2>&1 || true
    wait "$holder_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo 'ledger collector race: Docker is required' >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo 'ledger collector race: psql is required' >&2
  exit 1
fi

container="ledger-collector-race-$$"
docker run -d --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1::5432 \
  postgres:17.11 -c timezone=UTC >/dev/null
port="$(docker port "$container" 5432/tcp | head -n 1 | sed 's/.*://')"
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if pg_isready -h 127.0.0.1 -p "$port" -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo 'ledger collector race: Postgres 17.11 did not become ready' >&2
  exit 1
fi

version="$(psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -At -c 'SHOW server_version;')"
case "$version" in
  17.11*) ;;
  *)
    echo "ledger collector race: expected Postgres 17.11, got ${version}" >&2
    exit 1
    ;;
esac

psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null
psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${db}\";" >/dev/null

psql_db >/dev/null <<'SQL'
CREATE TYPE "ActivityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TABLE "GithubUserActivityHistory" (
  "githubId" BIGINT NOT NULL,
  "githubLogin" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "visibility" "ActivityVisibility" NOT NULL DEFAULT 'PUBLIC',
  "commitCount" INTEGER NOT NULL DEFAULT 0,
  "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "repositoryCount" INTEGER NOT NULL DEFAULT 0,
  "starCount" INTEGER NOT NULL DEFAULT 0,
  "observedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("githubId", "year", "visibility")
);
CREATE TABLE "GithubUserActivityMonthly" (
  "githubId" BIGINT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "commitCount" INTEGER NOT NULL DEFAULT 0,
  "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "repositoryCount" INTEGER NOT NULL DEFAULT 0,
  "starCount" INTEGER NOT NULL DEFAULT 0,
  "observedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("githubId", "year", "month")
);
CREATE TABLE "github_user_activity_history" (
  "github_id" BIGINT NOT NULL,
  "year" INTEGER NOT NULL,
  "visibility" "ActivityVisibility" NOT NULL,
  "commit_count" INTEGER NOT NULL,
  "pull_request_count" INTEGER NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "repository_count" INTEGER NOT NULL,
  "star_count" INTEGER NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("github_id", "year", "visibility", "observed_at")
);
CREATE TABLE "CollectionCommitFact" (
  "repositoryId" TEXT NOT NULL,
  "sha" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT
);
CREATE TABLE "GithubRepository" (
  "id" TEXT PRIMARY KEY,
  "githubRepositoryId" BIGINT NOT NULL
);
CREATE TABLE "repo" (
  "github_repo_id" BIGINT PRIMARY KEY
);
CREATE TABLE "contribution" (
  "repo_id" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "github_key" TEXT NOT NULL,
  "author_github_id" BIGINT,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("repo_id", "kind", "github_key")
);
CREATE TABLE "contribution_copy" (
  LIKE "contribution" INCLUDING ALL
);
CREATE TABLE "contribution_unpinned" (
  LIKE "contribution" INCLUDING ALL
);
SQL

assert_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL ${name}: got ${got} want ${want}" >&2
    exit 1
  fi
  echo "PASS ${name}"
}

reset_activity() {
  psql_db >/dev/null <<'SQL'
TRUNCATE "github_user_activity_history", "GithubUserActivityHistory", "GithubUserActivityMonthly";
SQL
}

seed_legacy() {
  local github_id="$1" commit_count="$2" observed_at="$3"
  psql_db >/dev/null <<SQL
INSERT INTO "GithubUserActivityHistory" (
  "githubId", "githubLogin", "year", "visibility",
  "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount",
  "observedAt"
) VALUES (
  ${github_id}, 'octocat', 2026, 'PUBLIC',
  ${commit_count}, 2, 3, 4, 5,
  TIMESTAMP '${observed_at}'
);
SQL
}

legacy_commit() {
  local github_id="$1"
  psql_db -At -c "SELECT \"commitCount\" FROM \"GithubUserActivityHistory\" WHERE \"githubId\" = ${github_id};"
}

ledger_count() {
  psql_db -At -c 'SELECT count(*) FROM "github_user_activity_history";'
}

ledger_commit() {
  psql_db -At -c 'SELECT "commit_count" FROM "github_user_activity_history" ORDER BY "observed_at" DESC LIMIT 1;'
}

wait_for_holder_lock() {
  local i held
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if ! kill -0 "$holder_pid" >/dev/null 2>&1; then
      echo 'FAIL holder exited before the collector waited' >&2
      cat "$holder_log" >&2
      exit 1
    fi
    held="$(psql_db -At -c "SELECT count(*) FROM pg_locks WHERE relation = 'github_user_activity_history'::regclass AND mode = 'ExclusiveLock' AND granted;")"
    if [ "$held" != "0" ]; then
      return 0
    fi
    sleep 0.05
  done
  echo 'FAIL holder did not lock github_user_activity_history' >&2
  cat "$holder_log" >&2
  exit 1
}

start_holder() {
  local insert_file="$1"
  holder_log="$(mktemp)"
  {
    printf '%s\n' 'BEGIN;'
    printf '%s\n' 'LOCK TABLE "github_user_activity_history" IN EXCLUSIVE MODE;'
    cat <<'SQL'
DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1..400 LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_locks
      WHERE relation = 'github_user_activity_history'::regclass
        AND NOT granted
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION 'collector did not wait on github_user_activity_history';
END $$;
SQL
    cat "$insert_file"
    printf '%s\n' 'COMMIT;'
  } | psql_db >"$holder_log" 2>&1 &
  holder_pid=$!
}

finish_holder() {
  local status
  set +e
  wait "$holder_pid"
  status=$?
  set -e
  holder_pid=""
  if [ "$status" -ne 0 ]; then
    echo 'FAIL holder did not commit' >&2
    cat "$holder_log" >&2
    exit 1
  fi
}

run_probe() {
  local mode="$1"
  local log="$2"
  set +e
  (
    cd "$backend"
    DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/${db}" \
      pnpm exec ts-node --transpile-only prisma/github-ledger-collector-race.probe.ts "$mode"
  ) >"$log" 2>&1
  probe_status=$?
  set -e
}

reset_activity
seed_legacy 77 1 '2026-06-01 00:00:00'
insert_file="$(mktemp)"
cat >"$insert_file" <<'SQL'
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  77, 2026, 'PUBLIC',
  8, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-06-02 00:00:00+00'
);
SQL
start_holder "$insert_file"
wait_for_holder_lock
old_log="$(mktemp)"
set +e
psql_db >"$old_log" 2>&1 <<'SQL'
BEGIN;
UPDATE "GithubUserActivityHistory"
SET "commitCount" = 8,
    "observedAt" = TIMESTAMP '2026-06-02 00:00:00'
WHERE "githubId" = 77 AND "year" = 2026 AND "visibility" = 'PUBLIC';
SELECT count(*) FROM "github_user_activity_history"
WHERE "github_id" = 77
  AND "observed_at" = TIMESTAMPTZ '2026-06-02 00:00:00+00';
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  77, 2026, 'PUBLIC',
  8, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-06-02 00:00:00+00'
);
COMMIT;
SQL
old_status=$?
set -e
finish_holder
if [ "$old_status" -eq 0 ]; then
  echo 'FAIL old_pkey_race_should_error' >&2
  cat "$old_log" >&2
  exit 1
fi
pkey_line="$(grep -F 'github_user_activity_history_pkey' "$old_log" | head -n 1 || true)"
if [ -z "$pkey_line" ]; then
  echo 'FAIL old_pkey_race_should_name_the_primary_key' >&2
  cat "$old_log" >&2
  exit 1
fi
printf '%s\n' "$pkey_line"
echo 'PASS old_pkey_race_errors'
assert_eq old_pkey_rolls_back_legacy "$(legacy_commit 77)" 1

reset_activity
seed_legacy 78 5 '2026-06-01 00:00:00'
cat >"$insert_file" <<'SQL'
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  78, 2026, 'PUBLIC',
  5, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-06-01 00:00:00+00'
);
SQL
start_holder "$insert_file"
wait_for_holder_lock
psql_db >/dev/null <<'SQL'
BEGIN;
UPDATE "GithubUserActivityHistory"
SET "commitCount" = 5,
    "observedAt" = TIMESTAMP '2026-06-03 00:00:00'
WHERE "githubId" = 78 AND "year" = 2026 AND "visibility" = 'PUBLIC';
SELECT count(*) FROM "github_user_activity_history" WHERE "github_id" = 78;
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  78, 2026, 'PUBLIC',
  5, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-06-03 00:00:00+00'
);
COMMIT;
SQL
finish_holder
assert_eq old_same_count_two_rows "$(ledger_count)" 2

reset_activity
seed_legacy 42 1 '2026-04-01 00:00:00'
cat >"$insert_file" <<'SQL'
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  42, 2026, 'PUBLIC',
  1, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-04-02 00:00:00+00'
);
SQL
start_holder "$insert_file"
wait_for_holder_lock
probe_log="$(mktemp)"
run_probe pkey "$probe_log"
finish_holder
if [ "$probe_status" -ne 0 ]; then
  echo 'FAIL repository_pkey_race' >&2
  cat "$probe_log" >&2
  exit 1
fi
echo 'PASS repository_pkey_no_error'
assert_eq repository_pkey_keeps_legacy "$(legacy_commit 42)" 2
assert_eq repository_pkey_one_row "$(ledger_count)" 1
assert_eq repository_pkey_updates_counts "$(ledger_commit)" 2

reset_activity
seed_legacy 42 5 '2026-04-01 00:00:00'
cat >"$insert_file" <<'SQL'
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
) VALUES (
  42, 2026, 'PUBLIC',
  5, 2, 3, 4, 5,
  TIMESTAMPTZ '2026-04-01 00:00:00+00'
);
SQL
start_holder "$insert_file"
wait_for_holder_lock
run_probe same-count "$probe_log"
finish_holder
if [ "$probe_status" -ne 0 ]; then
  echo 'FAIL repository_same_count_race' >&2
  cat "$probe_log" >&2
  exit 1
fi
echo 'PASS repository_same_count_no_error'
assert_eq repository_same_count_one_row "$(ledger_count)" 1
later_rows="$(psql_db -At -c "SELECT count(*) FROM \"github_user_activity_history\" WHERE \"observed_at\" = TIMESTAMPTZ '2026-04-03 00:00:00+00';")"
assert_eq repository_same_count_skips_later "$later_rows" 0
assert_eq repository_same_count_keeps_legacy "$(legacy_commit 42)" 5

reset_activity
run_probe logical "$probe_log"
if [ "$probe_status" -ne 0 ]; then
  echo 'FAIL repository_logical' >&2
  cat "$probe_log" >&2
  exit 1
fi
assert_eq logical_two_rows "$(ledger_count)" 2
assert_eq logical_latest_commit "$(ledger_commit)" 10
may_first="$(psql_db -At -c "SELECT \"commit_count\" FROM \"github_user_activity_history\" WHERE \"observed_at\" = TIMESTAMPTZ '2026-05-01 00:00:00+00';")"
assert_eq logical_same_instant_updates "$may_first" 9
echo 'PASS repository_logical'

psql_db >/dev/null <<'SQL'
INSERT INTO "GithubRepository" ("id", "githubRepositoryId") VALUES ('repo-1', 1001);
INSERT INTO "repo" ("github_repo_id") VALUES (1001);
INSERT INTO "CollectionCommitFact" (
  "repositoryId", "sha", "committedAt", "observedAt", "authorGithubId"
) VALUES (
  'repo-1', 'abc',
  TIMESTAMP '2026-03-01 00:00:00',
  TIMESTAMP '2026-03-02 03:04:05.678',
  99
);
SQL

psql_db >/dev/null <<'SQL'
SET TIME ZONE 'Asia/Seoul';
INSERT INTO "contribution" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'commit',
  fact."sha",
  fact."authorGithubId",
  fact."committedAt" AT TIME ZONE 'UTC',
  fact."observedAt" AT TIME ZONE 'UTC'
FROM "CollectionCommitFact" AS fact
JOIN "GithubRepository" AS repository
  ON repository."id" = fact."repositoryId"
JOIN "repo" ON "repo"."github_repo_id" = repository."githubRepositoryId";

INSERT INTO "contribution_unpinned" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'commit',
  fact."sha",
  fact."authorGithubId",
  fact."committedAt",
  fact."observedAt"
FROM "CollectionCommitFact" AS fact
JOIN "GithubRepository" AS repository
  ON repository."id" = fact."repositoryId"
JOIN "repo" ON "repo"."github_repo_id" = repository."githubRepositoryId";
SQL

psql_db >/dev/null <<'SQL'
BEGIN;
SET LOCAL TIME ZONE 'UTC';
INSERT INTO "contribution_copy" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'commit',
  fact."sha",
  fact."authorGithubId",
  fact."committedAt",
  fact."observedAt"
FROM "CollectionCommitFact" AS fact
JOIN "GithubRepository" AS repository
  ON repository."id" = fact."repositoryId"
JOIN "repo" ON "repo"."github_repo_id" = repository."githubRepositoryId";
COMMIT;
SQL

same_instant="$(psql_db -At <<'SQL'
SELECT
  (collector."occurred_at" = copied."occurred_at")
  AND (collector."first_seen_at" = copied."first_seen_at")
FROM "contribution" AS collector
JOIN "contribution_copy" AS copied
  ON copied."github_key" = collector."github_key";
SQL
)"
assert_eq seoul_collector_matches_utc_copy "$same_instant" t

occurred_utc="$(psql_db -At -c "SELECT to_char(\"occurred_at\" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') FROM \"contribution\";")"
seen_utc="$(psql_db -At -c "SELECT to_char(\"first_seen_at\" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') FROM \"contribution\";")"
assert_eq seoul_occurred_at_is_utc "$occurred_utc" '2026-03-01 00:00:00.000'
assert_eq seoul_first_seen_at_is_utc "$seen_utc" '2026-03-02 03:04:05.678'

unpinned_gap="$(psql_db -At -c "SELECT (unpinned.\"occurred_at\" = collector.\"occurred_at\" - interval '9 hours') AND (unpinned.\"first_seen_at\" = collector.\"first_seen_at\" - interval '9 hours') AND (unpinned.\"occurred_at\" IS DISTINCT FROM collector.\"occurred_at\") FROM \"contribution_unpinned\" AS unpinned JOIN \"contribution\" AS collector ON collector.\"github_key\" = unpinned.\"github_key\";")"
assert_eq seoul_unpinned_is_nine_hours_early "$unpinned_gap" t

if ! grep -F 'ON CONFLICT ("github_id", "year", "visibility", "observed_at") DO UPDATE SET' "$activity_ts" >/dev/null; then
  echo 'FAIL activity writer is missing the conflict update' >&2
  exit 1
fi
if ! grep -F 'WHERE NOT EXISTS' "$activity_ts" >/dev/null; then
  echo 'FAIL activity writer is missing the latest-count guard' >&2
  exit 1
fi
if grep -F 'githubUserActivityObservation' "$activity_ts" >/dev/null; then
  echo 'FAIL activity writer still uses a separate read and insert' >&2
  exit 1
fi
if ! grep -F "AT TIME ZONE 'UTC' AS occurred_at" "$fact_ts" >/dev/null; then
  echo 'FAIL fact occurred_at is not pinned to UTC' >&2
  exit 1
fi
if ! grep -F 'fact."observedAt" AT TIME ZONE '"'"'UTC'"'"' AS first_seen_at' "$fact_ts" >/dev/null; then
  echo 'FAIL fact first_seen_at is not pinned to UTC' >&2
  exit 1
fi
if grep -F 'fact."observedAt" AS first_seen_at' "$fact_ts" >/dev/null; then
  echo 'FAIL fact first_seen_at still casts without a UTC pin' >&2
  exit 1
fi
echo 'PASS source_matches_statement'

echo "ledger collector race: passed on Postgres ${version}"
