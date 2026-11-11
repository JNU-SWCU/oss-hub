#!/usr/bin/env bash
# Apply pending Prisma migrations once.
# A lock timeout (SQLSTATE 55P03) is marked rolled back and this script exits
# non-zero so the deploy stops before activation. Any other error is left in
# place for a person to see.
set -euo pipefail

common="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prisma-migrate-common.sh"
# shellcheck source=prisma-migrate-common.sh
source "$common"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend="$repo_root/apps/backend"
working_directory="${PRISMA_WORKING_DIRECTORY:-$backend}"
helper="$backend/prisma/prisma-migration-failure.mjs"

prefix=()
if [[ "${1:-}" == "--" ]]; then
  shift
  prefix=("$@")
fi

run() {
  if [[ ${#prefix[@]} -gt 0 ]]; then
    "${prefix[@]}" "$@"
  else
    (cd "$working_directory" && "$@")
  fi
}

node_helper() {
  if [[ ${#prefix[@]} -gt 0 ]]; then
    "${prefix[@]}" node prisma/prisma-migration-failure.mjs "$@"
  else
    node "$helper" "$@"
  fi
}

before="$(node_helper fingerprint | tr -d '[:space:]')"
set +e
log="$(run npx prisma migrate deploy 2>&1)"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  exit 0
fi
printf '%s\n' "$log" >&2

classified="$(classify_migrate_log "$log")"
kind="$(printf '%s\n' "$classified" | sed -n '1p')"
cause="$(printf '%s\n' "$classified" | sed -n '2p')"
if [[ "$kind" != "lock_timeout" ]]; then
  printf 'migrate failed: %s\n' "$cause" >&2
  exit 1
fi

export SCHEMA_FINGERPRINT_BEFORE="$before"
recover="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prisma-migrate-recover.sh"
if [[ ${#prefix[@]} -gt 0 ]]; then
  bash "$recover" --apply -- "${prefix[@]}"
else
  bash "$recover" --apply
fi
printf 'lock timeout was rolled back and activation will not run. cause: %s\n' "$cause" >&2
exit 1
