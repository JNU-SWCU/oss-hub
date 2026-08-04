#!/usr/bin/env bash
# check-host-nginx-drift.sh 계약 픽스처.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
checker="$script_dir/check-host-nginx-drift.sh"
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  shift
  if bash "$checker" "$@" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (통과해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  shift
  if bash "$checker" "$@" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 통과)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

printf 'server { listen 443; client_max_body_size 6m; }\n' >"$fixture_dir/repo.conf"
cp "$fixture_dir/repo.conf" "$fixture_dir/live-same.conf"
printf 'server { listen 443; client_max_body_size 1m; }\n' >"$fixture_dir/live-limit-changed.conf"
printf 'server { listen 443; client_max_body_size 6m; }\n\n' >"$fixture_dir/live-trailing-newline.conf"
printf 'server { listen 443; client_max_body_size 6m; } # 수동 편집\n' >"$fixture_dir/live-manual-edit.conf"
: >"$fixture_dir/live-empty.conf"

expect_pass '동일 설정' "$fixture_dir/repo.conf" "$fixture_dir/live-same.conf"
expect_fail '활성 설정에서 한도가 바뀜' "$fixture_dir/repo.conf" "$fixture_dir/live-limit-changed.conf"
expect_fail '활성 설정에 수동 편집이 붙음' "$fixture_dir/repo.conf" "$fixture_dir/live-manual-edit.conf"
expect_fail '활성 설정 끝에 빈 줄이 추가됨' "$fixture_dir/repo.conf" "$fixture_dir/live-trailing-newline.conf"
expect_fail '활성 설정이 비어 있음' "$fixture_dir/repo.conf" "$fixture_dir/live-empty.conf"
expect_fail '활성 설정 파일 부재' "$fixture_dir/repo.conf" "$fixture_dir/does-not-exist.conf"
expect_fail '저장소 원본 부재' "$fixture_dir/missing-repo.conf" "$fixture_dir/live-same.conf"

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
