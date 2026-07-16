#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_directory="$repo_root/apps/backend"
compose_file="$repo_root/compose.dev.yml"
project_name="oss-hub-test-$(date +%s)-$$-$RANDOM"

unset DATABASE_URL OSS_HUB_INTEGRATION_RUNNER

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

if ! [[ "$published_port" =~ ^[0-9]+$ ]]; then
  echo 'backend integration: PostgreSQL 임시 포트를 확인할 수 없습니다.' >&2
  exit 1
fi

integration_database_url="postgresql://oss:oss-dev@127.0.0.1:${published_port}/oss_hub_test?schema=public"

(
  cd "$backend_directory"
  OSS_HUB_INTEGRATION_RUNNER=oss-hub-isolated-integration-v1 \
    DATABASE_URL="$integration_database_url" \
    pnpm exec prisma migrate deploy
  OSS_HUB_INTEGRATION_RUNNER=oss-hub-isolated-integration-v1 \
    DATABASE_URL="$integration_database_url" \
    pnpm exec jest \
    --runInBand \
    --testPathPattern='\.integration\.spec\.ts$'
)
