#!/usr/bin/env bash
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
  "clock_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("github_id", "year", "visibility", "observed_at")
);
CREATE TABLE "CollectionCutoverLease" (
  "appId" BIGINT NOT NULL,
  "scope" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL DEFAULT 1,
  "ownerId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("appId", "scope")
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
TRUNCATE "github_user_activity_history", "GithubUserActivityMonthly";
SQL
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

insert_file="$(mktemp)"
reset_activity
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
assert_eq repository_pkey_one_row "$(ledger_count)" 1
assert_eq repository_pkey_updates_counts "$(ledger_commit)" 2

reset_activity
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
if ! grep -F '${fact.occurredAt}::timestamptz' "$fact_ts" >/dev/null; then
  echo 'FAIL contribution occurred_at is not bound as timestamptz' >&2
  exit 1
fi
if ! grep -F 'CURRENT_TIMESTAMP AS first_seen_at' "$fact_ts" >/dev/null; then
  echo 'FAIL contribution first_seen_at is not bound as timestamptz' >&2
  exit 1
fi
if grep -F 'fact."observedAt" AS first_seen_at' "$fact_ts" >/dev/null; then
  echo 'FAIL contribution first_seen_at still casts a timestamp without time zone' >&2
  exit 1
fi
echo 'PASS source_matches_statement'

echo "ledger collector race: passed on Postgres ${version}"
