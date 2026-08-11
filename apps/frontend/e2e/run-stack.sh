#!/usr/bin/env bash

set -euo pipefail
set -m

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_directory/../../.." && pwd)"
compose_file="$repo_root/compose.dev.yml"
backend_directory="$repo_root/apps/backend"
frontend_directory="$repo_root/apps/frontend"
source "$script_directory/support/backend-env.sh"
source "$script_directory/support/stack-profile.sh"

stack_profile="$(e2e_stack_profile "${E2E_STACK_PROFILE:-full}")"

frontend_port="${E2E_FRONTEND_PORT:-3300}"
backend_port="${E2E_BACKEND_PORT:-4300}"
postgres_port="${E2E_POSTGRES_PORT:-0}"
postgres_database="${E2E_POSTGRES_DB:-oss_hub_e2e}"
project_name="${E2E_COMPOSE_PROJECT_NAME:-oss-hub-e2e-$$}"
session_secret="${E2E_SESSION_SECRET:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}"
frontend_origin="http://127.0.0.1:${frontend_port}"
backend_origin="http://127.0.0.1:${backend_port}"
tool_path="$backend_directory/node_modules/.bin:$frontend_directory/node_modules/.bin:$repo_root/node_modules/.bin:$(dirname "$(command -v node)"):/usr/bin:/bin"
sanitized_home="$(mktemp -d "${TMPDIR:-/tmp}/oss-hub-e2e-home.XXXXXX")"
backend_dist="$backend_directory/.e2e-dist-${project_name//[^A-Za-z0-9]/_}"
artifact_directory="${E2E_ARTIFACT_DIR:-$repo_root/.omo/artifacts/program-authoring-and-document-flow/12-e2e}"

export E2E_ARTIFACT_DIR="$artifact_directory"
export E2E_FROZEN_NOW="${E2E_FROZEN_NOW:-2026-08-20T00:00:00.000Z}"
export TZ="Asia/Seoul"
mkdir -p "$artifact_directory"

backend_pid=''
frontend_pid=''

compose() {
  POSTGRES_BIND_HOST=127.0.0.1 \
    POSTGRES_PORT="$postgres_port" \
    POSTGRES_DB="$postgres_database" \
    docker compose -p "$project_name" -f "$compose_file" "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$frontend_pid" ] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill -TERM -- "-$frontend_pid" 2>/dev/null || kill -TERM "$frontend_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ] && kill -0 "$backend_pid" 2>/dev/null; then
    kill -TERM -- "-$backend_pid" 2>/dev/null || kill -TERM "$backend_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$backend_dist"
  rm -rf "$sanitized_home"
  exit "$status"
}
trap cleanup EXIT INT TERM

run_deadline_digest() {
  (
    cd "$backend_directory"
    e2e_backend_tool_env \
      "$tool_path" \
      "$sanitized_home" \
      "$database_url" \
      node "$script_directory/support/seed-deadline-digest.mjs"
    e2e_backend_server_env \
      "$tool_path" \
      "$sanitized_home" \
      "$database_url" \
      "$session_secret" \
      "$frontend_origin" \
      "$backend_port" \
      ./node_modules/.bin/ts-node src/notifications/cli/send-deadline-digest.ts
  )
}

bash "$script_directory/support/backend-env.test.sh"

compose up -d --wait postgres
published_endpoint="$(compose port postgres 5432)"
published_endpoint="${published_endpoint%%$'\n'*}"
published_port="${published_endpoint##*:}"
if ! [[ "$published_port" =~ ^[0-9]+$ ]]; then
  printf 'frontend e2e: failed to resolve the isolated PostgreSQL port.\n' >&2
  exit 1
fi

database_url="postgresql://oss:oss-dev@127.0.0.1:${published_port}/${postgres_database}?schema=public"

# postgres 초기화 중의 임시 서버도 pg_isready를 통과해 healthcheck가 일찍 healthy가 된다.
# 연속 성공을 요구해 재시작으로 TCP가 끊기는 창에서 migrate·seed가 죽지 않게 한다.
attempt=0
ready_streak=0
until [ "$ready_streak" -ge 3 ]; do
  if compose exec -T -e PGPASSWORD=oss-dev postgres \
    psql -h 127.0.0.1 -p 5432 -U oss -d "$postgres_database" -c 'select 1' \
    >/dev/null 2>&1; then
    ready_streak=$((ready_streak + 1))
  else
    ready_streak=0
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    printf 'frontend e2e: PostgreSQL did not accept TCP connections in time.\n' >&2
    exit 1
  fi
  sleep 1
done

(
  cd "$backend_directory"
  e2e_backend_tool_env \
    "$tool_path" \
    "$sanitized_home" \
    "$database_url" \
    ./node_modules/.bin/prisma migrate deploy
  e2e_backend_tool_env \
    "$tool_path" \
    "$sanitized_home" \
    "$database_url" \
    SEED_PROFILE=auth \
    ./node_modules/.bin/prisma db seed
)

e2e_stack_profile_run_deadline_digest "$stack_profile" run_deadline_digest

(
  cd "$backend_directory"
  e2e_backend_tool_env \
    "$tool_path" \
    "$sanitized_home" \
    "$database_url" \
    ./node_modules/.bin/tsc \
    -p tsconfig.build.json \
    --outDir "$backend_dist" \
    --incremental false
)

(
  cd "$backend_directory"
  e2e_backend_server_env \
    "$tool_path" \
    "$sanitized_home" \
    "$database_url" \
    "$session_secret" \
    "$frontend_origin" \
    "$backend_port" \
    node "$backend_dist/src/main.js"
) &
backend_pid=$!

attempt=0
until curl --fail --silent "$backend_origin/api/v1/health" >/dev/null; do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    printf 'frontend e2e: backend exited before becoming ready.\n' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    printf 'frontend e2e: backend readiness timed out.\n' >&2
    exit 1
  fi
  sleep 1
done

node "$script_directory/support/assert-loopback-only.mjs" "$backend_port"

(
  cd "$frontend_directory"
  env -i \
    PATH="$tool_path" \
    HOME="$sanitized_home" \
    BACKEND_ORIGIN="$backend_origin" \
    ./node_modules/.bin/next dev \
      --hostname 127.0.0.1 --port "$frontend_port"
) &
frontend_pid=$!

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

printf 'frontend e2e: an application process exited unexpectedly.\n' >&2
exit 1
