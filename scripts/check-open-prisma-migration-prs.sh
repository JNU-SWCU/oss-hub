#!/usr/bin/env bash
set -euo pipefail

current_pr=${1:-0}
if ! [[ "$current_pr" =~ ^[0-9]+$ ]]; then
  printf 'Usage: scripts/check-open-prisma-migration-prs.sh <current-pr-number-or-0>\n' >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  printf '{"status":"error","reason":"gh-unavailable"}\n' >&2
  exit 1
fi

open_prs=$(mktemp "${TMPDIR:-/tmp}/open-prisma-prs.XXXXXX")
pr_files=$(mktemp "${TMPDIR:-/tmp}/open-prisma-files.XXXXXX")
trap 'rm -f "$open_prs" "$pr_files"' EXIT

if ! gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100' \
  --jq '.[].number' >"$open_prs"; then
  printf '{"status":"error","reason":"open-pr-list-failed"}\n' >&2
  exit 1
fi

checked=0
while IFS= read -r pull_number; do
  [[ -z "$pull_number" ]] && continue
  if ! [[ "$pull_number" =~ ^[0-9]+$ ]]; then
    printf '{"status":"error","reason":"invalid-pull-number"}\n' >&2
    exit 1
  fi
  if [[ "$pull_number" == "$current_pr" ]]; then
    continue
  fi
  if ! gh api --paginate "repos/{owner}/{repo}/pulls/${pull_number}/files?per_page=100" \
    --jq '.[].filename' >"$pr_files"; then
    printf '{"status":"error","reason":"pull-files-failed","pullRequest":%s}\n' \
      "$pull_number" >&2
    exit 1
  fi
  checked=$((checked + 1))
  if grep -Eq '^apps/backend/prisma/(schema\.prisma|migrations/|member-authority-backfill\.(ts|mts|mjs)$)' "$pr_files"; then
    printf '{"status":"blocked","competingPullRequest":%s}\n' "$pull_number" >&2
    exit 1
  fi
done <"$open_prs"

printf '{"status":"clear","checkedOpenPullRequests":%s}\n' "$checked"
