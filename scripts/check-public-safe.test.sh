#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="$ROOT/scripts/check-public-safe.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/public-safe-email-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

# 완성된 이메일 literal을 저장소에 남기지 않고 실행 시점에만 합성한다.
allowed_noreply='noreply'"@"'synthetic.invalid'
allowed_reserved='fixture'"@"'sub.example.com'
allowed_reserved_upper='FIXTURE'"@"'SYNTHETIC.INVALID'
blocked_contact='contact'"@"'synthetic.local'
blocked_lookalike='contact'"@"'notexample.com'
blocked_test_lookalike='contact'"@"'test.co'
mixed_same_line="$allowed_noreply $blocked_contact"
git_identity='noreply'"@"'example.com'

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
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'not ok - %s (expected failure)\n' "$label"
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  fi
}

scan_pr_text() {
  (
    cd "$ROOT"
    PR_TEXT="$1" bash "$SCANNER" HEAD
  )
}

scan_invalid_ref() {
  (
    cd "$ROOT"
    PR_TEXT='' bash "$SCANNER" refs/heads/missing-public-safe-base
  )
}

expect_blocked_redacted() {
  local output status=0
  output="$(scan_pr_text "$blocked_contact" 2>&1)" || status=$?
  if [ "$status" -ne 0 ] && ! printf '%s\n' "$output" | grep -Fq "$blocked_contact"; then
    printf 'ok - 차단값을 로그에 원문 출력하지 않음\n'
    passed=$((passed + 1))
  else
    printf 'not ok - 차단값 로그 redaction\n'
    failed=$((failed + 1))
  fi
}

init_fixture_repo() {
  FIXTURE_REPO="$TEMP_ROOT/$1"
  mkdir -p "$FIXTURE_REPO/scripts"
  cp "$SCANNER" "$FIXTURE_REPO/scripts/check-public-safe.sh"
  git -C "$FIXTURE_REPO" init -q
  printf 'synthetic baseline\n' >"$FIXTURE_REPO/README.md"
  git -C "$FIXTURE_REPO" add README.md scripts/check-public-safe.sh
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    commit -qm 'test: synthetic baseline'
  BASE_REF="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
}

commit_fixture() {
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    "$@"
}

scan_fixture_repo() {
  (
    cd "$FIXTURE_REPO"
    PR_TEXT='' bash scripts/check-public-safe.sh "$BASE_REF"
  )
}

expect_pass 'noreply 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_noreply"
expect_pass 'RFC 2606 예약 예시 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_reserved"
expect_pass '대문자 RFC 2606 예약 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_reserved_upper"
expect_fail '금지 합성 연락처 주소만 있는 PR 텍스트' \
  scan_pr_text "$blocked_contact"
expect_fail '예약 도메인 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_lookalike"
expect_fail '예약 TLD 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_test_lookalike"
expect_fail '허용·금지 주소가 같은 줄인 PR 텍스트' \
  scan_pr_text "$mixed_same_line"
expect_fail '존재하지 않는 기준 ref' scan_invalid_ref
expect_blocked_redacted

init_fixture_repo changed-file
printf '%s\n' "$mixed_same_line" >"$FIXTURE_REPO/synthetic-fixture.txt"
git -C "$FIXTURE_REPO" add synthetic-fixture.txt
commit_fixture commit -qm 'test: synthetic changed-file fixture'
expect_fail '허용·금지 주소가 같은 줄인 변경 파일' scan_fixture_repo

init_fixture_repo commit-message
commit_fixture commit --allow-empty -qm "$mixed_same_line"
expect_fail '허용·금지 주소가 같은 줄인 커밋 메시지' scan_fixture_repo

init_fixture_repo test-source
cp "$ROOT/scripts/check-public-safe.test.sh" \
  "$FIXTURE_REPO/scripts/check-public-safe.test.sh"
git -C "$FIXTURE_REPO" add scripts/check-public-safe.test.sh
commit_fixture commit -qm 'test: synthetic regression source'
expect_pass '회귀 테스트 소스 자체 public-safe 검사' scan_fixture_repo

printf 'tests=%s passed=%s failed=%s\n' \
  "$((passed + failed))" "$passed" "$failed"

[ "$failed" -eq 0 ]
