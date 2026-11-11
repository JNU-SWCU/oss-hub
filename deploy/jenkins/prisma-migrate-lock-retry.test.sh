#!/usr/bin/env bash
# A lock timeout leaves a rolled-back row and any earlier migration from the
# same deploy. The next detect must accept that ledger, and the next deploy
# must apply the failed migration.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="/tmp/node-v24.11.1-linux-x64/bin:${PATH}"
if ! command -v node >/dev/null || ! sudo -u postgres psql -d postgres -c 'SELECT 1' >/dev/null; then
  printf 'postgres and node are required\n' >&2
  exit 1
fi

shadow="${repo}/apps/backend/prisma/migrations/20261111170000_add_github_ledger_shadow/migration.sql"
if grep -qx 'COMMIT;' "$shadow" || grep -qx 'BEGIN;' "$shadow"; then
  printf '170000 still wraps itself in BEGIN/COMMIT\n' >&2
  exit 1
fi

db=oss_hub_lock_retry
psql_db() { sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" "$@"; }

reset_db() {
  sudo -u postgres psql -d postgres -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);" >/dev/null
  sudo -u postgres psql -d postgres -c "CREATE DATABASE \"${db}\";" >/dev/null
  psql_db -c 'ALTER SCHEMA public OWNER TO oss;' >/dev/null
}

prepare_backend() {
  local root="$1"
  rm -rf "$root"
  mkdir -p "$root/apps/backend/prisma"
  ln -sfn "${repo}/apps/backend/node_modules" "$root/apps/backend/node_modules"
  cat >"$root/apps/backend/prisma/schema.prisma" <<'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
EOF
}

assert_original_error() {
  local root="/tmp/oss-hub-migrate-error"
  prepare_backend "$root"
  mkdir -p "$root/apps/backend/prisma/migrations/20261111000000_fail"
  cat >"$root/apps/backend/prisma/migrations/20261111000000_fail/migration.sql" <<'EOF'
CREATE TABLE "marker" ("id" INTEGER PRIMARY KEY);
SELECT 1/0;
CREATE TABLE "after" ("id" INTEGER PRIMARY KEY);
EOF
  reset_db
  export DATABASE_URL="postgresql://oss:oss-dev@127.0.0.1:5432/${db}"
  export PRISMA_WORKING_DIRECTORY="$root/apps/backend"
  set +e
  bash "${repo}/deploy/jenkins/prisma-migrate-deploy.sh" >/tmp/oss-hub-migrate-error.out 2>/tmp/oss-hub-migrate-error.err
  local status=$?
  set -e
  [[ "$status" -eq 1 ]]
  grep -q 'migrate failed: ERROR: division by zero' /tmp/oss-hub-migrate-error.err
  if grep -q 'unknown failure' /tmp/oss-hub-migrate-error.err; then
    printf 'original error was replaced\n' >&2
    exit 1
  fi
  local tables
  tables="$(psql_db -At -c "SELECT coalesce(string_agg(tablename, ','), '') FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('marker', 'after');")"
  [[ -z "$tables" ]]
  printf 'original error stays visible\n'
}

write_release() {
  local root="$1"
  prepare_backend "$root"
  local migrations="$root/apps/backend/prisma/migrations"
  mkdir -p \
    "$migrations/20261031000000_previous" \
    "$migrations/20261102160000_consolidate_user_domain" \
    "$migrations/20261111170000_partial" \
    "$root/deploy/jenkins/user-consolidation"
  printf 'SELECT 1;\n' >"$migrations/20261031000000_previous/migration.sql"
  printf 'SELECT 1;\n' >"$migrations/20261102160000_consolidate_user_domain/migration.sql"
  cat >"$migrations/20261111170000_partial/migration.sql" <<'EOF'
CREATE TABLE "Team" ("id" TEXT PRIMARY KEY);
INSERT INTO "Team" ("id") VALUES ('t1');
CREATE TABLE "marker" ("id" INTEGER PRIMARY KEY);
EOF
  mkdir -p "$migrations/20261111170200_column"
  cp "${repo}/apps/backend/prisma/migrations/20261111170200_add_team_archived_at/migration.sql" \
    "$migrations/20261111170200_column/migration.sql"
  local sql artifacts
  artifacts="$root/deploy/jenkins/user-consolidation"
  sql='SELECT 1;\n'
  printf '%b' "$sql" >"$migrations/20261102160000_consolidate_user_domain/migration.sql"
  for name in preflight reconcile rollback open; do
    printf '%b' "$sql" >"$artifacts/${name}.sql"
  done
  local migration_hash
  migration_hash="$(sha256sum "$migrations/20261102160000_consolidate_user_domain/migration.sql" | awk '{print $1}')"
  local other_hash
  other_hash="$(sha256sum "$artifacts/preflight.sql" | awk '{print $1}')"
  cat >"$artifacts/manifest.json" <<EOF
{"version":1,"migrationId":"20261102160000_consolidate_user_domain","previousMigrationId":"20261031000000_previous","sha256":{"migration":"${migration_hash}","preflight":"${other_hash}","reconcile":"${other_hash}","rollback":"${other_hash}","open":"${other_hash}"}}
EOF
}

detect_ledger() {
  local root="$1"
  chmod 700 "$root"
  local ledger
  ledger="$(psql_db -At -c "SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT migration_name, checksum, finished_at, rolled_back_at FROM \"_prisma_migrations\" ORDER BY started_at, id) t;")"
  local bin="$root/bin"
  mkdir -p "$bin"
  printf '#!/bin/sh\nshift 3\nexec "$@"\n' >"$bin/timeout"
  printf '#!/bin/sh\ntest "$1" = exec || exit 2\nshift 2\nexec "$@"\n' >"$bin/docker"
  printf '#!%s\nprocess.stdout.write(process.env.FIXTURE_LEDGER);\n' "$(command -v node)" >"$bin/psql"
  chmod 755 "$bin/timeout" "$bin/docker" "$bin/psql"
  PATH="${bin}:${PATH}" \
    UC_STATE_ROOT="$root" \
    UC_ISOLATED_HOST=1 \
    RELEASE_SOURCE="$root" \
    PREV_POSTGRES_ID=postgres \
    POSTGRES_USER=fixture \
    POSTGRES_DB=fixture \
    FIXTURE_LEDGER="$ledger" \
    bash "${repo}/deploy/jenkins/user-consolidation-migrate.sh" --detect
}

assert_retry() {
  local root="/tmp/oss-hub-migrate-retry"
  write_release "$root"
  # Apply the prefix first, then expose the column migration.
  mv "$root/apps/backend/prisma/migrations/20261111170200_column" /tmp/oss-hub-column-migration
  reset_db
  export DATABASE_URL="postgresql://oss:oss-dev@127.0.0.1:5432/${db}"
  export PRISMA_WORKING_DIRECTORY="$root/apps/backend"
  bash "${repo}/deploy/jenkins/prisma-migrate-deploy.sh" >/tmp/oss-hub-prefix.out
  mv /tmp/oss-hub-column-migration "$root/apps/backend/prisma/migrations/20261111170200_column"
  psql_db >/tmp/oss-hub-holder.out 2>&1 <<'SQL' &
BEGIN;
LOCK TABLE "Team" IN ACCESS SHARE MODE;
SELECT pg_sleep(30);
COMMIT;
SQL
  local holder=$!
  local granted=0
  local attempt
  for attempt in $(seq 1 100); do
    granted="$(psql_db -At -c "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_stat_activity a ON a.pid = l.pid WHERE c.relname = 'Team' AND l.mode = 'AccessShareLock' AND l.granted AND a.query LIKE '%pg_sleep(30)%';")"
    [[ "$granted" != "0" ]] && break
    sleep 0.05
  done
  [[ "$granted" != "0" ]]
  set +e
  bash "${repo}/deploy/jenkins/prisma-migrate-deploy.sh" >/tmp/oss-hub-lock.out 2>/tmp/oss-hub-lock.err
  local status=$?
  set -e
  [[ "$status" -eq 1 ]]
  grep -q 'resolve left the schema unchanged' /tmp/oss-hub-lock.out
  if grep -q 'schema fingerprint changed' /tmp/oss-hub-lock.out /tmp/oss-hub-lock.err; then
    printf 'fingerprint compared against the pre-deploy schema\n' >&2
    exit 1
  fi
  [[ "$(psql_db -At -c "SELECT count(*) FROM information_schema.tables WHERE table_name = 'marker';")" == "1" ]]
  [[ "$(psql_db -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'Team' AND column_name = 'archivedAt';")" == "0" ]]
  [[ "$(psql_db -At -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '20261111170200_column' AND finished_at IS NULL AND rolled_back_at IS NOT NULL;")" == "1" ]]
  local detected
  detected="$(detect_ledger "$root")"
  [[ "$detected" == "ordinary" ]]
  sudo -u postgres psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND query LIKE '%pg_sleep(30)%';" >/dev/null
  wait "$holder" 2>/dev/null || true
  bash "${repo}/deploy/jenkins/prisma-migrate-deploy.sh" >/tmp/oss-hub-retry.out
  [[ "$(psql_db -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'Team' AND column_name = 'archivedAt';")" == "1" ]]
  detected="$(detect_ledger "$root")"
  [[ "$detected" == "ordinary" ]]
  [[ "$(psql_db -At -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '20261111170200_column' AND rolled_back_at IS NOT NULL;")" == "1" ]]
  printf 'rolled-back ledger retries on the next detect\n'
}

assert_original_error
assert_retry
printf 'prisma migrate retry path ok\n'
