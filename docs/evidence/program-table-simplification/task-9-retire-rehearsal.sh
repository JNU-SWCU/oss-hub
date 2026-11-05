#!/usr/bin/env bash
# Local retirement rehearsal on synthetic data: success on migrated and fresh databases, mismatch rollback,
# and row and file counts after a post-drop dump is restored. Run with Docker; it never reaches production.
set -Eeuo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
migrations="$root/apps/backend/prisma/migrations"
harness="$root/deploy/jenkins/program-migration"
manifest="$harness/team-application/retire.json"
seed="$root/docs/evidence/program-table-simplification/task-9-retire-rehearsal-seed.sql"
pre_head=20261105050000_retire_submission_axis
cutover_head=20261105100100_merge_applications_into_teams
retire_head=20261105110000_retire_application_storage
prefix="${RETIRE_REHEARSAL_PREFIX:-oss-hub-task9-retire}"
builder="$prefix-build"
runner="$prefix-run"
work="$(mktemp -d)"
retained=(Team TeamMember TeamInvitation TeamHistory GithubRepository RepositoryProvisionJob
  RepositoryIssuanceHistory GithubRepositoryOutsiderContribution MilestoneDocumentSubmission
  SubmissionFile Notification OutboxEvent)

cleanup() {
  docker rm -fv "$builder" "$runner" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() { printf 'RETIRE_REHEARSAL_FAILED %s\n' "$1"; exit 1; }
sql() { docker exec -i "$builder" psql -X -v ON_ERROR_STOP=1 -q -At -U oss_rehearsal -d "$1" "${@:2}"; }

start_container() {
  local name="$1"
  shift
  docker run -d --rm --name "$name" --label oss-hub.program-migration.rehearsal=true "$@" \
    -e POSTGRES_USER=oss_rehearsal -e POSTGRES_DB=postgres -e POSTGRES_HOST_AUTH_METHOD=trust \
    postgres:17-alpine >/dev/null
  local attempt
  for attempt in $(seq 1 60); do
    docker exec "$name" psql -U oss_rehearsal -d postgres -Atc 'SELECT 1' >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "container did not start: $name"
}

deploy_through() {
  local db="$1" head="$2"
  local dir="$work/prisma-$head" port name
  mkdir -p "$dir/migrations"
  printf 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n' >"$dir/schema.prisma"
  cp "$migrations/migration_lock.toml" "$dir/migrations/"
  for path in "$migrations"/*/; do
    name="$(basename "$path")"
    [[ "$name" > "$head" ]] || cp -R "$path" "$dir/migrations/$name"
  done
  port="$(docker port "$builder" 5432 | sed -n '1s/.*://p')"
  (cd "$root/apps/backend" && DATABASE_URL="postgresql://oss_rehearsal@127.0.0.1:$port/$db" \
    node_modules/.bin/prisma migrate deploy --schema "$dir/schema.prisma" >"$dir/deploy.log" 2>&1) \
    || { tail -20 "$dir/deploy.log"; fail "prisma migrate deploy through $head on $db"; }
}

ledger_head() {
  sql "$1" -c "SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
}

expect_zero() {
  local label="$1" db="$2" file="$3" got
  got="$(sql "$db" <"$file")"
  [[ "$got" == 0 ]] || fail "$label returned $got mismatches"
  printf '%s mismatches=0\n' "$label"
}

retained_counts() {
  local table
  for table in "${retained[@]}"; do
    printf '%s=%s\n' "$table" "$(sql "$1" -c "SELECT count(*) FROM \"$table\"")"
  done
}

rehearse() {
  PM_PG_CONTAINER="$runner" PM_DUMP_FILE="$1" bash "$harness/rehearse.sh" "$manifest" 2>&1
}

clone_db() { sql postgres -c "CREATE DATABASE \"$2\" TEMPLATE \"$1\""; }

printf 'source_commit=%s\n' "$(git -C "$root" rev-parse HEAD)"
printf 'migration=%s\n' "$retire_head"
printf 'migration_sha256=%s\n' "$(shasum -a 256 "$migrations/$retire_head/migration.sql" | cut -d' ' -f1)"
printf 'data=synthetic production_clone=no production_database_writes=0\n'

start_container "$builder" -p 127.0.0.1:0:5432 --tmpfs /var/lib/postgresql/data:rw,size=768m
start_container "$runner" --network none --tmpfs /var/lib/postgresql/data:rw,size=384m

printf '\n== build post-cutover source on the real migration chain\n'
sql postgres -c 'CREATE DATABASE source'
deploy_through source "$pre_head"
sql source <"$seed"
expect_zero CUTOVER_PREFLIGHT source "$harness/team-application/preflight.sql"
deploy_through source "$cutover_head"
expect_zero CUTOVER_RECONCILE source "$harness/team-application/reconcile.sql"
printf 'source_ledger_head=%s\n' "$(ledger_head source)"
docker exec "$builder" pg_dump --no-owner --no-acl -U oss_rehearsal -d source >"$work/source.sql"

printf '\n== scenario 1: success on migrated data through rehearse.sh\n'
output="$(rehearse "$work/source.sql")" || { printf '%s\n' "$output"; fail 'rehearse.sh on migrated data'; }
printf '%s\n' "$output"
grep -q '^REHEARSAL_OK ' <<<"$output" || fail 'rehearse.sh printed no REHEARSAL_OK'

printf '\n== scenario 2: success on a fresh database through the whole migration chain\n'
sql postgres -c 'CREATE DATABASE fresh'
deploy_through fresh "$retire_head"
expect_zero CHECK_RETIRED_FRESH fresh "$harness/team-application/check-retired.sql"
head_fresh="$(ledger_head fresh)"
[[ "$head_fresh" == "$retire_head" ]] || fail "fresh ledger head is $head_fresh"
printf 'fresh_ledger_head=%s\n' "$head_fresh"
printf 'fresh_application_table=%s\n' "$(sql fresh -c "SELECT coalesce(to_regclass('\"Application\"')::text, 'absent')")"

printf '\n== scenario 3: mismatch rollback\n'
pair_cte="WITH pair AS (SELECT id, data->>'pairedAuditId' AS paired, row_number() OVER (ORDER BY id) AS n
  FROM \"TeamHistory\" WHERE \"sourceTable\" = 'ApplicationReviewHistory' ORDER BY id LIMIT 2)"
first_review="(SELECT id FROM \"TeamHistory\" WHERE \"sourceTable\" = 'ApplicationReviewHistory' ORDER BY id LIMIT 1)"
first_audit="(SELECT id FROM \"TeamHistory\" WHERE \"sourceTable\" = 'AuditLog' ORDER BY id LIMIT 1)"

mismatch() {
  local name="$1" corruption="$2" expected="$3"
  local db="mismatch_$name" errors="$work/$name.err"
  clone_db source "$db"
  printf 'SET session_replication_role = replica;\n%s;\n' "$corruption" | sql "$db" >/dev/null
  docker exec "$builder" pg_dump --no-owner --no-acl -U oss_rehearsal -d "$db" >"$work/$name.sql"

  if sql "$db" <"$migrations/$retire_head/migration.sql" >/dev/null 2>"$errors"; then
    fail "$name: retire migration succeeded on corrupted data"
  fi
  grep -q "$expected" "$errors" || { cat "$errors"; fail "$name: unexpected failure"; }
  local kept
  kept="$(sql "$db" -c "SELECT (SELECT count(*) FROM \"Application\") || '|' || (SELECT count(*) FROM \"ApplicationReviewHistory\") || '|' ||
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'SubmissionFile' AND column_name = 'applicationId') || '|' ||
    (SELECT count(*) FROM pg_constraint WHERE conname = 'Team_application_fields_check')")"
  [[ "$kept" == '33|9|1|0' ]] || fail "$name: source storage changed after abort: $kept"
  printf 'MISMATCH_ABORTED name=%s guard="%s" applications=33 reviews=9 files_column_kept=1 fields_check_added=0\n' "$name" "$expected"

  local out rc=0
  out="$(rehearse "$work/$name.sql")" || rc=$?
  [[ "$rc" != 0 ]] || fail "$name: rehearse.sh succeeded on corrupted data"
  ! grep -q '^REHEARSAL_OK ' <<<"$out" || fail "$name: rehearse.sh printed REHEARSAL_OK"
  printf 'REHEARSAL_REJECTED name=%s exit=%s last="%s"\n' "$name" "$rc" "$(tail -1 <<<"$out" | cut -c1-120)"
}

mismatch null_copied_review_actor \
  "UPDATE \"TeamHistory\" SET \"actorId\" = NULL WHERE id = $first_review" \
  'Team retirement review history mismatch'
mismatch null_copied_audit_actor \
  "UPDATE \"TeamHistory\" SET \"actorId\" = NULL WHERE id = $first_audit" \
  'Team retirement copied audit mismatch'
mismatch swapped_paired_audit_ids \
  "$pair_cte UPDATE \"TeamHistory\" t SET data = jsonb_set(t.data, '{pairedAuditId}', to_jsonb(o.paired)) FROM pair p JOIN pair o ON o.n = 3 - p.n WHERE t.id = p.id" \
  'Team retirement paired audit'
mismatch changed_paired_audit_metadata \
  "UPDATE \"TeamHistory\" SET data = jsonb_set(data, '{pairedAuditMetadata}', '{\"changed\":true}'::jsonb) WHERE id = $first_review" \
  'Team retirement paired audit mismatch'
mismatch deleted_copied_audit \
  "DELETE FROM \"TeamHistory\" WHERE id = $first_audit" \
  'Team retirement copied audit mismatch'

printf '\n== scenario 4: post-drop dump restoration with row and file counts\n'
clone_db source retired
retained_counts retired >"$work/before.txt"
sql retired <"$migrations/$retire_head/migration.sql" 2>&1 | grep 'TEAM_RETIRE' || true
expect_zero CHECK_RETIRED_MIGRATED retired "$harness/team-application/check-retired.sql"
retained_counts retired >"$work/after.txt"
diff "$work/before.txt" "$work/after.txt" || fail 'retained row counts changed across the drop'
sql retired -c "SELECT coalesce(to_regclass('\"Application\"')::text, 'absent') || '|' || coalesce(to_regclass('\"ApplicationReviewHistory\"')::text, 'absent')" \
  | { read -r dropped; [[ "$dropped" == 'absent|absent' ]] || fail "source tables remain: $dropped"; printf 'source_tables=%s\n' "$dropped"; }
docker exec "$builder" pg_dump --no-owner --no-acl -U oss_rehearsal -d retired >"$work/retired.sql"
sql postgres -c 'CREATE DATABASE retired_restored'
sql retired_restored --single-transaction <"$work/retired.sql" >/dev/null
retained_counts retired_restored >"$work/restored.txt"
diff "$work/after.txt" "$work/restored.txt" || fail 'row counts changed after restoring the post-drop dump'
sed 's/^/POST_DROP_RESTORED /' "$work/restored.txt"
storage_keys="$(sql retired_restored -c 'SELECT count(DISTINCT "storageKey") FROM "SubmissionFile"')"
[[ "$storage_keys" == 81 ]] || fail "restored file count is $storage_keys"
printf 'POST_DROP_RESTORED distinct_file_storage_keys=%s\n' "$storage_keys"

cleanup
trap - EXIT
remaining="$(docker ps -aq --filter "name=^/$builder$" --filter "name=^/$runner$" | wc -l | tr -d ' ')"
[[ "$remaining" == 0 ]] || fail "containers left behind: $remaining"
printf '\nrehearsal_containers_remaining=0\nRETIRE_REHEARSAL_OK\n'
