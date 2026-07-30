#!/usr/bin/env bash
# 호스트 hot reload 개발 실행기 — `pnpm dev`의 구현.
#
# 인프라(postgres·minio)는 Docker가, 앱(backend·frontend)은 호스트 프로세스가 담당한다.
# env 원본은 direnv가 주입하는 `.envrc`다(compose 경로의 `.env`와 별개 — docs/rules/local-dev.md).
#
# 방어 순서: env 확인 → 포트 preflight → 인프라 기동 → 마이그레이션 → watcher 2개.
# 값은 어떤 단계에서도 출력하지 않는다. 키 이름만 보고한다.

set -euo pipefail
set -m # 각 watcher를 독립 process group으로 띄워 종료 시 자손까지 함께 정리한다.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FRONTEND_PORT=3000
BACKEND_PORT=4000

# `.envrc`가 소유해야 하는 키 중 backend 기동을 실제로 막는 것들.
# apps/backend/src/auth/auth.config.ts가 SESSION_SECRET·FRONTEND_URL·OAuth 2종을 기동 시점에
# 검증하고, TEAM_JOIN_CODE_SECRET·DATABASE_URL은 각 모듈이 요구한다. 여기서 먼저 걸러
# nest가 스택트레이스로 죽는 대신 무엇을 채워야 하는지 알려준다.
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
    # 값은 읽지도, 출력하지도 않는다. 비어 있는지만 본다.
    if [ -z "${!key:-}" ]; then
      missing+=("$key")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'dev: 다음 env가 비어 있어 시작할 수 없습니다: %s\n' "${missing[*]}" >&2
    cat >&2 <<'GUIDE'
dev: .envrc.example을 .envrc로 복사하고 "직접 채운다" 항목을 채운 뒤 direnv allow를 실행하세요.
dev:   cp .envrc.example .envrc && direnv allow
dev: 자세한 절차는 docs/rules/local-dev.md의 "두 실행 경로"를 따릅니다.
GUIDE
    exit 1
  fi
  local checked_count=${#REQUIRED_ENV_KEYS[@]}
  log "필수 env ${checked_count}개 확인 (값은 출력하지 않습니다)"
}

port_in_use() { # $1=port
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
dev: 컨테이너 경로(pnpm local:up)가 떠 있으면 같은 ingress 포트를 씁니다 — 동시 실행은 불가합니다.
dev: 그 스택을 내린 뒤 다시 시도하세요:
dev:   pnpm local:down
GUIDE
    exit 1
  fi
  log "포트 ${FRONTEND_PORT}, ${BACKEND_PORT} 사용 가능"
}

start_infrastructure() {
  log '인프라 기동 (postgres·minio) — 멱등'
  pnpm db:up
}

apply_migrations() {
  # 이미 있는 마이그레이션만 적용한다(비대화형·멱등). 새 마이그레이션 파일 생성은
  # pnpm db:migrate:dev의 몫이며 이 스크립트가 대신하지 않는다.
  log '마이그레이션 적용 (prisma migrate deploy)'
  pnpm --filter backend exec prisma migrate deploy
}

WATCHER_PIDS=()

cleanup() {
  trap - INT TERM EXIT
  # set -u 하에서 빈 배열 확장은 bash 3.2에서 오류다 — 개수를 먼저 확인한다.
  [ "${#WATCHER_PIDS[@]}" -gt 0 ] || return 0
  local pid
  for pid in "${WATCHER_PIDS[@]}"; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    # process group 우선 — pnpm이 띄운 자손(nest/next)까지 함께 내린다.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

start_watchers() {
  # pnpm -r 를 쓰지 않는다 — 대상을 명시해야 무관한 패키지가 끼어들지 않는다.
  log 'backend watcher 시작 (nest start --watch)'
  pnpm --filter backend dev &
  WATCHER_PIDS+=("$!")

  log 'frontend watcher 시작 (next dev)'
  pnpm --filter frontend dev &
  WATCHER_PIDS+=("$!")

  log "backend http://localhost:$BACKEND_PORT · frontend http://localhost:$FRONTEND_PORT — 종료는 Ctrl+C"
}

# `wait -n`을 쓰지 않는다: bash 4.3+ 전용이고 macOS 기본 bash는 3.2다.
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
