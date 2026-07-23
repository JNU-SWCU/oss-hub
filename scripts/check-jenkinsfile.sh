#!/usr/bin/env bash
set -euo pipefail

jenkinsfile=${1:-Jenkinsfile}

if [[ ! -f "$jenkinsfile" ]]; then
  printf 'Jenkinsfile contract: file not found: %s\n' "$jenkinsfile" >&2
  exit 1
fi

active_jenkinsfile=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-active.XXXXXX")
docker_scan_file=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-docker-scan.XXXXXX")
trap 'rm -f "$active_jenkinsfile" "$docker_scan_file"' EXIT

# 주석에 계약 문자열을 남겨 검사를 우회하지 못하도록 실행 가능한 줄만 검사한다.
awk '
  in_block {
    if (/\*\//) in_block=0
    next
  }
  /^[[:space:]]*\/\*/ {
    if (!/\*\//) in_block=1
    next
  }
  /^[[:space:]]*(\/\/|#)/ { next }
  {
    sub(/[[:space:]]+\/\/.*/, "")
    sub(/[[:space:]]+#.*/, "")
    print
  }
' "$jenkinsfile" >"$active_jenkinsfile"

# shell에서 하나의 명령인 backslash-newline을 합쳐 우회된 build·volume 삭제도 검사한다.
awk '
  {
    line=$0
    if (continued != "") line=continued " " line
    if (line ~ /\\[[:space:]]*$/) {
      sub(/\\[[:space:]]*$/, "", line)
      continued=line
      next
    }
    print line
    continued=""
  }
  END {
    if (continued != "") print continued
  }
' "$active_jenkinsfile" >"$docker_scan_file"

count_fixed() {
  local pattern=$1
  { grep -F "$pattern" "$active_jenkinsfile" || true; } | wc -l | tr -d ' '
}

require_exact() {
  local description=$1
  local pattern=$2
  local expected=$3
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual != expected)); then
    printf 'Jenkinsfile contract: %s (expected=%s, actual=%s)\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

require_at_least() {
  local description=$1
  local pattern=$2
  local minimum=$3
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual < minimum)); then
    printf 'Jenkinsfile contract: %s (minimum=%s, actual=%s)\n' "$description" "$minimum" "$actual" >&2
    exit 1
  fi
}

line_of() {
  local pattern=$1
  grep -nF "$pattern" "$active_jenkinsfile" | head -n 1 | cut -d: -f1
}

require_exact '동시 실행 차단은 한 번이어야 함' 'disableConcurrentBuilds()' 1
require_exact '기본 checkout 차단은 한 번이어야 함' 'skipDefaultCheckout(true)' 1
require_exact 'Docker 권한은 전용 production executor에서만 사용해야 함' "label 'oss-hub-production'" 1
require_exact 'Release action 입력은 한 번이어야 함' "string(name: 'RELEASE_ACTION'" 1
require_exact 'Release tag 입력은 한 번이어야 함' "string(name: 'RELEASE_TAG'" 1
require_exact '빈 Release 입력은 main 검증으로만 분류해야 함' "env.RUN_MODE = 'main'" 1
require_exact '유효 Release만 배포로 분류해야 함' "env.RUN_MODE = 'release'" 1
require_exact 'created action 허용은 한 번이어야 함' "action == 'created'" 1
require_exact 'published action 허용은 한 번이어야 함' "action == 'published'" 1
require_exact 'full SemVer tag 검증은 한 번이어야 함' 'tag ==~ /' 1
require_exact 'latest Release API 검증은 한 번이어야 함' '/releases/latest' 1
require_exact 'draft 거절은 한 번이어야 함' "jq -r '.draft'" 1
require_exact 'prerelease 거절은 한 번이어야 함' "jq -r '.prerelease'" 1
require_exact 'latest tag 일치는 한 번이어야 함' "jq -r '.tag_name'" 1
require_exact 'Release tag의 commit 해석은 한 번이어야 함' 'git rev-parse "${RELEASE_TAG}^{commit}"' 1
require_exact 'main ancestry 검증은 한 번이어야 함' 'git merge-base --is-ancestor "$release_sha" origin/main' 1
require_exact 'exact SHA IMAGE_TAG 할당은 한 번이어야 함' 'env.IMAGE_TAG = releaseSha' 1
require_exact 'exact SHA checkout은 한 번이어야 함' 'git checkout --detach "$IMAGE_TAG"' 1

require_exact '영속 배포 상태 파일은 고정 경로여야 함' "DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'" 1
require_exact '동일·하위 버전 비교는 한 번이어야 함' 'sort -V' 1
require_exact '동일 Release tag의 SHA 변경은 차단해야 함' 'env.RELEASE_TAG == currentTag && env.IMAGE_TAG != env.CURRENT_DEPLOY_SHA' 1
require_at_least 'Release 배포 stage는 no-op을 건너뛰어야 함' "env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true'" 7
require_at_least '운영 환경은 Jenkins file credential로 주입해야 함' "credentialsId: 'oss-hub-production-env'" 1

require_exact '의존성 설치는 한 번이어야 함' 'pnpm install --frozen-lockfile' 1
require_exact 'test는 한 번이어야 함' 'pnpm test' 1
require_exact 'DB backup은 한 번이어야 함' 'pg_dump' 1
require_exact 'frontend 이미지는 한 번만 빌드해야 함' 'docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .' 1
require_exact 'backend 이미지는 한 번만 빌드해야 함' 'docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${IMAGE_TAG}" .' 1
require_exact '중지된 기존 container도 rollback 기준에 포함해야 함' 'docker compose --env-file "$OSS_HUB_ENV_FILE" ps --all -q' 2
require_exact 'migration은 한 번이어야 함' 'npx prisma migrate deploy' 1
require_exact 'primary·rollback은 기존 이미지만 사용해야 함' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 2
require_exact 'backend smoke는 primary·rollback에 있어야 함' 'http://127.0.0.1/api/v1/health' 2
require_exact 'rollback은 이전 정상 이미지가 있을 때만 실행해야 함' 'if (env.PREV_TAG?.trim())' 1
require_exact '정상 상태는 한 번만 원자 갱신해야 함' 'mv "$state_tmp" "$DEPLOY_STATE_FILE"' 1

frontend_smoke_count=$(grep -Ec 'http://127\.0\.0\.1/[[:space:]]*$' "$active_jenkinsfile" || true)
if ((frontend_smoke_count != 2)); then
  printf 'Jenkinsfile contract: frontend smoke는 primary·rollback에 있어야 함 (expected=2, actual=%s)\n' "$frontend_smoke_count" >&2
  exit 1
fi

image_tag_assignment_count=$(grep -Ec 'env\.IMAGE_TAG[[:space:]]*=' "$active_jenkinsfile" || true)
if ((image_tag_assignment_count != 1)) ||
   grep -Eq 'env\[['\''"]IMAGE_TAG['\''"][[:space:]]*\][[:space:]]*=' "$active_jenkinsfile" ||
   grep -Eq 'env\."IMAGE_TAG"[[:space:]]*=' "$active_jenkinsfile" ||
   grep -Eq 'export[[:space:]]+IMAGE_TAG=' "$active_jenkinsfile" ||
   grep -Eq '^[[:space:]]*(export[[:space:]]+)?IMAGE_TAG=' "$active_jenkinsfile"; then
  echo 'Jenkinsfile contract: IMAGE_TAG는 검증된 Release SHA로 한 번만 할당해야 함' >&2
  exit 1
fi
if grep -Fq "branch 'main'" "$active_jenkinsfile"; then
  echo 'Jenkinsfile contract: main은 검증 전용이며 production branch 배포 guard를 둘 수 없음' >&2
  exit 1
fi
if grep -Eq 'docker[[:space:]]+compose.*[[:space:]]down.*[[:space:]](-v|--volumes)([^[:alnum:]_-]|$)' "$docker_scan_file"; then
  echo 'Jenkinsfile contract: docker compose down -v/--volumes is prohibited' >&2
  exit 1
fi
if grep -Eq 'docker[[:space:]]+compose.*([[:space:]]build|[[:space:]]--build)([^[:alnum:]_-]|$)' "$docker_scan_file"; then
  echo 'Jenkinsfile contract: Compose may not rebuild production images' >&2
  exit 1
fi

docker_build_count=$(grep -Ec 'docker[[:space:]]+((image|buildx)[[:space:]]+)?build([[:space:]]|$)' "$docker_scan_file" || true)
if ((docker_build_count != 2)); then
  printf 'Jenkinsfile contract: canonical frontend/backend 외 image build는 금지됨 (actual=%s)\n' "$docker_build_count" >&2
  exit 1
fi

test_line=$(line_of 'pnpm test')
backup_line=$(line_of 'pg_dump')
frontend_build_line=$(line_of 'docker build --file apps/frontend/Dockerfile')
backend_build_line=$(line_of 'docker build --file apps/backend/Dockerfile')
migration_line=$(line_of 'npx prisma migrate deploy')
rollout_line=$(line_of 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait')
state_line=$(line_of 'mv "$state_tmp" "$DEPLOY_STATE_FILE"')

if ! ((test_line < backup_line &&
       backup_line < frontend_build_line &&
       frontend_build_line < backend_build_line &&
       backend_build_line < migration_line &&
       migration_line < rollout_line &&
       rollout_line < state_line)); then
  echo 'Jenkinsfile contract: required order is test -> backup -> image build -> migration -> rollout/smoke -> state update' >&2
  exit 1
fi

echo 'Jenkinsfile contract: ok (main validation only, Release exact-SHA deploy, durable no-op/backup/rollback)'
