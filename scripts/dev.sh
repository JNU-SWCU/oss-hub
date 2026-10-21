#!/usr/bin/env bash

set -euo pipefail
set -m

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FRONTEND_PORT=3000
BACKEND_PORT=4000

REQUIRED_ENV_KEYS=(
  DATABASE_URL
  SESSION_SECRET
  TEAM_JOIN_CODE_SECRET
  FRONTEND_URL
  GITHUB_OAUTH_CLIENT_ID
  GITHUB_OAUTH_CLIENT_SECRET
)

log() { printf 'dev: %s\n' "$1"; }
fail() {
  printf 'dev: %s\n' "$1" >&2
  exit 1
}

check_required_env() {
  local missing=()
  local key
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if [ -z "${!key:-}" ]; then
      missing+=("$key")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'dev: 다음 env가 비어 있어 시작할 수 없습니다: %s\n' "${missing[*]}" >&2
    cat >&2 <<'GUIDE'
dev: .envrc.example을 .envrc로 복사하고 "직접 채운다" 항목을 채운 뒤 direnv allow를 실행하세요.
dev:   cp .envrc.example .envrc && direnv allow
dev: 자세한 절차는 scripts/dev.sh와 compose.dev.yml를 따릅니다.
GUIDE
    exit 1
  fi
  local checked_count=${#REQUIRED_ENV_KEYS[@]}
  log "필수 env ${checked_count}개 확인 (값은 출력하지 않습니다)"
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

preflight_ports() {
  local occupied=()
  local port
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    if port_in_use "$port"; then
      occupied+=("$port")
    fi
  done
  if [ "${#occupied[@]}" -gt 0 ]; then
    printf 'dev: 포트가 이미 사용 중입니다: %s\n' "${occupied[*]}" >&2
    cat >&2 <<'GUIDE'
dev: 그 포트를 쓰는 프로세스를 종료한 뒤 다시 시도하세요:
dev:   lsof -nP -iTCP:<포트> -sTCP:LISTEN
GUIDE
    exit 1
  fi
  log "포트 ${FRONTEND_PORT}, ${BACKEND_PORT} 사용 가능"
}

start_infrastructure() {
  log '인프라 기동 (postgres·object-storage) — 멱등'
  pnpm db:up
}

apply_migrations() {
  log '마이그레이션 적용 (prisma migrate deploy)'
  pnpm --filter backend exec prisma migrate deploy
}

WATCHER_PIDS=()

cleanup() {
  trap - INT TERM EXIT
  [ "${#WATCHER_PIDS[@]}" -gt 0 ] || return 0
  local pid
  for pid in "${WATCHER_PIDS[@]}"; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

start_watchers() {
  log 'backend watcher 시작 (nest start --watch)'
  PORT="$BACKEND_PORT" pnpm --filter backend dev &
  WATCHER_PIDS+=("$!")

  log 'frontend watcher 시작 (next dev)'
  PORT="$FRONTEND_PORT" pnpm --filter frontend dev &
  WATCHER_PIDS+=("$!")

  log "backend http://localhost:$BACKEND_PORT · frontend http://localhost:$FRONTEND_PORT — 종료는 Ctrl+C"
}

wait_until_any_watcher_exits() {
  local pid
  while :; do
    for pid in "${WATCHER_PIDS[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        fail 'watcher 한쪽이 종료됐습니다. 나머지 watcher도 함께 내립니다.'
      fi
    done
    sleep 1
  done
}

main() {
  check_required_env
  preflight_ports
  start_infrastructure
  apply_migrations

  trap cleanup INT TERM EXIT
  start_watchers
  wait_until_any_watcher_exits
}

main "$@"
