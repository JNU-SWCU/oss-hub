#!/usr/bin/env bash
# shellcheck source=deploy/jenkins/program-migration/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage='usage: backup.sh --label <label> --backup-dir <dir> [-- <object-mirror command...>]'
label=
backup_dir=
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --label) [[ "$#" -ge 2 ]] || pm_fail "$usage"; label="$2"; shift 2 ;;
    --backup-dir) [[ "$#" -ge 2 ]] || pm_fail "$usage"; backup_dir="$2"; shift 2 ;;
    --) shift; break ;;
    *) pm_fail "$usage" ;;
  esac
done
[[ -n "$label" && -n "$backup_dir" ]] || pm_fail "$usage"
[[ "$label" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || pm_fail 'invalid backup label'
pm_require_container

dump_timeout="${PM_DUMP_TIMEOUT:-1800}"
mirror_timeout="${PM_MIRROR_TIMEOUT:-1800}"
lock_wait="${PM_DUMP_LOCK_WAIT:-30s}"

mkdir -p "$backup_dir"
dump_target="$backup_dir/$label.sql"
objects_target="$backup_dir/$label.objects"
hashes_target="$backup_dir/$label.objects.sha256"
receipt_target="$backup_dir/$label.receipt"
for target in "$dump_target" "$objects_target" "$hashes_target" "$receipt_target"; do
  [[ ! -e "$target" && ! -L "$target" ]] || pm_fail "backup target already exists: $target"
done

work="$(mktemp -d "$backup_dir/.$label.XXXXXX")"
committed=0
cleanup() {
  local rc=$?
  trap - EXIT
  rm -rf "$work"
  if [[ "$committed" != 1 ]]; then
    rm -rf "$dump_target" "$objects_target" "$hashes_target"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rc=0
# shellcheck disable=SC2016 # expanded by the container shell
pm_bounded "$((dump_timeout + PM_BOUND_GRACE))" docker exec \
  -e "PM_DATABASE=${PM_DATABASE:-}" \
  "$PM_PG_CONTAINER" sh -ec \
  'exec timeout "$1" pg_dump --lock-wait-timeout="$2" -U "$POSTGRES_USER" -d "${PM_DATABASE:-$POSTGRES_DB}"' \
  sh "$dump_timeout" "$lock_wait" >"$work/dump.sql" </dev/null || rc=$?
[[ "$rc" == 0 ]] || pm_fail "backup pg_dump: $(pm_describe_exit "$rc")"
[[ -s "$work/dump.sql" ]] || pm_fail 'backup pg_dump produced an empty dump'
tail -n 8 "$work/dump.sql" | grep -q '^-- PostgreSQL database dump complete$' ||
  pm_fail 'backup pg_dump output is truncated'

object_count=0
object_bytes=0
objects=absent
: >"$work/hashes"
if [[ "$#" -gt 0 ]]; then
  objects=present
  mkdir "$work/objects"
  rc=0
  pm_bounded "$mirror_timeout" "$@" "$work/objects" >/dev/null 2>&1 </dev/null || rc=$?
  [[ "$rc" == 0 ]] || pm_fail "backup object mirror: $(pm_describe_exit "$rc")"
  find "$work/objects" -type f -print0 >"$work/list"
  while IFS= read -r -d '' object_file; do
    printf '%s  %s\n' "$(pm_sha256 "$object_file")" "${object_file#"$work/objects/"}" >>"$work/hashes"
    object_count=$((object_count + 1))
    object_bytes=$((object_bytes + $(wc -c <"$object_file")))
  done <"$work/list"
  [[ "$object_count" -gt 0 ]] || pm_fail 'backup object mirror produced no objects'
fi

dump_bytes="$(wc -c <"$work/dump.sql" | tr -d ' ')"
{
  printf 'label=%s\n' "$label"
  printf 'dump-sha256=%s\n' "$(pm_sha256 "$work/dump.sql")"
  printf 'dump-bytes=%s\n' "$dump_bytes"
  printf 'objects=%s\n' "$objects"
  printf 'object-count=%s\n' "$object_count"
  printf 'object-bytes=%s\n' "$object_bytes"
} >"$work/receipt"

mv "$work/dump.sql" "$dump_target"
if [[ "$objects" == present ]]; then
  mv "$work/objects" "$objects_target"
  mv "$work/hashes" "$hashes_target"
fi
mv "$work/receipt" "$receipt_target"
committed=1
printf 'BACKUP_OK label=%s dump-bytes=%s object-count=%s\n' "$label" "$dump_bytes" "$object_count"
