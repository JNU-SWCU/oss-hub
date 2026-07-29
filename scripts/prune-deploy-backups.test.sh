#!/usr/bin/env bash
# Focused synthetic fixtures for scripts/prune-deploy-backups.sh (G005/G007 C4).
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pruner="$repo_root/scripts/prune-deploy-backups.sh"

if [[ ! -x "$pruner" && -f "$pruner" ]]; then
  chmod +x "$pruner"
fi

fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/prune-deploy-backups.XXXXXX")
trap 'rm -rf "$fixture_root"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  shift
  if "$@"; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected pass)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  shift
  if "$@"; then
    printf 'not ok - %s (expected fail)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

# Write synthetic backups with strictly increasing mtimes (newest = highest index).
# Naming matches production: vMAJOR.MINOR.PATCH-BUILD.sql
seed_ordered_backups() {
  local dir=$1
  local count=$2
  local prefix=${3:-v1.2.3}
  python3 - "$dir" "$count" "$prefix" <<'PY'
import os
import sys

directory = sys.argv[1]
count = int(sys.argv[2])
prefix = sys.argv[3]
base_ts = 1_700_000_000
os.makedirs(directory, exist_ok=True)
for i in range(1, count + 1):
    path = os.path.join(directory, f"{prefix}-{i}.sql")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(f"synthetic-backup-{i}\n")
    ts = base_ts + i
    os.utime(path, (ts, ts))
PY
}

count_matching() {
  local dir=$1
  local n=0
  local f base
  shopt -s nullglob
  for f in "$dir"/*; do
    base=${f##*/}
    if [[ -f "$f" && ! -L "$f" && "$base" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[1-9][0-9]*\.sql$ ]]; then
      n=$((n + 1))
    fi
  done
  shopt -u nullglob
  printf '%s' "$n"
}

# --- arg validation ---
missing_dir="$fixture_root/does-not-exist"
expect_fail 'missing args' "$pruner"
expect_fail 'single arg only' "$pruner" "$fixture_root/empty"
expect_fail 'retain zero' bash -c "mkdir -p '$fixture_root/zero' && '$pruner' '$fixture_root/zero' 0"
expect_fail 'retain negative' bash -c "mkdir -p '$fixture_root/neg' && '$pruner' '$fixture_root/neg' -1"
expect_fail 'retain non-integer' bash -c "mkdir -p '$fixture_root/nan' && '$pruner' '$fixture_root/nan' abc"
expect_fail 'retain decimal' bash -c "mkdir -p '$fixture_root/dec' && '$pruner' '$fixture_root/dec' 1.5"
expect_fail 'retain leading zero' bash -c "mkdir -p '$fixture_root/lz' && '$pruner' '$fixture_root/lz' 0120"
expect_fail 'missing directory' "$pruner" "$missing_dir" 120

not_dir="$fixture_root/not-a-dir"
printf 'x\n' >"$not_dir"
expect_fail 'file instead of directory' "$pruner" "$not_dir" 120

# --- symlink directory rejection ---
real_dir="$fixture_root/real-backup-dir"
mkdir -p "$real_dir"
link_dir="$fixture_root/symlink-backup-dir"
ln -s "$real_dir" "$link_dir"
expect_fail 'symlink directory rejected' "$pruner" "$link_dir" 120
symlink_entry_dir="$fixture_root/symlink-entry"
mkdir -p "$symlink_entry_dir"
ln -s "$real_dir/outside.sql" "$symlink_entry_dir/v1.2.3-1.sql"
expect_fail 'contract-named symlink entry rejected' "$pruner" "$symlink_entry_dir" 120

# --- empty / fewer-than-N no-op ---
empty_dir="$fixture_root/empty"
mkdir -p "$empty_dir"
expect_pass 'empty directory no-op' "$pruner" "$empty_dir" 120
expect_pass 'empty still empty' bash -c "[[ -z \"\$(find '$empty_dir' -mindepth 1 -maxdepth 1)\" ]]"

few_dir="$fixture_root/few"
mkdir -p "$few_dir"
seed_ordered_backups "$few_dir" 3
before_few=$(count_matching "$few_dir")
expect_pass 'fewer-than-N no-op runs' "$pruner" "$few_dir" 120
after_few=$(count_matching "$few_dir")
expect_pass 'fewer-than-N retains all matching' bash -c "[[ '$before_few' -eq 3 && '$after_few' -eq 3 ]]"
expect_pass 'fewer-than-N keeps newest names' bash -c "[[ -f '$few_dir/v1.2.3-1.sql' && -f '$few_dir/v1.2.3-2.sql' && -f '$few_dir/v1.2.3-3.sql' ]]"

# --- N+1 isolation: 121 matching → retain exactly 120 (newest) ---
c4_dir="$fixture_root/c4-isolated"
mkdir -p "$c4_dir"
seed_ordered_backups "$c4_dir" 121

# Unknown / non-contract inventory that must survive.
printf 'keep-me\n' >"$c4_dir/notes.txt"
printf 'not-a-backup\n' >"$c4_dir/random.sql"
printf 'bad-name\n' >"$c4_dir/v1.2.3.sql"
printf 'bad-build\n' >"$c4_dir/v1.2.3-0.sql"
printf 'bad-semver\n' >"$c4_dir/v01.2.3-9.sql"
printf 'extra-ext\n' >"$c4_dir/v1.2.3-9.sql.bak"
mkdir -p "$c4_dir/subdir"
printf 'nested\n' >"$c4_dir/subdir/v1.2.3-999.sql"

# Outside inventory (must never be touched).
outside_dir="$fixture_root/outside-unrelated"
mkdir -p "$outside_dir"
printf 'outside-secret-marker\n' >"$outside_dir/v9.9.9-1.sql"
outside_marker_before=$(cksum <"$outside_dir/v9.9.9-1.sql")

# Non-contract symlink inventory is ignored and never followed.
ln -s "$outside_dir/v9.9.9-1.sql" "$c4_dir/link-other.sql"

expect_pass 'C4 retain 120 runs' "$pruner" "$c4_dir" 120

matching_after=$(count_matching "$c4_dir")
expect_pass 'C4 retains exactly 120 matching backups' bash -c "[[ '$matching_after' -eq 120 ]]"

# Newest 120 are build 2..121; oldest build 1 is stale.
expect_pass 'C4 deleted oldest matching' bash -c "[[ ! -e '$c4_dir/v1.2.3-1.sql' ]]"
expect_pass 'C4 kept second-oldest' bash -c "[[ -f '$c4_dir/v1.2.3-2.sql' ]]"
expect_pass 'C4 kept newest' bash -c "[[ -f '$c4_dir/v1.2.3-121.sql' ]]"

expect_pass 'unknown notes.txt untouched' bash -c "[[ -f '$c4_dir/notes.txt' ]]"
expect_pass 'unknown random.sql untouched' bash -c "[[ -f '$c4_dir/random.sql' ]]"
expect_pass 'non-contract v1.2.3.sql untouched' bash -c "[[ -f '$c4_dir/v1.2.3.sql' ]]"
expect_pass 'non-contract build 0 untouched' bash -c "[[ -f '$c4_dir/v1.2.3-0.sql' ]]"
expect_pass 'non-contract leading-zero semver untouched' bash -c "[[ -f '$c4_dir/v01.2.3-9.sql' ]]"
expect_pass 'non-contract .sql.bak untouched' bash -c "[[ -f '$c4_dir/v1.2.3-9.sql.bak' ]]"
expect_pass 'nested subdir inventory untouched' bash -c "[[ -f '$c4_dir/subdir/v1.2.3-999.sql' ]]"

expect_pass 'non-contract symlink entry still present' bash -c "[[ -L '$c4_dir/link-other.sql' ]]"

outside_marker_after=$(cksum <"$outside_dir/v9.9.9-1.sql")
expect_pass 'outside inventory unchanged' bash -c "[[ '$outside_marker_before' == '$outside_marker_after' ]]"
expect_pass 'outside file still present' bash -c "[[ -f '$outside_dir/v9.9.9-1.sql' ]]"

# --- small retain sanity (newest-first) ---
order_dir="$fixture_root/order"
mkdir -p "$order_dir"
seed_ordered_backups "$order_dir" 5
expect_pass 'retain 2 runs' "$pruner" "$order_dir" 2
expect_pass 'retain 2 keeps newest pair' bash -c "[[ ! -e '$order_dir/v1.2.3-1.sql' && ! -e '$order_dir/v1.2.3-2.sql' && ! -e '$order_dir/v1.2.3-3.sql' && -f '$order_dir/v1.2.3-4.sql' && -f '$order_dir/v1.2.3-5.sql' ]]"
order_count=$(count_matching "$order_dir")
expect_pass 'retain 2 count' bash -c "[[ '$order_count' -eq 2 ]]"

# --- retain 120 accepted as positive integer (empty dir) ---
accept_dir="$fixture_root/accept120"
mkdir -p "$accept_dir"
expect_pass 'retain 120 accepted on empty dir' "$pruner" "$accept_dir" 120

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
