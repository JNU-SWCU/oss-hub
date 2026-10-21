#!/usr/bin/env bash
set -euo pipefail

scenario=${1:-}
dump_path=${2:-}
image_tag=${3:-}

mode=''
if [[ $# -eq 1 ]]; then
  mode='synthetic'
elif [[ $# -eq 3 ]]; then
  mode='production-dump'
fi

if [[ -z $mode ]] || [[ $scenario != 'migrate' && $scenario != 'negative' ]]; then
  printf 'Usage: scripts/rehearse-legacy-table-drop.sh migrate|negative [dump_path image_tag]\n' >&2
  printf '  (no extra args)      synthetic mode — builds the pre-migration DB from the tracked\n' >&2
  printf '                       migrations; no production dump or release image required.\n' >&2
  printf '  dump_path image_tag  production-dump mode — restores dump_path (a `pg_dump -Fc`\n' >&2
  printf '                       file) and runs image_tag'"'"'s own release `npx prisma migrate\n' >&2
  printf '                       deploy`. Run only on the production host, by the owner.\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backend="$repo_root/apps/backend"
migration_dir='20260924120000_drop_legacy_projection_tables'
migration_sql="$backend/prisma/migrations/$migration_dir/migration.sql"
[[ -f "$migration_sql" ]] || {
  printf '[legacy-table-drop] migration file is missing\n' >&2
  exit 1
}

if [[ $mode == 'production-dump' ]]; then
  [[ -f "$dump_path" ]] || {
    printf '[legacy-table-drop] dump file not found: %s\n' "$dump_path" >&2
    exit 1
  }
fi

command -v docker >/dev/null 2>&1 || {
  printf '[legacy-table-drop] docker is required\n' >&2
  exit 1
}

postgres_image='postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73'

fail() {
  result_emitted=1
  printf '[legacy-table-drop] status=failed scenario=%s mode=%s reason=%s\n' "$scenario" "$mode" "$1" >&2
  exit 1
}

container="oss-hub-legacy-drop-$(date +%s)-$$-$RANDOM"
network=''
password="synthetic-legacy-drop-$$-$RANDOM"
database='legacy_table_drop_rehearsal'
pg_connect_timeout='5'
pg_options='-c statement_timeout=60000 -c lock_timeout=10000'
docker_cli=()
effective_docker_context=''
effective_docker_host=''
container_started=0
network_created=0
tmp_root=''
staged=''
result_emitted=0
success_result=''

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
  if (( container_started == 1 )); then
    if ! "${docker_cli[@]}" rm -f -v "$container" >/dev/null 2>&1; then
      cleanup_status=1
    fi
  fi
  if (( network_created == 1 )); then
    if ! "${docker_cli[@]}" network rm "$network" >/dev/null 2>&1; then
      cleanup_status=1
    fi
  fi
  for dir in "${tmp_root:-}" "${staged:-}"; do
    [[ -n $dir ]] || continue
    if command -v shred >/dev/null 2>&1; then
      find "$dir" -type f -exec shred -u -- {} + 2>/dev/null || true
    fi
    rm -rf -- "$dir" || cleanup_status=1
  done
  if (( cleanup_status != 0 )); then
    printf '[legacy-table-drop] status=failed scenario=%s mode=%s reason=cleanup failed\n' \
      "$scenario" "$mode" >&2
    status=1
  elif (( status != 0 && result_emitted == 0 )); then
    printf '[legacy-table-drop] status=failed scenario=%s mode=%s\n' "$scenario" "$mode" >&2
  elif (( status == 0 )) && [[ -n "$success_result" ]]; then
    printf '%s\n' "$success_result"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/legacy-table-drop-rehearsal.XXXXXX")


if [[ $mode == 'production-dump' ]]; then
  network="oss-hub-legacy-drop-net-$(date +%s)-$$-$RANDOM"
  "${docker_cli[@]}" network create --internal "$network" >/dev/null
  network_created=1
  "${docker_cli[@]}" run -d --name "$container" --network "$network" \
    -e POSTGRES_USER=migration \
    -e POSTGRES_PASSWORD="$password" \
    -e POSTGRES_DB="$database" \
    "$postgres_image" >/dev/null
else
  "${docker_cli[@]}" run -d --name "$container" -p 127.0.0.1:0:5432 \
    -e POSTGRES_USER=migration \
    -e POSTGRES_PASSWORD="$password" \
    -e POSTGRES_DB="$database" \
    "$postgres_image" >/dev/null
fi
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
  printf '[legacy-table-drop] PostgreSQL did not become ready after 60 attempts\n' >&2
  exit 1
}

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

if [[ $mode == 'synthetic' ]]; then
  host_port=$("${docker_cli[@]}" port "$container" 5432/tcp | head -1 | sed 's/.*://')
  host_database_url="postgresql://migration:${password}@127.0.0.1:${host_port}/${database}?schema=public"
else
  container_database_url="postgresql://migration:${password}@${container}:5432/${database}?schema=public"
fi


table_snapshot() {
  psql_exec -tA <<'SQL'
CREATE TEMP TABLE table_digests (tablename text, row_count bigint, content_hash text);
DO $do$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'PublicShowcaseRepository', 'PublicShowcaseContributor',
        'CollectionRun', 'GithubRawObservation', '_prisma_migrations'
      )
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'INSERT INTO table_digests SELECT %L, count(*), md5(COALESCE(string_agg(t::text, E''\n'' ORDER BY t::text), '''')) FROM %I AS t',
      tbl, tbl
    );
  END LOOP;
END
$do$;
SELECT tablename || '|' || row_count || '|' || content_hash FROM table_digests ORDER BY tablename;
SQL
}

constraint_digest() {
  local extra_filter=''
  [[ ${1:-} == 'excluding-dropped' ]] && extra_filter="AND conrelid::regclass::text NOT IN ('\"PublicShowcaseRepository\"','\"PublicShowcaseContributor\"','\"CollectionRun\"','\"GithubRawObservation\"')"
  psql_value "SELECT md5(COALESCE((SELECT string_agg(conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid), chr(10) ORDER BY conrelid::regclass::text, conname) FROM pg_constraint WHERE connamespace = 'public'::regnamespace $extra_filter), ''))"
}

index_digest() {
  local extra_filter=''
  [[ ${1:-} == 'excluding-dropped' ]] && extra_filter="AND tablename NOT IN ('PublicShowcaseRepository','PublicShowcaseContributor','CollectionRun','GithubRawObservation')"
  psql_value "SELECT md5(COALESCE((SELECT string_agg(indexname || '|' || indexdef, chr(10) ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' $extra_filter), ''))"
}

enum_digest() {
  local extra_filter=''
  [[ ${1:-} == 'excluding-dropped' ]] && extra_filter="AND t.typname NOT IN ('ObservationSourceType','CollectionRunStatus','CollectionTrigger')"
  psql_value "SELECT md5(COALESCE((SELECT string_agg(t.typname || '|' || e.enumlabel, chr(10) ORDER BY t.typname, e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' $extra_filter), ''))"
}

migrations_row_count() {
  psql_value 'SELECT count(*) FROM "_prisma_migrations"'
}

migration_finished_count() {
  psql_value "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$migration_dir' AND finished_at IS NOT NULL AND rolled_back_at IS NULL"
}

migration_unfinished_count() {
  psql_value "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$migration_dir' AND finished_at IS NULL"
}

legacy_tables_present_count() {
  psql_value "SELECT count(*) FROM (VALUES ('PublicShowcaseRepository'),('PublicShowcaseContributor'),('CollectionRun'),('GithubRawObservation')) AS t(name) WHERE to_regclass('public.\"' || t.name || '\"') IS NOT NULL"
}

collection_run_row_count() {
  psql_value 'SELECT count(*) FROM "CollectionRun"'
}


if [[ $mode == 'production-dump' ]]; then
  "${docker_cli[@]}" exec -i \
    -e "PGPASSWORD=$password" \
    -e "PGCONNECT_TIMEOUT=$pg_connect_timeout" \
    -e "PGOPTIONS=$pg_options" \
    "$container" \
    pg_restore --exit-on-error --no-owner -U migration -d "$database" <"$dump_path" \
    >"$tmp_root/restore.log" 2>&1 ||
    fail 'pg_restore of the input dump failed'
else
  staged=$(mktemp -d "${TMPDIR:-/tmp}/legacy-table-drop-staged.XXXXXX")
  cp -R "$backend/prisma/migrations" "$staged/migrations"
  cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
  mkdir -p "$staged/pending"
  mv "$staged/migrations/$migration_dir" "$staged/pending/$migration_dir"

  (cd "$backend" && DATABASE_URL="$host_database_url" \
    pnpm exec prisma migrate deploy --schema "$staged/schema.prisma") \
    >"$tmp_root/deploy-base.log" 2>&1 ||
    fail 'deploying the pre-existing migration history failed'

  psql_exec >/dev/null 2>"$tmp_root/seed.log" <<'SQL' || fail 'seeding the synthetic control row failed'
INSERT INTO "User" ("id", "githubId", "login", "updatedAt")
VALUES ('synthetic-legacy-drop-control-user', 9990000001, 'synthetic-legacy-drop-control', now());
SQL

  mv "$staged/pending/$migration_dir" "$staged/migrations/$migration_dir"
fi

[[ "$(legacy_tables_present_count)" == '4' ]] ||
  fail 'pre-migration database does not have all four legacy tables'

if [[ $scenario == 'negative' ]]; then
  psql_exec >/dev/null 2>"$tmp_root/violation.log" <<'SQL' || fail 'inserting the negative-lane CollectionRun row failed'
INSERT INTO "CollectionRun" ("id", "targetGithubId", "targetLogin", "trigger", "status")
VALUES ('synthetic-legacy-drop-violation', 9990000002, 'synthetic-legacy-drop-violation', 'SELF', 'RUNNING');
SQL
  [[ "$(collection_run_row_count)" == '1' ]] || fail 'negative-lane fixture row did not land'
fi


snapshot_before=$(table_snapshot)
constraints_before=$(constraint_digest)
indexes_before=$(index_digest)
enums_before=$(enum_digest)
migrations_before=$(migrations_row_count)
expected_constraints=$(constraint_digest 'excluding-dropped')
expected_indexes=$(index_digest 'excluding-dropped')
expected_enums=$(enum_digest 'excluding-dropped')
[[ -n "$snapshot_before" ]] ||
  fail 'pre-migration table snapshot came back empty — the digest query itself is broken'
[[ -n "$constraints_before" && -n "$indexes_before" && -n "$enums_before" ]] ||
  fail 'pre-migration schema fingerprints must not be empty'

if [[ $scenario == 'negative' ]]; then
  gate_log="$tmp_root/gate-check.log"
  set +e
  psql_exec <"$migration_sql" >"$gate_log" 2>&1
  gate_status=$?
  set -e
  gate_output=$(<"$gate_log")
  (( gate_status != 0 )) ||
    fail 'the tracked migration file unexpectedly succeeded with a non-empty legacy table'
  [[ "$gate_output" == *'legacy tables require reconciliation'* ]] ||
    fail "the tracked migration file did not report the preflight gate's message
  output: $gate_output"
fi


deploy_log="$tmp_root/deploy-migration.log"
set +e
if [[ $mode == 'production-dump' ]]; then
  "${docker_cli[@]}" run --rm --network "$network" \
    -e DATABASE_URL="$container_database_url" \
    "$image_tag" npx prisma migrate deploy >"$deploy_log" 2>&1
else
  (cd "$backend" && DATABASE_URL="$host_database_url" \
    pnpm exec prisma migrate deploy --schema "$staged/schema.prisma") >"$deploy_log" 2>&1
fi
deploy_status=$?
set -e
deploy_output=$(<"$deploy_log")

if [[ $scenario == 'migrate' ]]; then
  (( deploy_status == 0 )) || fail "migrate deploy failed on an empty, reconciled database
  output: $deploy_output"

  [[ "$(legacy_tables_present_count)" == '0' ]] || fail 'DROP left one or more legacy tables behind'

  snapshot_after=$(table_snapshot)
  [[ "$snapshot_after" == "$snapshot_before" ]] || fail "an unrelated table changed
  before: $snapshot_before
  after:  $snapshot_after"

  [[ "$(constraint_digest)" == "$expected_constraints" ]] ||
    fail 'a constraint outside the four dropped tables changed'

  [[ "$(index_digest)" == "$expected_indexes" ]] ||
    fail 'an index outside the four dropped tables changed'

  [[ "$(enum_digest)" == "$expected_enums" ]] ||
    fail 'an enum other than the three this migration owns changed'

  [[ "$(migrations_row_count)" == "$((migrations_before + 1))" ]] ||
    fail '_prisma_migrations did not gain exactly one row'
  [[ "$(migration_finished_count)" == '1' ]] ||
    fail 'the new _prisma_migrations row is not a finished, non-rolled-back record'

  printf -v success_result '{"status":"ok","scenario":"migrate","mode":"%s","tables_dropped":4,"enums_dropped":3,"unrelated_tables_unchanged":true,"migrations_row":"finished"}' \
    "$mode"
  result_emitted=1
  exit 0
fi

(( deploy_status != 0 )) || fail 'migrate deploy unexpectedly succeeded with a non-empty legacy table'

[[ "$(legacy_tables_present_count)" == '4' ]] || fail 'negative lane dropped a legacy table despite the failed gate'
[[ "$(collection_run_row_count)" == '1' ]] || fail 'negative lane changed the CollectionRun fixture row'

snapshot_after=$(table_snapshot)
[[ "$snapshot_after" == "$snapshot_before" ]] || fail "negative lane changed an unrelated table
before: $snapshot_before
after:  $snapshot_after"
[[ "$(constraint_digest)" == "$constraints_before" ]] || fail 'negative lane changed a constraint'
[[ "$(index_digest)" == "$indexes_before" ]] || fail 'negative lane changed an index'
[[ "$(enum_digest)" == "$enums_before" ]] || fail 'negative lane dropped an enum despite the failed gate'

[[ "$(migrations_row_count)" == "$((migrations_before + 1))" ]] ||
  fail '_prisma_migrations did not record the rejected attempt'
[[ "$(migration_unfinished_count)" == '1' ]] ||
  fail 'the rejected attempt was recorded as finished — the gate did not actually block it'

printf -v success_result '{"status":"ok","scenario":"negative","mode":"%s","gate_rejected":true,"unrelated_tables_unchanged":true,"migrations_row":"unfinished"}' \
  "$mode"
result_emitted=1
