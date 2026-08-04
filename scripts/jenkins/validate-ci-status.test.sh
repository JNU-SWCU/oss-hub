#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
validator="$repo_root/scripts/jenkins/validate-ci-status.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/ci-status.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

stub_dir="$fixture_dir/bin"
mkdir -p "$stub_dir"

# curl을 stub해 네트워크를 타지 않는다. RUNS_BODY/JOBS_BODY는 각 endpoint의 응답 본문이고,
# CURL_SCENARIO=http_error면 두 endpoint 모두 nonzero로 실패한다(--fail 흉내).
cat >"$stub_dir/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

scenario=${CURL_SCENARIO:-normal}

if [[ "$scenario" == 'http_error' ]]; then
  exit 22
fi

output=''
url=''
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  arg=${args[$i]}
  if [[ "$arg" == '--output' ]]; then
    output=${args[$((i + 1))]}
  fi
  if [[ "$arg" == https://* ]]; then
    url=$arg
  fi
done

if [[ -z "$output" || -z "$url" ]]; then
  exit 64
fi

case "$url" in
  */actions/runs/*/jobs)
    printf '%s' "${JOBS_BODY:-}" >"$output"
    ;;
  *actions/workflows/ci.yml/runs*)
    printf '%s' "${RUNS_BODY:-}" >"$output"
    ;;
  *)
    exit 64
    ;;
esac
STUB
chmod +x "$stub_dir/curl"

expect_result() {
  local name=$1
  local scenario=$2
  local runs_body=$3
  local jobs_body=$4
  local release_sha=$5
  local expected_status=$6
  local expected_marker=$7
  local case_number=$((passed + failed + 1))
  local stdout_file="$fixture_dir/case-${case_number}.stdout"
  local stderr_file="$fixture_dir/case-${case_number}.stderr"
  local actual_status=0
  local actual_stdout actual_stderr

  if PATH="$stub_dir:$PATH" \
    CURL_SCENARIO="$scenario" \
    RUNS_BODY="$runs_body" \
    JOBS_BODY="$jobs_body" \
    RELEASE_SHA="$release_sha" \
    bash "$validator" >"$stdout_file" 2>"$stderr_file"; then
    actual_status=0
  else
    actual_status=$?
  fi

  actual_stdout=$(<"$stdout_file")
  actual_stderr=$(<"$stderr_file")

  if [[ "$actual_status" -ne "$expected_status" ]]; then
    printf 'not ok - %s (expected exit %s, got %s; stderr=%s)\n' "$name" "$expected_status" "$actual_status" "$actual_stderr" >&2
    failed=$((failed + 1))
    return
  fi

  if [[ "$expected_status" -eq 0 ]]; then
    if [[ "$actual_stdout" != CI_STATUS_GATE=ok* || -n "$actual_stderr" ]]; then
      printf 'not ok - %s (expected exact success output, got stdout=%s stderr=%s)\n' "$name" "$actual_stdout" "$actual_stderr" >&2
      failed=$((failed + 1))
      return
    fi
  elif [[ -n "$actual_stdout" || "$actual_stderr" != *"$expected_marker"* ]]; then
    printf 'not ok - %s (expected stderr marker %s and empty stdout; got stdout=%s stderr=%s)\n' \
      "$name" "$expected_marker" "$actual_stdout" "$actual_stderr" >&2
    failed=$((failed + 1))
    return
  fi

  printf 'ok - %s\n' "$name"
  passed=$((passed + 1))
}

green_push_runs='{"workflow_runs":[{"id":111,"head_sha":"'"$sha"'","event":"push","status":"completed","run_started_at":"2026-01-01T00:00:00Z","conclusion":"success"}]}'
green_push_jobs='{"jobs":[{"name":"commitlint","conclusion":"skipped"},{"name":"ci","conclusion":"success"}]}'

zero_runs='{"workflow_runs":[]}'

skipped_job_runs='{"workflow_runs":[{"id":222,"head_sha":"'"$sha"'","event":"push","status":"completed","run_started_at":"2026-01-01T00:00:00Z","conclusion":"success"}]}'
skipped_job_jobs='{"jobs":[{"name":"ci","conclusion":"skipped"}]}'

failed_job_runs='{"workflow_runs":[{"id":333,"head_sha":"'"$sha"'","event":"push","status":"completed","run_started_at":"2026-01-01T00:00:00Z","conclusion":"failure"}]}'
failed_job_jobs='{"jobs":[{"name":"ci","conclusion":"failure"}]}'

in_progress_runs='{"workflow_runs":[{"id":444,"head_sha":"'"$sha"'","event":"push","status":"in_progress","run_started_at":"2026-01-01T00:00:00Z","conclusion":null}]}'

missing_job_runs='{"workflow_runs":[{"id":555,"head_sha":"'"$sha"'","event":"push","status":"completed","run_started_at":"2026-01-01T00:00:00Z","conclusion":"success"}]}'
missing_job_jobs='{"jobs":[{"name":"commitlint","conclusion":"skipped"}]}'

# issue_comment 회귀: run은 success지만 트리거가 push가 아니므로 통과하면 안 된다.
issue_comment_runs='{"workflow_runs":[{"id":666,"head_sha":"'"$sha"'","event":"issue_comment","status":"completed","run_started_at":"2026-01-01T00:00:00Z","conclusion":"success"}]}'

expect_result '정상 push run + ci success' normal "$green_push_runs" "$green_push_jobs" "$sha" 0 ''
expect_result 'push run 자체가 없음' normal "$zero_runs" '' "$sha" 1 ci_status_missing
expect_result 'ci job이 skipped' normal "$skipped_job_runs" "$skipped_job_jobs" "$sha" 1 ci_status_failed
expect_result 'ci job이 failure' normal "$failed_job_runs" "$failed_job_jobs" "$sha" 1 ci_status_failed
expect_result 'run이 아직 in_progress' normal "$in_progress_runs" '' "$sha" 1 ci_status_pending
expect_result 'HTTP 에러' http_error "$green_push_runs" "$green_push_jobs" "$sha" 1 ci_status_fetch
expect_result '파싱 불가 JSON' normal 'not-json{' '' "$sha" 1 ci_status_parse
expect_result 'ci job이 응답에 없음' normal "$missing_job_runs" "$missing_job_jobs" "$sha" 1 ci_status_missing_job
expect_result 'issue_comment success run은 게이트를 통과하면 안 됨' normal "$issue_comment_runs" '' "$sha" 1 ci_status_missing
expect_result '잘못된 SHA 형식' normal "$green_push_runs" "$green_push_jobs" 'not-a-sha' 2 ci_status_input
expect_result 'SHA 누락' normal "$green_push_runs" "$green_push_jobs" '' 2 ci_status_input

argument_stdout="$fixture_dir/argument.stdout"
argument_stderr="$fixture_dir/argument.stderr"
if PATH="$stub_dir:$PATH" \
  CURL_SCENARIO=normal \
  RUNS_BODY="$green_push_runs" \
  JOBS_BODY="$green_push_jobs" \
  RELEASE_SHA="$sha" \
  bash "$validator" unexpected >"$argument_stdout" 2>"$argument_stderr"; then
  argument_status=0
else
  argument_status=$?
fi
if [[ "$argument_status" -eq 2 && ! -s "$argument_stdout" ]] && grep -Fq 'ci_status_input' "$argument_stderr"; then
  printf 'ok - 호출 인자 거부\n'
  passed=$((passed + 1))
else
  printf 'not ok - 호출 인자 거부\n' >&2
  failed=$((failed + 1))
fi

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
