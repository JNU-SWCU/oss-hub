#!/usr/bin/env bash
# check-team-state-updated.sh의 합성 git repo fixture 회귀 테스트.
# 실제 origin·네트워크·실데이터 없이 refs/remotes/origin/main을 로컬로 시뮬레이션한다.

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
  mkdir -p "$FIXTURE_REPO/docs/handoff"
  git -C "$FIXTURE_REPO" init -q -b main
  printf 'synthetic baseline\n' >"$FIXTURE_REPO/README.md"
  printf '# TEAM-STATE\nsynthetic baseline\n' >"$FIXTURE_REPO/docs/handoff/TEAM-STATE.md"
  git -C "$FIXTURE_REPO" add README.md docs/handoff/TEAM-STATE.md
  commit_fixture commit -qm 'test: synthetic baseline'
  # 네트워크 fetch 없이 origin/main 원격 추적 ref를 로컬로 시뮬레이션한다.
  git -C "$FIXTURE_REPO" update-ref refs/remotes/origin/main refs/heads/main
}

# main 대비 docs/handoff/TEAM-STATE.md를 건드리지 않는 분기.
branch_without_team_state_change() {
  git -C "$FIXTURE_REPO" checkout -q -b feature-a main
  printf 'unrelated change\n' >>"$FIXTURE_REPO/README.md"
  git -C "$FIXTURE_REPO" add README.md
  commit_fixture commit -qm 'test: unrelated change'
  git -C "$FIXTURE_REPO" checkout -q main
}

# main 대비 docs/handoff/TEAM-STATE.md를 갱신하는 분기.
branch_with_team_state_change() {
  git -C "$FIXTURE_REPO" checkout -q -b feature-b main
  printf 'updated row\n' >>"$FIXTURE_REPO/docs/handoff/TEAM-STATE.md"
  git -C "$FIXTURE_REPO" add docs/handoff/TEAM-STATE.md
  commit_fixture commit -qm 'test: team-state update'
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

check_blocked_without_team_state_update() {
  run_prepush "refs/heads/feature-a $(sha_of feature-a) refs/heads/feature-a $ZERO_SHA"
}

check_passes_with_team_state_update() {
  run_prepush "refs/heads/feature-b $(sha_of feature-b) refs/heads/feature-b $ZERO_SHA"
}

check_skip_env_bypasses() {
  run_prepush_skip "refs/heads/feature-a $(sha_of feature-a) refs/heads/feature-a $ZERO_SHA"
}

# main으로의 direct push는 내용(TEAM-STATE 변경 여부)과 무관하게 제외돼야 한다.
check_main_direct_push_excluded() {
  run_prepush "refs/heads/main $(sha_of feature-a) refs/heads/main $(sha_of main)"
}

# 브랜치 삭제 push(local sha1이 전부 0)는 원격에 남아있던 이력과 무관하게 제외돼야 한다.
check_branch_delete_excluded() {
  run_prepush "(delete) $ZERO_SHA refs/heads/feature-a $(sha_of feature-a)"
}

init_repo
branch_without_team_state_change
branch_with_team_state_change

expect_fail 'TEAM-STATE 미변경 브랜치 push 차단' check_blocked_without_team_state_update
expect_pass 'TEAM-STATE 변경 포함 push 통과' check_passes_with_team_state_update
expect_pass 'TEAM_STATE_SKIP=1 우회 통과' check_skip_env_bypasses
expect_pass 'main direct push 검사 제외' check_main_direct_push_excluded
expect_pass '브랜치 삭제 push 검사 제외' check_branch_delete_excluded

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
