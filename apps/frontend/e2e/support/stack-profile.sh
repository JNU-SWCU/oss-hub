#!/usr/bin/env bash

e2e_stack_profile() {
  case "${1:-full}" in
    full | deadline-digest | program-authoring)
      printf '%s\n' "${1:-full}"
      ;;
    *)
      printf 'frontend e2e: unknown stack profile: %s\n' "${1:-full}" >&2
      return 1
      ;;
  esac
}

e2e_stack_profile_run_deadline_digest() {
  local profile="$1"
  local command="$2"

  case "$profile" in
    full | deadline-digest)
      "$command"
      ;;
    program-authoring)
      ;;
    *)
      printf 'frontend e2e: unknown stack profile: %s\n' "$profile" >&2
      return 1
      ;;
  esac
}
