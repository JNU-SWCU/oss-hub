#!/usr/bin/env bash
# prune-deploy-backups.sh — success-only deploy DB backup retention.
# Keep the newest N production-named backups under an explicit directory.
# Intended call site: Jenkins success path after smoke (not before).
set -euo pipefail

usage() {
  printf 'usage: %s <backup_dir> <retain_n>\n' "$(basename -- "$0")" >&2
  exit 1
}

fail_closed() {
  printf 'FAIL_CLOSED backup_retention: %s\n' "$1" >&2
  exit 1
}

# Exact production backup naming contract:
#   ${RELEASE_TAG}-${BUILD_NUMBER}.sql
#   RELEASE_TAG = vMAJOR.MINOR.PATCH (full SemVer, no leading zeros in numeric parts)
#   BUILD_NUMBER = positive integer
# Accepted basenames exclude tabs/newlines (and slashes), so mtime+basename TSV is delimiter-safe.
BACKUP_NAME_RE='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[1-9][0-9]*\.sql$'

file_mtime_epoch() {
  local path=$1
  # BSD stat (macOS) then GNU stat (Linux Jenkins agent).
  if stat -f '%m' "$path" >/dev/null 2>&1; then
    stat -f '%m' "$path"
  elif stat -c '%Y' "$path" >/dev/null 2>&1; then
    stat -c '%Y' "$path"
  else
    return 1
  fi
}

# Read one NUL-terminated path from stdin.
# Sets _read_path. Returns 0 on record, 1 on clean EOF, 2 on incomplete/error.
read_nul_path() {
  _read_path=
  # Capture read status via || so set -e does not abort on EOF (rc=1).
  local rc=0
  IFS= read -r -d '' _read_path || rc=$?
  if ((rc == 0)); then
    [[ -n "$_read_path" ]] || return 2
    return 0
  fi
  if [[ -n "$_read_path" ]]; then
    # Partial record before EOF/error — not a clean delimiter boundary.
    return 2
  fi
  # bash read: 1 == EOF. Anything else is a hard failure.
  if ((rc == 1)); then
    return 1
  fi
  return 2
}

# Read one TSV record (mtime<TAB>basename) from stdin.
# Sets _read_mtime/_read_base. Same EOF/error contract as read_nul_path.
read_tsv_record() {
  _read_mtime=
  _read_base=
  local line=
  local rc=0
  IFS= read -r line || rc=$?
  if ((rc == 0)); then
    [[ -n "$line" ]] || return 2
    # Exactly one tab separating two non-empty fields; fields themselves must not contain tab.
    if [[ "$line" != *$'\t'* || "$line" == *$'\t'*$'\t'* ]]; then
      return 2
    fi
    _read_mtime=${line%%$'\t'*}
    _read_base=${line#*$'\t'}
    [[ -n "$_read_mtime" && -n "$_read_base" ]] || return 2
    return 0
  fi
  if [[ -n "$line" ]]; then
    # bash read returns >0 for a final line without trailing newline; treat as incomplete.
    return 2
  fi
  if ((rc == 1)); then
    return 1
  fi
  return 2
}

[[ $# -eq 2 ]] || usage

backup_dir=$1
retain_n=$2

if ! [[ "$retain_n" =~ ^[1-9][0-9]*$ ]]; then
  fail_closed "retain_n must be a positive integer (got: ${retain_n})"
fi

if [[ ! -e "$backup_dir" ]]; then
  fail_closed "backup_dir does not exist"
fi

if [[ -L "$backup_dir" ]]; then
  fail_closed "backup_dir must not be a symlink"
fi

if [[ ! -d "$backup_dir" ]]; then
  fail_closed "backup_dir is not a directory"
fi

# Canonical absolute path; -P resolves intermediates but dir itself is not a symlink.
backup_dir=$(cd -- "$backup_dir" && pwd -P)

# Materialize NUL inventories with checked producers. Process substitutions do not
# propagate find's exit status, so a failed inventory must not become empty success.
inventory_dir=$(mktemp -d "${TMPDIR:-/tmp}/prune-deploy-backups.inv.XXXXXX")
cleanup_inventory() {
  rm -rf -- "$inventory_dir"
}
trap cleanup_inventory EXIT

symlink_inventory="$inventory_dir/symlinks.print0"
file_inventory="$inventory_dir/files.print0"

if ! find "$backup_dir" -maxdepth 1 -type l -print0 >"$symlink_inventory"; then
  fail_closed "symlink inventory producer failed"
fi

# 계약 이름을 가진 symlink는 외부 파일 오인 가능성이 있으므로 전체 작업을 중단한다.
while true; do
  rc=0
  read_nul_path <&3 || rc=$?
  if ((rc == 1)); then
    break
  fi
  if ((rc != 0)); then
    fail_closed "symlink inventory read failed or truncated"
  fi
  entry=$_read_path
  base=${entry##*/}
  if [[ "$base" =~ $BACKUP_NAME_RE ]]; then
    fail_closed "contract-named symlink entry is forbidden"
  fi
done 3<"$symlink_inventory"

# Collect matching regular files only. maxdepth 1: never traverse subdirs or outside.
# -type f excludes symlinks (even when the target is a regular file).
if ! find "$backup_dir" -maxdepth 1 -type f -print0 >"$file_inventory"; then
  fail_closed "file inventory producer failed"
fi

candidates=()
while true; do
  rc=0
  read_nul_path <&3 || rc=$?
  if ((rc == 1)); then
    break
  fi
  if ((rc != 0)); then
    fail_closed "file inventory read failed or truncated"
  fi
  entry=$_read_path
  base=${entry##*/}

  # Defense in depth: never operate on symlink entries.
  if [[ -L "$entry" ]]; then
    continue
  fi
  if [[ ! -f "$entry" ]]; then
    continue
  fi

  if [[ ! "$base" =~ $BACKUP_NAME_RE ]]; then
    # Unknown / non-contract names stay untouched (including separator-bearing names).
    continue
  fi

  # Contract basename must be a single path segment with no record separators.
  if [[ "$base" == */* || "$base" == '.' || "$base" == '..' ]]; then
    fail_closed "contract basename is not a single path segment"
  fi
  if [[ "$base" == *$'\t'* || "$base" == *$'\n'* ]]; then
    fail_closed "contract basename contains record separator"
  fi

  case "$entry" in
    "$backup_dir"/*) ;;
    *)
      fail_closed "path escapes backup_dir"
      ;;
  esac

  mtime=
  if ! mtime=$(file_mtime_epoch "$entry"); then
    fail_closed "stat failed for candidate"
  fi
  if ! [[ "$mtime" =~ ^[0-9]+$ ]]; then
    fail_closed "invalid mtime for candidate"
  fi

  # Serialize mtime + basename only; reconstruct under canonical backup_dir after sort.
  candidates+=("${mtime}"$'\t'"${base}")
done 3<"$file_inventory"

if ((${#candidates[@]} == 0)); then
  exit 0
fi

candidate_count=${#candidates[@]}

# Newest-first by mtime (numeric desc), then basename for deterministic ties.
# Materialize sort output so a failed order producer cannot become empty success.
sort_inventory="$inventory_dir/sorted.tsv"
if ! printf '%s\n' "${candidates[@]}" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2 >"$sort_inventory"; then
  fail_closed "mtime order producer failed"
fi

sorted_bases=()
readback_records=()
while true; do
  rc=0
  read_tsv_record <&3 || rc=$?
  if ((rc == 1)); then
    break
  fi
  if ((rc != 0)); then
    fail_closed "sort inventory read failed or truncated"
  fi
  mtime=$_read_mtime
  base=$_read_base

  if ! [[ "$mtime" =~ ^[0-9]+$ ]]; then
    fail_closed "invalid mtime in sort inventory"
  fi
  if [[ ! "$base" =~ $BACKUP_NAME_RE ]]; then
    fail_closed "invalid basename in sort inventory"
  fi
  if [[ "$base" == *$'\t'* || "$base" == *$'\n'* || "$base" == */* ]]; then
    fail_closed "basename separator in sort inventory"
  fi

  readback_records+=("${mtime}"$'\t'"${base}")
  sorted_bases+=("$base")
done 3<"$sort_inventory"

# Fail closed before any deletion when the ordered inventory is incomplete or corrupted.
if ((${#sorted_bases[@]} != candidate_count)); then
  fail_closed "sort inventory count mismatch"
fi

expected_sorted_cksum=$(printf '%s\n' "${candidates[@]}" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2 | cksum) \
  || fail_closed "expected sort fingerprint producer failed"
readback_cksum=$(printf '%s\n' "${readback_records[@]}" | cksum) \
  || fail_closed "readback checksum failed"
if [[ "$readback_cksum" != "$expected_sorted_cksum" ]]; then
  fail_closed "sort inventory readback checksum mismatch"
fi

total=${#sorted_bases[@]}
if ((total <= retain_n)); then
  exit 0
fi

for ((i = retain_n; i < total; i++)); do
  base=${sorted_bases[i]}

  # Reconstruct only under the already-canonical non-symlink backup_dir.
  stale="$backup_dir/$base"

  case "$stale" in
    "$backup_dir"/*) ;;
    *)
      fail_closed "stale path escapes backup_dir"
      ;;
  esac

  # Re-check immediately before delete: regular file only, never symlink.
  if [[ -L "$stale" ]]; then
    fail_closed "refusing to delete symlink entry"
  fi
  if [[ ! -f "$stale" ]]; then
    continue
  fi

  if [[ ! "$base" =~ $BACKUP_NAME_RE ]]; then
    continue
  fi

  rm -f -- "$stale"
done

exit 0
