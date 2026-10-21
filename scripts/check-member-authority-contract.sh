#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
schema="$repo_root/apps/backend/prisma/schema.prisma"
migration="$repo_root/apps/backend/prisma/migrations/20260824000000_contract_member_authority/migration.sql"

for required in "$schema" "$migration"; do
  if [[ ! -f $required ]]; then
    printf 'contract check: missing required file %s\n' "$required" >&2
    exit 1
  fi
done

mapfile -t sources < <(cd "$repo_root" && node scripts/member-authority-contract-sources.mjs)
if [[ ${#sources[@]} -eq 0 ]]; then
  printf 'contract check: source policy selected no files\n' >&2
  exit 1
fi

printf 'contract check: scanning %d tracked production sources\n' "${#sources[@]}"
(cd "$repo_root" && node scripts/member-authority-contract-contract.mjs \
  "$schema" "$migration" "${sources[@]}")
