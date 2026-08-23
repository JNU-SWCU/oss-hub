#!/usr/bin/env bash
# Fail-closed greenfield host check. Called only when frontend/backend
# containers are both absent. Leftover SQL/object backups or compose
# named volumes mean this is not a first deploy.
# Genuine re-provision: set GREENFIELD_DEPLOY_ACK=1.
set -euo pipefail

fail_closed() {
  printf 'FAIL_CLOSED greenfield_host: %s\n' "$1" >&2
  exit 2
}

if (($# != 0)); then
  fail_closed '인자를 받지 않습니다.'
fi

if [[ -z "${BACKUP_DIR:-}" ]]; then
  fail_closed 'BACKUP_DIR 가 비어 있습니다.'
fi

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  fail_closed 'COMPOSE_PROJECT_NAME 가 비어 있습니다.'
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/greenfield-host-clean.XXXXXX")
trap 'rm -rf "$work"' EXIT

evidence=()

record_find_entries() {
  local kind=$1
  local inventory=$2
  local path base
  while IFS= read -r -d '' path; do
    base=$(basename -- "$path")
    evidence+=("${kind}${base})")
  done <"$inventory"
}

if [[ -e "$BACKUP_DIR" && ! -d "$BACKUP_DIR" ]]; then
  fail_closed 'BACKUP_DIR 가 디렉터리가 아닙니다.'
fi

if [[ -d "$BACKUP_DIR" ]]; then
  if ! find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql' -print0 >"$work/sql"; then
    fail_closed 'SQL 백업 흔적 조회에 실패했습니다.'
  fi
  record_find_entries 'SQL 백업(' "$work/sql"

  if [[ -d "$BACKUP_DIR/objects" ]]; then
    if ! find "$BACKUP_DIR/objects" -mindepth 1 -maxdepth 1 -print0 >"$work/objects"; then
      fail_closed '객체 백업 흔적 조회에 실패했습니다.'
    fi
    record_find_entries '객체 백업(objects/' "$work/objects"
  fi
fi

if ! docker volume ls -q --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
  >"$work/volumes"; then
  fail_closed 'compose 프로젝트 named volume 을 확인하지 못했습니다.'
fi

while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  evidence+=("named volume(${name})")
done <"$work/volumes"

if ((${#evidence[@]} == 0)); then
  exit 0
fi

joined=${evidence[0]}
i=1
while ((i < ${#evidence[@]})); do
  joined+=", ${evidence[i]}"
  i=$((i + 1))
done

if [[ "${GREENFIELD_DEPLOY_ACK:-}" == '1' ]]; then
  printf 'greenfield_host: GREENFIELD_DEPLOY_ACK=1 — 기존 배포 흔적을 확인하고 재프로비저닝을 계속합니다: %s\n' "$joined"
  exit 0
fi

fail_closed "기존 배포 흔적이 있어 최초 배포로 진행할 수 없습니다: ${joined}. 재프로비저닝이 맞다면 GREENFIELD_DEPLOY_ACK=1 을 설정하십시오."
