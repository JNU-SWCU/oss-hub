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

# --- F6·F7 재현: 코드가 읽는 키가 계약에 없을 때 non-zero ---
# F6: GITHUB_OPERATIONS_APP_* 가 코드에 있으나 compose/env 계약에 없음
# F7: COLLECTION_CRON_EXPRESSION · PORT 가 코드에 있으나 계약에 없음
f6f7_root="$fixture_dir/f6f7"
mkdir -p "$f6f7_root/apps/backend/src/repositories" "$f6f7_root/apps/backend/src/collection" "$f6f7_root/apps/frontend/src"
cat >"$f6f7_root/apps/backend/src/repositories/ops.ts" <<'EOF'
export function loadOps() {
  return {
    id: process.env.GITHUB_OPERATIONS_APP_ID,
    key: process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY,
  };
}
EOF
cat >"$f6f7_root/apps/backend/src/collection/scheduler.ts" <<'EOF'
export const cron = process.env.COLLECTION_CRON_EXPRESSION?.trim() || '0 0 * * * *';
export const port = Number.parseInt(process.env.PORT ?? '4000', 10);
EOF
# compose/env 는 DATABASE_URL 만 — F6·F7 키가 없다.
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$f6f7_root/compose.yml"
printf 'DATABASE_URL=value\n' >"$f6f7_root/.env.example"

expect_fail_message \
  'F6·F7: 코드가 읽는 운영 App·cron·PORT 키가 계약에 없으면 실패' \
  "$f6f7_root/compose.yml" \
  "$f6f7_root/.env.example" \
  'code reads undeclared key:' \
  "$f6f7_root"

# 같은 코드 키를 계약에 넣으면 통과
printf 'DATABASE_URL=value\nGITHUB_OPERATIONS_APP_ID=\nGITHUB_OPERATIONS_APP_PRIVATE_KEY=\nCOLLECTION_CRON_EXPRESSION=\nPORT=\n' >"$f6f7_root/.env.example.fixed"
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      GITHUB_OPERATIONS_APP_ID: ${GITHUB_OPERATIONS_APP_ID:?required}\n      GITHUB_OPERATIONS_APP_PRIVATE_KEY: ${GITHUB_OPERATIONS_APP_PRIVATE_KEY:?required}\n      COLLECTION_CRON_EXPRESSION: ${COLLECTION_CRON_EXPRESSION:-}\n      PORT: ${PORT:-4000}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$f6f7_root/compose.fixed.yml"
expect_pass \
  'F6·F7 키를 계약에 매핑하면 성공' \
  "$f6f7_root/compose.fixed.yml" \
  "$f6f7_root/.env.example.fixed" \
  "$f6f7_root"

# --- allowlist 키는 계약에 없어도 통과 ---
allow_root="$fixture_dir/allowlist"
mkdir -p "$allow_root/apps/backend/src"
cat >"$allow_root/apps/backend/src/runtime.ts" <<'EOF'
export const nodeEnv = process.env.NODE_ENV;
export const runner = process.env.OSS_HUB_INTEGRATION_RUNNER;
export const forceTo = process.env.DIGEST_FORCE_TO;
EOF
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$allow_root/compose.yml"
printf 'DATABASE_URL=value\n' >"$allow_root/.env.example"
expect_pass \
  'allowlist 키(NODE_ENV·OSS_HUB_INTEGRATION_RUNNER·DIGEST_FORCE_TO)는 계약 없이도 통과' \
  "$allow_root/compose.yml" \
  "$allow_root/.env.example" \
  "$allow_root"

# IMAGE_TAG 는 compose ${:?} 필수여도 .env.example 문서화 대상이 아니다.
printf 'services:\n  backend:\n    image: app:${IMAGE_TAG:?IMAGE_TAG is required}\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$allow_root/compose-image.yml"
expect_pass \
  'IMAGE_TAG 는 빌드 주입값으로 계약 문서화 예외' \
  "$allow_root/compose-image.yml" \
  "$allow_root/.env.example" \
  "$allow_root"

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

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
