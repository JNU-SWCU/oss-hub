#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_directory="$repo_root/apps/backend"
compose_file="$repo_root/compose.dev.yml"
project_name="oss-hub-test-$(date +%s)-$$-$RANDOM"
test_pattern="${BACKEND_INTEGRATION_TEST_PATTERN:-\.integration\.spec\.ts$}"

unset DATABASE_URL OSS_HUB_INTEGRATION_RUNNER TEAM_JOIN_CODE_SECRET
unset SUBMISSION_FILE_STORAGE_MODE SUBMISSION_FILE_S3_ENDPOINT SUBMISSION_FILE_S3_REGION
unset SUBMISSION_FILE_S3_BUCKET SUBMISSION_FILE_S3_ACCESS_KEY_ID
unset SUBMISSION_FILE_S3_SECRET_ACCESS_KEY SUBMISSION_FILE_S3_FORCE_PATH_STYLE
# 호출자 env의 역할 시드가 통합 테스트 결과를 오염시키지 않도록 격리한다.
unset AUTH_INITIAL_ROLES

export POSTGRES_BIND_HOST=127.0.0.1
export POSTGRES_PORT=0
export POSTGRES_DB=oss_hub_test
export MINIO_BIND_HOST=127.0.0.1
export MINIO_PORT=0
export MINIO_ROOT_USER="integration-$RANDOM-$$"
export MINIO_ROOT_PASSWORD="synthetic-$RANDOM-$RANDOM-$$"
export SUBMISSION_FILE_S3_BUCKET="submission-files-$RANDOM-$$"

cleanup() {
  status=$?
  trap - EXIT
  cleanup_status=0
  if POSTGRES_BIND_HOST=127.0.0.1 \
    POSTGRES_PORT=0 \
    POSTGRES_DB=oss_hub_test \
    docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    down -v --remove-orphans >/dev/null 2>&1; then
    :
  else
    cleanup_status=$?
    echo 'backend integration: 임시 Docker 자원 정리에 실패했습니다.' >&2
  fi
  if [ "$status" -eq 0 ] && [ "$cleanup_status" -ne 0 ]; then
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

POSTGRES_BIND_HOST=127.0.0.1 \
  POSTGRES_PORT=0 \
  POSTGRES_DB=oss_hub_test \
  docker compose \
  -p "$project_name" \
  -f "$compose_file" \
  up -d --wait

published_endpoint="$(
  POSTGRES_BIND_HOST=127.0.0.1 \
    POSTGRES_PORT=0 \
    POSTGRES_DB=oss_hub_test \
    docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    port postgres 5432 | sed -n '1p'
)"
published_port="${published_endpoint##*:}"

minio_endpoint="$(docker compose -p "$project_name" -f "$compose_file" port minio 9000)"
minio_endpoint="${minio_endpoint%%$'\n'*}"
minio_port="${minio_endpoint##*:}"

if ! [[ "$published_port" =~ ^[0-9]+$ ]]; then
  echo 'backend integration: PostgreSQL 임시 포트를 확인할 수 없습니다.' >&2
  exit 1
fi

if ! [[ "$minio_port" =~ ^[0-9]+$ ]]; then
  echo 'backend integration: MinIO 임시 포트를 확인할 수 없습니다.' >&2
  exit 1
fi

integration_database_url="postgresql://oss:oss-dev@127.0.0.1:${published_port}/oss_hub_test?schema=public"
integration_storage_endpoint="http://127.0.0.1:${minio_port}"

(
  cd "$backend_directory"
  OSS_HUB_INTEGRATION_RUNNER=oss-hub-isolated-integration-v1 \
    DATABASE_URL="$integration_database_url" \
    SUBMISSION_FILE_STORAGE_MODE=minio \
    SUBMISSION_FILE_S3_ENDPOINT="$integration_storage_endpoint" \
    SUBMISSION_FILE_S3_REGION=us-east-1 \
    SUBMISSION_FILE_S3_BUCKET="$SUBMISSION_FILE_S3_BUCKET" \
    SUBMISSION_FILE_S3_ACCESS_KEY_ID="$MINIO_ROOT_USER" \
    SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
    SUBMISSION_FILE_S3_FORCE_PATH_STYLE=true \
    pnpm exec prisma migrate deploy
  OSS_HUB_INTEGRATION_RUNNER=oss-hub-isolated-integration-v1 \
    DATABASE_URL="$integration_database_url" \
    SUBMISSION_FILE_STORAGE_MODE=minio \
    SUBMISSION_FILE_S3_ENDPOINT="$integration_storage_endpoint" \
    SUBMISSION_FILE_S3_REGION=us-east-1 \
    SUBMISSION_FILE_S3_BUCKET="$SUBMISSION_FILE_S3_BUCKET" \
    SUBMISSION_FILE_S3_ACCESS_KEY_ID="$MINIO_ROOT_USER" \
    SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
    SUBMISSION_FILE_S3_FORCE_PATH_STYLE=true \
    TEAM_JOIN_CODE_SECRET=synthetic-integration-join-code-secret \
    pnpm exec jest \
    --runInBand \
    --testPathPattern="$test_pattern"
)
