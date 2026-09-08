#!/usr/bin/env bash
# Program deletionProtected contract rehearsal (#1237).
#
# This intentionally uses focused-table isolation rather than the complete repo
# migration ledger: the first release has already removed the application/client
# contract, and this second release owns only the physical column. A disposable
# PostgreSQL container holds a production-shaped Program table, related rows, and
# unrelated control table. No caller database connection is consulted; Docker
# endpoint variables are checked explicitly and remote endpoints are rejected.
#
# `migrate` snapshots the populated pre-contract database, invokes this exact
# migration file, checks the surviving rows/constraints, and restores the dump.
# `negative` first removes the column and proves the exact migration rejects that
# drift without changing any unrelated data.
set -euo pipefail

scenario=${1:-}
if [[ $# -ne 1 ]] || [[ $scenario != 'migrate' && $scenario != 'negative' ]]; then
  printf 'Usage: scripts/rehearse-program-deletion-column.sh migrate|negative\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration_sql="$repo_root/apps/backend/prisma/migrations/20260908150000_drop_program_deletion_protected/migration.sql"
[[ -f "$migration_sql" ]] || {
  printf '[program-column] migration file is missing\n' >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || {
  printf '[program-column] docker is required\n' >&2
  exit 1
}

fail() {
  result_emitted=1
  printf '[program-column] status=failed scenario=%s reason=%s\n' "$scenario" "$1" >&2
  exit 1
}

container="oss-hub-program-column-$(date +%s)-$$-$RANDOM"
password='synthetic-program-column-rehearsal-password'
database='program_column_rehearsal'
container_migration='/tmp/20260908150000_drop_program_deletion_protected.sql'
pg_connect_timeout='5'
pg_options='-c statement_timeout=30000 -c lock_timeout=5000'
docker_cli=()
effective_docker_context=''
effective_docker_host=''
container_started=0
tmp_root=''
backup=''
result_emitted=0
success_result=''

# DOCKER_CONTEXT takes precedence over DOCKER_HOST. When it is absent,
# DOCKER_HOST takes precedence over the selected context endpoint. Both paths
# are checked before any container operation; only a local Unix socket is safe.
if [[ -n ${DOCKER_CONTEXT:-} ]]; then
  effective_docker_context=$DOCKER_CONTEXT
  effective_docker_host=$(
    docker context inspect "$effective_docker_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  ) || fail 'unable to inspect the selected Docker context'
  docker_cli=(env -u DOCKER_HOST -u DOCKER_CONTEXT docker --context "$effective_docker_context")
elif [[ -n ${DOCKER_HOST:-} ]]; then
  effective_docker_host=$DOCKER_HOST
  docker_cli=(env -u DOCKER_CONTEXT docker --host "$effective_docker_host")
else
  effective_docker_context=$(docker context show 2>/dev/null) ||
    fail 'unable to determine the current Docker context'
  effective_docker_host=$(
    docker context inspect "$effective_docker_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  ) || fail 'unable to inspect the current Docker context'
  docker_cli=(env -u DOCKER_HOST -u DOCKER_CONTEXT docker --context "$effective_docker_context")
fi
[[ "$effective_docker_host" == unix://* ]] ||
  fail 'refusing a non-local Docker endpoint; only unix:// is allowed'

cleanup() {
  local status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  # The container owns the only database. `-v` also removes its anonymous volume.
  if (( container_started == 1 )); then
    if ! "${docker_cli[@]}" rm -f -v "$container" >/dev/null 2>&1; then
      cleanup_status=1
    fi
  fi
  if [[ -n ${tmp_root:-} ]]; then
    rm -rf -- "$tmp_root" || cleanup_status=1
  fi
  if (( cleanup_status != 0 )); then
    # Do not expose daemon details or endpoint material; cleanup failure is still
    # a failed rehearsal even when the migration assertions passed.
    printf '[program-column] status=failed scenario=%s reason=cleanup failed\n' "$scenario" >&2
    status=1
  elif (( status != 0 && result_emitted == 0 )); then
    printf '[program-column] status=failed scenario=%s\n' "$scenario" >&2
  elif (( status == 0 )) && [[ -n "$success_result" ]]; then
    printf '%s\n' "$success_result"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# No host port is published and no caller connection string is read. Every SQL
# command runs inside this container against the synthetic database.
"${docker_cli[@]}" run -d --name "$container" \
  -e POSTGRES_USER=migration \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB="$database" \
  postgres:17-alpine >/dev/null
container_started=1

ready=0
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if "${docker_cli[@]}" exec \
      -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
      -e "PGOPTIONS=$pg_options" \
      "$container" pg_isready -U migration -d "$database" -t "$pg_connect_timeout" \
      >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
(( ready == 1 )) || {
  printf '[program-column] PostgreSQL did not become ready after 60 attempts\n' >&2
  exit 1
}
"${docker_cli[@]}" cp "$migration_sql" "$container:$container_migration" >/dev/null 2>&1

psql_exec() {
  "${docker_cli[@]}" exec -i \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$pg_options" \
    "$container" \
    psql -v ON_ERROR_STOP=1 -U migration -d "$database" "$@"
}

psql_value() {
  psql_exec -tA -c "$1" 2>/dev/null
}

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/program-column-rehearsal.XXXXXX")
backup="$tmp_root/pre-drop.dump"

# This is the smallest useful production-shaped slice: the current Program
# columns, the deployed Program checks, a child FK, and independent control data.
seed_database() {
  psql_exec >/dev/null 2>"$tmp_root/seed.log" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TYPE "ProgramCategory" AS ENUM (
  'BASIC', 'SW_VALUE_SPREAD', 'OSS_CONTEST', 'CAPSTONE',
  'SW_CONVERGENCE', 'GLOBAL_MAKERTHON', 'CORPORATE_INTERNSHIP'
);
CREATE TYPE "ProgramTrackType" AS ENUM ('CURRICULAR', 'EXTRACURRICULAR');
CREATE TYPE "ProgramLifecycle" AS ENUM ('PUBLISHED', 'ARCHIVED');

CREATE TABLE "Program" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizer" TEXT NOT NULL,
  "category" "ProgramCategory" NOT NULL,
  "trackType" "ProgramTrackType",
  "lifecycle" "ProgramLifecycle" NOT NULL DEFAULT 'PUBLISHED',
  "applicationTemplateKey" TEXT NOT NULL,
  "applicationTemplateVersion" INTEGER NOT NULL,
  "applicationStartAt" TIMESTAMP(3) NOT NULL,
  "applicationEndAt" TIMESTAMP(3) NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "teamMinSize" INTEGER NOT NULL DEFAULT 1,
  "teamMaxSize" INTEGER NOT NULL DEFAULT 1,
  "description" TEXT NOT NULL,
  "repositoryProvisioningEnabled" BOOLEAN NOT NULL DEFAULT false,
  "notifyOnDeadline" BOOLEAN NOT NULL DEFAULT false,
  "deletionProtected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Program_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Program_applicationWithinProgramWindow_check"
    CHECK ("applicationEndAt" <= "endAt"),
  CONSTRAINT "Program_operatingWindow_check"
    CHECK ("startAt" < "endAt"),
  CONSTRAINT "Program_teamSize_check"
    CHECK ("teamMinSize" >= 1 AND "teamMaxSize" >= 1 AND "teamMinSize" <= "teamMaxSize"),
  CONSTRAINT "Program_name_organizer_key" UNIQUE ("name", "organizer")
);
CREATE INDEX "Program_organizer_idx" ON "Program" ("organizer");

CREATE TABLE "ProgramNote" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  CONSTRAINT "ProgramNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgramNote_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SyntheticUnrelated" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "SyntheticUnrelated_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SyntheticUnrelated_value_check" CHECK ("value" >= 0)
);

INSERT INTO "Program" (
  "id", "name", "organizer", "category", "trackType", "lifecycle",
  "applicationTemplateKey", "applicationTemplateVersion", "applicationStartAt",
  "applicationEndAt", "startAt", "endAt", "teamMinSize", "teamMaxSize",
  "description", "repositoryProvisioningEnabled", "notifyOnDeadline",
  "deletionProtected", "createdAt", "updatedAt"
) VALUES
  (
    'synthetic-program-protected', 'Synthetic Protected Program', 'OSS Hub', 'OSS_CONTEST',
    'EXTRACURRICULAR', 'PUBLISHED', 'program-template', 3,
    '2026-09-01 09:00:00', '2026-09-15 18:00:00', '2026-09-16 09:00:00',
    '2026-12-31 18:00:00', 1, 4, 'protected synthetic row', true, true, true,
    '2026-08-01 09:00:00', '2026-08-01 09:00:00'
  ),
  (
    'synthetic-program-open', 'Synthetic Open Program', 'OSS Hub', 'BASIC',
    'CURRICULAR', 'ARCHIVED', 'program-template', 2,
    '2026-07-01 09:00:00', '2026-07-15 18:00:00', '2026-07-16 09:00:00',
    '2026-08-31 18:00:00', 2, 6, 'unprotected synthetic row', false, false, false,
    '2026-06-01 09:00:00', '2026-06-01 09:00:00'
  );
INSERT INTO "ProgramNote" ("id", "programId", "body") VALUES
  ('synthetic-note-1', 'synthetic-program-protected', 'control child row');
INSERT INTO "SyntheticUnrelated" ("id", "label", "value") VALUES
  ('synthetic-control-1', 'unrelated control row', 42);
SQL
}

program_columns() {
  psql_value 'SELECT string_agg(column_name, '"'"','"'"' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'Program'"'"''
}

program_columns_without_protection() {
  psql_value 'SELECT string_agg(column_name, '"'"','"'"' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'Program'"'"' AND column_name <> '"'"'deletionProtected'"'"''
}

program_has_protection_column() {
  psql_value 'SELECT count(*) FROM information_schema.columns WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'Program'"'"' AND column_name = '"'"'deletionProtected'"'"''
}

program_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(p) - '"'"'deletionProtected'"'"' ORDER BY id)::text FROM "Program" AS p), '"'"'[]'"'"'))'
}

program_protection_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg("id" || '"'"'='"'"' || "deletionProtected"::text, '"'"'|'"'"' ORDER BY "id") FROM "Program"), '"'"''"'"'))'
}

control_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY id)::text FROM "SyntheticUnrelated" AS u), '"'"'[]'"'"'))'
}

note_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY id)::text FROM "ProgramNote" AS n), '"'"'[]'"'"'))'
}

constraint_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg(conrelid::regclass::text || '"'"'|'"'"' || conname || '"'"'|'"'"' || pg_get_constraintdef(oid), chr(10) ORDER BY conrelid::regclass::text, conname) FROM pg_constraint WHERE conrelid IN ('"'"'"Program"'"'"'::regclass, '"'"'"ProgramNote"'"'"'::regclass, '"'"'"SyntheticUnrelated"'"'"'::regclass)), '"'"''"'"'))'
}

index_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg(indexrelid::regclass::text || '"'"'|'"'"' || pg_get_indexdef(indexrelid), chr(10) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid IN ('"'"'"Program"'"'"'::regclass, '"'"'"ProgramNote"'"'"'::regclass, '"'"'"SyntheticUnrelated"'"'"'::regclass)), '"'"''"'"'))'
}

restore_backup() {
  "${docker_cli[@]}" exec \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$pg_options" \
    "$container" dropdb -U migration --if-exists "$database" >/dev/null 2>&1
  "${docker_cli[@]}" exec \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$pg_options" \
    "$container" createdb -U migration "$database" >/dev/null 2>&1
  "${docker_cli[@]}" exec -i \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$pg_options" \
    "$container" \
    pg_restore --exit-on-error --no-owner -U migration -d "$database" <"$backup" >/dev/null 2>&1
}

seed_database

columns_before=$(program_columns)
columns_without_protection_before=$(program_columns_without_protection)
program_rows_before=$(psql_value 'SELECT count(*) FROM "Program"')
protected_rows_before=$(psql_value 'SELECT count(*) FROM "Program" WHERE "deletionProtected"')
unprotected_rows_before=$(psql_value 'SELECT count(*) FROM "Program" WHERE NOT "deletionProtected"')
program_before=$(program_digest)
protection_before=$(program_protection_digest)
control_before=$(control_digest)
note_before=$(note_digest)
constraints_before=$(constraint_digest)
indexes_before=$(index_digest)

[[ "$program_rows_before" == '2' && "$protected_rows_before" == '1' && "$unprotected_rows_before" == '1' ]] ||
  fail 'fixture must contain one protected and one unprotected Program row'
[[ -n "$program_before" && -n "$control_before" && -n "$constraints_before" ]] ||
  fail 'pre-drop fingerprints must not be empty'
[[ "$columns_before" == *deletionProtected* ]] || fail 'fixture must contain deletionProtected before DROP'

# The custom archive is the pre-DROP image used by the restore check. It never
# leaves the temporary directory and is consumed only by this container.
"${docker_cli[@]}" exec \
  -e "PGPASSWORD=$password" \
  -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
  -e "PGOPTIONS=$pg_options" \
  "$container" \
  pg_dump --format=custom --no-owner -U migration -d "$database" >"$backup"
[[ -s "$backup" ]] || fail 'pre-drop backup is empty'

if [[ $scenario == 'migrate' ]]; then
  # Invoke the tracked SQL itself, not a reconstructed ALTER statement.
  if ! psql_exec -f "$container_migration" >"$tmp_root/migration.log" 2>&1; then
    fail 'exact migration failed on a populated pre-contract table'
  fi

  [[ "$(program_has_protection_column)" == '0' ]] || fail 'DROP left deletionProtected present'
  [[ "$(program_columns)" == "$columns_without_protection_before" ]] ||
    fail 'DROP changed a column other than deletionProtected'
  [[ "$(program_digest)" == "$program_before" ]] || fail 'Program row contents changed'
  [[ "$(control_digest)" == "$control_before" ]] || fail 'unrelated control data changed'
  [[ "$(note_digest)" == "$note_before" ]] || fail 'Program child data changed'
  [[ "$(constraint_digest)" == "$constraints_before" ]] || fail 'constraints changed'
  [[ "$(index_digest)" == "$indexes_before" ]] || fail 'indexes changed'

  restore_backup
  [[ "$(program_has_protection_column)" == '1' ]] || fail 'restore did not recover deletionProtected'
  [[ "$(program_columns)" == "$columns_before" ]] || fail 'restore did not recover the original columns'
  [[ "$(program_digest)" == "$program_before" ]] || fail 'restore did not recover Program data'
  [[ "$(program_protection_digest)" == "$protection_before" ]] || fail 'restore did not recover protection values'
  [[ "$(control_digest)" == "$control_before" && "$(note_digest)" == "$note_before" ]] ||
    fail 'restore did not recover control data'
  [[ "$(constraint_digest)" == "$constraints_before" && "$(index_digest)" == "$indexes_before" ]] ||
    fail 'restore did not recover constraints and indexes'

  printf -v success_result '{"status":"ok","scenario":"migrate","coverage":"focused-table","program_rows":%s,"protected_rows":%s,"unprotected_rows":%s,"restored":true}' \
    "$program_rows_before" "$protected_rows_before" "$unprotected_rows_before"
  result_emitted=1
  exit 0
fi

# Negative lane: create the exact drift a repeated/partially applied deployment
# would see, then run the same tracked migration and require its explicit error.
psql_exec -c 'ALTER TABLE "Program" DROP COLUMN "deletionProtected"' >/dev/null 2>&1
negative_program_before=$(program_digest)
negative_control_before=$(control_digest)
negative_note_before=$(note_digest)
negative_constraints_before=$(constraint_digest)
negative_error="$tmp_root/negative-error.log"
set +e
psql_exec -f "$container_migration" >"$negative_error" 2>&1
negative_status=$?
set -e
negative_message=$(<"$negative_error")
(( negative_status != 0 )) || fail 'migration unexpectedly succeeded with the column already absent'
[[ "$negative_message" == *'column "deletionProtected" of relation "Program" does not exist'* ]] ||
  fail 'negative migration did not report the missing column explicitly'
[[ "$(program_has_protection_column)" == '0' ]] || fail 'negative lane recreated the absent column'
[[ "$(program_digest)" == "$negative_program_before" ]] || fail 'negative lane changed Program data'
[[ "$(control_digest)" == "$negative_control_before" ]] || fail 'negative lane changed unrelated data'
[[ "$(note_digest)" == "$negative_note_before" ]] || fail 'negative lane changed child data'
[[ "$(constraint_digest)" == "$negative_constraints_before" ]] || fail 'negative lane changed constraints'

restore_backup
[[ "$(program_has_protection_column)" == '1' && "$(program_digest)" == "$program_before" ]] ||
  fail 'negative lane backup restore did not recover the pre-drop image'
printf -v success_result '{"status":"ok","scenario":"negative","coverage":"focused-table","program_rows":%s,"unrelated_rows":1,"migration_rejected_drift":true,"restored":true}' \
  "$program_rows_before"
result_emitted=1
