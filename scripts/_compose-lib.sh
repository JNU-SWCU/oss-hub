#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verify_lock_directory="${TMPDIR:-/tmp}/oss-hub-local-verify.lock"
VERIFY_LOCK_OWNER=''
COMPOSE_ARGV=()

compose_argv() {
  local project=${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}
  local env_file=${COMPOSE_ENV_FILE:-"$repo_root/.env"}

  COMPOSE_ARGV=(
    docker compose -p "$project" --env-file "$env_file"
    -f "$repo_root/compose.yml" -f "$repo_root/compose.local.yml"
  )
}

preflight_ingress_port() {
  # OAuth 콜백 origin이 기동 전에 고정되므로 ingress 포트는 임시 포트로 바꿀 수 없다.
  local status
  set +e
  curl --silent --show-error --max-time 2 http://127.0.0.1:${LOCAL_INGRESS_PORT:-3000}/ >/dev/null
  status=$?
  set -e
  if ((status == 7)); then
    return 0
  fi
  printf 'local Docker verify: ingress port %s is already in use (curl exit=%s).\n' "${LOCAL_INGRESS_PORT:-3000}" "$status" >&2
  return 1
}

db_smoke() {
  "${COMPOSE_ARGV[@]}" exec -T postgres sh -eu -c 'psql -Atqc "SELECT 1" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | grep -Fx '1' >/dev/null
}

http_smoke() {
  curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:${LOCAL_INGRESS_PORT:-3000}/ >/dev/null
  curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:${LOCAL_INGRESS_PORT:-3000}/api/v1/health >/dev/null
}

minio_smoke() {
  "${COMPOSE_ARGV[@]}" exec -T minio-bucket sh -eu -c 'mc ls "local/$SUBMISSION_FILE_S3_BUCKET"' >/dev/null
}

verify_lock_release() {
  local owner_file="$verify_lock_directory/owner"
  [[ -n "$VERIFY_LOCK_OWNER" && -f "$owner_file" ]] || return 0
  if ! printf '%s' "$VERIFY_LOCK_OWNER" | cmp -s - "$owner_file"; then
    printf 'local Docker verify: lock owner changed; leaving lock in place.\n' >&2
    return 1
  fi
  rm -f "$owner_file"
  rmdir "$verify_lock_directory"
  VERIFY_LOCK_OWNER=''
}

verify_lock_acquire() {
  local owner_file stale_owner stale_pid
  VERIFY_LOCK_OWNER="$$ $(date +%s)"

  if ! mkdir "$verify_lock_directory" 2>/dev/null; then
    owner_file="$verify_lock_directory/owner"
    stale_owner=$(<"$owner_file") || {
      printf 'local Docker verify: another verification lock is active: %s\n' "$verify_lock_directory" >&2
      return 1
    }
    stale_pid=${stale_owner%% *}
    if [[ "$stale_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$stale_pid" 2>/dev/null; then
      if printf '%s' "$stale_owner" | cmp -s - "$owner_file"; then
        rm -f "$owner_file"
        rmdir "$verify_lock_directory" 2>/dev/null || true
      fi
      mkdir "$verify_lock_directory" 2>/dev/null || {
        printf 'local Docker verify: another verification lock is active: %s\n' "$verify_lock_directory" >&2
        return 1
      }
    else
      printf 'local Docker verify: another verification lock is active: %s\n' "$verify_lock_directory" >&2
      return 1
    fi
  fi
  printf '%s' "$VERIFY_LOCK_OWNER" >"$verify_lock_directory/owner"
  trap verify_lock_release EXIT INT TERM HUP
}
