#!/usr/bin/env bash
# 릴리스 후보 이미지 인증 매트릭스 게이트 — 운영 변경 전에 돌린다.
#
# Jenkins 가 정확한 후보 frontend/backend 이미지를 빌드한 직후, backup·migration·
# 서비스 교체보다 먼저 호출한다. 일회용 격리 Compose 프로젝트를 만들고 합성
# STUDENT / STAFF / student-admin / staff-admin / revoked / deactivated /
# unassigned 주체로 권한 매트릭스를 돌린 뒤 프로젝트를 제거한다.
#
# 합성 인증 수단은 이 일회용 스택 안에서만 존재한다. 운영에는 합성 사용자도,
# 이 인증 경로도 노출하지 않는다.
set -euo pipefail

usage() {
  printf 'Usage: scripts/check-auth-release-image.sh <tag> <sha>\n' >&2
  exit 2
}

(($# == 2)) || usage
tag=$1
sha=$2

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || usage

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
frontend_image="oss-hub-frontend:${tag}"
backend_image="oss-hub-backend:${tag}"

# 증거 파일 충돌은 스택을 띄우기 전에 거른다 — 인자 오류로
# 일회용 컴포즈 부팅 비용을 치를 이유가 없다.
if [[ -n "${AUTH_RELEASE_IMAGE_EVIDENCE:-}" &&
  "${AUTH_RELEASE_IMAGE_EVIDENCE}" != '-' &&
  -e "${AUTH_RELEASE_IMAGE_EVIDENCE}" ]]; then
  printf 'auth-release-image: evidence already exists\n' >&2
  exit 1
fi

# 후보 이미지의 정확한 digest 와 OCI 라벨을 먼저 고정한다.
# 라벨이 요청한 tag/SHA 와 다르면 매트릭스를 도는 의미가 없다.
resolve_image() {
  local image=$1 inspection version revision image_id
  if ! inspection=$(docker image inspect \
    --format '{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Id}}' \
    "$image" 2>/dev/null); then
    return 1
  fi
  IFS='|' read -r version revision image_id <<<"$inspection"
  [[ "$version" == "$tag" ]] || return 1
  [[ "$revision" == "$sha" ]] || return 1
  [[ -n "$image_id" ]] || return 1
  printf '%s' "$image_id"
}

frontend_image_id=$(resolve_image "$frontend_image") || {
  printf 'auth-release-image: frontend candidate digest mismatch\n' >&2
  exit 1
}
backend_image_id=$(resolve_image "$backend_image") || {
  printf 'auth-release-image: backend candidate digest mismatch\n' >&2
  exit 1
}

run_id="${AUTH_RELEASE_IMAGE_RUN_ID:-$(date +%s)-$$-$RANDOM}"
run_slug="${run_id//[^A-Za-z0-9]/_}"
project_name="oss-hub-auth-release-${run_slug:0:32}"
evidence_json=${AUTH_RELEASE_IMAGE_EVIDENCE:-}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/auth-release-image.XXXXXX")
matrix_path="$tmp_dir/matrix.json"

compose=(docker compose -p "$project_name" -f "$repo_root/compose.yml")

# 정리 실패는 통과가 아니다. 일회용 리소스가 남으면 명시적으로 실패한다.
cleanup_failed=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if ! IMAGE_TAG="$tag" "${compose[@]}" down -v --remove-orphans --timeout 30 \
    >/dev/null 2>&1; then
    cleanup_failed=1
  fi
  rm -rf "$tmp_dir"
  if ((cleanup_failed != 0)); then
    printf 'auth-release-image: disposable project cleanup failed\n' >&2
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# 합성 스택은 loopback 에만 붙이고 임의 포트를 쓴다.
# 운영 포트를 점유하거나 외부에 노출되지 않게 한다.
if ! IMAGE_TAG="$tag" \
  SEED_PROFILE=auth \
  AUTH_SYNTHETIC_MATRIX=1 \
  "${compose[@]}" up -d --wait --quiet-pull backend frontend >/dev/null 2>&1; then
  printf 'auth-release-image: disposable stack failed to become healthy\n' >&2
  exit 1
fi

# 매트릭스는 후보 backend 이미지 안에서 돈다 — 호스트 소스가 아니라
# 실제로 배포될 바이너리의 권한 판정을 증명해야 하기 때문이다.
if ! IMAGE_TAG="$tag" "${compose[@]}" exec -T backend \
  node dist/prisma/auth-release-matrix.js --synthetic --evidence - \
  >"$matrix_path" 2>/dev/null; then
  printf 'auth-release-image: synthetic authority matrix failed\n' >&2
  exit 1
fi

if ! node "$repo_root/scripts/auth-release-image-report.mjs" \
  "$tag" "$sha" "$frontend_image_id" "$backend_image_id" "$matrix_path" \
  "${evidence_json:--}"; then
  printf 'auth-release-image: synthetic authority matrix rejected\n' >&2
  exit 1
fi

printf 'auth-release-image: %s ok\n' "$tag"
