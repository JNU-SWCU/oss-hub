#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
guard="$repo_root/scripts/check-host-db-url.sh"

passed=0
failed=0

run_guard() {
  local url=$1 port=${2:-} database=${3:-}
  local -a env_argv=(env -u DATABASE_URL -u POSTGRES_PORT -u POSTGRES_DB)
  [ -n "$url" ] && env_argv+=("DATABASE_URL=$url")
  [ -n "$port" ] && env_argv+=("POSTGRES_PORT=$port")
  [ -n "$database" ] && env_argv+=("POSTGRES_DB=$database")
  "${env_argv[@]}" bash "$guard" 2>&1
}

expect_pass() {
  local name=$1
  if run_guard "${2:-}" "${3:-}" "${4:-}" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (통과해야 하는데 거부됐다)\n' "$name"
    failed=$((failed + 1))
  fi
}

expect_reject() {
  local name=$1
  if run_guard "${2:-}" "${3:-}" "${4:-}" >/dev/null 2>&1; then
    printf 'not ok - %s (거부해야 하는데 통과했다)\n' "$name"
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

expect_output_excludes() {
  local name=$1 forbidden=$2
  local output
  output=$(run_guard "${3:-}" "${4:-}" "${5:-}" || true)
  if printf '%s' "$output" | grep -qF -- "$forbidden"; then
    printf 'not ok - %s (출력에 %s 가 노출됐다)\n' "$name" "$forbidden"
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

local_url='postgresql://oss:oss-dev@localhost:5432/oss_hub'

expect_pass 'compose.dev.yml 기본값과 일치하는 localhost 주소' "$local_url"
expect_pass '127.0.0.1 표기' 'postgresql://oss:oss-dev@127.0.0.1:5432/oss_hub'
expect_pass 'postgres:// 스킴도 허용' 'postgres://oss:oss-dev@localhost:5432/oss_hub'
expect_pass '포트 생략은 PostgreSQL 기본값 5432으로 해석' \
  'postgresql://oss:oss-dev@localhost/oss_hub'
expect_pass 'query string(schema=public)이 붙어도 무관' \
  'postgresql://oss:oss-dev@localhost:5432/oss_hub?schema=public'
expect_pass 'POSTGRES_PORT override와 DATABASE_URL이 함께 옮겨간 경우' \
  'postgresql://oss:oss-dev@localhost:55432/oss_hub' '55432'
expect_pass 'POSTGRES_DB override와 DATABASE_URL이 함께 바뀐 경우' \
  'postgresql://oss:oss-dev@localhost:5432/oss_hub_scratch' '' 'oss_hub_scratch'

expect_reject 'DATABASE_URL 미설정' ''

expect_reject 'POSTGRES_PORT override와 DATABASE_URL 포트 불일치' \
  "$local_url" '55432'
expect_reject 'POSTGRES_DB override와 DATABASE_URL 데이터베이스 불일치' \
  "$local_url" '' 'oss_hub_test'
expect_reject '포트 생략인데 override가 5432이 아닌 경우' \
  'postgresql://oss:oss-dev@localhost/oss_hub' '55432'

expect_reject '원격 호스트' 'postgresql://oss:pw@db.example.com:5432/oss_hub'
expect_reject '사설 IP 호스트' 'postgresql://oss:pw@10.0.0.5:5432/oss_hub'

expect_reject 'URL 형식이 아님' 'not-a-url'
expect_reject 'postgres 계열이 아닌 스킴' 'mysql://oss:pw@localhost:3306/oss_hub'

expect_output_excludes '거부 메시지에 비밀번호 미노출' 'super-secret-pw' \
  'postgresql://oss:super-secret-pw@db.example.com:5432/oss_hub'
expect_output_excludes '포트 불일치 메시지에 비밀번호 미노출' 'super-secret-pw' \
  'postgresql://oss:super-secret-pw@localhost:5432/oss_hub' '55432'
expect_output_excludes '통과 메시지에 비밀번호 미노출' 'oss-dev' "$local_url"

printf '\n%d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
