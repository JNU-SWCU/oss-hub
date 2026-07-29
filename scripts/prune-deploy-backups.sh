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
BACKUP_NAME_RE='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[1-9][0-9]*\.sql$'

file_mtime_epoch() {
  local path=$1
  # BSD stat (macOS) then GNU stat (Linux Jenkins agent).
  if stat -f '%m' "$path" >/dev/null 2>&1; then
    stat -f '%m' "$path"
  else
    stat -c '%Y' "$path"
  fi
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

# 계약 이름을 가진 symlink는 외부 파일 오인 가능성이 있으므로 전체 작업을 중단한다.
while IFS= read -r -d '' entry; do
  base=${entry##*/}
  if [[ "$base" =~ $BACKUP_NAME_RE ]]; then
    fail_closed "contract-named symlink entry is forbidden"
  fi
done < <(find "$backup_dir" -maxdepth 1 -type l -print0)
# Collect matching regular files only. maxdepth 1: never traverse subdirs or outside.
# -type f excludes symlinks (even when the target is a regular file).
candidates=()
while IFS= read -r -d '' entry; do
  base=${entry##*/}

  # Defense in depth: never operate on symlink entries.
  if [[ -L "$entry" ]]; then
    continue
  fi
  if [[ ! -f "$entry" ]]; then
    continue
  fi

  if [[ ! "$base" =~ $BACKUP_NAME_RE ]]; then
    # Unknown / non-contract names stay untouched.
    continue
  fi

  case "$entry" in
    "$backup_dir"/*) ;;
    *)
      fail_closed "path escapes backup_dir"
      ;;
  esac

  # basename must be a single path segment (no slash) — already true at maxdepth 1.
  if [[ "$base" == */* || "$base" == '.' || "$base" == '..' ]]; then
    continue
  fi

  mtime=$(file_mtime_epoch "$entry")
  candidates+=("${mtime}"$'\t'"${entry}")
done < <(find "$backup_dir" -maxdepth 1 -type f -print0)

if ((${#candidates[@]} == 0)); then
  exit 0
fi

# Newest-first by mtime (numeric desc), then path for deterministic ties.
sorted_paths=()
while IFS=$'\t' read -r _mtime path; do
  [[ -n "$path" ]] || continue
  sorted_paths+=("$path")
done < <(printf '%s\n' "${candidates[@]}" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2)

total=${#sorted_paths[@]}
if ((total <= retain_n)); then
  exit 0
fi

for ((i = retain_n; i < total; i++)); do
  stale=${sorted_paths[i]}

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

  base=${stale##*/}
  if [[ ! "$base" =~ $BACKUP_NAME_RE ]]; then
    continue
  fi

  rm -f -- "$stale"
done

exit 0
