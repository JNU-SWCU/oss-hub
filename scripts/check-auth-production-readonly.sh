#!/usr/bin/env bash
# 운영 인증 경계 read-only 검증 — 자격증명 없이, 행 값을 출력하지 않는다.
#
# 세 모드는 서로 분리된 arity 를 가진다. 인자 개수 자체가 모드 오용을 막는 1차 방어다.
#   start      <tag> <sha> <url> <start-json>            관측 기준선 1회 기록
#   finish     <tag> <sha> <url> <start-json> <final-json>  같은 이미지로 86400초 경과 확인
#   postdeploy <tag> <sha> <url> <output-json>           새 릴리스 단일 체크포인트
#
# `postdeploy` 는 관측 파일을 인자로 받지 않는다 — Todo 12 의 start 파일을 Todo 14 가
# 실수로 재사용할 수 없어야 하기 때문이다. 모드별 인자 개수를 엄격히 고정해서
# start 파일을 덧붙이면 usage 로 거부된다.
#
# 이 스크립트는 SELECT/GET 만 수행한다. 운영 데이터를 변경하지 않고,
# 합성 사용자를 만들지 않으며, 인증된 변경 요청을 보내지 않는다.
set -euo pipefail

readonly MIN_OBSERVATION_SECONDS=86400
readonly CURL_MAX_TIME=20
readonly CURL_RETRY=2

usage() {
  printf 'Usage: scripts/check-auth-production-readonly.sh <start|finish|postdeploy> ...\n' >&2
  printf '  start      <tag> <sha> <url> <start-json>\n' >&2
  printf '  finish     <tag> <sha> <url> <start-json> <final-json>\n' >&2
  printf '  postdeploy <tag> <sha> <url> <output-json>\n' >&2
  exit 2
}

(($# >= 1)) || usage
mode=$1

# 모드별 arity 를 먼저 고정한다. postdeploy 에 start 파일을 붙이면 여기서 죽는다.
case "$mode" in
  start | postdeploy) (($# == 5)) || usage ;;
  finish) (($# == 6)) || usage ;;
  *) usage ;;
esac

tag=$2
sha=$3
base_url=${4%/}

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$base_url" =~ ^https://[^/]+$ ]] || usage

if [[ "$mode" == finish ]]; then
  start_json=$5
  output_json=$6
else
  start_json=''
  output_json=$5
fi

[[ ! -e "$output_json" ]] || {
  printf 'auth-production-readonly: output already exists\n' >&2
  exit 1
}

if [[ "$mode" == finish ]]; then
  if [[ ! -f "$start_json" || ! -r "$start_json" || ! -s "$start_json" ]]; then
    printf 'auth-production-readonly: observation baseline is unavailable\n' >&2
    exit 1
  fi
fi

env_file=${OSS_HUB_ENV_FILE:-}
if [[ -z "$env_file" || ! -f "$env_file" || ! -r "$env_file" || ! -s "$env_file" ]]; then
  printf 'auth-production-readonly: production env file is unavailable\n' >&2
  exit 1
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/auth-production-readonly.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
aggregate_path="$tmp_dir/aggregate.json"
compose=(docker compose --env-file "$env_file")

# 실행 중인 컨테이너가 정확히 요청한 tag/SHA 인지 먼저 확인한다.
# 이미지가 다르면 이후 HTTP 관측은 다른 릴리스를 증명하게 되므로 의미가 없다.
inspect_service() {
  local service=$1
  local expected_image="oss-hub-${service}:${tag}"
  local container_id inspection image_ref version revision image_id state health local_image_id
  container_id=$("${compose[@]}" ps -q "$service")
  [[ -n "$container_id" ]] || return 1
  inspection=$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")
  IFS='|' read -r image_ref version revision image_id state health <<<"$inspection"
  [[ "$image_ref" == "$expected_image" ]] || return 1
  [[ "$version" == "$tag" ]] || return 1
  [[ "$revision" == "$sha" ]] || return 1
  [[ "$state" == running ]] || return 1
  [[ "$health" == healthy ]] || return 1
  local_image_id=$(docker image inspect --format '{{.Id}}' "$expected_image")
  [[ "$image_id" == "$local_image_id" ]] || return 1
  printf '%s' "$image_id"
}

frontend_image_id=$(inspect_service frontend) || {
  printf 'auth-production-readonly: frontend image verification failed\n' >&2
  exit 1
}
backend_image_id=$(inspect_service backend) || {
  printf 'auth-production-readonly: backend image verification failed\n' >&2
  exit 1
}

# 익명 상태의 HTTP 상태 코드만 읽는다. 본문을 저장하지 않아 행 값이 새지 않는다.
probe_status() {
  local path=$1
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time "$CURL_MAX_TIME" --retry "$CURL_RETRY" \
    "$base_url$path"
}

require_status() {
  local path=$1 expected=$2 observed
  observed=$(probe_status "$path") || {
    printf 'auth-production-readonly: route probe failed\n' >&2
    exit 1
  }
  if [[ "$observed" != "$expected" ]]; then
    printf 'auth-production-readonly: unexpected status for %s\n' "$path" >&2
    exit 1
  fi
  printf '%s' "$observed"
}

# route-manifest 3분류를 익명 관측으로 확인한다.
#   PUBLIC           health      200
#   OPTIONAL_SESSION auth/session 200 (익명도 표현을 받는다)
#   PROTECTED        users/me/profile  401 (기본 거부가 살아 있다)
health_status=$(require_status '/api/v1/health' 200)
session_status=$(require_status '/api/v1/auth/session' 200)
protected_status=$(require_status '/api/v1/users/me/profile' 401)

# 집계는 서버 로컬 신뢰 경로로만 읽는다. 행 값은 출력되지 않는다.
"${compose[@]}" exec -T postgres psql -Atq -c '
SELECT json_build_object(
  '\''version'\'', '\''20260823-auth-production-readonly-v1'\'',
  '\''aggregate'\'', json_build_object(
    '\''totalUsers'\'', (SELECT count(*) FROM "User"),
    '\''totalProfiles'\'', (SELECT count(*) FROM "UserProfile"),
    '\''memberKinds'\'', json_build_object(
      '\''STUDENT'\'', (SELECT count(*) FROM "UserProfile" WHERE "memberKind" = '\''STUDENT'\''),
      '\''STAFF'\'', (SELECT count(*) FROM "UserProfile" WHERE "memberKind" = '\''STAFF'\''),
      '\''NULL'\'', (SELECT count(*) FROM "UserProfile" WHERE "memberKind" IS NULL)
    ),
    '\''usersWithStaffAccess'\'', (SELECT count(*) FROM "User" WHERE "hasStaffAccess"),
    '\''usersWithAdminAccess'\'', (SELECT count(*) FROM "User" WHERE "hasAdminAccess"),
    '\''staffAccessRequests'\'', json_build_object(
      '\''PENDING'\'', (SELECT count(*) FROM "StaffAccessRequest" WHERE status = '\''PENDING'\''),
      '\''APPROVED'\'', (SELECT count(*) FROM "StaffAccessRequest" WHERE status = '\''APPROVED'\''),
      '\''REJECTED'\'', (SELECT count(*) FROM "StaffAccessRequest" WHERE status = '\''REJECTED'\''),
      '\''REVOKED'\'', (SELECT count(*) FROM "StaffAccessRequest" WHERE status = '\''REVOKED'\'')
    ),
    '\''blankNames'\'', (SELECT count(*) FROM "UserProfile" WHERE btrim("name") = '\''''\'')
  )
);' >"$aggregate_path"

observed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if ! node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auth-production-readonly-report.mjs" \
  "$mode" "$tag" "$sha" "$output_json" \
  "$frontend_image_id" "$backend_image_id" "$aggregate_path" \
  "$observed_at" "$MIN_OBSERVATION_SECONDS" \
  "$health_status" "$session_status" "$protected_status" \
  "$start_json"; then
  printf 'auth-production-readonly: %s gate failed\n' "$mode" >&2
  exit 1
fi

printf 'auth-production-readonly: %s ok\n' "$mode"
