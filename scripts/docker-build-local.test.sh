#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
builder="$repo_root/scripts/docker-build-local.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/docker-build-local.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0
expect_equal() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == "$expected" ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected=%s, actual=%s)\n' "$name" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}
expect_fail() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

# shellcheck source=scripts/docker-build-local.sh
source "$builder"
printf ' IMAGE_TAG = ignored\nIMAGE_TAG=first # 이전 값\nIMAGE_TAG="tag with space"\nIMAGE_TAG=last # 마지막 값\n' >"$fixture_dir/.env"
expect_equal '.env 마지막 IMAGE_TAG와 inline comment 파싱' 'last' "$(image_tag_from_env_file "$fixture_dir/.env")"
printf "IMAGE_TAG='quoted tag with space' # inline comment\n" >"$fixture_dir/quoted.env"
expect_equal '작은따옴표 공백과 inline comment IMAGE_TAG 파싱' 'quoted tag with space' "$(image_tag_from_env_file "$fixture_dir/quoted.env")"
repo_root=$fixture_dir
IMAGE_TAG='environment tag'
expect_equal '환경 IMAGE_TAG 우선' 'environment tag' "$(resolve_image_tag)"
unset IMAGE_TAG
expect_equal '.env fallback 사용' 'last' "$(resolve_image_tag)"
rm -f "$fixture_dir/.env"
expect_fail '환경과 .env 모두 없으면 실패' resolve_image_tag

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
