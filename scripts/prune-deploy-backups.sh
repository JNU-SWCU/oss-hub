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


# Count direct children of a given type without relying on find/sort producers.
# type: "symlink" | "file"
count_dir_entries() {
  local dir=$1
  local kind=$2
  local count=0
  local p
  local base

  # Use find-free directory enumeration via bash glob; portable with nullglob/dotglob off.
  # Only maxdepth-1 basenames; skip . and .. implicitly.
  for p in "$dir"/*; do
    # When dir is empty, the literal glob may remain; treat as no match.
    if [[ "$p" == "$dir"/* && ! -e "$p" && ! -L "$p" ]]; then
      continue
    fi
    base=${p##*/}
    if [[ "$base" == "*" ]]; then
      continue
    fi
    if [[ "$kind" == "symlink" ]]; then
      if [[ -L "$p" ]]; then
        count=$((count + 1))
      fi
    elif [[ "$kind" == "file" ]]; then
      if [[ ! -L "$p" && -f "$p" ]]; then
        count=$((count + 1))
      fi
    else
      fail_closed "invalid dir entry kind"
    fi
  done
  printf '%s\n' "$count"
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

# Independent producer-side attestation before any consumer derivation.
attest_nul_inventory() {
  local inv_path=$1
  local label=$2
  local size
  local digest
  local last
  local count=0
  local path_item
  local rc

  size=$(wc -c <"$inv_path" | tr -d '[:space:]') \
    || fail_closed "${label} inventory size failed"
  [[ "$size" =~ ^[0-9]+$ ]] || fail_closed "${label} inventory size invalid"
  digest=$(cksum <"$inv_path") \
    || fail_closed "${label} inventory digest failed"
  [[ -n "$digest" ]] || fail_closed "${label} inventory digest empty"

  if ((size > 0)); then
    last=$(tail -c 1 "$inv_path" | od -An -tu1 | tr -d '[:space:]') \
      || fail_closed "${label} inventory final-byte probe failed"
    if [[ "$last" != "0" ]]; then
      fail_closed "${label} inventory missing final NUL delimiter"
    fi
  fi

  # Count every NUL record independently of later filtered candidate derivation.
  while true; do
    path_item=
    rc=0
    IFS= read -r -d '' path_item || rc=$?
    if ((rc == 0)); then
      [[ -n "$path_item" ]] || fail_closed "${label} inventory empty NUL record"
      count=$((count + 1))
      continue
    fi
    if [[ -n "$path_item" ]]; then
      fail_closed "${label} inventory truncated mid-record"
    fi
    if ((rc == 1)); then
      break
    fi
    fail_closed "${label} inventory read failed"
  done <"$inv_path"

  # Empty inventory must have size 0; non-empty must end with NUL and match count.
  if ((count == 0)); then
    if ((size != 0)); then
      fail_closed "${label} inventory size/count mismatch (empty)"
    fi
  else
    if ((size < count)); then
      fail_closed "${label} inventory size smaller than record count"
    fi
  fi

  printf '%s\n' "$digest"
  printf '%s\n' "$count"
  printf '%s\n' "$size"
}

symlink_attestation=$(attest_nul_inventory "$symlink_inventory" "symlink") \
  || fail_closed "symlink inventory attestation failed"
symlink_expected_digest=$(printf '%s\n' "$symlink_attestation" | sed -n '1p')
symlink_expected_count=$(printf '%s\n' "$symlink_attestation" | sed -n '2p')
symlink_expected_size=$(printf '%s\n' "$symlink_attestation" | sed -n '3p')
[[ "$symlink_expected_count" =~ ^[0-9]+$ ]] || fail_closed "symlink inventory count invalid"
[[ "$symlink_expected_size" =~ ^[0-9]+$ ]] || fail_closed "symlink inventory size invalid"

symlink_dir_count=$(count_dir_entries "$backup_dir" symlink)   || fail_closed "symlink directory count failed"
if [[ "$symlink_dir_count" != "$symlink_expected_count" ]]; then
  fail_closed "symlink inventory count disagrees with directory"
fi

symlink_readback="$inventory_dir/symlinks.readback.print0"
: >"$symlink_readback"
symlink_consumed=0

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
  # Serialize every consumed source record for independent readback attestation.
  printf '%s\0' "$entry" >>"$symlink_readback" \
    || fail_closed "symlink inventory readback write failed"
  symlink_consumed=$((symlink_consumed + 1))
  base=${entry##*/}
  if [[ "$base" =~ $BACKUP_NAME_RE ]]; then
    fail_closed "contract-named symlink entry is forbidden"
  fi
done 3<"$symlink_inventory"

if ((symlink_consumed != symlink_expected_count)); then
  fail_closed "symlink inventory consumed count mismatch"
fi
symlink_readback_digest=$(cksum <"$symlink_readback") \
  || fail_closed "symlink inventory readback digest failed"
if [[ "$symlink_readback_digest" != "$symlink_expected_digest" ]]; then
  fail_closed "symlink inventory readback digest mismatch"
fi
symlink_readback_size=$(wc -c <"$symlink_readback" | tr -d '[:space:]') \
  || fail_closed "symlink inventory readback size failed"
if [[ "$symlink_readback_size" != "$symlink_expected_size" ]]; then
  fail_closed "symlink inventory readback size mismatch"
fi

# Collect matching regular files only. maxdepth 1: never traverse subdirs or outside.
# -type f excludes symlinks (even when the target is a regular file).
if ! find "$backup_dir" -maxdepth 1 -type f -print0 >"$file_inventory"; then
  fail_closed "file inventory producer failed"
fi

file_attestation=$(attest_nul_inventory "$file_inventory" "file") \
  || fail_closed "file inventory attestation failed"
file_expected_digest=$(printf '%s\n' "$file_attestation" | sed -n '1p')
file_expected_count=$(printf '%s\n' "$file_attestation" | sed -n '2p')
file_expected_size=$(printf '%s\n' "$file_attestation" | sed -n '3p')
[[ "$file_expected_count" =~ ^[0-9]+$ ]] || fail_closed "file inventory count invalid"
[[ "$file_expected_size" =~ ^[0-9]+$ ]] || fail_closed "file inventory size invalid"

file_dir_count=$(count_dir_entries "$backup_dir" file)   || fail_closed "file directory count failed"
if [[ "$file_dir_count" != "$file_expected_count" ]]; then
  fail_closed "file inventory count disagrees with directory"
fi

file_readback="$inventory_dir/files.readback.print0"
: >"$file_readback"
file_consumed=0
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
  printf '%s\0' "$entry" >>"$file_readback" \
    || fail_closed "file inventory readback write failed"
  file_consumed=$((file_consumed + 1))
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

if ((file_consumed != file_expected_count)); then
  fail_closed "file inventory consumed count mismatch"
fi
file_readback_digest=$(cksum <"$file_readback") \
  || fail_closed "file inventory readback digest failed"
if [[ "$file_readback_digest" != "$file_expected_digest" ]]; then
  fail_closed "file inventory readback digest mismatch"
fi
file_readback_size=$(wc -c <"$file_readback" | tr -d '[:space:]') \
  || fail_closed "file inventory readback size failed"
if [[ "$file_readback_size" != "$file_expected_size" ]]; then
  fail_closed "file inventory readback size mismatch"
fi

if ((${#candidates[@]} == 0)); then
  exit 0
fi

candidate_count=${#candidates[@]}

# Build an independent source multiset for membership/uniqueness checks (no sort trust).
source_keys=()
source_counts=()
source_key_index() {
  local needle=$1
  local i
  for i in "${!source_keys[@]}"; do
    if [[ "${source_keys[i]}" == "$needle" ]]; then
      printf '%s\n' "$i"
      return 0
    fi
  done
  return 1
}
for rec in "${candidates[@]}"; do
  if idx=$(source_key_index "$rec"); then
    source_counts[idx]=$((source_counts[idx] + 1))
  else
    source_keys+=("$rec")
    source_counts+=(1)
  fi
done

# Newest-first by mtime (numeric desc), then basename for deterministic ties.
# Materialize sort output so a failed order producer cannot become empty success.
sort_inventory="$inventory_dir/sorted.tsv"
if ! printf '%s\n' "${candidates[@]}" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2 >"$sort_inventory"; then
  fail_closed "mtime order producer failed"
fi

sorted_bases=()
readback_records=()
seen_keys=()
seen_counts=()
prev_mtime=
prev_base=
have_prev=0
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

  rec="${mtime}"$'\t'"${base}"
  if ! src_idx=$(source_key_index "$rec"); then
    fail_closed "sort inventory record not present in source"
  fi

  found_seen=
  for i in "${!seen_keys[@]}"; do
    if [[ "${seen_keys[i]}" == "$rec" ]]; then
      found_seen=$i
      break
    fi
  done
  if [[ -n "$found_seen" ]]; then
    seen_counts[found_seen]=$((seen_counts[found_seen] + 1))
    if ((seen_counts[found_seen] > source_counts[src_idx])); then
      fail_closed "sort inventory duplicate beyond source multiset"
    fi
  else
    seen_keys+=("$rec")
    seen_counts+=(1)
  fi

  # Adjacent ordering independent of the sort binary: numeric mtime desc,
  # then LC_ALL=C basename ascending on ties.
  if ((have_prev)); then
    if ((10#$mtime > 10#$prev_mtime)); then
      fail_closed "sort inventory mtime not descending"
    fi
    if ((10#$mtime == 10#$prev_mtime)); then
      first=$(printf '%s\n%s\n' "$prev_base" "$base" | LC_ALL=C sort | head -n 1) \
        || fail_closed "basename tie order probe failed"
      if [[ "$first" != "$prev_base" ]]; then
        fail_closed "sort inventory basename tie order invalid"
      fi
    fi
  fi
  prev_mtime=$mtime
  prev_base=$base
  have_prev=1

  readback_records+=("$rec")
  sorted_bases+=("$base")
done 3<"$sort_inventory"

# Fail closed before any deletion when the ordered inventory is incomplete or corrupted.
if ((${#sorted_bases[@]} != candidate_count)); then
  fail_closed "sort inventory count mismatch"
fi

# Every source record must appear exactly its source multiplicity (no omit/duplicate).
if ((${#seen_keys[@]} != ${#source_keys[@]})); then
  fail_closed "sort inventory unique-key coverage mismatch"
fi
for i in "${!source_keys[@]}"; do
  sk=${source_keys[i]}
  sc=${source_counts[i]}
  found=
  for j in "${!seen_keys[@]}"; do
    if [[ "${seen_keys[j]}" == "$sk" ]]; then
      found=$j
      break
    fi
  done
  if [[ -z "$found" ]]; then
    fail_closed "sort inventory omitted source record"
  fi
  if ((seen_counts[found] != sc)); then
    fail_closed "sort inventory multiplicity mismatch"
  fi
done

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
