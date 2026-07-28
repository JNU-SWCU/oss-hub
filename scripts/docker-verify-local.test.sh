#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
verifier="$repo_root/scripts/docker-verify-local.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/docker-verify-local.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin" "$fixture_dir/tmp"
log_file="$fixture_dir/docker.argv"

cat >"$fixture_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
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

PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" "$verifier" verify

up_log_file="$fixture_dir/docker.up.argv"
PATH="$fixture_dir/bin:$PATH" TMPDIR="$fixture_dir/tmp" DOCKER_STUB_LOG="$up_log_file" COMPOSE_ENV_FILE="$fixture_dir/local env" "$verifier" up

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
    [[ "$line" == *'compose '* && "$line" == *'--env-file '* && "$line" == *'compose.yml '* && "$line" == *'compose.dev.yml '* && "$line" == *'compose.local.yml '* ]] || return 1
  done <"$log_file"
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

expect_true '모든 Compose 호출이 공통 배열 계약을 사용' all_compose_calls_include_contract
expect_true '--wait와 --wait-timeout이 별도 토큰' wait_tokens_are_separate
expect_true '공백 포함 env 경로가 배열에서 보존됨' path_was_not_split
expect_true 'EXIT trap이 verify lock을 해제함' lock_released
expect_true 'up은 성공 시 스택을 내리지 않는다' up_keeps_stack_alive
expect_true 'up은 고정 project name을 쓴다' up_uses_stable_project_name
printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
