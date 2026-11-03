#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

PM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PM_BOUND_GRACE=5
PM_LOCK_TIMEOUT_MS="${PM_LOCK_TIMEOUT_MS:-5000}"
PM_STATEMENT_TIMEOUT_MS="${PM_STATEMENT_TIMEOUT_MS:-30000}"
PM_CHECK_TIMEOUT="${PM_CHECK_TIMEOUT:-120}"
PM_LIST=()

pm_fail() {
  printf 'FAIL_CLOSED %s\n' "$*" >&2
  exit 1
}

pm_bounded() {
  node "$PM_DIR/bounded.mjs" "$@"
}

pm_describe_exit() {
  if [[ "$1" == 124 ]]; then printf 'timed out'; else printf 'exit %s' "$1"; fi
}

pm_require_container() {
  [[ -n "${PM_PG_CONTAINER:-}" ]] || pm_fail 'PM_PG_CONTAINER is required'
}

pm_manifest_list() {
  local out line
  out="$(node "$PM_DIR/manifest.mjs" "$@")" || pm_fail "manifest query failed: $2"
  PM_LIST=()
  [[ -n "$out" ]] || return 0
  while IFS= read -r line; do
    PM_LIST+=("$line")
  done <<<"$out"
}

# usage: pm_psql <read-only on|off> <seconds> <statement-ms> <database or ''> [psql args]
pm_psql() {
  local read_only="$1" seconds="$2" statement_ms="$3" database="$4"
  shift 4
  # shellcheck disable=SC2016 # expanded by the container shell
  pm_bounded "$((seconds + PM_BOUND_GRACE))" docker exec -i \
    -e "PGOPTIONS=-c default_transaction_read_only=$read_only -c statement_timeout=$statement_ms -c lock_timeout=$PM_LOCK_TIMEOUT_MS" \
    -e "PM_DATABASE=$database" \
    "$PM_PG_CONTAINER" sh -ec \
    'seconds="$1"; shift; exec timeout "$seconds" psql -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v SHOW_CONTEXT=never -U "$POSTGRES_USER" -d "${PM_DATABASE:-$POSTGRES_DB}" "$@"' \
    sh "$seconds" "$@"
}

# A check file runs read-only and must print exactly one mismatch count.
pm_check() {
  local file="$1" out rc=0
  out="$(pm_psql on "$PM_CHECK_TIMEOUT" "$PM_STATEMENT_TIMEOUT_MS" "${PM_DATABASE:-}" <"$file")" || rc=$?
  if [[ "$rc" != 0 ]]; then
    printf 'CHECK_FAILED %s: %s\n' "$file" "$(pm_describe_exit "$rc")" >&2
    return 1
  fi
  if [[ ! "$out" =~ ^[0-9]+$ ]]; then
    printf 'CHECK_FAILED %s: expected exactly one mismatch count\n' "$file" >&2
    return 1
  fi
  if [[ ! "$out" =~ ^0+$ ]]; then
    printf 'CHECK_FAILED %s: mismatches=%s\n' "$file" "$out" >&2
    return 1
  fi
  printf 'CHECK_OK %s\n' "$file"
}

pm_run_checks() {
  local failed=0 file
  [[ "$#" -gt 0 ]] || pm_fail 'no checks to run'
  for file in "$@"; do
    pm_check "$file" || failed=$((failed + 1))
  done
  [[ "$failed" == 0 ]] || {
    printf 'CHECKS_FAILED %s of %s\n' "$failed" "$#" >&2
    return 1
  }
}

pm_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}
