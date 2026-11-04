#!/usr/bin/env bash
# shellcheck source=deploy/jenkins/program-migration/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

manifest="${1:-}"
[[ -n "$manifest" && "$#" == 1 ]] || pm_fail 'usage: rehearse.sh <manifest>'
pm_require_container
[[ -f "${PM_DUMP_FILE:-}" && -s "${PM_DUMP_FILE:-}" ]] || pm_fail 'PM_DUMP_FILE must be a non-empty dump file'
node "$PM_DIR/manifest.mjs" "$manifest" validate

rc=0
isolation="$(pm_bounded 20 docker inspect --format '{{index .Config.Labels "oss-hub.program-migration.rehearsal"}}' "$PM_PG_CONTAINER" </dev/null)" || rc=$?
[[ "$rc" == 0 && "$isolation" == true ]] || pm_fail 'container is not labelled as an isolated rehearsal database'

restore_timeout="${PM_RESTORE_TIMEOUT:-1800}"
apply_timeout="${PM_APPLY_TIMEOUT:-900}"
apply_statement_ms="${PM_APPLY_STATEMENT_TIMEOUT_MS:-600000}"
hook_timeout="${PM_HOOK_TIMEOUT:-600}"
run_id="$(date +%Y%m%d%H%M%S)_$$"
db_main="pm_rehearsal_${run_id}_main"
db_restore="pm_rehearsal_${run_id}_restore"
created=()
work="$(mktemp -d)"

step() { printf 'STEP %s\n' "$*"; }

admin() {
  pm_psql off 60 60000 postgres -c "$1" </dev/null
}

cleanup() {
  local rc=$? database
  trap - EXIT
  for database in ${created[@]+"${created[@]}"}; do
    admin "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" || {
      printf 'FAIL_CLOSED cleanup could not drop %s\n' "$database" >&2
      [[ "$rc" != 0 ]] || rc=1
    }
  done
  rm -rf "$work"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

create_and_restore() {
  local database="$1" dump="$2" rc=0
  created+=("$database")
  admin "CREATE DATABASE \"$database\"" || pm_fail "create $database"
  pm_psql off "$restore_timeout" 0 "$database" --single-transaction -f - >/dev/null <"$dump" || rc=$?
  [[ "$rc" == 0 ]] || pm_fail "restore into $database: $(pm_describe_exit "$rc")"
}

snapshot_counts() {
  local database="$1" output="$2" count file index=0 rc
  : >"$output"
  pm_manifest_list "$manifest" count-files
  for file in "${PM_LIST[@]}"; do
    rc=0
    count="$(pm_psql on "$PM_CHECK_TIMEOUT" "$PM_STATEMENT_TIMEOUT_MS" "$database" <"$file")" || rc=$?
    [[ "$rc" == 0 ]] || pm_fail "count query $file: $(pm_describe_exit "$rc")"
    [[ "$count" =~ ^[0-9]+$ ]] || pm_fail "count query $file must print exactly one integer"
    printf '%s\n' "$count" >>"$output"
    index=$((index + 1))
  done
  [[ "$index" -gt 0 ]] || pm_fail 'no counts to snapshot'
}

take_backup() {
  local mirror=()
  pm_manifest_list "$manifest" object-mirror
  mirror=(${PM_LIST[@]+"${PM_LIST[@]}"})
  snapshot_counts "$db_main" "$work/counts-before"
  PM_DATABASE="$db_main" bash "$PM_DIR/backup.sh" --label "$backup_label" --backup-dir "$work/backups" \
    -- ${mirror[@]+"${mirror[@]}"} || pm_fail 'pre-deletion backup failed'
  bash "$PM_DIR/verify-backup.sh" "$work/backups" "$backup_label" || pm_fail 'pre-deletion backup failed verification'
}

run_cutover() {
  local file rc=0 check_argv=()
  step "cutover write"
  pm_manifest_list "$manifest" cutover-write
  for file in "${PM_LIST[@]}"; do
    pm_psql off "$apply_timeout" "$apply_statement_ms" "$db_main" >/dev/null <"$file" || pm_fail "cutover write failed: $file"
  done
  step "previous image check"
  pm_manifest_list "$manifest" cutover-previous-image
  check_argv=("${PM_LIST[@]}")
  PM_DATABASE="$db_main" pm_bounded "$hook_timeout" "${check_argv[@]}" >/dev/null 2>&1 </dev/null || rc=$?
  [[ "$rc" == 0 ]] || pm_fail "previous image check: $(pm_describe_exit "$rc")"
  step "old structure reconcile"
  pm_manifest_list "$manifest" cutover-old-reconcile
  PM_DATABASE="$db_main" pm_run_checks "${PM_LIST[@]}" || pm_fail 'old structure reconcile failed'
}

rc=0
stale="$(pm_psql on 30 30000 postgres -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'pm\\_rehearsal\\_%'" </dev/null)" || rc=$?
[[ "$rc" == 0 ]] || pm_fail "stale database check: $(pm_describe_exit "$rc")"
[[ "$stale" == 0 ]] || pm_fail "isolated container already has $stale rehearsal databases"

pm_manifest_list "$manifest" name
name="${PM_LIST[0]}"
backup_label="rehearsal-$run_id"
pm_manifest_list "$manifest" backup-before
backup_before="${PM_LIST[0]}"
pm_manifest_list "$manifest" cutover-after
cutover_after="${PM_LIST[0]:-}"
pm_manifest_list "$manifest" stage-ids
stage_ids=("${PM_LIST[@]}")

step "restore production dump"
create_and_restore "$db_main" "$PM_DUMP_FILE"

step "preflight"
PM_DATABASE="$db_main" bash "$PM_DIR/preflight.sh" "$manifest" || pm_fail 'preflight failed'

for stage in "${stage_ids[@]}"; do
  if [[ "$stage" == "$backup_before" ]]; then
    step "backup before $stage"
    take_backup
  fi
  step "apply $stage"
  pm_manifest_list "$manifest" stage-apply "$stage"
  for file in ${PM_LIST[@]+"${PM_LIST[@]}"}; do
    pm_psql off "$apply_timeout" "$apply_statement_ms" "$db_main" >/dev/null <"$file" || pm_fail "apply failed: $file"
  done
  step "reconcile $stage"
  PM_DATABASE="$db_main" bash "$PM_DIR/reconcile.sh" "$manifest" "$stage" || pm_fail "reconcile failed: $stage"
  if [[ "$stage" == "$cutover_after" ]]; then
    run_cutover
  fi
done

step "restore backup and compare counts"
bash "$PM_DIR/verify-backup.sh" "$work/backups" "$backup_label" || pm_fail 'backup failed verification before restore'
create_and_restore "$db_restore" "$work/backups/$backup_label.sql"
snapshot_counts "$db_restore" "$work/counts-after"
pm_manifest_list "$manifest" count-names
index=0
mismatched=0
for count_name in "${PM_LIST[@]}"; do
  index=$((index + 1))
  before="$(sed -n "${index}p" "$work/counts-before")"
  after="$(sed -n "${index}p" "$work/counts-after")"
  printf 'COUNT %s before=%s restored=%s\n' "$count_name" "$before" "$after"
  [[ "$before" == "$after" ]] || mismatched=$((mismatched + 1))
done
[[ "$mismatched" == 0 ]] || pm_fail "restored counts differ: $mismatched"

printf 'REHEARSAL_OK name=%s stages=%s counts=%s\n' "$name" "${#stage_ids[@]}" "$index"
