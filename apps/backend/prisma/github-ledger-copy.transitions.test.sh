#!/usr/bin/env bash
# Synthetic team_repo transitions for github-ledger-copy.sql.
# Uses Postgres 17 and btree_gist. No production data.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
copy_sql="${LEDGER_COPY_SQL:-$root/apps/backend/prisma/github-ledger-copy.sql}"
db="ledger_copy_transitions_$$"
mode=""
container=""
engine="${LEDGER_COPY_ENGINE:-both}"

psql_admin() {
  if [ "$mode" = "local" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres "$@"
  else
    docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
  fi
}

psql_db() {
  if [ "$mode" = "local" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" "$@"
  else
    docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
  fi
}

psql_file() {
  local file="$1"
  if [ "$mode" = "local" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f - <"$file"
  else
    docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" -f - <"$file"
  fi
}

cleanup() {
  status=$?
  if [ "$mode" = "local" ]; then
    sudo -u postgres psql -d postgres -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null 2>&1 || true
  elif [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

if sudo -u postgres psql -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  mode="local"
elif command -v docker >/dev/null 2>&1; then
  mode="docker"
  container="ledger-copy-transitions-$$"
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
    echo 'ledger copy transitions: Postgres 17 did not become ready' >&2
    exit 1
  fi
else
  echo 'ledger copy transitions: Postgres 17 or Docker is required' >&2
  exit 1
fi

version="$(psql_admin -At -c 'SHOW server_version;')"
case "$version" in
  17*) ;;
  *)
    echo "ledger copy transitions: expected Postgres 17, got ${version}" >&2
    exit 1
    ;;
esac

psql_admin -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null
psql_admin -c "CREATE DATABASE \"${db}\";" >/dev/null

schema_file="$(mktemp)"
split_runner="$(mktemp)"
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
CREATE TABLE "CollectionCommitFact" (
  "repositoryId" TEXT, "sha" TEXT, "authorGithubId" BIGINT,
  "committedAt" TIMESTAMPTZ(3), "observedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "CollectionPullRequestFact" (
  "repositoryId" TEXT, "githubPullRequestId" BIGINT, "authorGithubId" BIGINT,
  "createdAt" TIMESTAMPTZ(3), "observedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "GithubIssueHistory" (
  "repositoryId" TEXT, "githubIssueId" BIGINT, "authorGithubId" BIGINT,
  "createdAt" TIMESTAMPTZ(3), "observedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "CollectionReleaseFact" (
  "repositoryId" TEXT, "githubReleaseId" BIGINT, "authorGithubId" BIGINT,
  "publishedAt" TIMESTAMPTZ(3), "observedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "GithubUserActivityHistory" (
  "githubId" BIGINT, "year" INTEGER, "visibility" "ActivityVisibility",
  "commitCount" INTEGER, "pullRequestCount" INTEGER, "issueCount" INTEGER,
  "repositoryCount" INTEGER, "starCount" INTEGER, "observedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "GithubUserActivityCycleSnapshot" (
  "githubId" BIGINT, "year" INTEGER, "visibility" "ActivityVisibility",
  "commitCount" INTEGER, "pullRequestCount" INTEGER, "issueCount" INTEGER,
  "repositoryCount" INTEGER, "starCount" INTEGER, "observedAt" TIMESTAMPTZ(3)
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
SQL

cat >"$split_runner" <<'JS'
const fs = require('node:fs');
const sql = fs.readFileSync(process.argv[2], 'utf8');
const stripped = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const parts = [];
let current = '';
let fence = null;
let inString = false;
for (let index = 0; index < stripped.length; index += 1) {
  const rest = stripped.slice(index);
  if (fence) {
    if (rest.startsWith(fence)) {
      current += fence;
      index += fence.length - 1;
      fence = null;
      continue;
    }
    current += stripped[index];
    continue;
  }
  if (inString) {
    current += stripped[index];
    if (stripped[index] === "'" && stripped[index + 1] === "'") {
      current += "'";
      index += 1;
      continue;
    }
    if (stripped[index] === "'") inString = false;
    continue;
  }
  const marker = /^\$[A-Za-z0-9_]*\$/.exec(rest);
  if (marker) {
    fence = marker[0];
    current += fence;
    index += fence.length - 1;
    continue;
  }
  if (stripped[index] === "'") {
    inString = true;
    current += "'";
    continue;
  }
  if (stripped[index] === ';') {
    const statement = current.trim();
    if (statement !== '' && statement !== 'BEGIN' && statement !== 'COMMIT') {
      parts.push(statement);
    }
    current = '';
    continue;
  }
  current += stripped[index];
}
const tail = current.trim();
if (tail !== '' && tail !== 'BEGIN' && tail !== 'COMMIT') parts.push(tail);
process.stdout.write(`BEGIN;\n${parts.join(';\n')};\nCOMMIT;\n`);
JS

reset_db() {
  psql_admin -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null
  psql_admin -c "CREATE DATABASE \"${db}\";" >/dev/null
  psql_file "$schema_file" >/dev/null
}

run_copy() {
  local err_file
  err_file="$(mktemp)"
  if [ "$1" = "file" ]; then
    if psql_file "$copy_sql" >"$err_file" 2>&1; then
      rm -f "$err_file"
      return 0
    fi
  else
    local split_sql
    split_sql="$(mktemp)"
    node "$split_runner" "$copy_sql" >"$split_sql"
    if psql_file "$split_sql" >"$err_file" 2>&1; then
      rm -f "$err_file" "$split_sql"
      return 0
    fi
    rm -f "$split_sql"
  fi
  tr '\n' ' ' <"$err_file"
  rm -f "$err_file"
  return 1
}

run_copy_with_setup() {
  local engine_name="$1"
  local setup="$2"
  local err_file combined split_sql
  err_file="$(mktemp)"
  combined="$(mktemp)"
  {
    printf '%s\n' 'BEGIN;'
    printf '%s\n' "$setup"
    if [ "$engine_name" = "file" ]; then
      cat "$copy_sql"
    else
      split_sql="$(mktemp)"
      node "$split_runner" "$copy_sql" >"$split_sql"
      tail -n +2 "$split_sql"
      rm -f "$split_sql"
    fi
  } >"$combined"
  if psql_file "$combined" >"$err_file" 2>&1; then
    rm -f "$err_file" "$combined"
    return 0
  fi
  tr '\n' ' ' <"$err_file"
  rm -f "$err_file" "$combined"
  return 1
}

copy_or_die() {
  local engine_name="$1"
  local label="$2"
  local result
  if ! result="$(run_copy "$engine_name")"; then
    echo "FAIL ${engine_name} ${label}: ${result}" >&2
    exit 1
  fi
}

digest() {
  psql_db -At -c "SELECT md5(coalesce(string_agg(payload, '|' ORDER BY payload), '')) FROM (
    SELECT 'repo:' || github_repo_id::text || ':' || owner_name || ':' || source::text || ':' || coalesce(gone_at::text, '') AS payload FROM repo
    UNION ALL
    SELECT 'link:' || team_id || ':' || repo_id::text || ':' || valid_from::text || ':' || coalesce(valid_to::text, '') FROM team_repo
    UNION ALL
    SELECT 'contrib:' || repo_id::text || ':' || kind::text || ':' || github_key FROM contribution
    UNION ALL
    SELECT 'act:' || github_id::text || ':' || observed_at::text FROM github_user_activity_history
  ) rows;"
}

periods() {
  psql_db -At -c "SELECT coalesce(string_agg(team_id || ':' || repo_id::text || '[' || to_char(valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') || ',' || coalesce(to_char(valid_to AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'), 'open') || ']', ' ' ORDER BY repo_id, valid_from, team_id), 'none') FROM team_repo;"
}

expect_periods() {
  local name="$1" engine_name="$2" want="$3" got
  got="$(periods)"
  if [ "$got" != "$want" ]; then
    echo "FAIL ${engine_name} ${name}: periods ${got} != ${want}" >&2
    exit 1
  fi
  local before after
  before="$(digest)"
  if ! run_copy "$engine_name" >/dev/null; then
    echo "FAIL ${engine_name} ${name}: second copy rejected" >&2
    exit 1
  fi
  after="$(digest)"
  if [ "$before" != "$after" ] || [ "$(periods)" != "$want" ]; then
    echo "FAIL ${engine_name} ${name}: second copy changed the ledger" >&2
    exit 1
  fi
  echo "PASS ${engine_name} ${name}"
}

expect_reject() {
  local name="$1" engine_name="$2" before result after
  before="$(digest)"
  if result="$(run_copy "$engine_name")"; then
    echo "FAIL ${engine_name} ${name}: copy succeeded" >&2
    exit 1
  fi
  after="$(digest)"
  case "$result" in
    *'overlapping_teams='*) ;;
    *)
      echo "FAIL ${engine_name} ${name}: ${result}" >&2
      exit 1
      ;;
  esac
  if [ "$before" != "$after" ]; then
    echo "FAIL ${engine_name} ${name}: rejected copy changed the ledger" >&2
    exit 1
  fi
  echo "PASS ${engine_name} ${name}"
}

teams_sql="INSERT INTO \"Team\" (\"id\") VALUES ('team-x'), ('team-t'), ('team-y'), ('team-u');"

repo_sql() {
  local id="$1" gid="$2" team="$3" created="$4" updated="$5" presence="${6:-PRESENT}"
  local team_sql="NULL"
  if [ "$team" != "null" ]; then
    team_sql="'${team}'"
  fi
  printf 'INSERT INTO "GithubRepository" ("id", "githubRepositoryId", "nameWithOwner", "source", "presence", "teamId", "createdAt", "updatedAt") VALUES ('"'"'%s'"'"', %s, '"'"'synthetic/%s'"'"', '"'"'ORG_PROVISIONED'"'"', '"'"'%s'"'"', %s, '"'"'%s'"'"', '"'"'%s'"'"');\n' \
    "$id" "$gid" "$id" "$presence" "$team_sql" "$created" "$updated"
}

move_sql() {
  local id="$1" team="$2" updated="$3"
  local team_sql="NULL"
  if [ "$team" != "null" ]; then
    team_sql="'${team}'"
  fi
  printf 'UPDATE "GithubRepository" SET "teamId" = %s, "updatedAt" = '"'"'%s'"'"' WHERE "id" = '"'"'%s'"'"';\n' \
    "$team_sql" "$updated" "$id"
}

run_engine() {
  local engine_name="$1"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-05 04:06:07.123+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods E1 "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.123] team-t:1001[2026-11-05 04:06:07.123,open]'
  opens="$(psql_db -At -c "SELECT count(*) FROM team_repo WHERE repo_id = 1001 AND valid_to IS NULL AND team_id = 'team-t';")"
  if [ "$opens" != "1" ]; then
    echo "FAIL ${engine_name} E1: open periods on T = ${opens}" >&2
    exit 1
  fi

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql s 1002 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
$(repo_sql r 1001 team-x '2026-09-01 00:00:00+00' '2026-09-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
DELETE FROM "GithubRepository" WHERE "id" = 's';
$(move_sql r team-t '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods E2 "$engine_name" 'team-x:1001[2026-09-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1001[2026-11-05 04:06:07.000,open] team-t:1002[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
$(move_sql r team-t '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods E2_before_period "$engine_name" 'team-t:1001[2026-10-01 00:00:00.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
DELETE FROM "GithubRepository" WHERE "id" = 'r';
$(repo_sql m 1003 team-t '2026-11-02 03:04:05+00' '2026-11-02 03:04:05+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods B "$engine_name" 'team-t:1001[2026-10-01 00:00:00.000,2026-11-02 03:04:05.000] team-t:1003[2026-11-02 03:04:05.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
DELETE FROM "GithubRepository" WHERE "id" = 'r';
$(repo_sql m 1003 null '2020-01-01 00:00:00+00' '2020-01-01 00:00:00+00')
$(move_sql m team-t '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods C "$engine_name" 'team-t:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1003[2026-11-05 04:06:07.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r null '2020-01-01 00:00:00+00')
$(repo_sql v 1004 team-t '2026-11-05 04:06:07+00' '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods D "$engine_name" 'team-t:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1004[2026-11-05 04:06:07.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r null '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods X_to_null "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 null '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods null_to_T "$engine_name" 'team-t:1001[2026-10-01 00:00:00.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r null '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-20 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods null_to_T_after_close "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1001[2026-11-05 04:06:07.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-x '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods X_T_X "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1001[2026-11-05 04:06:07.000,2026-12-01 00:00:00.000] team-x:1001[2026-12-01 00:00:00.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<'SQL'
UPDATE team_repo SET valid_to = '2026-11-11 08:29:00+00'
WHERE team_id = 'team-x' AND valid_to IS NULL AND valid_from < '2026-11-11 08:29:00+00';
UPDATE "Team" SET "archivedAt" = '2026-11-11 08:29:00+00' WHERE id = 'team-x';
SQL
  copy_or_die "$engine_name" setup
  expect_periods archived_keep_link "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-11 08:29:00.000]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<'SQL'
UPDATE team_repo SET valid_to = '2026-11-11 08:29:00+00'
WHERE team_id = 'team-x' AND valid_to IS NULL AND valid_from < '2026-11-11 08:29:00+00';
UPDATE "Team" SET "archivedAt" = '2026-11-11 08:29:00+00' WHERE id = 'team-x';
SQL
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-20 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods archived_then_move "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-11 08:29:00.000] team-t:1001[2026-11-11 08:29:00.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
UPDATE "Team" SET "archivedAt" = '2026-11-11 08:29:00+00' WHERE id = 'team-x';
$(repo_sql r 1001 team-x '2026-12-01 00:00:00+00' '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  ordered="$(psql_db -At -c "SELECT count(*) FROM team_repo WHERE valid_to IS NULL;")"
  if [ "$ordered" != "0" ]; then
    echo "FAIL ${engine_name} archived_without_ledger: left an open period" >&2
    exit 1
  fi
  echo "PASS ${engine_name} archived_without_ledger"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-12-01 00:00:00+00' '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<'SQL'
UPDATE "Team" SET "archivedAt" = '2026-11-11 08:29:00+00' WHERE id = 'team-x';
SQL
  copy_or_die "$engine_name" setup
  future="$(psql_db -At -c "SELECT (count(*) FILTER (WHERE valid_to IS NULL) = 0 AND bool_and(valid_from < valid_to))::text FROM team_repo;")"
  if [ "$future" != "true" ]; then
    echo "FAIL ${engine_name} archived_future_period: $(periods)" >&2
    exit 1
  fi
  echo "PASS ${engine_name} archived_future_period"

  reset_db
  rounded_ok=0
  for _attempt in $(seq 1 40); do
    if rounded="$(run_copy_with_setup "$engine_name" "
DO \$\$
BEGIN
  IF (EXTRACT(MICROSECONDS FROM transaction_timestamp())::bigint % 1000) NOT BETWEEN 1 AND 499 THEN
    RAISE EXCEPTION 'retry_window';
  END IF;
END \$\$;
INSERT INTO \"Team\" (id, \"archivedAt\") VALUES ('team-x', '2000-01-01 00:00:00+00');
INSERT INTO \"GithubRepository\" (\"id\", \"githubRepositoryId\", \"nameWithOwner\", \"source\", \"presence\", \"teamId\", \"createdAt\", \"updatedAt\")
VALUES ('r', 501, 'synthetic/501', 'ORG_PROVISIONED', 'PRESENT', 'team-x', '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00');
INSERT INTO repo (github_repo_id, owner_name, source)
VALUES (501, 'synthetic/501', 'ORG_PROVISIONED');
INSERT INTO team_repo (team_id, repo_id, valid_from)
VALUES ('team-x', 501, date_trunc('milliseconds', transaction_timestamp()));
")"; then
      rounded_ok=1
      break
    fi
    case "$rounded" in
      *retry_window*) ;;
      *)
        echo "FAIL ${engine_name} archived_same_millisecond: ${rounded}" >&2
        exit 1
        ;;
    esac
  done
  if [ "$rounded_ok" -ne 1 ]; then
    echo "FAIL ${engine_name} archived_same_millisecond: did not enter the rounding window" >&2
    exit 1
  fi
  rounded="$(psql_db -At -c "SELECT (count(*) FILTER (WHERE valid_to IS NULL) = 0 AND bool_and(valid_to = valid_from + interval '1 millisecond'))::text FROM team_repo;")"
  if [ "$rounded" != "true" ]; then
    echo "FAIL ${engine_name} archived_same_millisecond: $(periods)" >&2
    exit 1
  fi
  before="$(digest)"
  copy_or_die "$engine_name" archived_same_millisecond
  if [ "$before" != "$(digest)" ]; then
    echo "FAIL ${engine_name} archived_same_millisecond: second copy changed the ledger" >&2
    exit 1
  fi
  echo "PASS ${engine_name} archived_same_millisecond"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
$(repo_sql s 1002 team-y '2026-10-02 00:00:00+00' '2026-10-02 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-05 04:06:07+00')
$(move_sql s team-u '2026-11-06 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods multi_move "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1001[2026-11-05 04:06:07.000,open] team-y:1002[2026-10-02 00:00:00.000,2026-11-06 00:00:00.000] team-u:1002[2026-11-06 00:00:00.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
$(repo_sql s 1002 team-t '2026-10-03 00:00:00+00' '2026-10-03 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2026-11-05 04:06:07+00')
$(move_sql s team-x '2026-11-05 04:06:07+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods swap "$engine_name" 'team-x:1001[2026-10-01 00:00:00.000,2026-11-05 04:06:07.000] team-t:1001[2026-11-05 04:06:07.000,open] team-t:1002[2026-10-03 00:00:00.000,2026-11-05 04:06:07.000] team-x:1002[2026-11-05 04:06:07.000,open]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r team-t '2020-01-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  stale="$(psql_db -At -c "SELECT (count(*) = 2 AND count(*) FILTER (WHERE valid_to IS NULL AND team_id = 'team-t') = 1 AND (SELECT valid_to FROM team_repo WHERE team_id = 'team-x') = (SELECT valid_from FROM team_repo WHERE valid_to IS NULL))::text FROM team_repo;")"
  if [ "$stale" != "true" ]; then
    echo "FAIL ${engine_name} stale_updated_move: $(periods)" >&2
    exit 1
  fi
  echo "PASS ${engine_name} stale_updated_move"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-x '2026-08-01 00:00:00+00' '2026-08-01 00:00:00+00')
$(repo_sql s 1002 team-t '2026-09-01 00:00:00+00' '2026-09-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql s null '2026-11-01 00:00:00+00')
$(move_sql r team-t '2026-10-15 00:00:00+00')
SQL
  expect_reject illegal_move "$engine_name"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql kept 1002 null '2026-09-01 00:00:00+00' '2026-11-01 00:00:00+00')
INSERT INTO repo (github_repo_id, owner_name, source)
VALUES (1002, 'synthetic/kept', 'ORG_PROVISIONED');
INSERT INTO team_repo (team_id, repo_id, valid_from)
VALUES ('team-t', 1002, '2026-09-01 00:00:00+00');
$(repo_sql r 1001 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
SQL
  expect_reject occupant_overlap "$engine_name"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql r 1001 team-t '2026-10-01 00:00:00+00' '2026-10-01 00:00:00+00')
INSERT INTO "CollectionCommitFact" ("repositoryId", "sha", "authorGithubId", "committedAt", "observedAt")
VALUES ('r', 'abc123', 42, '2026-10-15 00:00:00+00', '2026-10-16 00:00:00+00');
$(repo_sql gone 1008 null '2026-10-01 00:00:00+00' '2026-10-02 00:00:00+00' ABSENT)
SQL
  copy_or_die "$engine_name" setup
  facts="$(psql_db -At -c "SELECT (SELECT count(*) FROM contribution) = 1 AND (SELECT gone_at IS NOT NULL FROM repo WHERE github_repo_id = 1008);")"
  if [ "$facts" != "t" ]; then
    echo "FAIL ${engine_name} facts_and_absence" >&2
    exit 1
  fi
  before="$(digest)"
  copy_or_die "$engine_name" setup
  if [ "$before" != "$(digest)" ]; then
    echo "FAIL ${engine_name} facts_and_absence: second copy changed the ledger" >&2
    exit 1
  fi
  echo "PASS ${engine_name} facts_and_absence"

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql s 1002 team-t '2026-01-01 00:00:00+00' '2026-01-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
DELETE FROM "GithubRepository" WHERE "id" = 's';
$(repo_sql r 1001 team-t '2026-03-01 00:00:00+00' '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods reused_claim_uses_updated_at "$engine_name" 'team-t:1001[2026-12-01 00:00:00.000,open] team-t:1002[2026-01-01 00:00:00.000,2026-12-01 00:00:00.000]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql old 1002 team-t '2026-01-01 00:00:00+00' '2026-01-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
UPDATE "GithubRepository" SET "teamId" = NULL, "updatedAt" = '2026-12-01 00:00:00+00' WHERE "id" = 'old';
$(repo_sql r 1001 team-t '2026-03-01 00:00:00+00' '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods detached_same_updated_at "$engine_name" 'team-t:1001[2026-12-01 00:00:00.000,open] team-t:1002[2026-01-01 00:00:00.000,2026-12-01 00:00:00.000]'
  open_repo="$(psql_db -At -c "SELECT repo_id::text FROM team_repo WHERE valid_to IS NULL;")"
  if [ "$open_repo" != "1001" ]; then
    echo "FAIL ${engine_name} detached_same_updated_at: open repo ${open_repo}" >&2
    exit 1
  fi

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql s 1002 team-t '2026-01-01 00:00:00+00' '2026-01-01 00:00:00+00')
$(repo_sql r 1001 team-x '2026-03-01 00:00:00+00' '2026-03-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql r null '2026-06-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
DELETE FROM "GithubRepository" WHERE "id" = 's';
$(move_sql r team-t '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods prior_close_before_claim "$engine_name" 'team-x:1001[2026-03-01 00:00:00.000,2026-06-01 00:00:00.000] team-t:1001[2026-12-01 00:00:00.000,open] team-t:1002[2026-01-01 00:00:00.000,2026-12-01 00:00:00.000]'

  reset_db
  psql_db >/dev/null <<SQL
${teams_sql}
$(repo_sql s 1002 team-t '2026-01-01 00:00:00+00' '2026-01-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
$(move_sql s null '2026-06-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  psql_db >/dev/null <<SQL
INSERT INTO "GithubUserActivityHistory" (
  "githubId", "year", "visibility",
  "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount",
  "observedAt"
) VALUES (42, 2026, 'PUBLIC', 4, 1, 1, 1, 1, '2026-07-01 00:00:00+00');
$(repo_sql r 1001 team-t '2026-03-01 00:00:00+00' '2026-12-01 00:00:00+00')
SQL
  copy_or_die "$engine_name" setup
  expect_periods closed_period_reused_claim "$engine_name" 'team-t:1001[2026-12-01 00:00:00.000,open] team-t:1002[2026-01-01 00:00:00.000,2026-06-01 00:00:00.000]'
  history_rows="$(psql_db -At -c "SELECT count(*) FROM github_user_activity_history WHERE github_id = 42 AND commit_count = 4;")"
  if [ "$history_rows" != "1" ]; then
    echo "FAIL ${engine_name} closed_period_reused_claim: history rows ${history_rows}" >&2
    exit 1
  fi
}

case "$engine" in
  both)
    run_engine file
    run_engine split
    ;;
  file|split)
    run_engine "$engine"
    ;;
  *)
    echo "ledger copy transitions: unknown engine ${engine}" >&2
    exit 1
    ;;
esac

rm -f "$schema_file" "$split_runner"
echo "ledger copy transitions: ${engine} passed on Postgres ${version}"
