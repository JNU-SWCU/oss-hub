#!/usr/bin/env bash
# Inspect failed Prisma migrations. The default is read-only.
# --apply marks a lock-timeout failure rolled back. SCHEMA_FINGERPRINT_BEFORE
# is the schema after the failed deploy and before resolve. Other failures
# are never resolved here.
set -euo pipefail

common="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prisma-migrate-common.sh"
# shellcheck source=prisma-migrate-common.sh
source "$common"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend="$repo_root/apps/backend"
working_directory="${PRISMA_WORKING_DIRECTORY:-$backend}"
helper="$backend/prisma/prisma-migration-failure.mjs"

apply=0
if [[ "${1:-}" == "--apply" ]]; then
  apply=1
  shift
fi
prefix=()
if [[ "${1:-}" == "--" ]]; then
  shift
  prefix=("$@")
elif [[ $# -gt 0 ]]; then
  printf 'usage: prisma-migrate-recover.sh [--apply] [-- command prefix]\n' >&2
  exit 2
fi

node_helper() {
  if [[ ${#prefix[@]} -gt 0 ]]; then
    "${prefix[@]}" node prisma/prisma-migration-failure.mjs "$@"
  else
    node "$helper" "$@"
  fi
}

run() {
  if [[ ${#prefix[@]} -gt 0 ]]; then
    "${prefix[@]}" "$@"
  else
    (cd "$working_directory" && "$@")
  fi
}

pending="$(node_helper pending)"
kind="$(printf '%s\n' "$pending" | sed -n '1p')"
name="$(printf '%s\n' "$pending" | sed -n '2p')"
cause="$(printf '%s\n' "$pending" | sed -n '3p')"

if [[ "$kind" == "none" ]]; then
  printf 'no failed migration\n'
  exit 0
fi
if [[ "$kind" == "many" ]]; then
  printf 'more than one failed migration; leaving them untouched\n' >&2
  exit 1
fi

printf 'failed migration: %s\n' "$name"
printf 'class: %s\n' "$kind"
printf 'cause: %s\n' "$cause"
fingerprint="$(node_helper fingerprint | tr -d '[:space:]')"
printf 'schema fingerprint: %s\n' "$fingerprint"

if [[ "$apply" -eq 0 ]]; then
  printf 'dry-run: no migration record was changed\n'
  exit 0
fi
if [[ "$kind" != "lock_timeout" ]]; then
  printf 'refusing to resolve a failure that is not a lock timeout\n' >&2
  exit 1
fi
run npx prisma migrate resolve --rolled-back "$name"
after="$(node_helper fingerprint | tr -d '[:space:]')"
if [[ -n "${SCHEMA_FINGERPRINT_BEFORE:-}" && "$after" != "$SCHEMA_FINGERPRINT_BEFORE" ]]; then
  printf 'schema fingerprint changed while resolving %s\n' "$name" >&2
  exit 1
fi
if [[ -z "${SCHEMA_FINGERPRINT_BEFORE:-}" ]]; then
  printf 'resolved %s. schema fingerprint after resolve: %s. no earlier fingerprint was supplied, so equality with the pre-failure schema was not checked.\n' "$name" "$after" >&2
  exit 1
fi
confirmed="$(node_helper pending)"
if [[ "$(printf '%s\n' "$confirmed" | sed -n '1p')" != "none" ]]; then
  printf 'migration %s is still failed after resolve\n' "$name" >&2
  exit 1
fi
printf 'resolved %s. resolve left the schema unchanged. migrations that committed before this failure stay applied.\n' "$name"
