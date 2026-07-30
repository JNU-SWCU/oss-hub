#!/usr/bin/env bash
# scripts/check-host-db-url.sh 회귀 테스트.
#
# 가드의 목적은 파괴적 명령(`prisma migrate reset --force`)이 의도하지 않은
# 데이터베이스에 닿는 것을 막는 것이다. 따라서 통과 조건보다 **차단 조건**을
# 더 촘촘히 고정한다. 비밀값 미출력도 계약이므로 함께 검사한다.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
guard="$repo_root/scripts/check-host-db-url.sh"

passed=0
failed=0

# 가드를 격리 환경에서 실행한다. 호출자의 DATABASE_URL·POSTGRES_* 가 새지 않도록
# env -u 로 명시 제거한 뒤 인자로 받은 값만 주입한다.
run_guard() { # $1=DATABASE_URL(빈 문자열이면 미설정) $2=POSTGRES_PORT $3=POSTGRES_DB
  local url=$1 port=${2:-} database=${3:-}
  local -a env_argv=(env -u DATABASE_URL -u POSTGRES_PORT -u POSTGRES_DB)
  [ -n "$url" ] && env_argv+=("DATABASE_URL=$url")
  [ -n "$port" ] && env_argv+=("POSTGRES_PORT=$port")
  [ -n "$database" ] && env_argv+=("POSTGRES_DB=$database")
  "${env_argv[@]}" bash "$guard" 2>&1
}

expect_pass() { # $1=name $2=DATABASE_URL $3=POSTGRES_PORT $4=POSTGRES_DB
  local name=$1
  if run_guard "${2:-}" "${3:-}" "${4:-}" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (통과해야 하는데 거부됐다)\n' "$name"
    failed=$((failed + 1))
  fi
}

expect_reject() { # $1=name $2=DATABASE_URL $3=POSTGRES_PORT $4=POSTGRES_DB
  local name=$1
  if run_guard "${2:-}" "${3:-}" "${4:-}" >/dev/null 2>&1; then
    printf 'not ok - %s (거부해야 하는데 통과했다)\n' "$name"
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

expect_output_excludes() { # $1=name $2=금지문자열 $3=DATABASE_URL $4=POSTGRES_PORT $5=POSTGRES_DB
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

# --- 통과 경로 ---
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

# --- 차단 경로: env 부재 ---
expect_reject 'DATABASE_URL 미설정' ''

# --- 차단 경로: 이 티켓이 막으려는 실제 사고 시나리오 ---
# compose는 55432로 옮겨갔는데 연결 문자열만 5432에 남은 상태.
# 하드코딩 시절 `pnpm db:reset`이 정확히 이 형태로 남의 DB를 지웠다.
expect_reject 'POSTGRES_PORT override와 DATABASE_URL 포트 불일치' \
  "$local_url" '55432'
expect_reject 'POSTGRES_DB override와 DATABASE_URL 데이터베이스 불일치' \
  "$local_url" '' 'oss_hub_test'
expect_reject '포트 생략인데 override가 5432이 아닌 경우' \
  'postgresql://oss:oss-dev@localhost/oss_hub' '55432'

# --- 차단 경로: 로컬이 아닌 대상 ---
expect_reject '원격 호스트' 'postgresql://oss:pw@db.example.internal:5432/oss_hub'
expect_reject '사설 IP 호스트' 'postgresql://oss:pw@10.0.0.5:5432/oss_hub'

# --- 차단 경로: 형식 오류 ---
expect_reject 'URL 형식이 아님' 'not-a-url'
expect_reject 'postgres 계열이 아닌 스킴' 'mysql://oss:pw@localhost:3306/oss_hub'

# --- 비밀값 미출력 계약 ---
# 실패 경로에서도 자격증명이 로그에 남으면 안 된다(저장소 PUBLIC · CI 로그 공개).
expect_output_excludes '거부 메시지에 비밀번호 미노출' 'super-secret-pw' \
  'postgresql://oss:super-secret-pw@db.example.internal:5432/oss_hub'
expect_output_excludes '포트 불일치 메시지에 비밀번호 미노출' 'super-secret-pw' \
  'postgresql://oss:super-secret-pw@localhost:5432/oss_hub' '55432'
expect_output_excludes '통과 메시지에 비밀번호 미노출' 'oss-dev' "$local_url"

printf '\n%d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
