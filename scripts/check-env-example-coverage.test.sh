#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-env-example-coverage.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/env-example-coverage.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

# checker 인자는 compose, env_example, [scan_root]
# docker config 단계는 fixture compose 가 실제 스택이 아니라 실패할 수 있으므로
# PATH 에서 docker 를 가린 채 돌린다(단위 테스트는 a·b 계약만 본다).
run_checker() {
  local compose_file=$1 env_file=$2
  shift 2
  local scan_root=${1:-}
  env PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    "$checker" "$compose_file" "$env_file" ${scan_root:+"$scan_root"}
}

expect_pass() {
  local name=$1 compose_file=$2 env_file=$3
  local scan_root=${4:-}
  if run_checker "$compose_file" "$env_file" "$scan_root" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    run_checker "$compose_file" "$env_file" "$scan_root" >&2 || true
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1 compose_file=$2 env_file=$3
  local scan_root=${4:-}
  local output
  if output=$(run_checker "$compose_file" "$env_file" "$scan_root" 2>&1); then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

expect_fail_message() {
  local name=$1 compose_file=$2 env_file=$3 expected_needle=$4
  local scan_root=${5:-}
  local output rc=0
  output=$(run_checker "$compose_file" "$env_file" "$scan_root" 2>&1) || rc=$?
  if [[ $rc -eq 0 ]]; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
    return
  fi
  if printf '%s' "$output" | grep -Fq -- "$expected_needle"; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected message missing: %s)\n%s\n' "$name" "$expected_needle" "$output" >&2
    failed=$((failed + 1))
  fi
}

# --- 기존 fixture: compose → 계약 ---
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      SUBMISSION_FILE_S3_BUCKET: ${SUBMISSION_FILE_S3_BUCKET:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$fixture_dir/valid-compose.yml"
printf 'DATABASE_URL=value\nSUBMISSION_FILE_S3_BUCKET=value\n' >"$fixture_dir/valid.env"
printf 'DATABASE_URL=value\n' >"$fixture_dir/missing.env"
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n' >"$fixture_dir/missing-map.yml"

# 구 fixture 는 코드 스캔을 끄기 위해 apps/ 없는 빈 루트를 넘긴다.
empty_scan="$fixture_dir/empty-scan"
mkdir -p "$empty_scan"

expect_pass '필수 키가 모두 있으면 성공' "$fixture_dir/valid-compose.yml" "$fixture_dir/valid.env" "$empty_scan"
expect_fail '숫자를 포함한 S3 필수 키 누락' "$fixture_dir/valid-compose.yml" "$fixture_dir/missing.env" "$empty_scan"
expect_fail 'AUTH_INITIAL_ROLES 명시 매핑 누락' "$fixture_dir/missing-map.yml" "$fixture_dir/valid.env" "$empty_scan"

# --- 공통 baseline: 프로덕션과 같은 environmentValue + process.env[name] helper ---
write_ops_helper() {
  local path=$1
  cat >"$path" <<'EOF'
function environmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}
export function loadOps() {
  return {
    id: environmentValue('GITHUB_OPERATIONS_APP_ID'),
    key: environmentValue('GITHUB_OPERATIONS_APP_PRIVATE_KEY'),
  };
}
EOF
}

write_scheduler() {
  local path=$1
  cat >"$path" <<'EOF'
export const cron = process.env.COLLECTION_CRON_EXPRESSION?.trim() || '0 0 * * * *';
export const port = Number.parseInt(process.env.PORT ?? '4000', 10);
EOF
}

base_env_all='DATABASE_URL=value
GITHUB_OPERATIONS_APP_ID=
GITHUB_OPERATIONS_APP_PRIVATE_KEY=
COLLECTION_CRON_EXPRESSION=
PORT=
'
base_compose_all='services:
  backend:
    environment:
      DATABASE_URL: ${DATABASE_URL:?required}
      GITHUB_OPERATIONS_APP_ID: ${GITHUB_OPERATIONS_APP_ID:?required}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: ${GITHUB_OPERATIONS_APP_PRIVATE_KEY:?required}
      COLLECTION_CRON_EXPRESSION: ${COLLECTION_CRON_EXPRESSION:-}
      PORT: ${PORT:-4000}
      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}
'

# --- F7: 코드가 읽는 키가 .env.example 에 없으면 실패 (선언 불변식) ---
f7_root="$fixture_dir/f7-undeclared"
mkdir -p "$f7_root/apps/backend/src/repositories" "$f7_root/apps/backend/src/collection"
write_ops_helper "$f7_root/apps/backend/src/repositories/ops.ts"
write_scheduler "$f7_root/apps/backend/src/collection/scheduler.ts"
# compose 의 ${:?} 필수 단계(a)와 겹치지 않도록 코드 키는 ${:-} 매핑을 쓴다.
cat >"$f7_root/compose.yml" <<'EOF'
services:
  backend:
    environment:
      DATABASE_URL: ${DATABASE_URL:?required}
      GITHUB_OPERATIONS_APP_ID: ${GITHUB_OPERATIONS_APP_ID:-}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: ${GITHUB_OPERATIONS_APP_PRIVATE_KEY:-}
      COLLECTION_CRON_EXPRESSION: ${COLLECTION_CRON_EXPRESSION:-}
      PORT: ${PORT:-4000}
      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}
EOF
printf 'DATABASE_URL=value\n' >"$f7_root/.env.example"

expect_fail_message \
  'F7: 코드 키가 .env.example 에 없으면 undeclared 로 실패' \
  "$f7_root/compose.yml" \
  "$f7_root/.env.example" \
  'code reads undeclared key:' \
  "$f7_root"

# --- F6: .env.example 선언은 유지하고 backend environment 매핑만 제거 ---
# 키별 독립 fixture — 각각 해당 키 하나만 매핑에서 빠진다.
f6_make() {
  local name=$1 missing_key=$2 needle=$3
  local root="$fixture_dir/f6-$name"
  mkdir -p "$root/apps/backend/src/repositories" "$root/apps/backend/src/collection"
  write_ops_helper "$root/apps/backend/src/repositories/ops.ts"
  write_scheduler "$root/apps/backend/src/collection/scheduler.ts"
  printf '%s\n' "$base_env_all" >"$root/.env.example"

  # base compose 에서 missing_key 매핑 줄만 제거
  printf '%s\n' "$base_compose_all" | grep -v "^      ${missing_key}:" >"$root/compose.yml"

  expect_fail_message \
    "F6: $missing_key 가 .env.example 에 있어도 backend environment 매핑 없으면 실패" \
    "$root/compose.yml" \
    "$root/.env.example" \
    "$needle" \
    "$root"
}

f6_make 'ops-id' 'GITHUB_OPERATIONS_APP_ID' \
  'code key not mapped in backend service environment: GITHUB_OPERATIONS_APP_ID'
f6_make 'ops-key' 'GITHUB_OPERATIONS_APP_PRIVATE_KEY' \
  'code key not mapped in backend service environment: GITHUB_OPERATIONS_APP_PRIVATE_KEY'
f6_make 'cron' 'COLLECTION_CRON_EXPRESSION' \
  'code key not mapped in backend service environment: COLLECTION_CRON_EXPRESSION'
f6_make 'port' 'PORT' \
  'code key not mapped in backend service environment: PORT'

# 선언+매핑 모두 있으면 통과
f6_ok="$fixture_dir/f6-ok"
mkdir -p "$f6_ok/apps/backend/src/repositories" "$f6_ok/apps/backend/src/collection"
write_ops_helper "$f6_ok/apps/backend/src/repositories/ops.ts"
write_scheduler "$f6_ok/apps/backend/src/collection/scheduler.ts"
printf '%s\n' "$base_env_all" >"$f6_ok/.env.example"
printf '%s\n' "$base_compose_all" >"$f6_ok/compose.yml"
expect_pass \
  'F6·F7 키를 선언하고 backend environment 에 매핑하면 성공' \
  "$f6_ok/compose.yml" \
  "$f6_ok/.env.example" \
  "$f6_ok"

# compose 파일 다른 위치의 ${KEY} 치환만으로는 서비스 매핑을 충족하지 않는다
f6_elsewhere="$fixture_dir/f6-elsewhere"
mkdir -p "$f6_elsewhere/apps/backend/src/repositories" "$f6_elsewhere/apps/backend/src/collection"
write_ops_helper "$f6_elsewhere/apps/backend/src/repositories/ops.ts"
write_scheduler "$f6_elsewhere/apps/backend/src/collection/scheduler.ts"
printf '%s\nIMAGE_TAG=local\n' "$base_env_all" >"$f6_elsewhere/.env.example"
cat >"$f6_elsewhere/compose.yml" <<'EOF'
services:
  backend:
    image: app:${IMAGE_TAG:?IMAGE_TAG is required}
    environment:
      DATABASE_URL: ${DATABASE_URL:?required}
      COLLECTION_CRON_EXPRESSION: ${COLLECTION_CRON_EXPRESSION:-}
      PORT: ${PORT:-4000}
      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}
  # 고의로 ops 키를 backend.environment 가 아닌 다른 서비스에만 둔다.
  other:
    environment:
      GITHUB_OPERATIONS_APP_ID: ${GITHUB_OPERATIONS_APP_ID:?required}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: ${GITHUB_OPERATIONS_APP_PRIVATE_KEY:?required}
EOF
expect_fail_message \
  'F6: 다른 서비스 environment 의 ${KEY} 만으로는 backend 매핑 불충족' \
  "$f6_elsewhere/compose.yml" \
  "$f6_elsewhere/.env.example" \
  'code key not mapped in backend service environment: GITHUB_OPERATIONS_APP_ID' \
  "$f6_elsewhere"

# --- 경로별 면제 ---
allow_root="$fixture_dir/allowlist"
mkdir -p \
  "$allow_root/apps/backend/src/notifications/cli" \
  "$allow_root/apps/backend/src/testing"
cat >"$allow_root/apps/backend/src/runtime.ts" <<'EOF'
export const nodeEnv = process.env.NODE_ENV;
EOF
cat >"$allow_root/apps/backend/src/notifications/cli/send-digest.ts" <<'EOF'
export const forceTo = process.env.DIGEST_FORCE_TO?.trim();
EOF
cat >"$allow_root/apps/backend/src/testing/integration-runner.ts" <<'EOF'
export const runner = process.env.OSS_HUB_INTEGRATION_RUNNER;
EOF
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$allow_root/compose.yml"
printf 'DATABASE_URL=value\nIMAGE_TAG=local\n' >"$allow_root/.env.example"
expect_pass \
  '경로별 면제: NODE_ENV·notifications/cli DIGEST_FORCE_TO·integration runner' \
  "$allow_root/compose.yml" \
  "$allow_root/.env.example" \
  "$allow_root"

# DIGEST_FORCE_TO 가 CLI 밖이면 면제 실패
allow_bad="$fixture_dir/allow-bad-digest"
mkdir -p "$allow_bad/apps/backend/src"
cat >"$allow_bad/apps/backend/src/runtime.ts" <<'EOF'
export const forceTo = process.env.DIGEST_FORCE_TO;
EOF
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$allow_bad/compose.yml"
printf 'DATABASE_URL=value\n' >"$allow_bad/.env.example"
expect_fail_message \
  'DIGEST_FORCE_TO 가 CLI 경로 밖이면 계약 검사 실패' \
  "$allow_bad/compose.yml" \
  "$allow_bad/.env.example" \
  'DIGEST_FORCE_TO' \
  "$allow_bad"

# IMAGE_TAG 는 .env.example 에 문서화된다 (로컬 placeholder).
printf 'services:\n  backend:\n    image: app:${IMAGE_TAG:?IMAGE_TAG is required}\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$allow_root/compose-image.yml"
printf 'DATABASE_URL=value\n' >"$allow_root/.env.example.no-tag"
expect_fail_message \
  'IMAGE_TAG 가 compose 필수면 .env.example 문서화 필요' \
  "$allow_root/compose-image.yml" \
  "$allow_root/.env.example.no-tag" \
  'required key missing: IMAGE_TAG' \
  "$empty_scan"
expect_pass \
  'IMAGE_TAG 로컬 placeholder 가 .env.example 에 있으면 성공' \
  "$allow_root/compose-image.yml" \
  "$allow_root/.env.example" \
  "$empty_scan"

# 테스트 전용 파일(*.spec.ts)의 process.env 는 스캔하지 않는다.
spec_root="$fixture_dir/spec-only"
mkdir -p "$spec_root/apps/backend/src"
cat >"$spec_root/apps/backend/src/thing.spec.ts" <<'EOF'
process.env.ONLY_IN_SPEC_KEY = 'x';
export const v = process.env.ONLY_IN_SPEC_KEY;
EOF
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$spec_root/compose.yml"
printf 'DATABASE_URL=value\n' >"$spec_root/.env.example"
expect_pass \
  '테스트 전용(*.spec.ts) 키는 계약 검사에서 제외' \
  "$spec_root/compose.yml" \
  "$spec_root/.env.example" \
  "$spec_root"

# --- blocker 3: 대괄호 리터럴·구조 분해·동적 접근 ---
scan_forms="$fixture_dir/scan-forms"
mkdir -p "$scan_forms/apps/backend/src"
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$scan_forms/compose.yml"
printf 'DATABASE_URL=value\n' >"$scan_forms/.env.example"

cat >"$scan_forms/apps/backend/src/bracket.ts" <<'EOF'
export const value = process.env['UNDECLARED_BRACKET_KEY'];
EOF
expect_fail_message \
  'process.env['\''KEY'\''] 대괄호 리터럴 접근을 검출' \
  "$scan_forms/compose.yml" \
  "$scan_forms/.env.example" \
  'code reads undeclared key: UNDECLARED_BRACKET_KEY' \
  "$scan_forms"

cat >"$scan_forms/apps/backend/src/bracket.ts" <<'EOF'
const { UNDECLARED_DESTRUCT_KEY } = process.env;
export const value = UNDECLARED_DESTRUCT_KEY;
EOF
# 이전 파일 잔여 제거 — 단일 파일만
rm -f "$scan_forms/apps/backend/src/bracket.ts"
cat >"$scan_forms/apps/backend/src/destruct.ts" <<'EOF'
const { UNDECLARED_DESTRUCT_KEY } = process.env;
export const value = UNDECLARED_DESTRUCT_KEY;
EOF
expect_fail_message \
  'const { KEY } = process.env 구조 분해를 검출' \
  "$scan_forms/compose.yml" \
  "$scan_forms/.env.example" \
  'code reads undeclared key: UNDECLARED_DESTRUCT_KEY' \
  "$scan_forms"

rm -f "$scan_forms/apps/backend/src/destruct.ts"
cat >"$scan_forms/apps/backend/src/dynamic.ts" <<'EOF'
export const value = process.env[someVariable];
EOF
expect_fail_message \
  '해석 불가 동적 process.env[var] 는 명시 실패' \
  "$scan_forms/compose.yml" \
  "$scan_forms/.env.example" \
  'unsupported dynamic process.env access' \
  "$scan_forms"

# 승인 helper 본문의 process.env[name] + environmentValue('KEY') 는 허용
rm -f "$scan_forms/apps/backend/src/dynamic.ts"
mkdir -p "$scan_forms/apps/backend/src/repositories"
write_ops_helper "$scan_forms/apps/backend/src/repositories/ops.ts"
printf '%s\n' "$base_env_all" >"$scan_forms/.env.example.fixed"
printf '%s\n' "$base_compose_all" >"$scan_forms/compose.fixed.yml"
# scheduler 없이 ops 만
expect_pass \
  'environmentValue helper 의 process.env[name] 은 동적 접근 실패가 아님' \
  "$scan_forms/compose.fixed.yml" \
  "$scan_forms/.env.example.fixed" \
  "$scan_forms"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
