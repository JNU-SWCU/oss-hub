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

# Given: 개발 기본값과 격리 테스트용 Compose 환경이 있다.
# When: Docker Compose가 두 설정을 해석한다.
# Then: 두 설정 모두 loopback에만 게시되고 개발 기본 포트·DB는 유지된다.
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
if [[ " $* " == *" down -v --remove-orphans "* ]]; then
  exit "${INTEGRATION_TEST_DOWN_EXIT:-0}"
fi
EOF

cat >"$fake_bin/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm|%s|DATABASE_URL=%s|RUNNER=%s\n' \
  "$*" \
  "${DATABASE_URL-}" \
  "${OSS_HUB_INTEGRATION_RUNNER-}" >>"$INTEGRATION_TEST_LOG"
if [[ " $* " == *" jest "* ]]; then
  exit "${INTEGRATION_TEST_JEST_EXIT:-0}"
fi
EOF

chmod +x "$fake_bin/docker" "$fake_bin/pnpm"

run_fixture() {
  PATH="$fake_bin:$PATH" \
    DATABASE_URL='postgresql://inherited.invalid/real_database' \
    OSS_HUB_INTEGRATION_RUNNER='inherited-runner-marker' \
    INTEGRATION_TEST_LOG="$command_log" \
    INTEGRATION_TEST_JEST_EXIT="$1" \
    INTEGRATION_TEST_DOWN_EXIT="$2" \
    "$runner"
}

# Given: 호출자가 별도의 DATABASE_URL을 가진 환경이다.
# When: 격리 통합 테스트 실행기가 성공 경로를 실행한다.
run_fixture 0 0

# Then: Docker 임시 포트와 별도 DB 주소를 사용하고 같은 프로젝트를 볼륨과 함께 정리한다.
grep -F 'POSTGRES_PORT=0' "$command_log" >/dev/null
grep -F 'POSTGRES_DB=oss_hub_test' "$command_log" >/dev/null
grep -F 'POSTGRES_BIND_HOST=127.0.0.1' "$command_log" >/dev/null
grep -F '|DATABASE_URL=|RUNNER=' "$command_log" >/dev/null
grep -F 'DATABASE_URL=postgresql://oss:oss-dev@127.0.0.1:49152/oss_hub_test?schema=public' "$command_log" >/dev/null
test "$(grep -Fc '|RUNNER=oss-hub-isolated-integration-v1' "$command_log")" -eq 2
if grep -F 'inherited.invalid' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 DATABASE_URL이 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi
if grep -F 'inherited-runner-marker' "$command_log" >/dev/null; then
  echo 'integration contract: 호출자의 runner 표식이 하위 프로세스에 전달됐습니다.' >&2
  exit 1
fi

success_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* up -d --wait.*$/\1/p' "$command_log")"
success_cleanup_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* down -v --remove-orphans.*$/\1/p' "$command_log")"
test -n "$success_project"
test "$success_project" = "$success_cleanup_project"

# Given: 실제 Jest 실행이 실패한다.
# When: 격리 통합 테스트 실행기가 비정상 종료를 전달한다.
: >"$command_log"
set +e
run_fixture 17 0
failure_status=$?
set -e

# Then: 원래 실패 코드를 보존하면서 임시 볼륨을 정리한다.
test "$failure_status" -eq 17
failure_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* up -d --wait.*$/\1/p' "$command_log")"
failure_cleanup_project="$(sed -n 's/^docker|compose -p \([^ ]*\).* down -v --remove-orphans.*$/\1/p' "$command_log")"
test -n "$failure_project"
test "$failure_project" = "$failure_cleanup_project"

# Given: 테스트는 통과했지만 Docker가 임시 자원 정리에 실패한다.
# When: 격리 통합 테스트 실행기가 종료된다.
: >"$command_log"
set +e
run_fixture 0 23 2>/dev/null
cleanup_failure_status=$?
set -e

# Then: 정리 실패를 성공으로 숨기지 않는다.
test "$cleanup_failure_status" -eq 23

echo 'integration contract: PASS'
