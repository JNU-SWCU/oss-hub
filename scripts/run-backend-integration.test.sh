#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="$repo_root/scripts/run-backend-integration.sh"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/oss-hub-integration-contract.XXXXXX")"
fake_bin="$fixture_root/bin"
command_log="$fixture_root/commands.log"

dev_compose_config="$(docker compose -f "$repo_root/compose.dev.yml" config)"
isolated_compose_config="$(
  POSTGRES_BIND_HOST=127.0.0.1 \
    POSTGRES_PORT=0 \
    POSTGRES_DB=oss_hub_test \
    docker compose -f "$repo_root/compose.dev.yml" config
)"

grep -F 'host_ip: 127.0.0.1' <<<"$dev_compose_config" >/dev/null
grep -F 'published: "5432"' <<<"$dev_compose_config" >/dev/null
grep -F 'POSTGRES_DB: oss_hub' <<<"$dev_compose_config" >/dev/null
grep -F 'host_ip: 127.0.0.1' <<<"$isolated_compose_config" >/dev/null
grep -F 'published: "0"' <<<"$isolated_compose_config" >/dev/null
grep -F 'POSTGRES_DB: oss_hub_test' <<<"$isolated_compose_config" >/dev/null

cleanup() {
  rm -rf "$fixture_root"
}
trap cleanup EXIT

mkdir -p "$fake_bin"

cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker|%s|POSTGRES_PORT=%s|POSTGRES_DB=%s|POSTGRES_BIND_HOST=%s|DATABASE_URL=%s|RUNNER=%s\n' \
  "$*" \
  "${POSTGRES_PORT-}" \
  "${POSTGRES_DB-}" \
  "${POSTGRES_BIND_HOST-}" \
  "${DATABASE_URL-}" \
  "${OSS_HUB_INTEGRATION_RUNNER-}" >>"$INTEGRATION_TEST_LOG"
if [[ " $* " == *" port postgres 5432 "* ]]; then
  printf '127.0.0.1:49152\n'
fi
if [[ " $* " == *" port object-storage 9090 "* ]]; then
  printf '127.0.0.1:49153\n'
fi
if [[ " $* " == *" down -v --remove-orphans "* ]]; then
  exit "${INTEGRATION_TEST_DOWN_EXIT:-0}"
fi
EOF

cat >"$fake_bin/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm|%s|DATABASE_URL=%s|STORAGE_MODE=%s|S3_ENDPOINT=%s|S3_BUCKET=%s|RUNNER=%s|SEED=%s|JOIN_SECRET=%s\n' \
  "$*" \
  "${DATABASE_URL-}" \
  "${SUBMISSION_FILE_STORAGE_MODE-}" \
  "${SUBMISSION_FILE_S3_ENDPOINT-}" \
  "${SUBMISSION_FILE_S3_BUCKET-}" \
  "${OSS_HUB_INTEGRATION_RUNNER-}" \
  "${AUTH_INITIAL_ROLES-}" \
  "${TEAM_JOIN_CODE_SECRET-}" >>"$INTEGRATION_TEST_LOG"
if [[ " $* " == *" jest "* ]]; then
  exit "${INTEGRATION_TEST_JEST_EXIT:-0}"
fi
EOF

chmod +x "$fake_bin/docker" "$fake_bin/pnpm"

run_fixture() {
  PATH="$fake_bin:$PATH" \
    DATABASE_URL='postgresql://inherited.invalid/real_database' \
    SUBMISSION_FILE_STORAGE_MODE=managed \
    OSS_HUB_INTEGRATION_RUNNER='inherited-runner-marker' \
    AUTH_INITIAL_ROLES='999999:ADMIN' \
    TEAM_JOIN_CODE_SECRET='inherited-real-join-secret' \
    INTEGRATION_TEST_LOG="$command_log" \
    INTEGRATION_TEST_JEST_EXIT="$1" \
    INTEGRATION_TEST_DOWN_EXIT="$2" \
    BACKEND_INTEGRATION_TEST_PATTERN="${3-}" \
    "$runner"
}

run_fixture 0 0

grep -F 'POSTGRES_PORT=0' "$command_log" >/dev/null
grep -F 'POSTGRES_DB=oss_hub_test' "$command_log" >/dev/null
grep -F 'POSTGRES_BIND_HOST=127.0.0.1' "$command_log" >/dev/null
grep -F '|DATABASE_URL=|RUNNER=' "$command_log" >/dev/null
grep -F 'DATABASE_URL=postgresql://oss:oss-dev@127.0.0.1:49152/oss_hub_test?schema=public' "$command_log" >/dev/null
grep -F 'S3_ENDPOINT=http://127.0.0.1:49153' "$command_log" >/dev/null
grep -F 'S3_BUCKET=submission-files-' "$command_log" >/dev/null
test "$(grep -Fc '|STORAGE_MODE=local|' "$command_log")" -eq 2
test "$(grep -Fc '|RUNNER=oss-hub-isolated-integration-v1' "$command_log")" -eq 2
if grep -F 'inherited.invalid' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 DATABASE_URL이 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi
if grep -F 'inherited-runner-marker' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 runner 표식이 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi

if grep -F '999999:ADMIN' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 AUTH_INITIAL_ROLES가 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi
grep -F '|SEED=' "$command_log" >/dev/null
test "$(grep -Fc '|JOIN_SECRET=synthetic-integration-join-code-secret' "$command_log")" -eq 1
grep -F -- '--testPathPattern=\.integration\.spec\.ts$' "$command_log" >/dev/null
if grep -F 'inherited-real-join-secret' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 TEAM_JOIN_CODE_SECRET이 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi

success_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* up -d --wait.*$/\1/p' "$command_log")"
success_cleanup_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* down -v --remove-orphans.*$/\1/p' "$command_log")"
test -n "$success_project"
test "$success_project" = "$success_cleanup_project"

: >"$command_log"
run_fixture 0 0 'storage-orphan-reconciliation\.integration\.spec\.ts$'

grep -F -- '--testPathPattern=storage-orphan-reconciliation\.integration\.spec\.ts$' "$command_log" >/dev/null

: >"$command_log"
set +e
run_fixture 17 0
failure_status=$?
set -e

test "$failure_status" -eq 17
failure_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* up -d --wait.*$/\1/p' "$command_log")"
failure_cleanup_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* down -v --remove-orphans.*$/\1/p' "$command_log")"
test -n "$failure_project"
test "$failure_project" = "$failure_cleanup_project"

: >"$command_log"
set +e
run_fixture 0 23 2>/dev/null
cleanup_failure_status=$?
set -e

test "$cleanup_failure_status" -eq 23

echo 'integration contract: PASS'
