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

# --- injected find producer failure must fail-closed with no inventory change ---
# PATH shim shadows `find` only for this fixture; production command is unchanged.
producer_fail_dir="$fixture_root/producer-fail"
mkdir -p "$producer_fail_dir"
seed_ordered_backups "$producer_fail_dir" 5
# Non-matching inventory that must also survive a failed run.
printf 'keep-notes\n' >"$producer_fail_dir/notes.txt"
before_producer_fail=$(count_matching "$producer_fail_dir")
# Stable inventory fingerprint: sorted basenames + type + content checksum (not dir mtime).
inventory_fingerprint() {
  local dir=$1
  local f base kind sum
  local names=()
  shopt -s nullglob
  for f in "$dir"/*; do
    names+=("${f##*/}")
  done
  shopt -u nullglob
  if ((${#names[@]} > 0)); then
    local sorted
    sorted=$(printf '%s\n' "${names[@]}" | LC_ALL=C sort)
    while IFS= read -r base; do
      [[ -n "$base" ]] || continue
      f="$dir/$base"
      if [[ -L "$f" ]]; then
        kind="L:$(readlink "$f")"
      elif [[ -f "$f" ]]; then
        sum=$(cksum <"$f")
        kind="F:${sum}"
      elif [[ -d "$f" ]]; then
        kind="D"
      else
        kind="?"
      fi
      printf '%s\t%s\n' "$base" "$kind"
    done <<<"$sorted"
  fi
}
before_producer_fp=$(inventory_fingerprint "$producer_fail_dir" | cksum)
before_notes_cksum=$(cksum <"$producer_fail_dir/notes.txt")
before_newest_cksum=$(cksum <"$producer_fail_dir/v1.2.3-5.sql")
before_oldest_cksum=$(cksum <"$producer_fail_dir/v1.2.3-1.sql")

find_shim_dir="$fixture_root/find-shim"
mkdir -p "$find_shim_dir"
cat >"$find_shim_dir/find" <<'SHIM'
#!/usr/bin/env bash
# Synthetic producer failure: never enumerate; always non-zero.
printf 'synthetic-find-failure\n' >&2
exit 42
SHIM
chmod +x "$find_shim_dir/find"

producer_fail_rc=0
producer_fail_err="$fixture_root/producer-fail.err"
env PATH="$find_shim_dir:$PATH" "$pruner" "$producer_fail_dir" 2 >"$producer_fail_err" 2>&1 || producer_fail_rc=$?

expect_pass 'find producer failure exits nonzero' bash -c "[[ '$producer_fail_rc' -ne 0 ]]"
expect_pass 'find producer failure is not success-zero' bash -c "[[ '$producer_fail_rc' -gt 0 ]]"
expect_pass 'find producer failure emits FAIL_CLOSED' bash -c "grep -q 'FAIL_CLOSED' '$producer_fail_err'"

after_producer_fail=$(count_matching "$producer_fail_dir")
after_producer_fp=$(inventory_fingerprint "$producer_fail_dir" | cksum)
after_notes_cksum=$(cksum <"$producer_fail_dir/notes.txt")
after_newest_cksum=$(cksum <"$producer_fail_dir/v1.2.3-5.sql")
after_oldest_cksum=$(cksum <"$producer_fail_dir/v1.2.3-1.sql")

expect_pass 'find producer failure deletes nothing (count)' bash -c "[[ '$before_producer_fail' -eq 5 && '$after_producer_fail' -eq 5 ]]"
expect_pass 'find producer failure keeps all matching names' bash -c "[[ -f '$producer_fail_dir/v1.2.3-1.sql' && -f '$producer_fail_dir/v1.2.3-2.sql' && -f '$producer_fail_dir/v1.2.3-3.sql' && -f '$producer_fail_dir/v1.2.3-4.sql' && -f '$producer_fail_dir/v1.2.3-5.sql' ]]"
expect_pass 'find producer failure inventory fingerprint unchanged' bash -c "[[ '$before_producer_fp' == '$after_producer_fp' ]]"
expect_pass 'find producer failure notes untouched' bash -c "[[ '$before_notes_cksum' == '$after_notes_cksum' ]]"
expect_pass 'find producer failure newest content untouched' bash -c "[[ '$before_newest_cksum' == '$after_newest_cksum' ]]"
expect_pass 'find producer failure oldest content untouched' bash -c "[[ '$before_oldest_cksum' == '$after_oldest_cksum' ]]"

# Control: without shim, same dir prunes normally (retain 2 → 2 newest).
expect_pass 'control prune after producer-fail fixture runs' "$pruner" "$producer_fail_dir" 2
control_count=$(count_matching "$producer_fail_dir")
expect_pass 'control prune retains 2' bash -c "[[ '$control_count' -eq 2 ]]"
expect_pass 'control prune kept newest pair' bash -c "[[ ! -e '$producer_fail_dir/v1.2.3-1.sql' && ! -e '$producer_fail_dir/v1.2.3-2.sql' && ! -e '$producer_fail_dir/v1.2.3-3.sql' && -f '$producer_fail_dir/v1.2.3-4.sql' && -f '$producer_fail_dir/v1.2.3-5.sql' ]]"

# --- sort producer failure must fail-closed with no inventory change ---
sort_fail_dir="$fixture_root/sort-fail"
mkdir -p "$sort_fail_dir"
seed_ordered_backups "$sort_fail_dir" 5
printf 'keep-notes\n' >"$sort_fail_dir/notes.txt"
before_sort_fail=$(count_matching "$sort_fail_dir")
before_sort_fp=$(inventory_fingerprint "$sort_fail_dir" | cksum)
before_sort_notes=$(cksum <"$sort_fail_dir/notes.txt")
before_sort_newest=$(cksum <"$sort_fail_dir/v1.2.3-5.sql")
before_sort_oldest=$(cksum <"$sort_fail_dir/v1.2.3-1.sql")

sort_shim_dir="$fixture_root/sort-shim-fail"
mkdir -p "$sort_shim_dir"
cat >"$sort_shim_dir/sort" <<'SHIM'
#!/usr/bin/env bash
# Synthetic order-producer failure: never emit ordered inventory; always non-zero.
printf 'synthetic-sort-failure\n' >&2
exit 42
SHIM
chmod +x "$sort_shim_dir/sort"

sort_fail_rc=0
sort_fail_err="$fixture_root/sort-fail.err"
env PATH="$sort_shim_dir:$PATH" "$pruner" "$sort_fail_dir" 2 >"$sort_fail_err" 2>&1 || sort_fail_rc=$?

expect_pass 'sort producer failure exits nonzero' bash -c "[[ '$sort_fail_rc' -ne 0 ]]"
expect_pass 'sort producer failure is not success-zero' bash -c "[[ '$sort_fail_rc' -gt 0 ]]"
expect_pass 'sort producer failure emits FAIL_CLOSED' bash -c "grep -q 'FAIL_CLOSED' '$sort_fail_err'"

after_sort_fail=$(count_matching "$sort_fail_dir")
after_sort_fp=$(inventory_fingerprint "$sort_fail_dir" | cksum)
after_sort_notes=$(cksum <"$sort_fail_dir/notes.txt")
after_sort_newest=$(cksum <"$sort_fail_dir/v1.2.3-5.sql")
after_sort_oldest=$(cksum <"$sort_fail_dir/v1.2.3-1.sql")

expect_pass 'sort producer failure deletes nothing (count)' bash -c "[[ '$before_sort_fail' -eq 5 && '$after_sort_fail' -eq 5 ]]"
expect_pass 'sort producer failure keeps all matching names' bash -c "[[ -f '$sort_fail_dir/v1.2.3-1.sql' && -f '$sort_fail_dir/v1.2.3-2.sql' && -f '$sort_fail_dir/v1.2.3-3.sql' && -f '$sort_fail_dir/v1.2.3-4.sql' && -f '$sort_fail_dir/v1.2.3-5.sql' ]]"
expect_pass 'sort producer failure inventory fingerprint unchanged' bash -c "[[ '$before_sort_fp' == '$after_sort_fp' ]]"
expect_pass 'sort producer failure notes untouched' bash -c "[[ '$before_sort_notes' == '$after_sort_notes' ]]"
expect_pass 'sort producer failure newest content untouched' bash -c "[[ '$before_sort_newest' == '$after_sort_newest' ]]"
expect_pass 'sort producer failure oldest content untouched' bash -c "[[ '$before_sort_oldest' == '$after_sort_oldest' ]]"

# --- truncated sort inventory must fail-closed (count/checksum) with no deletion ---
# PATH shim runs real sort then drops all but the first record so consumer sees short inventory.
trunc_dir="$fixture_root/sort-trunc"
mkdir -p "$trunc_dir"
seed_ordered_backups "$trunc_dir" 5
printf 'keep-notes\n' >"$trunc_dir/notes.txt"
before_trunc=$(count_matching "$trunc_dir")
before_trunc_fp=$(inventory_fingerprint "$trunc_dir" | cksum)
before_trunc_notes=$(cksum <"$trunc_dir/notes.txt")
before_trunc_newest=$(cksum <"$trunc_dir/v1.2.3-5.sql")
before_trunc_oldest=$(cksum <"$trunc_dir/v1.2.3-1.sql")

trunc_shim_dir="$fixture_root/sort-shim-trunc"
mkdir -p "$trunc_shim_dir"
# Locate a real sort binary outside this fixture's shim directory.
real_sort=$(command -v sort)
cat >"$trunc_shim_dir/sort" <<SHIM
#!/usr/bin/env bash
set -euo pipefail
# Emit only the first ordered record (successful exit) — under-complete vs candidate_count.
"$real_sort" "\$@" | awk 'NR==1 { print; exit 0 }'
exit 0
SHIM
chmod +x "$trunc_shim_dir/sort"

trunc_rc=0
trunc_err="$fixture_root/sort-trunc.err"
env PATH="$trunc_shim_dir:$PATH" "$pruner" "$trunc_dir" 2 >"$trunc_err" 2>&1 || trunc_rc=$?

expect_pass 'truncated sort inventory exits nonzero' bash -c "[[ '$trunc_rc' -ne 0 ]]"
expect_pass 'truncated sort inventory is not success-zero' bash -c "[[ '$trunc_rc' -gt 0 ]]"
expect_pass 'truncated sort inventory emits FAIL_CLOSED' bash -c "grep -q 'FAIL_CLOSED' '$trunc_err'"

after_trunc=$(count_matching "$trunc_dir")
after_trunc_fp=$(inventory_fingerprint "$trunc_dir" | cksum)
after_trunc_notes=$(cksum <"$trunc_dir/notes.txt")
after_trunc_newest=$(cksum <"$trunc_dir/v1.2.3-5.sql")
after_trunc_oldest=$(cksum <"$trunc_dir/v1.2.3-1.sql")

expect_pass 'truncated sort inventory deletes nothing (count)' bash -c "[[ '$before_trunc' -eq 5 && '$after_trunc' -eq 5 ]]"
expect_pass 'truncated sort inventory keeps all matching names' bash -c "[[ -f '$trunc_dir/v1.2.3-1.sql' && -f '$trunc_dir/v1.2.3-2.sql' && -f '$trunc_dir/v1.2.3-3.sql' && -f '$trunc_dir/v1.2.3-4.sql' && -f '$trunc_dir/v1.2.3-5.sql' ]]"
expect_pass 'truncated sort inventory fingerprint unchanged' bash -c "[[ '$before_trunc_fp' == '$after_trunc_fp' ]]"
expect_pass 'truncated sort inventory notes untouched' bash -c "[[ '$before_trunc_notes' == '$after_trunc_notes' ]]"
expect_pass 'truncated sort inventory newest content untouched' bash -c "[[ '$before_trunc_newest' == '$after_trunc_newest' ]]"
expect_pass 'truncated sort inventory oldest content untouched' bash -c "[[ '$before_trunc_oldest' == '$after_trunc_oldest' ]]"

# --- incomplete final TSV record (no trailing newline / partial line) fails closed ---
partial_dir="$fixture_root/sort-partial"
mkdir -p "$partial_dir"
seed_ordered_backups "$partial_dir" 5
printf 'keep-notes\n' >"$partial_dir/notes.txt"
before_partial=$(count_matching "$partial_dir")
before_partial_fp=$(inventory_fingerprint "$partial_dir" | cksum)

partial_shim_dir="$fixture_root/sort-shim-partial"
mkdir -p "$partial_shim_dir"
cat >"$partial_shim_dir/sort" <<SHIM
#!/usr/bin/env bash
set -euo pipefail
# Full ordered stream with the final newline stripped → last record is incomplete for read.
"$real_sort" "\$@" | tr -d '\n'
exit 0
SHIM
chmod +x "$partial_shim_dir/sort"

partial_rc=0
partial_err="$fixture_root/sort-partial.err"
env PATH="$partial_shim_dir:$PATH" "$pruner" "$partial_dir" 2 >"$partial_err" 2>&1 || partial_rc=$?

expect_pass 'partial sort inventory exits nonzero' bash -c "[[ '$partial_rc' -ne 0 ]]"
expect_pass 'partial sort inventory emits FAIL_CLOSED' bash -c "grep -q 'FAIL_CLOSED' '$partial_err'"
after_partial=$(count_matching "$partial_dir")
after_partial_fp=$(inventory_fingerprint "$partial_dir" | cksum)
expect_pass 'partial sort inventory deletes nothing (count)' bash -c "[[ '$before_partial' -eq 5 && '$after_partial' -eq 5 ]]"
expect_pass 'partial sort inventory fingerprint unchanged' bash -c "[[ '$before_partial_fp' == '$after_partial_fp' ]]"

# --- newline/tab-bearing backup directory paths remain portable (basename-only records) ---
nl_parent="$fixture_root/nl-parent"
mkdir -p "$nl_parent"
nl_dir="$nl_parent/dir"$'\n'"with-nl"
mkdir -p "$nl_dir"
seed_ordered_backups "$nl_dir" 5
expect_pass 'newline-bearing backup_dir retain 2 runs' "$pruner" "$nl_dir" 2
nl_count=$(count_matching "$nl_dir")
expect_pass 'newline-bearing backup_dir retain 2 count' bash -c "[[ '$nl_count' -eq 2 ]]"
expect_pass 'newline-bearing backup_dir keeps newest pair' bash -c "[[ ! -e '$nl_dir/v1.2.3-1.sql' && ! -e '$nl_dir/v1.2.3-2.sql' && ! -e '$nl_dir/v1.2.3-3.sql' && -f '$nl_dir/v1.2.3-4.sql' && -f '$nl_dir/v1.2.3-5.sql' ]]"

tab_parent="$fixture_root/tab-parent"
mkdir -p "$tab_parent"
tab_dir="$tab_parent/dir"$'\t'"with-tab"
mkdir -p "$tab_dir"
seed_ordered_backups "$tab_dir" 5
expect_pass 'tab-bearing backup_dir retain 2 runs' "$pruner" "$tab_dir" 2
tab_count=$(count_matching "$tab_dir")
expect_pass 'tab-bearing backup_dir retain 2 count' bash -c "[[ '$tab_count' -eq 2 ]]"
expect_pass 'tab-bearing backup_dir keeps newest pair' bash -c "[[ ! -e '$tab_dir/v1.2.3-1.sql' && ! -e '$tab_dir/v1.2.3-2.sql' && ! -e '$tab_dir/v1.2.3-3.sql' && -f '$tab_dir/v1.2.3-4.sql' && -f '$tab_dir/v1.2.3-5.sql' ]]"

# --- unrelated separator-bearing filenames must survive pruning ---
sep_dir="$fixture_root/sep-names"
mkdir -p "$sep_dir"
seed_ordered_backups "$sep_dir" 5
# Non-contract names that contain the TSV separators; must never be deleted or mis-parsed.
sep_tab="$sep_dir/notes"$'\t'"tab.txt"
sep_nl="$sep_dir/notes"$'\n'"nl.txt"
printf 'tab-marker\n' >"$sep_tab"
printf 'nl-marker\n' >"$sep_nl"
before_sep_tab=$(cksum <"$sep_tab")
before_sep_nl=$(cksum <"$sep_nl")
expect_pass 'separator-bearing unknown names retain 2 runs' "$pruner" "$sep_dir" 2
sep_count=$(count_matching "$sep_dir")
expect_pass 'separator-bearing unknown names retain 2 count' bash -c "[[ '$sep_count' -eq 2 ]]"
expect_pass 'separator-bearing tab filename still present' bash -c "[[ -f '$sep_tab' ]]"
expect_pass 'separator-bearing newline filename still present' bash -c "[[ -f '$sep_nl' ]]"
after_sep_tab=$(cksum <"$sep_tab")
after_sep_nl=$(cksum <"$sep_nl")
expect_pass 'separator-bearing tab filename content untouched' bash -c "[[ '$before_sep_tab' == '$after_sep_tab' ]]"
expect_pass 'separator-bearing newline filename content untouched' bash -c "[[ '$before_sep_nl' == '$after_sep_nl' ]]"
expect_pass 'separator-bearing fixture kept newest pair' bash -c "[[ ! -e '$sep_dir/v1.2.3-1.sql' && ! -e '$sep_dir/v1.2.3-2.sql' && ! -e '$sep_dir/v1.2.3-3.sql' && -f '$sep_dir/v1.2.3-4.sql' && -f '$sep_dir/v1.2.3-5.sql' ]]"

# --- retain 120 accepted as positive integer (empty dir) ---
accept_dir="$fixture_root/accept120"
mkdir -p "$accept_dir"
expect_pass 'retain 120 accepted on empty dir' "$pruner" "$accept_dir" 120

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
