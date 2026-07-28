#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

image_tag_from_env_file() {
  local env_file=$1 line value last=''
  [[ -f "$env_file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == '#' ]] && continue
    [[ "$line" =~ ^IMAGE_TAG[[:space:]]*=(.*)$ ]] || continue
    value=${BASH_REMATCH[1]}
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ "$value" =~ ^\"(.*)\"([[:space:]]*#.*)?[[:space:]]*$ ]] || [[ "$value" =~ ^\'(.*)\'([[:space:]]*#.*)?[[:space:]]*$ ]]; then
      value=${BASH_REMATCH[1]}
    else
      value=${value%%[[:space:]]*}
    fi
    last=$value
  done <"$env_file"
  [[ -n "$last" ]] || return 1
  printf '%s\n' "$last"
}

resolve_image_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    printf '%s\n' "$IMAGE_TAG"
    return 0
  fi
  image_tag_from_env_file "$repo_root/.env"
}

main() {
  local image_tag
  if ! image_tag=$(resolve_image_tag); then
    echo 'local Docker build: IMAGE_TAG 환경 변수 또는 .env의 IMAGE_TAG가 필요합니다.' >&2
    exit 1
  fi
  docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${image_tag}" "$repo_root"
  docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${image_tag}" "$repo_root"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
