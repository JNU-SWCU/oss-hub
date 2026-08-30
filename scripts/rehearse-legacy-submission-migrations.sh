#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

readonly MODES=(
  'fresh'
  'upgrade'
  'bridge-success'
  'bridge-replay-sql'
  'collision-fails'
  'prelive-cleanup-rollback'
  'forward-repair'
  'catch-up'
  'contract-negative'
  'contract-success'
  'restore-db-and-objects'
)

fixture_root=''
compose_file=''
project_name="legacy-submission-rehearsal-$$-${RANDOM}"
resources_initialized=0
result_emitted=0

fixture_compose() {
  docker compose -p "$project_name" -f "$compose_file" "$@"
}

cleanup() {
  local cleanup_status=0

  if [[ $resources_initialized -eq 1 ]]; then
    fixture_compose down --volumes --remove-orphans >/dev/null 2>&1 || cleanup_status=1
  fi
  if [[ -n $fixture_root ]]; then
    rm -rf "$fixture_root" >/dev/null 2>&1 || cleanup_status=1
  fi

  return "$cleanup_status"
}

on_exit() {
  local status=$?
  trap - EXIT
  cleanup || true
  if [[ $result_emitted -eq 0 ]]; then
    printf 'METRIC unexpected_failure=1\n'
    printf 'RESULT FAIL\n'
    status=1
  fi
  exit "$status"
}

emit_setup_error() {
  local category=$1
  result_emitted=1
  printf 'METRIC %s=1\n' "$category"
  printf 'RESULT SETUP_ERROR\n'
  exit 2
}

emit_gate_failure() {
  local category=$1
  result_emitted=1
  printf 'METRIC %s=1\n' "$category"
  printf 'RESULT FAIL\n'
  exit 1
}

mode_is_valid() {
  local candidate=$1
  local known_mode
  for known_mode in "${MODES[@]}"; do
    if [[ $candidate == "$known_mode" ]]; then
      return 0
    fi
  done
  return 1
}

migration_path_is_valid() {
  local directory=$1
  [[ -d $directory && -f $directory/migration.sql ]]
}

validate_future_migrations() {
  local scenario=$1
  local needs_expand=0
  local needs_bridge=0
  local needs_contract=0

  case "$scenario" in
    fresh | upgrade)
      ;;
    bridge-success | bridge-replay-sql | collision-fails | prelive-cleanup-rollback | forward-repair | catch-up)
      needs_expand=1
      needs_bridge=1
      ;;
    contract-negative | contract-success | restore-db-and-objects)
      needs_expand=1
      needs_bridge=1
      needs_contract=1
      ;;
  esac

  if [[ $needs_expand -eq 1 ]] &&
    ! migration_path_is_valid "${LEGACY_SUBMISSION_EXPAND_MIGRATION:-}"; then
    emit_setup_error setup_missing_migration
  fi
  if [[ $needs_bridge -eq 1 ]] &&
    ! migration_path_is_valid "${LEGACY_SUBMISSION_BRIDGE_MIGRATION:-}"; then
    emit_setup_error setup_missing_migration
  fi
  if [[ $needs_contract -eq 1 ]] &&
    ! migration_path_is_valid "${LEGACY_SUBMISSION_CONTRACT_MIGRATION:-}"; then
    emit_setup_error setup_missing_migration
  fi
}

require_real_prerequisites() {
  local repo_root=$1
  local docker_context
  local docker_endpoint

  command -v docker >/dev/null 2>&1 || emit_setup_error setup_missing_prerequisite
  [[ -z ${DOCKER_HOST:-} ]] || emit_setup_error setup_nonlocal_docker
  if ! docker_context=$(docker context show 2>/dev/null) ||
    ! docker_endpoint=$(docker context inspect "$docker_context" \
      --format '{{.Endpoints.docker.Host}}' 2>/dev/null); then
    emit_setup_error setup_docker_unavailable
  fi
  case "$docker_endpoint" in
    unix://* | npipe://*) ;;
    *) emit_setup_error setup_nonlocal_docker ;;
  esac
  docker compose version >/dev/null 2>&1 || emit_setup_error setup_missing_prerequisite
  command -v node >/dev/null 2>&1 || emit_setup_error setup_missing_prerequisite
  [[ -f $repo_root/package.json ]] || emit_setup_error setup_missing_repository_file
  [[ -f $repo_root/pnpm-lock.yaml ]] || emit_setup_error setup_missing_repository_file
  [[ -f $repo_root/pnpm-workspace.yaml ]] || emit_setup_error setup_missing_repository_file
  [[ -f $repo_root/apps/backend/package.json ]] || emit_setup_error setup_missing_repository_file
  [[ -f $repo_root/apps/backend/prisma/schema.prisma ]] || emit_setup_error setup_missing_repository_file
  [[ -d $repo_root/apps/backend/prisma/migrations ]] || emit_setup_error setup_missing_repository_file
  docker info >/dev/null 2>&1 || emit_setup_error setup_docker_unavailable
}

apply_migration() {
  local migration=$1
  fixture_compose exec -T postgres \
    psql --username migration --dbname legacy_submission --set ON_ERROR_STOP=1 \
    >/dev/null 2>&1 <"$migration"
}

if [[ $# -ne 2 || ${1:-} != '--mode' ]] || ! mode_is_valid "${2:-}"; then
  result_emitted=1
  printf 'METRIC argument_invalid=1\n'
  printf 'RESULT SETUP_ERROR\n'
  exit 2
fi
readonly mode=$2

if ! fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/legacy-submission-rehearsal.XXXXXX" 2>/dev/null); then
  emit_setup_error setup_temp_workspace
fi
compose_file="$fixture_root/compose.yml"
trap on_exit EXIT

validate_future_migrations "$mode"

if [[ ${LEGACY_SUBMISSION_REHEARSAL_DRY_RUN:-0} == '1' ]]; then
  if ! cleanup; then
    emit_gate_failure cleanup_failed
  fi
  fixture_root=''
  trap - EXIT
  result_emitted=1
  printf 'METRIC mode_validated=1\n'
  printf 'RESULT PASS\n'
  exit 0
fi

if [[ $mode != 'fresh' && $mode != 'upgrade' ]]; then
  emit_setup_error setup_missing_fixture_contract
fi

if ! repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd); then
  emit_setup_error setup_missing_repository_file
fi
readonly repo_root
require_real_prerequisites "$repo_root"

if ! cat >"$compose_file" 2>/dev/null <<'YAML'
services:
  postgres:
    image: postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
    environment:
      POSTGRES_USER: migration
      POSTGRES_PASSWORD: synthetic-rehearsal-password
      POSTGRES_DB: legacy_submission
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U migration -d legacy_submission']
      interval: 1s
      timeout: 3s
      retries: 30
YAML
then
  emit_setup_error setup_temp_workspace
fi

resources_initialized=1
if ! fixture_compose up -d --wait --wait-timeout 60 >/dev/null 2>&1; then
  emit_setup_error setup_database_unavailable
fi

shopt -s nullglob
migrations=("$repo_root"/apps/backend/prisma/migrations/*/migration.sql)
shopt -u nullglob
if [[ ${#migrations[@]} -eq 0 ]]; then
  emit_setup_error setup_missing_repository_file
fi

applied=0
if [[ $mode == 'upgrade' ]]; then
  if [[ ${#migrations[@]} -lt 2 ]]; then
    emit_setup_error setup_insufficient_upgrade_history
  fi
  final_index=$((${#migrations[@]} - 1))
  for ((index = 0; index < final_index; index += 1)); do
    if ! apply_migration "${migrations[$index]}"; then
      emit_gate_failure migration_apply_failed
    fi
    applied=$((applied + 1))
  done
  if ! apply_migration "${migrations[$final_index]}"; then
    emit_gate_failure migration_apply_failed
  fi
  applied=$((applied + 1))
else
  for migration in "${migrations[@]}"; do
    if ! apply_migration "$migration"; then
      emit_gate_failure migration_apply_failed
    fi
    applied=$((applied + 1))
  done
fi

if ! cleanup; then
  emit_gate_failure cleanup_failed
fi
fixture_root=''
resources_initialized=0
trap - EXIT
result_emitted=1
printf 'METRIC mode_validated=1\n'
printf 'METRIC migrations_applied=%d\n' "$applied"
printf 'RESULT PASS\n'
