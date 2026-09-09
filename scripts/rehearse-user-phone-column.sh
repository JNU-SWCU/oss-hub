#!/usr/bin/env bash
# Canonical user phone contract rehearsal (QA148, PR #1244).
#
# This intentionally uses focused-table isolation rather than the complete repo
# migration ledger: the release owns one migration that adds `User.phone` with a
# digits CHECK and drops the unused `TeamMember.phone` copy. A disposable
# PostgreSQL container holds production-shaped `User`, `Team`, `TeamMember`
# tables with populated phone values plus an unrelated control table. No caller
# database connection is consulted; Docker endpoint variables are checked
# explicitly and remote endpoints are rejected.
#
# `migrate` snapshots the populated pre-drop database, invokes this exact
# migration file in one transaction (as `prisma migrate deploy` does), checks the
# surviving rows/constraints and the new CHECK behaviour, then restores the dump
# and requires the dropped phone values to come back. `negative` first removes
# the column and proves the exact migration rejects that drift without leaving
# `User.phone` behind.
set -euo pipefail

scenario=${1:-}
if [[ $# -ne 1 ]] || [[ $scenario != 'migrate' && $scenario != 'negative' ]]; then
  printf 'Usage: scripts/rehearse-user-phone-column.sh migrate|negative\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration_sql="$repo_root/apps/backend/prisma/migrations/20260906174608_add_user_phone_canonical/migration.sql"
[[ -f "$migration_sql" ]] || {
  printf '[user-phone] migration file is missing\n' >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || {
  printf '[user-phone] docker is required\n' >&2
  exit 1
}

fail() {
  result_emitted=1
  printf '[user-phone] status=failed scenario=%s reason=%s\n' "$scenario" "$1" >&2
  exit 1
}

container="oss-hub-user-phone-$(date +%s)-$$-$RANDOM"
password='synthetic-user-phone-rehearsal-password'
database='user_phone_rehearsal'
container_migration='/tmp/20260906174608_add_user_phone_canonical.sql'
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
    printf '[user-phone] status=failed scenario=%s reason=cleanup failed\n' "$scenario" >&2
    status=1
  elif (( status != 0 && result_emitted == 0 )); then
    printf '[user-phone] status=failed scenario=%s\n' "$scenario" >&2
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
  printf '[user-phone] PostgreSQL did not become ready after 60 attempts\n' >&2
  exit 1
}
"${docker_cli[@]}" cp "$migration_sql" "$container:$container_migration" >/dev/null 2>&1

psql_exec() {
  psql_exec_with_options "$pg_options" "$@"
}

psql_exec_with_options() {
  local options=$1
  shift
  "${docker_cli[@]}" exec -i \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$options" \
    "$container" \
    psql -v ON_ERROR_STOP=1 -U migration -d "$database" "$@"
}

# `prisma migrate deploy` runs one migration file as one transaction. The file
# here has three statements, so a per-statement run would let the ADD COLUMN
# commit even when the DROP fails — that is not the deployed behaviour.
psql_migration() {
  psql_exec --single-transaction -f "$container_migration"
}

psql_value() {
  psql_exec -tA -c "$1" 2>/dev/null
}

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/user-phone-rehearsal.XXXXXX")
backup="$tmp_root/pre-drop.dump"

# This is the smallest useful production-shaped slice: the pre-migration User
# columns, the Team/TeamMember pair that owns the dropped copy, and independent
# control data.
seed_database() {
  psql_exec >/dev/null 2>"$tmp_root/seed.log" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TYPE "MemberKind" AS ENUM ('STUDENT', 'STAFF');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "githubId" BIGINT NOT NULL,
  "login" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "notificationEmail" TEXT,
  "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "selectedMemberKind" "MemberKind",
  "hasStaffAccess" BOOLEAN NOT NULL DEFAULT false,
  "hasAdminAccess" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_githubId_key" UNIQUE ("githubId")
);

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id", "programId")
);

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "department" TEXT,
  "name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamMember_teamId_programId_fkey"
    FOREIGN KEY ("teamId", "programId") REFERENCES "Team" ("id", "programId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamMember_teamId_userId_key" UNIQUE ("teamId", "userId"),
  CONSTRAINT "TeamMember_programId_userId_key" UNIQUE ("programId", "userId")
);
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember" ("userId");

CREATE TABLE "SyntheticUnrelated" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "SyntheticUnrelated_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SyntheticUnrelated_value_check" CHECK ("value" >= 0)
);

INSERT INTO "User" (
  "id", "githubId", "login", "avatarUrl", "accountStatus", "sessionVersion",
  "notificationEmail", "notifyEnabled", "selectedMemberKind", "hasStaffAccess",
  "hasAdminAccess", "createdAt", "updatedAt"
) VALUES
  (
    'synthetic-user-member', 9148000000000001, 'synthetic-member', NULL,
    'ACTIVE', 0, NULL, false, 'STUDENT', false, false,
    '2026-08-01 09:00:00', '2026-08-01 09:00:00'
  ),
  (
    'synthetic-user-blank', 9148000000000002, 'synthetic-blank', NULL,
    'DEACTIVATED', 3, NULL, true, 'STAFF', true, false,
    '2026-07-01 09:00:00', '2026-07-02 09:00:00'
  );

INSERT INTO "Team" ("id", "programId", "name") VALUES
  ('synthetic-team', 'synthetic-program', 'Synthetic Team');

-- One populated copy and one NULL copy: the DROP must lose both, and the
-- restore must bring the populated one back byte for byte.
INSERT INTO "TeamMember" (
  "id", "teamId", "programId", "userId", "department", "name", "phone", "email", "createdAt"
) VALUES
  (
    'synthetic-member-filled', 'synthetic-team', 'synthetic-program',
    'synthetic-user-member', 'Synthetic department', 'Synthetic Member',
    '80000000001', 'synthetic-member@example.invalid', '2026-08-02 09:00:00'
  ),
  (
    'synthetic-member-blank', 'synthetic-team', 'synthetic-program',
    'synthetic-user-blank', NULL, NULL, NULL, NULL, '2026-08-03 09:00:00'
  );

INSERT INTO "SyntheticUnrelated" ("id", "label", "value") VALUES
  ('synthetic-control-1', 'unrelated control row', 42);
SQL
}

table_columns() {
  psql_value "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1'"
}

column_count() {
  psql_value "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1' AND column_name = '$2'"
}

column_is_nullable() {
  psql_value "SELECT COALESCE(max(is_nullable), 'MISSING') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1' AND column_name = '$2'"
}

# The migration appends `User.phone`, so the comparable image is every other
# column. The new column is checked by name, nullability and CHECK behaviour.
user_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(u) - '"'"'phone'"'"' ORDER BY id)::text FROM "User" AS u), '"'"'[]'"'"'))'
}

member_digest_without_phone() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(m) - '"'"'phone'"'"' ORDER BY id)::text FROM "TeamMember" AS m), '"'"'[]'"'"'))'
}

member_phone_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg("id" || '"'"'='"'"' || COALESCE("phone", '"'"'<null>'"'"'), '"'"'|'"'"' ORDER BY "id") FROM "TeamMember"), '"'"''"'"'))'
}

control_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY id)::text FROM "SyntheticUnrelated" AS u), '"'"'[]'"'"'))'
}

constraint_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg(conrelid::regclass::text || '"'"'|'"'"' || conname || '"'"'|'"'"' || pg_get_constraintdef(oid), chr(10) ORDER BY conrelid::regclass::text, conname) FROM pg_constraint WHERE conrelid IN ('"'"'"Team"'"'"'::regclass, '"'"'"TeamMember"'"'"'::regclass, '"'"'"SyntheticUnrelated"'"'"'::regclass)), '"'"''"'"'))'
}

index_digest() {
  psql_value 'SELECT md5(COALESCE((SELECT string_agg(indexrelid::regclass::text || '"'"'|'"'"' || pg_get_indexdef(indexrelid), chr(10) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid IN ('"'"'"User"'"'"'::regclass, '"'"'"Team"'"'"'::regclass, '"'"'"TeamMember"'"'"'::regclass, '"'"'"SyntheticUnrelated"'"'"'::regclass)), '"'"''"'"'))'
}

phone_check_definition() {
  psql_value 'SELECT COALESCE(max(pg_get_constraintdef(oid)), '"'"'<missing>'"'"') FROM pg_constraint WHERE conrelid = '"'"'"User"'"'"'::regclass AND conname = '"'"'User_phone_digits_check'"'"''
}

# The CHECK is only useful if it actually refuses bad input on a populated table.
phone_write_rejected() {
  if psql_exec -c "UPDATE \"User\" SET \"phone\" = '$1' WHERE \"id\" = 'synthetic-user-member'" >/dev/null 2>&1; then
    psql_exec -c 'UPDATE "User" SET "phone" = NULL WHERE "id" = '"'"'synthetic-user-member'"'"'' >/dev/null 2>&1
    return 1
  fi
  return 0
}

phone_write_accepted() {
  if psql_exec -c "UPDATE \"User\" SET \"phone\" = '$1' WHERE \"id\" = 'synthetic-user-member'" >/dev/null 2>&1; then
    psql_exec -c 'UPDATE "User" SET "phone" = NULL WHERE "id" = '"'"'synthetic-user-member'"'"'' >/dev/null 2>&1
    return 0
  fi
  return 1
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

user_columns_before=$(table_columns 'User')
member_columns_before=$(table_columns 'TeamMember')
member_columns_without_phone_before=$(psql_value "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TeamMember' AND column_name <> 'phone'")
user_rows_before=$(psql_value 'SELECT count(*) FROM "User"')
member_rows_before=$(psql_value 'SELECT count(*) FROM "TeamMember"')
member_phones_before=$(psql_value 'SELECT count(*) FROM "TeamMember" WHERE "phone" IS NOT NULL')
user_before=$(user_digest)
member_before=$(member_digest_without_phone)
member_phone_before=$(member_phone_digest)
control_before=$(control_digest)
constraints_before=$(constraint_digest)
indexes_before=$(index_digest)

[[ "$user_rows_before" == '2' && "$member_rows_before" == '2' && "$member_phones_before" == '1' ]] ||
  fail 'fixture must contain two users and two team members with one stored phone'
[[ -n "$user_before" && -n "$member_before" && -n "$constraints_before" ]] ||
  fail 'pre-drop fingerprints must not be empty'
[[ "$member_columns_before" == *phone* ]] || fail 'fixture must contain TeamMember.phone before DROP'
[[ "$(column_count 'User' 'phone')" == '0' ]] || fail 'fixture must not contain User.phone before the migration'

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
  # Invoke the tracked SQL itself, not reconstructed ALTER statements.
  if ! psql_migration >"$tmp_root/migration.log" 2>&1; then
    fail 'exact migration failed on a populated pre-drop database'
  fi

  [[ "$(column_count 'User' 'phone')" == '1' ]] || fail 'migration did not add User.phone'
  [[ "$(column_is_nullable 'User' 'phone')" == 'YES' ]] || fail 'User.phone must stay nullable'
  [[ "$(table_columns 'User')" == "$user_columns_before,phone" ]] ||
    fail 'migration changed a User column other than the appended phone'
  [[ "$(phone_check_definition)" == "CHECK (((phone IS NULL) OR (phone ~ '^[0-9]{10,11}\$'::text)))" ]] ||
    fail 'User_phone_digits_check is missing or has a different definition'
  phone_write_accepted '0000000000' || fail 'ten digits must be accepted'
  phone_write_accepted '00000000000' || fail 'eleven digits must be accepted'
  phone_write_rejected '000000000' || fail 'nine digits must be rejected'
  phone_write_rejected '000000000000' || fail 'twelve digits must be rejected'
  phone_write_rejected '0000-000-0000' || fail 'separators must be rejected'

  [[ "$(column_count 'TeamMember' 'phone')" == '0' ]] || fail 'DROP left TeamMember.phone present'
  [[ "$(table_columns 'TeamMember')" == "$member_columns_without_phone_before" ]] ||
    fail 'DROP changed a TeamMember column other than phone'
  [[ "$(user_digest)" == "$user_before" ]] || fail 'User row contents changed'
  [[ "$(member_digest_without_phone)" == "$member_before" ]] || fail 'TeamMember row contents changed'
  [[ "$(control_digest)" == "$control_before" ]] || fail 'unrelated control data changed'
  [[ "$(constraint_digest)" == "$constraints_before" ]] || fail 'constraints outside User changed'

  restore_backup
  [[ "$(column_count 'TeamMember' 'phone')" == '1' ]] || fail 'restore did not recover TeamMember.phone'
  [[ "$(column_count 'User' 'phone')" == '0' ]] || fail 'restore did not return to the pre-drop User shape'
  [[ "$(table_columns 'TeamMember')" == "$member_columns_before" ]] ||
    fail 'restore did not recover the original TeamMember columns'
  [[ "$(member_phone_digest)" == "$member_phone_before" ]] ||
    fail 'restore did not recover the dropped phone values'
  [[ "$(user_digest)" == "$user_before" ]] || fail 'restore did not recover User data'
  [[ "$(control_digest)" == "$control_before" ]] || fail 'restore did not recover control data'
  [[ "$(constraint_digest)" == "$constraints_before" && "$(index_digest)" == "$indexes_before" ]] ||
    fail 'restore did not recover constraints and indexes'

  printf -v success_result '{"status":"ok","scenario":"migrate","coverage":"focused-table","user_rows":%s,"team_member_rows":%s,"dropped_phones":%s,"check_enforced":true,"restored":true}' \
    "$user_rows_before" "$member_rows_before" "$member_phones_before"
  result_emitted=1
  exit 0
fi

# Negative lane: create the exact drift a repeated/partially applied deployment
# would see, then run the same tracked migration and require its explicit error.
psql_exec -c 'ALTER TABLE "TeamMember" DROP COLUMN "phone"' >/dev/null 2>&1
negative_user_before=$(user_digest)
negative_member_before=$(member_digest_without_phone)
negative_control_before=$(control_digest)
negative_constraints_before=$(constraint_digest)
negative_error="$tmp_root/negative-error.log"
set +e
psql_migration >"$negative_error" 2>&1
negative_status=$?
set -e
negative_message=$(<"$negative_error")
(( negative_status != 0 )) || fail 'migration unexpectedly succeeded with the column already absent'
[[ "$negative_message" == *'column "phone" of relation "TeamMember" does not exist'* ]] ||
  fail 'negative migration did not report the missing column explicitly'
[[ "$(column_count 'TeamMember' 'phone')" == '0' ]] || fail 'negative lane recreated the absent column'
# The whole file is one transaction, so the earlier ADD COLUMN must roll back too.
[[ "$(column_count 'User' 'phone')" == '0' ]] ||
  fail 'negative lane left User.phone behind after the failed migration'
[[ "$(phone_check_definition)" == '<missing>' ]] ||
  fail 'negative lane left the phone CHECK behind after the failed migration'
[[ "$(user_digest)" == "$negative_user_before" ]] || fail 'negative lane changed User data'
[[ "$(member_digest_without_phone)" == "$negative_member_before" ]] || fail 'negative lane changed TeamMember data'
[[ "$(control_digest)" == "$negative_control_before" ]] || fail 'negative lane changed unrelated data'
[[ "$(constraint_digest)" == "$negative_constraints_before" ]] || fail 'negative lane changed constraints'

restore_backup
[[ "$(column_count 'TeamMember' 'phone')" == '1' && "$(member_phone_digest)" == "$member_phone_before" ]] ||
  fail 'negative lane backup restore did not recover the pre-drop image'
printf -v success_result '{"status":"ok","scenario":"negative","coverage":"focused-table","user_rows":%s,"team_member_rows":%s,"unrelated_rows":1,"migration_rejected_drift":true,"rolled_back":true,"restored":true}' \
  "$user_rows_before" "$member_rows_before"
result_emitted=1
