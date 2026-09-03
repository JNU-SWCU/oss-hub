#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/_compose-lib.sh
source "$repo_root/scripts/_compose-lib.sh"

# compose.yml requires IMAGE_TAG for production interpolation. Local compose.local.yml
# !reset nulls the image keys, so this value is interpolation-only and never selected.
readonly LOCAL_IMAGE_TAG_PLACEHOLDER='__local_compose_interpolation_only__'

PERSISTENT_STACK=0
INITIAL_WAIT_TIMEOUT=120
MINIO_WAIT_TIMEOUT=60

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  local cleanup_status=0
  # 지속형 스택(up)은 성공·실패 모두 named volume을 보존한다.
  # 일회성 verify와 명시적 down만 볼륨을 지운다.
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]] && ((PERSISTENT_STACK == 0)); then
    if "${COMPOSE_ARGV[@]}" down -v --remove-orphans >/dev/null 2>&1; then
      :
    else
      cleanup_status=$?
      echo 'local Docker verify: 임시 Docker 자원 정리에 실패했습니다.' >&2
    fi
  fi
  verify_lock_release || cleanup_status=1
  if ((status == 0 && cleanup_status != 0)); then
    status=$cleanup_status
  fi
  exit "$status"
}

run_step() {
  local description=$1
  shift
  if ! "$@"; then
    printf 'local Docker verify: failed at %s.\n' "$description" >&2
    exit 1
  fi
}

main() {
  local command=${1:-}
  case "$command" in
    up|verify|down) ;;
    *) echo 'Usage: docker-verify-local.sh {up|verify|down}' >&2; exit 1 ;;
  esac

  # up은 지속형이라 고정 project name을 쓰고 성공 시 스택을 남긴다.
  # verify는 일회성이라 매 실행 고유 project name을 쓰고 끝나면 정리한다.
  if [[ "$command" == verify ]]; then
    PERSISTENT_STACK=0
    COMPOSE_PROJECT_NAME="oss-hub-local-$(date +%s)-$$-$RANDOM"
  else
    PERSISTENT_STACK=1
    COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-oss-hub-local}"
  fi
  export COMPOSE_PROJECT_NAME

  verify_lock_acquire
  trap cleanup EXIT INT TERM HUP
  # down은 스택을 내리는 명령이라 ingress 포트가 점유돼 있는 것이 정상이다. preflight를 건너뛴다.
  if [[ "$command" != down ]]; then
    run_step 'ingress port preflight' preflight_ingress_port
  fi

  # 호스트 쉘 env는 Compose의 --env-file보다 우선하므로, .env가 소유해야 할 값은 먼저 비운다.
  # scripts/run-backend-integration.sh와 동일한 방어다.
  # 호출자 IMAGE_TAG는 무시하고 로컬 전용 interpolation placeholder만 넣는다.
  # compose.local.yml이 backend·frontend image를 !reset 하므로 이 값은 선택되지 않는다.
  unset IMAGE_TAG
  unset DATABASE_URL FRONTEND_URL GITHUB_OAUTH_CALLBACK_URL
  unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  unset SUBMISSION_FILE_STORAGE_MODE SUBMISSION_FILE_S3_ENDPOINT SUBMISSION_FILE_S3_REGION
  unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
  unset SUBMISSION_FILE_S3_FORCE_PATH_STYLE AUTH_INITIAL_ROLES
  unset ROLLBACK_MINIO_ACCESS_KEY_ID ROLLBACK_MINIO_SECRET_ACCESS_KEY ROLLBACK_MINIO_BUCKET
  unset SESSION_SECRET TEAM_JOIN_CODE_SECRET
  unset MAIL_MODE GMAIL_SENDER GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET GMAIL_OAUTH_REFRESH_TOKEN
  unset GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET
  unset GITHUB_COLLECTION_APP_ID GITHUB_APP_ORG
  unset GITHUB_COLLECTION_APP_API_BASE_URL GITHUB_COLLECTION_APP_MAX_PAGES GITHUB_COLLECTION_APP_DEADLINE_MS
  unset GITHUB_OPERATIONS_APP_ID
  unset COLLECTION_CRON_EXPRESSION PORT

  export IMAGE_TAG="$LOCAL_IMAGE_TAG_PLACEHOLDER"
  export SUBMISSION_FILE_STORAGE_MODE=minio
  export SUBMISSION_FILE_S3_ENDPOINT=http://minio:9000
  export SUBMISSION_FILE_S3_REGION=us-east-1
  export SUBMISSION_FILE_S3_ACCESS_KEY_ID=oss-hub-local
  export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY=oss-hub-local-synthetic-secret
  export SUBMISSION_FILE_S3_BUCKET="submission-files-$RANDOM-$$"
  export SUBMISSION_FILE_S3_FORCE_PATH_STYLE=true
  export ROLLBACK_MINIO_ACCESS_KEY_ID="$SUBMISSION_FILE_S3_ACCESS_KEY_ID"
  export ROLLBACK_MINIO_SECRET_ACCESS_KEY="$SUBMISSION_FILE_S3_SECRET_ACCESS_KEY"
  export ROLLBACK_MINIO_BUCKET="$SUBMISSION_FILE_S3_BUCKET"
  export COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$repo_root/.env}"
  compose_argv

  if [[ "$command" == down ]]; then
    run_step 'Compose teardown' "${COMPOSE_ARGV[@]}" down -v --remove-orphans
    return 0
  fi

  run_step 'Compose startup' "${COMPOSE_ARGV[@]}" up --build -d --wait --wait-timeout "$INITIAL_WAIT_TIMEOUT"
  run_step 'Prisma migration' "${COMPOSE_ARGV[@]}" exec -T backend sh -eu -c 'npx prisma migrate deploy'
  if [[ "$command" == up ]]; then
    return 0
  fi
  run_step 'PostgreSQL smoke' db_smoke
  run_step 'HTTP smoke' http_smoke
  run_step 'MinIO smoke' minio_smoke
  run_step 'MinIO restart' "${COMPOSE_ARGV[@]}" restart minio-bucket
  run_step 'MinIO restart wait' "${COMPOSE_ARGV[@]}" up -d --wait --wait-timeout "$MINIO_WAIT_TIMEOUT"
  run_step 'MinIO restart smoke' minio_smoke
  run_step 'MinIO recreation' "${COMPOSE_ARGV[@]}" up -d --force-recreate --wait --wait-timeout "$MINIO_WAIT_TIMEOUT" minio-bucket
  run_step 'MinIO recreation smoke' minio_smoke
}

main "$@"
