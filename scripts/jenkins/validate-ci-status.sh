#!/usr/bin/env bash
set -euo pipefail

# GitHub Actions ci.yml의 push run 중 job `ci`가 success인지 확인한다.
# ci.yml은 issues/issue_comment에서도 `ci` job명을 갖는 run을 default branch head SHA에
# 만들 수 있고(job은 skipped, run conclusion은 success), 그 상태로는 correctness를
# 증명하지 못한다. event=push로 서버·응답 양쪽에서 걸러야 안전하다.
API_BASE='https://api.github.com/repos/JNU-SWCU/oss-hub'
CURL_MAX_TIME=15
CURL_RETRY=3
CURL_RETRY_DELAY=2

input_error() {
  printf 'ci_status_input: RELEASE_SHA는 40-hex commit SHA여야 합니다\n' >&2
  exit 2
}

if (($# != 0)); then
  printf 'ci_status_input: arguments are not accepted\n' >&2
  exit 2
fi

if [[ -z "${RELEASE_SHA:-}" ]]; then
  input_error
fi

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  input_error
fi

api_get() {
  local url=$1
  local out=$2

  curl --fail --silent --show-error \
    --max-time "$CURL_MAX_TIME" \
    --retry "$CURL_RETRY" --retry-delay "$CURL_RETRY_DELAY" --retry-connrefused \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "$url" \
    --output "$out"
}

runs_file="$(mktemp)"
jobs_file="$(mktemp)"
trap 'rm -f "$runs_file" "$jobs_file"' EXIT

runs_url="${API_BASE}/actions/workflows/ci.yml/runs?head_sha=${RELEASE_SHA}&event=push&per_page=30"
if ! api_get "$runs_url" "$runs_file"; then
  printf 'ci_status_fetch: %s의 ci.yml push run 조회에 실패했습니다.\n' "$RELEASE_SHA" >&2
  exit 1
fi

if ! jq -e '.workflow_runs' "$runs_file" >/dev/null 2>&1; then
  printf 'ci_status_parse: ci.yml runs 응답을 파싱하지 못했습니다.\n' >&2
  exit 1
fi

# 쿼리 파라미터(head_sha·event)가 서버에서 이미 걸러주지만, 응답에서도 다시 확인해
# API 계약이 조용히 바뀌어도 issue_comment 등 다른 트리거의 run을 통과시키지 않는다.
push_run_count="$(
  jq -r --arg sha "$RELEASE_SHA" \
    '[.workflow_runs[] | select(.head_sha == $sha and .event == "push")] | length' \
    "$runs_file"
)"

if [[ "$push_run_count" -eq 0 ]]; then
  printf 'ci_status_missing: %s에 대한 ci.yml push run이 없습니다.\n' "$RELEASE_SHA" >&2
  exit 1
fi

run_id="$(
  jq -r --arg sha "$RELEASE_SHA" '
    [.workflow_runs[] | select(.head_sha == $sha and .event == "push" and .status == "completed")]
    | sort_by(.run_started_at) | reverse | .[0].id // empty
  ' "$runs_file"
)"

if [[ -z "$run_id" ]]; then
  printf 'ci_status_pending: %s의 ci.yml push run이 아직 진행 중입니다. 완료 후 재시도하십시오.\n' "$RELEASE_SHA" >&2
  exit 1
fi

jobs_url="${API_BASE}/actions/runs/${run_id}/jobs"
if ! api_get "$jobs_url" "$jobs_file"; then
  printf 'ci_status_fetch: run %s의 job 목록 조회에 실패했습니다.\n' "$run_id" >&2
  exit 1
fi

if ! jq -e '.jobs' "$jobs_file" >/dev/null 2>&1; then
  printf 'ci_status_parse: run %s의 job 응답을 파싱하지 못했습니다.\n' "$run_id" >&2
  exit 1
fi

# run 전체 conclusion이 아니라 job `ci` 자체를 단언한다 — issues/issue_comment 트리거에서는
# `ci` job이 skipped여도 run conclusion은 success이므로, run 단위 검사는 조용한 구멍이 된다.
ci_job_conclusion="$(
  jq -r '[.jobs[] | select(.name == "ci")] | .[0].conclusion // empty' "$jobs_file"
)"

if [[ -z "$ci_job_conclusion" ]]; then
  printf 'ci_status_missing_job: run %s에 ci job이 없습니다.\n' "$run_id" >&2
  exit 1
fi

if [[ "$ci_job_conclusion" != 'success' ]]; then
  printf 'ci_status_failed: run %s의 ci job이 success가 아닙니다 (conclusion=%s).\n' "$run_id" "$ci_job_conclusion" >&2
  exit 1
fi

printf 'CI_STATUS_GATE=ok run_id=%s conclusion=%s\n' "$run_id" "$ci_job_conclusion"
