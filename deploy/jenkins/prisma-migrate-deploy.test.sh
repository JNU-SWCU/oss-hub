#!/usr/bin/env bash
set -euo pipefail

common="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prisma-migrate-common.sh"
# shellcheck source=prisma-migrate-common.sh
source "$common"

assert_kind() {
  local log="$1"
  local expected="$2"
  local actual
  actual="$(classify_migrate_log "$log" | sed -n '1p')"
  if [[ "$actual" != "$expected" ]]; then
    printf 'expected %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

lock_log="$(printf '%s\n' 'ERROR: canceling statement due to lock timeout' 'SQLSTATE 55P03' 'ERROR: current transaction is aborted' 'SQLSTATE 25P02')"
assert_kind "$lock_log" lock_timeout
cause="$(classify_migrate_log "$lock_log" | sed -n '2p')"
if [[ "$cause" != *"lock timeout"* ]]; then
  printf 'cause hid the lock timeout: %s\n' "$cause" >&2
  exit 1
fi

other_log="$(printf '%s\n' 'ERROR: division by zero' 'ERROR: current transaction is aborted')"
assert_kind "$other_log" other
other_cause="$(classify_migrate_log "$other_log" | sed -n '2p')"
if [[ "$other_cause" != *"division by zero"* ]]; then
  printf 'cause hid the original error: %s\n' "$other_cause" >&2
  exit 1
fi

p3009_log="$(printf '%s\n' 'Error: P3009 migrate found failed migrations in the target database')"
assert_kind "$p3009_log" other

prisma_lock_log="$(printf '%s\n' 'Database error code: P0001' 'ERROR: OSS_HUB_LOCK_TIMEOUT 55P03')"
assert_kind "$prisma_lock_log" lock_timeout
aborted_only="$(printf '%s\n' 'Error: ERROR: current transaction is aborted, commands ignored until end of transaction block')"
assert_kind "$aborted_only" other
aborted_cause="$(classify_migrate_log "$aborted_only" | sed -n '2p')"
if [[ "$aborted_cause" != "unknown failure" ]]; then
  printf 'aborted transaction was treated as the cause: %s\n' "$aborted_cause" >&2
  exit 1
fi

parent="$(mktemp)"
cat >"$parent" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo activate
EOF
# The deploy script is what Jenkins runs under the same shell flags.
# A non-zero exit must stop the next command. This stand-in exits 1.
if bash -c 'set -euo pipefail; false; echo activate' >"$parent.out" 2>"$parent.err"; then
  printf 'a failing command under set -euo pipefail continued\n' >&2
  exit 1
fi
if [[ -s "$parent.out" ]]; then
  printf 'activation command ran after failure\n' >&2
  exit 1
fi
rm -f "$parent" "$parent.out" "$parent.err"

printf 'prisma migrate classifier ok\n'
