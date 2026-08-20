#!/usr/bin/env bash
# Synthetic git-repo fixture regression tests for check-team-state-updated.sh.
# Simulates refs/remotes/origin/main locally — no real origin, network, or data.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="$ROOT/scripts/check-team-state-updated.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/team-state-prepush-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

FIXTURE_REPO="$TEMP_ROOT/repo"
git_identity='noreply@synthetic.local'
ZERO_SHA='0000000000000000000000000000000000000000'

passed=0
failed=0

expect_pass() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected pass)\n' "$label"
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local label="$1" status=0
  shift
  "$@" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 1 ]; then
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected exit 1, got %s)\n' "$label" "$status"
    failed=$((failed + 1))
  fi
}

commit_fixture() {
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    "$@"
}

sha_of() {
  git -C "$FIXTURE_REPO" rev-parse "$1"
}

init_repo() {
  mkdir -p "$FIXTURE_REPO/docs/handoff/team-state"
  git -C "$FIXTURE_REPO" init -q -b main
  printf 'synthetic baseline\n' >"$FIXTURE_REPO/README.md"
  printf '# TEAM-STATE index\nsynthetic baseline\n' >"$FIXTURE_REPO/docs/handoff/TEAM-STATE.md"
  printf '# @synthetic 저널\n' >"$FIXTURE_REPO/docs/handoff/team-state/synthetic.md"
  git -C "$FIXTURE_REPO" add README.md docs/handoff/TEAM-STATE.md docs/handoff/team-state/synthetic.md
  commit_fixture commit -qm 'test: synthetic baseline'
  # Simulate origin/main without a network fetch.
  git -C "$FIXTURE_REPO" update-ref refs/remotes/origin/main refs/heads/main
}

# Branch that does not touch any member journal.
branch_without_journal_change() {
  git -C "$FIXTURE_REPO" checkout -q -b feature-a main
  printf 'unrelated change\n' >>"$FIXTURE_REPO/README.md"
  git -C "$FIXTURE_REPO" add README.md
  commit_fixture commit -qm 'test: unrelated change'
  git -C "$FIXTURE_REPO" checkout -q main
}

# Branch that appends to the member journal.
branch_with_journal_change() {
  git -C "$FIXTURE_REPO" checkout -q -b feature-b main
  printf '\n## 2026-08-20 — synthetic update\n\n- 상태: review\n- Issue: -\n- PR: (이 PR)\n- blocker: 없음\n' >>"$FIXTURE_REPO/docs/handoff/team-state/synthetic.md"
  git -C "$FIXTURE_REPO" add docs/handoff/team-state/synthetic.md
  commit_fixture commit -qm 'test: journal update'
  git -C "$FIXTURE_REPO" checkout -q main
}

# Branch that changes only the index — must not satisfy the hook.
branch_with_index_only_change() {
  git -C "$FIXTURE_REPO" checkout -q -b feature-index main
  printf 'index only\n' >>"$FIXTURE_REPO/docs/handoff/TEAM-STATE.md"
  git -C "$FIXTURE_REPO" add docs/handoff/TEAM-STATE.md
  commit_fixture commit -qm 'test: index only'
  git -C "$FIXTURE_REPO" checkout -q main
}

run_prepush() {
  local stdin_line="$1"
  (
    cd "$FIXTURE_REPO"
    printf '%s\n' "$stdin_line" | "$CHECKER" origin 'https://example.invalid/origin.git'
  )
}

run_prepush_skip() {
  local stdin_line="$1"
  (
    cd "$FIXTURE_REPO"
    export TEAM_STATE_SKIP=1
    printf '%s\n' "$stdin_line" | "$CHECKER" origin 'https://example.invalid/origin.git'
  )
}

check_blocked_without_journal_update() {
  run_prepush "refs/heads/feature-a $(sha_of feature-a) refs/heads/feature-a $ZERO_SHA"
}

check_passes_with_journal_update() {
  run_prepush "refs/heads/feature-b $(sha_of feature-b) refs/heads/feature-b $ZERO_SHA"
}

check_blocked_when_only_index_changes() {
  run_prepush "refs/heads/feature-index $(sha_of feature-index) refs/heads/feature-index $ZERO_SHA"
}

check_skip_env_bypasses() {
  run_prepush_skip "refs/heads/feature-a $(sha_of feature-a) refs/heads/feature-a $ZERO_SHA"
}

# Direct push to main is excluded regardless of journal changes.
check_main_direct_push_excluded() {
  run_prepush "refs/heads/main $(sha_of feature-a) refs/heads/main $(sha_of main)"
}

# Branch-delete push (local sha1 all zeros) is excluded.
check_branch_delete_excluded() {
  run_prepush "(delete) $ZERO_SHA refs/heads/feature-a $(sha_of feature-a)"
}

init_repo
branch_without_journal_change
branch_with_journal_change
branch_with_index_only_change

expect_fail '저널 미변경 브랜치 push 차단' check_blocked_without_journal_update
expect_pass '저널 변경 포함 push 통과' check_passes_with_journal_update
expect_fail '인덱스만 변경한 push 차단' check_blocked_when_only_index_changes
expect_pass 'TEAM_STATE_SKIP=1 우회 통과' check_skip_env_bypasses
expect_pass 'main direct push 검사 제외' check_main_direct_push_excluded
expect_pass '브랜치 삭제 push 검사 제외' check_branch_delete_excluded

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
