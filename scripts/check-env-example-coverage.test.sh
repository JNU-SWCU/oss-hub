#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-env-example-coverage.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/env-example-coverage.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0
expect_pass() {
  local name=$1 compose_file=$2 env_file=$3
  if "$checker" "$compose_file" "$env_file" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    failed=$((failed + 1))
  fi
}
expect_fail() {
  local name=$1 compose_file=$2 env_file=$3
  if "$checker" "$compose_file" "$env_file" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n      SUBMISSION_FILE_S3_BUCKET: ${SUBMISSION_FILE_S3_BUCKET:?required}\n      AUTH_INITIAL_ROLES: ${AUTH_INITIAL_ROLES:-}\n' >"$fixture_dir/valid-compose.yml"
printf 'DATABASE_URL=value\nSUBMISSION_FILE_S3_BUCKET=value\n' >"$fixture_dir/valid.env"
cp "$fixture_dir/valid.env" "$fixture_dir/missing.env"
printf 'DATABASE_URL=value\n' >"$fixture_dir/missing.env"
cp "$fixture_dir/valid-compose.yml" "$fixture_dir/missing-map.yml"
printf 'services:\n  backend:\n    environment:\n      DATABASE_URL: ${DATABASE_URL:?required}\n' >"$fixture_dir/missing-map.yml"

expect_pass '필수 키가 모두 있으면 성공' "$fixture_dir/valid-compose.yml" "$fixture_dir/valid.env"
expect_fail '숫자를 포함한 S3 필수 키 누락' "$fixture_dir/valid-compose.yml" "$fixture_dir/missing.env"
expect_fail 'AUTH_INITIAL_ROLES 명시 매핑 누락' "$fixture_dir/missing-map.yml" "$fixture_dir/valid.env"
printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
