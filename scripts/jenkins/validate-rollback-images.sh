#!/usr/bin/env bash
set -euo pipefail

input_error() {
  printf 'rollback_input: PREV_TAG, PREV_SHA, and PREV_BE_IMAGE_ID must be non-empty\n' >&2
  exit 2
}

if (($# != 0)); then
  printf 'rollback_input: arguments are not accepted\n' >&2
  exit 2
fi

if [[ -z "${PREV_TAG:-}" || -z "${PREV_SHA:-}" || -z "${PREV_BE_IMAGE_ID:-}" ]]; then
  input_error
fi

backend_image="oss-hub-backend:${PREV_TAG}"

require_image() {
  local image=$1

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    printf 'rollback_image: rollback image lookup failed\n' >&2
    exit 1
  fi
}

read_image_metadata() {
  local format=$1
  local image=$2
  local value

  if ! value="$(docker image inspect --format "$format" "$image")"; then
    printf 'rollback_image: rollback image metadata lookup failed\n' >&2
    exit 1
  fi

  printf '%s' "$value"
}

require_image "$backend_image"

be_ver="$(read_image_metadata '{{index .Config.Labels "org.opencontainers.image.version"}}' "$backend_image")"
be_rev="$(read_image_metadata '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$backend_image")"
be_id="$(read_image_metadata '{{.Id}}' "$backend_image")"

if [[ -z "$be_id" ]]; then
  printf 'rollback_id: rollback image ID is missing\n' >&2
  exit 1
fi

if [[ "$be_id" != "$PREV_BE_IMAGE_ID" ]]; then
  printf 'rollback_id: rollback image ID does not match the captured running container\n' >&2
  exit 1
fi

if [[ -z "$be_ver" || -z "$be_rev" ]]; then
  printf 'rollback_label: rollback OCI labels are incomplete\n' >&2
  exit 1
fi

if [[ "$be_ver" != "$PREV_TAG" || "$be_rev" != "$PREV_SHA" ]]; then
  printf 'rollback_label: rollback OCI labels do not match the previous deployment identity\n' >&2
  exit 1
fi

printf 'ROLLBACK_PREFLIGHT=ok\n'
