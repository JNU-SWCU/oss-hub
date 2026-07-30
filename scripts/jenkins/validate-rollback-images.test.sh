#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
validator="$repo_root/scripts/jenkins/validate-rollback-images.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/rollback-images.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

stub_dir="$fixture_dir/bin"
mkdir -p "$stub_dir"

cat >"$stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 || "$1" != 'image' || "$2" != 'inspect' ]]; then
  exit 64
fi

scenario=${DOCKER_SCENARIO:-normal}
shift 2

if [[ "$1" == '--format' ]]; then
  format=$2
  image=$3
else
  format=''
  image=$1
fi

case "$scenario:$image" in
  missing_front:oss-hub-frontend:*) exit 1 ;;
  missing_back:oss-hub-backend:*) exit 1 ;;
  inspect_nonzero:*) exit 1 ;;
esac

if [[ -z "$format" ]]; then
  exit 0
fi

if [[ "$scenario" == 'metadata_inspect_nonzero' ]]; then
  exit 1
fi

case "$format" in
  *org.opencontainers.image.version*)
    if [[ "$scenario" == 'empty_output' || "$scenario" == 'missing_label' ]]; then
      value=''
    elif [[ "$scenario" == 'version_mismatch' && "$image" == oss-hub-backend:* ]]; then
      value='v9.9.8'
    else
      value='v9.9.9'
    fi
    ;;
  *org.opencontainers.image.revision*)
    if [[ "$scenario" == 'empty_output' ]]; then
      value=''
    elif [[ "$scenario" == 'revision_mismatch' && "$image" == oss-hub-backend:* ]]; then
      value='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    else
      value='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    fi
    ;;
  '{{.Id}}')
    if [[ "$scenario" == 'empty_output' ]]; then
      value=''
    elif [[ "$scenario" == 'image_id_mismatch' && "$image" == oss-hub-backend:* ]]; then
      value='sha256:backend-other'
    elif [[ "$image" == oss-hub-frontend:* ]]; then
      value='sha256:frontend'
    else
      value='sha256:backend'
    fi
    ;;
  *) exit 64 ;;
esac

printf '%s\n' "$value"
STUB
chmod +x "$stub_dir/docker"

expect_result() {
  local name=$1
  local scenario=$2
  local expected_status=$3
  local expected_marker=$4
  local prev_tag=${5-v9.9.9}
  local prev_sha=${6-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
  local prev_fe_id=${7-sha256:frontend}
  local prev_be_id=${8-sha256:backend}
  local case_number=$((passed + failed + 1))
  local stdout_file="$fixture_dir/case-${case_number}.stdout"
  local stderr_file="$fixture_dir/case-${case_number}.stderr"
  local actual_status=0
  local actual_stdout actual_stderr

  if PATH="$stub_dir:$PATH" \
    DOCKER_SCENARIO="$scenario" \
    PREV_TAG="$prev_tag" \
    PREV_SHA="$prev_sha" \
    PREV_FE_IMAGE_ID="$prev_fe_id" \
    PREV_BE_IMAGE_ID="$prev_be_id" \
    bash "$validator" >"$stdout_file" 2>"$stderr_file"; then
    actual_status=0
  else
    actual_status=$?
  fi

  actual_stdout=$(<"$stdout_file")
  actual_stderr=$(<"$stderr_file")

  if [[ "$actual_status" -ne "$expected_status" ]]; then
    printf 'not ok - %s (expected exit %s, got %s)\n' "$name" "$expected_status" "$actual_status" >&2
    failed=$((failed + 1))
    return
  fi

  if [[ "$expected_status" -eq 0 ]]; then
    if [[ "$actual_stdout" != 'ROLLBACK_PREFLIGHT=ok' || -n "$actual_stderr" || $(wc -l <"$stdout_file" | tr -d ' ') -ne 1 ]]; then
      printf 'not ok - %s (expected exact success output)\n' "$name" >&2
      failed=$((failed + 1))
      return
    fi
  elif [[ -n "$actual_stdout" || "$actual_stderr" != *"$expected_marker"* ]]; then
    printf 'not ok - %s (expected stderr marker %s and empty stdout)\n' "$name" "$expected_marker" >&2
    failed=$((failed + 1))
    return
  fi

  printf 'ok - %s\n' "$name"
  passed=$((passed + 1))
}

expect_result '정상 rollback 이미지' normal 0 rollback_input
expect_result 'frontend rollback 이미지 부재' missing_front 1 rollback_image
expect_result 'backend rollback 이미지 부재' missing_back 1 rollback_image
expect_result 'rollback image inspect nonzero' inspect_nonzero 1 rollback_image
expect_result 'rollback metadata inspect nonzero' metadata_inspect_nonzero 1 rollback_image
expect_result 'frontend/backend version 불일치' version_mismatch 1 rollback_label
expect_result 'frontend/backend revision 불일치' revision_mismatch 1 rollback_label
expect_result 'rollback image ID 한쪽 불일치' image_id_mismatch 1 rollback_id
expect_result '실행 frontend ID 불일치' normal 1 rollback_id v9.9.9 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:other sha256:backend
expect_result '실행 backend ID 불일치' normal 1 rollback_id v9.9.9 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:frontend sha256:other
expect_result '빈 inspect metadata output' empty_output 1 rollback_id
expect_result 'OCI label 누락' missing_label 1 rollback_label
expect_result 'PREV_TAG 누락' normal 2 rollback_input '' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:frontend sha256:backend
expect_result 'PREV_SHA 누락' normal 2 rollback_input v9.9.9 '' sha256:frontend sha256:backend
expect_result 'PREV_FE_IMAGE_ID 누락' normal 2 rollback_input v9.9.9 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa '' sha256:backend
expect_result 'PREV_BE_IMAGE_ID 누락' normal 2 rollback_input v9.9.9 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:frontend ''
expect_result 'frontend/backend ID 교환 구현 방지' normal 1 rollback_id v9.9.9 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:backend sha256:frontend

argument_stdout="$fixture_dir/argument.stdout"
argument_stderr="$fixture_dir/argument.stderr"
if PATH="$stub_dir:$PATH" \
  DOCKER_SCENARIO=normal \
  PREV_TAG=v9.9.9 \
  PREV_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  PREV_FE_IMAGE_ID=sha256:frontend \
  PREV_BE_IMAGE_ID=sha256:backend \
  bash "$validator" unexpected >"$argument_stdout" 2>"$argument_stderr"; then
  argument_status=0
else
  argument_status=$?
fi
if [[ "$argument_status" -eq 2 && ! -s "$argument_stdout" ]] && grep -Fq 'rollback_input' "$argument_stderr"; then
  printf 'ok - 호출 인자 거부\n'
  passed=$((passed + 1))
else
  printf 'not ok - 호출 인자 거부\n' >&2
  failed=$((failed + 1))
fi

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
