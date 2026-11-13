#!/usr/bin/env bash
# The deploy copy leaves the activity ledger alone, and ledger verify reports
# same-value runs, fails on a standing drift, and keeps the Seoul floor
# report-only. Postgres 17. No production data.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
copy_sql="$root/apps/backend/prisma/github-ledger-copy.sql"
verify_sql="$root/apps/backend/prisma/github-ledger-verify.sql"
verify_sh="$root/apps/backend/prisma/github-ledger-verify.sh"
db="ledger_history_change_$$"
container=""

psql_admin() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

psql_db() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}

psql_file() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" -f - <"$1"
}

cleanup() {
  status=$?
  if [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo 'ledger history change: Docker is required' >&2
  exit 1
fi

container="ledger-history-change-$$"
docker run -d --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17 >/dev/null
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo 'ledger history change: Postgres 17 did not become ready' >&2
  exit 1
fi

version="$(psql_admin -At -c 'SHOW server_version;')"
case "$version" in
  17*) ;;
  *)
    echo "ledger history change: expected Postgres 17, got ${version}" >&2
    exit 1
    ;;
esac

psql_admin -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null
psql_admin -c "CREATE DATABASE \"${db}\";" >/dev/null

schema_file="$(mktemp)"
cat >"$schema_file" <<'SQL'
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE "RepositorySource" AS ENUM ('ORG_PROVISIONED', 'EXTERNAL_PUBLIC');
CREATE TYPE "contribution_kind" AS ENUM ('commit', 'pull_request', 'issue', 'release');
CREATE TYPE "ActivityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TABLE "Team" (
  "id" TEXT PRIMARY KEY,
  "archivedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "GithubRepository" (
  "id" TEXT PRIMARY KEY,
  "githubRepositoryId" BIGINT NOT NULL UNIQUE,
  "nameWithOwner" TEXT NOT NULL,
  "source" "RepositorySource" NOT NULL,
  "presence" TEXT NOT NULL DEFAULT 'PRESENT',
  "teamId" TEXT REFERENCES "Team"("id"),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "repo" (
  "github_repo_id" BIGINT PRIMARY KEY,
  "owner_name" TEXT NOT NULL,
  "source" "RepositorySource" NOT NULL,
  "gone_at" TIMESTAMPTZ(3)
);
CREATE TABLE "team_repo" (
  "team_id" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE RESTRICT,
  "repo_id" BIGINT NOT NULL REFERENCES "repo"("github_repo_id") ON DELETE RESTRICT,
  "valid_from" TIMESTAMPTZ(3) NOT NULL,
  "valid_to" TIMESTAMPTZ(3),
  "period" tstzrange GENERATED ALWAYS AS (tstzrange("valid_from", "valid_to", '[)')) STORED NOT NULL,
  PRIMARY KEY ("team_id", "repo_id", "valid_from"),
  CHECK ("valid_to" IS NULL OR "valid_from" < "valid_to"),
  CONSTRAINT "team_repo_repo_id_period_excl" EXCLUDE USING gist ("repo_id" WITH =, "period" WITH &&),
  CONSTRAINT "team_repo_team_id_period_excl" EXCLUDE USING gist ("team_id" WITH =, "period" WITH &&)
);
CREATE TABLE "contribution" (
  "repo_id" BIGINT NOT NULL,
  "kind" "contribution_kind" NOT NULL,
  "github_key" TEXT NOT NULL,
  "author_github_id" BIGINT,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("repo_id", "kind", "github_key")
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
CREATE VIEW contributor_standing AS
SELECT
  latest.github_id,
  latest.year,
  latest.visibility,
  latest.commit_count,
  latest.pull_request_count,
  latest.issue_count,
  latest.repository_count,
  latest.star_count,
  latest.observed_at
FROM (
  SELECT DISTINCT ON (
    observation.github_id,
    observation.year,
    observation.visibility
  )
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.commit_count,
    observation.pull_request_count,
    observation.issue_count,
    observation.repository_count,
    observation.star_count,
    observation.observed_at
  FROM github_user_activity_history AS observation
  ORDER BY
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.observed_at DESC
) AS latest;
SQL
psql_file "$schema_file" >/dev/null
rm -f "$schema_file"

reset_activity() {
  psql_db >/dev/null <<'SQL'
TRUNCATE "github_user_activity_history";
SQL
}

run_copy() {
  psql_file "$copy_sql" >/dev/null
}

history_count() {
  psql_db -At -c 'SELECT count(*) FROM "github_user_activity_history";'
}

assert_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL ${name}: got ${got} want ${want}" >&2
    exit 1
  fi
  echo "PASS ${name}"
}

run_verify() {
  docker cp "$verify_sh" "$container:/tmp/github-ledger-verify.sh" >/dev/null
  docker cp "$verify_sql" "$container:/tmp/github-ledger-verify.sql" >/dev/null
  docker exec -e PGUSER=postgres -e PGDATABASE="$db" -e LEDGER_VERIFY_SQL=/tmp/github-ledger-verify.sql \
    "$container" sh /tmp/github-ledger-verify.sh
}

reset_activity
psql_db >/dev/null <<'SQL'
INSERT INTO "github_user_activity_history" (
  "github_id", "year", "visibility",
  "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
  "observed_at"
)
SELECT 42, 2026, 'PUBLIC', 7, 3, 2, 4, 1,
  timestamptz '2020-01-01 00:00:00+00' + (n || ' hours')::interval
FROM generate_series(1, 320) AS n;
SQL
run_copy
assert_eq copy_leaves_ledger "$(history_count)" 320
verify_out="$(run_verify)"
verify_status=$?
assert_eq duplicate_verify_exit "$verify_status" 0
printf '%s\n' "$verify_out" | grep -qx 'history_consecutive_same_value=319'
echo 'PASS duplicate_verify_logs_319'
if printf '%s\n' "$verify_out" | grep -qx 'verify_mismatch'; then
  echo 'FAIL duplicate_verify_should_match' >&2
  exit 1
fi
echo 'PASS duplicate_verify_matches'

psql_db >/dev/null <<'SQL'
BEGIN;
ALTER VIEW contributor_standing RENAME TO contributor_standing_kept;
CREATE VIEW contributor_standing AS
SELECT github_id, year, visibility, commit_count + 1 AS commit_count,
  pull_request_count, issue_count, repository_count, star_count, observed_at
FROM contributor_standing_kept;
COMMIT;
SQL
set +e
mismatch_out="$(run_verify)"
mismatch_status=$?
pipeline_status=0
docker exec -e PGUSER=postgres -e PGDATABASE="$db" -e LEDGER_VERIFY_SQL=/tmp/github-ledger-verify.sql \
  "$container" sh -c 'set -eu; sh /tmp/github-ledger-verify.sh' >/tmp/ledger-verify-pipeline.out
pipeline_status=$?
set -e
assert_eq mismatch_exit "$mismatch_status" 1
printf '%s\n' "$mismatch_out" | grep -qx 'verify_mismatch'
echo 'PASS mismatch_logs_verify_mismatch'
assert_eq pipeline_exit "$pipeline_status" 1
psql_db >/dev/null <<'SQL'
BEGIN;
DROP VIEW contributor_standing;
ALTER VIEW contributor_standing_kept RENAME TO contributor_standing;
COMMIT;
SQL

psql_db >/dev/null <<'SQL'
ALTER TABLE "GithubRepository"
  ALTER COLUMN "createdAt" TYPE timestamp(3) USING ("createdAt" AT TIME ZONE 'UTC'),
  ALTER COLUMN "updatedAt" TYPE timestamp(3) USING ("updatedAt" AT TIME ZONE 'UTC');
INSERT INTO "Team" ("id") VALUES ('team-t');
INSERT INTO "GithubRepository" (
  "id", "githubRepositoryId", "nameWithOwner", "source", "presence", "teamId",
  "createdAt", "updatedAt"
) VALUES
  ('r', 1001, 'org/r', 'ORG_PROVISIONED', 'PRESENT', 'team-t',
    TIMESTAMP '2026-08-01 00:00:00', TIMESTAMP '2026-12-01 00:00:00'),
  ('s', 1002, 'org/s', 'ORG_PROVISIONED', 'PRESENT', NULL,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-06-01 00:00:00');
INSERT INTO "repo" ("github_repo_id", "owner_name", "source") VALUES
  (1001, 'org/r', 'ORG_PROVISIONED'),
  (1002, 'org/s', 'ORG_PROVISIONED');
INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from", "valid_to") VALUES
  ('team-t', 1002, '2026-01-01 00:00:00+00', '2026-06-01 00:00:00+00'),
  ('team-t', 1001, '2026-08-01 00:00:00+00', NULL);
SQL
seoul_out="$(docker exec -e PGUSER=postgres -e PGDATABASE="$db" \
  -e PGOPTIONS='-c TimeZone=Asia/Seoul' -e LEDGER_VERIFY_SQL=/tmp/github-ledger-verify.sql \
  "$container" sh /tmp/github-ledger-verify.sh)"
seoul_status=$?
assert_eq seoul_floor_exit "$seoul_status" 0
printf '%s\n' "$seoul_out" | grep -qx 'open_period_created_at_floor=1'
echo 'PASS seoul_floor_still_counts'
if printf '%s\n' "$seoul_out" | grep -qx 'verify_mismatch'; then
  echo 'FAIL seoul_floor_should_stay_report_only' >&2
  exit 1
fi
echo 'PASS seoul_floor_report_only'

echo "ledger history change: passed on Postgres ${version}"
