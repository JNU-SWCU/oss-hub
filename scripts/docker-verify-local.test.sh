#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
verifier="$repo_root/scripts/docker-verify-local.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/docker-verify-local.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin" "$fixture_dir/tmp"
log_file="$fixture_dir/docker.argv"
readonly LOCAL_IMAGE_TAG_PLACEHOLDER='__local_compose_interpolation_only__'

cat >"$fixture_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'IMAGE_TAG=%q ' "${IMAGE_TAG-<unset>}" >>"$DOCKER_STUB_LOG"
printf '%q ' "$@" >>"$DOCKER_STUB_LOG"
printf '\n' >>"$DOCKER_STUB_LOG"
for argument in "$@"; do
  [[ "$argument" == postgres ]] && { printf '1\n'; break; }
done
exit 0
EOF
cat >"$fixture_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
for argument in "$@"; do
  [[ "$argument" == --max-time ]] && exit 7
done
exit 0
EOF
chmod +x "$fixture_dir/bin/docker" "$fixture_dir/bin/curl"

PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" IMAGE_TAG=should-not-leak "$verifier" verify

up_log_file="$fixture_dir/docker.up.argv"
PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$up_log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" "$verifier" up

# 지속형 up 실패 시 named volume 보존 fixture
failed_up_log_file="$fixture_dir/docker.failed-up.argv"
cat >"$fixture_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'IMAGE_TAG=%q ' "${IMAGE_TAG-<unset>}" >>"$DOCKER_STUB_LOG"
printf '%q ' "$@" >>"$DOCKER_STUB_LOG"
printf '\n' >>"$DOCKER_STUB_LOG"
for argument in "$@"; do
  if [[ "$argument" == up ]]; then
    exit 1
  fi
done
exit 0
EOF
chmod +x "$fixture_dir/bin/docker"
set +e
PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$failed_up_log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" "$verifier" up
failed_up_status=$?
set -e

# restore success docker stub for any later helpers that shell out
cat >"$fixture_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'IMAGE_TAG=%q ' "${IMAGE_TAG-<unset>}" >>"$DOCKER_STUB_LOG"
printf '%q ' "$@" >>"$DOCKER_STUB_LOG"
printf '\n' >>"$DOCKER_STUB_LOG"
for argument in "$@"; do
  [[ "$argument" == postgres ]] && { printf '1\n'; break; }
done
exit 0
EOF
chmod +x "$fixture_dir/bin/docker"
down_log_file="$fixture_dir/docker.down.argv"
PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$down_log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" "$verifier" down

passed=0
failed=0
expect_true() {
  local name=$1
  shift
  if "$@"; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    failed=$((failed + 1))
  fi
}
all_compose_calls_include_contract() {
  local line
  while IFS= read -r line; do
    [[ "$line" == *'compose '* && "$line" == *'--env-file '* && "$line" == *'compose.yml '* && "$line" == *'compose.local.yml '* ]] || return 1
    [[ "$line" != *'compose.dev.yml '* ]] || return 1
  done <"$log_file"
}
compose_uses_exactly_two_files() {
  local line file_count
  while IFS= read -r line; do
    [[ "$line" == *'compose '* ]] || continue
    file_count=$(printf '%s\n' "$line" | grep -o -- ' -f ' | wc -l | tr -d ' ')
    [[ "$file_count" == '2' ]] || return 1
    [[ "$line" == *'compose.yml '* && "$line" == *'compose.local.yml '* ]] || return 1
    [[ "$line" != *'compose.dev.yml'* ]] || return 1
  done <"$log_file"
}
verifier_uses_synthetic_image_tag_not_caller() {
  ! grep -Fq 'IMAGE_TAG=should-not-leak ' "$log_file" &&
    ! grep -Fq 'IMAGE_TAG=\<unset\> ' "$log_file" &&
    grep -Fq "IMAGE_TAG=${LOCAL_IMAGE_TAG_PLACEHOLDER} " "$log_file" &&
    grep -Fq "IMAGE_TAG=${LOCAL_IMAGE_TAG_PLACEHOLDER} " "$up_log_file"
}
wait_tokens_are_separate() {
  grep -Fq -- '--wait --wait-timeout 120' "$log_file" &&
    grep -Fq -- '--wait --wait-timeout 60' "$log_file" &&
    ! grep -Fq -- '--wait\ 120' "$log_file"
}
lock_released() {
  [[ ! -d "$fixture_dir/tmp/oss-hub-local-verify.lock" ]]
}
path_was_not_split() {
  grep -Fq -- 'local\ env' "$log_file"
}

up_keeps_stack_alive() {
  ! grep -Fq -- ' down ' "$up_log_file"
}
up_uses_stable_project_name() {
  grep -Fq -- ' -p oss-hub-local ' "$up_log_file"
}
explicit_down_uses_owned_contract() {
  local file_count
  file_count=$(grep -o -- ' -f ' "$down_log_file" | wc -l | tr -d ' ')
  [[ "$file_count" == '2' ]] &&
    grep -Fq -- 'compose -p oss-hub-local --env-file ' "$down_log_file" &&
    grep -Fq -- 'compose.yml ' "$down_log_file" &&
    grep -Fq -- 'compose.local.yml ' "$down_log_file" &&
    ! grep -Fq -- 'compose.dev.yml' "$down_log_file" &&
    grep -Fq -- ' down -v --remove-orphans' "$down_log_file" &&
    ! grep -Fq -- ' up ' "$down_log_file" &&
    ! grep -Fq -- ' exec ' "$down_log_file"
}
startup_forces_build() {
  grep -Fq -- ' up --build -d --wait --wait-timeout 120' "$log_file" &&
    grep -Fq -- ' up --build -d --wait --wait-timeout 120' "$up_log_file"
}
both_modes_run_migration() {
  grep -Fq -- ' exec -T backend sh -eu -c npx\ prisma\ migrate\ deploy' "$log_file" &&
    grep -Fq -- ' exec -T backend sh -eu -c npx\ prisma\ migrate\ deploy' "$up_log_file"
}
write_compose_env() {
  local env_file=$1
  cat >"$env_file" <<'EOF'
POSTGRES_USER=oss
POSTGRES_PASSWORD=oss-dev
POSTGRES_DB=oss_hub
DATABASE_URL=postgresql://oss:oss-dev@postgres:5432/oss_hub
SESSION_SECRET=local-session-secret-at-least-32-bytes-long
TEAM_JOIN_CODE_SECRET=local-join-code-secret-at-least-32b
FRONTEND_URL=http://localhost:3000
GITHUB_OAUTH_CLIENT_ID=local-oauth-client
GITHUB_OAUTH_CLIENT_SECRET=local-oauth-secret
GITHUB_COLLECTION_APP_ID=1
GITHUB_APP_ORG=local-org
GITHUB_COLLECTION_APP_PRIVATE_KEY=local-collection-key
GITHUB_OPERATIONS_APP_ID=2
GITHUB_OPERATIONS_APP_PRIVATE_KEY=local-operations-key
SUBMISSION_FILE_S3_ACCESS_KEY_ID=oss-hub-local
SUBMISSION_FILE_S3_SECRET_ACCESS_KEY=oss-hub-local-synthetic-secret
MAIL_MODE=dry-run
EOF
}
local_compose_config_without_caller_image_tag_or_gmail_credentials() {
  local env_file="$fixture_dir/compose.env"
  local config_json
  write_compose_env "$env_file"
  # caller IMAGE_TAG 없이 wrapper와 동일한 synthetic placeholder만 공급한다.
  config_json="$(
    IMAGE_TAG="$LOCAL_IMAGE_TAG_PLACEHOLDER" docker compose \
      --env-file "$env_file" \
      -f "$repo_root/compose.yml" \
      -f "$repo_root/compose.local.yml" \
      config --format json
  )" || return 1
  printf '%s' "$config_json" | grep -Fq '"dockerfile": "apps/backend/Dockerfile"' || return 1
  printf '%s' "$config_json" | grep -Fq '"dockerfile": "apps/frontend/Dockerfile"' || return 1
  # image reset: services should not keep a prebuilt image tag dependency
  ! printf '%s' "$config_json" | grep -Eq '"image": "oss-hub-backend:' || return 1
  ! printf '%s' "$config_json" | grep -Eq '"image": "oss-hub-frontend:' || return 1
  ! printf '%s' "$config_json" | grep -Fq 'NODE_ENV' || return 1
  ! printf '%s' "$config_json" | grep -Fq 'compose.dev.yml' || return 1
  ! printf '%s' "$config_json" | grep -Fq "$LOCAL_IMAGE_TAG_PLACEHOLDER" || return 1
}

production_missing_image_tag_fails_closed() {
  local env_file="$fixture_dir/compose.env"
  local err_file="$fixture_dir/compose.missing-tag.err"
  local config_json
  write_compose_env "$env_file"
  set +e
  config_json="$(
    env -u IMAGE_TAG docker compose \
      --env-file "$env_file" \
      -f "$repo_root/compose.yml" \
      config --format json 2>"$err_file"
  )"
  local status=$?
  set -e
  ((status != 0)) || return 1
  grep -Eq 'IMAGE_TAG' "$err_file" || return 1
  # must fail before selecting any runnable image tag
  ! printf '%s' "$config_json" | grep -Eq 'oss-hub-backend:' || return 1
  ! printf '%s' "$config_json" | grep -Eq 'oss-hub-frontend:' || return 1
  ! grep -Fq '__IMAGE_TAG_REQUIRED__' "$err_file" || return 1
  ! printf '%s' "$config_json" | grep -Fq '__IMAGE_TAG_REQUIRED__' || return 1
}

production_provided_image_tag_selects_images() {
  local env_file="$fixture_dir/compose.env"
  local config_json
  write_compose_env "$env_file"
  config_json="$(
    IMAGE_TAG=release-sha-abc123 docker compose \
      --env-file "$env_file" \
      -f "$repo_root/compose.yml" \
      config --format json
  )" || return 1
  printf '%s' "$config_json" | grep -Fq 'oss-hub-backend:release-sha-abc123' || return 1
  printf '%s' "$config_json" | grep -Fq 'oss-hub-frontend:release-sha-abc123' || return 1
}

failed_persistent_up_preserves_volumes() {
  ((failed_up_status != 0)) || return 1
  grep -Fq -- ' up --build -d --wait --wait-timeout 120' "$failed_up_log_file" || return 1
  ! grep -Fq -- ' down ' "$failed_up_log_file" || return 1
  ! grep -Fq -- ' -v ' "$failed_up_log_file" || return 1
}

expect_true '모든 Compose 호출이 공통 배열 계약을 사용' all_compose_calls_include_contract
expect_true 'Compose 파일은 정확히 compose.yml + compose.local.yml 둘' compose_uses_exactly_two_files
expect_true 'verifier가 호출자 IMAGE_TAG를 무시하고 synthetic placeholder를 쓴다' verifier_uses_synthetic_image_tag_not_caller
expect_true 'IMAGE_TAG·Gmail 자격 없이 local compose config 평가·build 해석' local_compose_config_without_caller_image_tag_or_gmail_credentials
expect_true 'up·verify 모두 현재 source image를 --build' startup_forces_build
expect_true 'up·verify 모두 성공 반환 전 migration 적용' both_modes_run_migration
expect_true 'production 무 IMAGE_TAG는 fail-closed로 실패' production_missing_image_tag_fails_closed
expect_true 'production 제공 IMAGE_TAG는 backend·frontend 이미지를 선택' production_provided_image_tag_selects_images
expect_true '실패한 persistent up은 down -v로 volume을 지우지 않는다' failed_persistent_up_preserves_volumes
expect_true '--wait와 --wait-timeout이 별도 토큰' wait_tokens_are_separate
expect_true '공백 포함 env 경로가 배열에서 보존됨' path_was_not_split
expect_true 'EXIT trap이 verify lock을 해제함' lock_released
expect_true 'up은 성공 시 스택을 내리지 않는다' up_keeps_stack_alive
expect_true 'up은 고정 project name을 쓴다' up_uses_stable_project_name
expect_true '명시적 down은 두 파일·고정 project의 volume만 정리' explicit_down_uses_owned_contract
printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
