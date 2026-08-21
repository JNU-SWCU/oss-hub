#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project_name="oss-hub-prisma-concurrency-$(date +%s)-$$-$RANDOM"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/prisma-concurrency.XXXXXX")
compose_file="$fixture_root/compose.yml"
first_log="$fixture_root/deploy-first.log"
second_log="$fixture_root/deploy-second.log"

fixture_compose() {
  docker compose -p "$project_name" -f "$compose_file" "$@"
}

cleanup() {
  local status=$?
  trap - EXIT
  local cleanup_status=0
  fixture_compose down -v --remove-orphans >/dev/null 2>&1 || {
    cleanup_status=$?
    printf 'Prisma migration concurrency: disposable resource cleanup failed.\n' >&2
  }
  rm -rf "$fixture_root"
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

cat >"$compose_file" <<'YAML'
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: migration
      POSTGRES_PASSWORD: synthetic-migration-password
      POSTGRES_DB: migration_concurrency
    ports:
      - '127.0.0.1::5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U migration -d migration_concurrency']
      interval: 1s
      timeout: 3s
      retries: 30
YAML

fixture_compose up -d --wait --wait-timeout 60
published_endpoint=$(fixture_compose port postgres 5432 | head -n 1)
published_port=${published_endpoint##*:}
if ! [[ "$published_port" =~ ^[0-9]+$ ]]; then
  printf 'Prisma migration concurrency: PostgreSQL port unavailable.\n' >&2
  exit 1
fi

database_url="postgresql://migration:synthetic-migration-password@127.0.0.1:${published_port}/migration_concurrency?schema=public"
run_deploy() {
  DATABASE_URL="$database_url" pnpm --dir "$repo_root" --filter backend exec prisma migrate deploy
}

run_deploy >"$first_log" 2>&1 &
first_pid=$!
run_deploy >"$second_log" 2>&1 &
second_pid=$!

set +e
wait "$first_pid"
first_status=$?
wait "$second_pid"
second_status=$?
set -e
if [[ $first_status -ne 0 || $second_status -ne 0 ]]; then
  cat "$first_log" "$second_log" >&2
  printf 'Prisma migration concurrency: deploy failed (first=%s second=%s).\n' \
    "$first_status" "$second_status" >&2
  exit 1
fi

DATABASE_URL="$database_url" node "$repo_root/scripts/prisma-migration-ledger.mjs" \
  "$repo_root/apps/backend/prisma/migrations"
