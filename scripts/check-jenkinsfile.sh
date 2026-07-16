#!/usr/bin/env bash
set -euo pipefail

jenkinsfile=${1:-Jenkinsfile}

if [[ ! -f "$jenkinsfile" ]]; then
  echo "Jenkinsfile contract: file not found: $jenkinsfile" >&2
  exit 1
fi

active_jenkinsfile=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-active.XXXXXX")
docker_scan_file=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-docker-scan.XXXXXX")
trap 'rm -f "$active_jenkinsfile" "$docker_scan_file"' EXIT

# 정적 검사는 실행 가능한 줄만 대상으로 한다. 주석에 계약 문자열을 남겨 검사를 우회하거나,
# 주석 속 금지 명령 때문에 false positive가 발생하지 않도록 full-line Groovy/shell 주석을 제외한다.
awk '
  in_block {
    if (/\*\//) in_block=0
    next
  }
  /^[[:space:]]*\/\*/ {
    if (!/\*\//) in_block=1
    next
  }
  /^[[:space:]]*(\/\/|#)/ { next }
  {
    sub(/[[:space:]]+\/\/.*/, "")
    sub(/[[:space:]]+#.*/, "")
    print
  }
' "$jenkinsfile" >"$active_jenkinsfile"

# Docker의 backslash-newline은 shell에서 한 명령이므로 global build/volume 금지 검사에 한해
# 이어진 줄을 공백 하나로 합친다. canonical build 2줄 검사는 원본 active line을 그대로 쓴다.
awk '
  {
    line=$0
    if (continued != "") line=continued " " line
    if (line ~ /\\[[:space:]]*$/) {
      sub(/\\[[:space:]]*$/, "", line)
      continued=line
      next
    }
    print line
    continued=""
  }
  END {
    if (continued != "") print continued
  }
' "$active_jenkinsfile" >"$docker_scan_file"

concurrency_count=$(grep -Ec '^[[:space:]]*disableConcurrentBuilds\(\)[[:space:]]*$' "$active_jenkinsfile" || true)
checkout_count=$(grep -Ec '^[[:space:]]*skipDefaultCheckout\(true\)[[:space:]]*$' "$active_jenkinsfile" || true)
compose_project_count=$(grep -Ec "^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=[[:space:]]*'oss-hub'[[:space:]]*$" "$active_jenkinsfile" || true)
image_tag_count=$(grep -Ec "^[[:space:]]*env\.IMAGE_TAG[[:space:]]*=[[:space:]]*sh\(script:[[:space:]]*'git rev-parse HEAD',[[:space:]]*returnStdout:[[:space:]]*true\)\.trim\(\)[[:space:]]*$" "$active_jenkinsfile" || true)
image_tag_assignment_count=$({ grep -Eo 'env\.IMAGE_TAG[[:space:]]*=' "$active_jenkinsfile" || true; } | wc -l | tr -d ' ')
rollback_image_tag_scope_count=$(grep -Ec '^[[:space:]]*withEnv\(\["IMAGE_TAG=\$\{env\.PREV_TAG\}"\]\)[[:space:]]*\{[[:space:]]*$' "$active_jenkinsfile" || true)
unexpected_image_tag_line_count=$(awk '
  /IMAGE_TAG/ {
    line=$0
    sub(/^[[:space:]]*/, "", line)
    if (line == "env.IMAGE_TAG = sh(script: \047git rev-parse HEAD\047, returnStdout: true).trim()") next
    if (line == "echo \"IMAGE_TAG=${env.IMAGE_TAG}\"") next
    if (line == "withEnv([\"IMAGE_TAG=${env.PREV_TAG}\"]) {") next
    if (line ~ /^docker build --file apps\/(frontend|backend)\/Dockerfile --tag "oss-hub-(frontend|backend):\$\{IMAGE_TAG\}" \.$/) next
    if (line ~ /^"oss-hub-backend:\$\{IMAGE_TAG\}"[[:space:]]*\\$/) next
    count++
  }
  END { print count + 0 }
' "$active_jenkinsfile")
rollback_guard_count=$(grep -Ec '^[[:space:]]*if[[:space:]]*\(env\.PREV_TAG\?\.trim\(\)\)[[:space:]]*\{[[:space:]]*$' "$active_jenkinsfile" || true)
migration_count=$(grep -Ec '^[[:space:]]*npx[[:space:]]+prisma[[:space:]]+migrate[[:space:]]+deploy[[:space:]]*$' "$active_jenkinsfile" || true)

if ((concurrency_count != 1 || checkout_count != 1 || compose_project_count != 1 || image_tag_count != 1 || image_tag_assignment_count != 1 || rollback_image_tag_scope_count != 1 || unexpected_image_tag_line_count != 0 || rollback_guard_count != 1 || migration_count != 1)); then
  echo "Jenkinsfile contract: required active directives must each appear exactly once (concurrency=$concurrency_count, checkout=$checkout_count, compose_project=$compose_project_count, image_tag=$image_tag_count/$image_tag_assignment_count, rollback_image_tag=$rollback_image_tag_scope_count, unexpected_image_tag=$unexpected_image_tag_line_count, rollback=$rollback_guard_count, migration=$migration_count)" >&2
  exit 1
fi

frontend_build_count=$(grep -Ec '^[[:space:]]*docker[[:space:]]+build[[:space:]]+--file[[:space:]]+apps/frontend/Dockerfile[[:space:]]+--tag[[:space:]]+"oss-hub-frontend:\$\{IMAGE_TAG\}"[[:space:]]+\.[[:space:]]*$' "$active_jenkinsfile" || true)
backend_build_count=$(grep -Ec '^[[:space:]]*docker[[:space:]]+build[[:space:]]+--file[[:space:]]+apps/backend/Dockerfile[[:space:]]+--tag[[:space:]]+"oss-hub-backend:\$\{IMAGE_TAG\}"[[:space:]]+\.[[:space:]]*$' "$active_jenkinsfile" || true)
unexpected_build_count=$(awk '
  /^[[:space:]]*docker[[:space:]]+build[[:space:]]+--file[[:space:]]+apps\/frontend\/Dockerfile[[:space:]]+--tag[[:space:]]+"oss-hub-frontend:\$\{IMAGE_TAG\}"[[:space:]]+\.[[:space:]]*$/ { next }
  /^[[:space:]]*docker[[:space:]]+build[[:space:]]+--file[[:space:]]+apps\/backend\/Dockerfile[[:space:]]+--tag[[:space:]]+"oss-hub-backend:\$\{IMAGE_TAG\}"[[:space:]]+\.[[:space:]]*$/ { next }
  /docker/ && (/[[:space:]]build([^[:alnum:]_-]|$)/ || /[[:space:]]--build([^[:alnum:]_-]|$)/) { count++ }
  END { print count + 0 }
' "$docker_scan_file")

if ((frontend_build_count != 1 || backend_build_count != 1 || unexpected_build_count != 0)); then
  echo "Jenkinsfile contract: only canonical frontend/backend IMAGE_TAG builds are allowed (frontend=$frontend_build_count, backend=$backend_build_count, unexpected=$unexpected_build_count)" >&2
  exit 1
fi

service_up_count=$(grep -Ec '^[[:space:]]*docker[[:space:]]+compose[[:space:]]+up[[:space:]]+-d[[:space:]]+--no-build[[:space:]]+--wait([[:space:]]|$)' "$active_jenkinsfile" || true)
frontend_smoke_count=$(grep -Ec '^[[:space:]]*curl[[:space:]]+[^#]*http://127\.0\.0\.1/[[:space:]]*$' "$active_jenkinsfile" || true)
backend_smoke_count=$(grep -Ec '^[[:space:]]*curl[[:space:]]+[^#]*http://127\.0\.0\.1/api/v1/health[[:space:]]*$' "$active_jenkinsfile" || true)

if ((service_up_count != 2 || frontend_smoke_count != 2 || backend_smoke_count != 2)); then
  echo "Jenkinsfile contract: primary and rollback paths must both keep --no-build and smoke checks (service_up=$service_up_count, frontend_smoke=$frontend_smoke_count, backend_smoke=$backend_smoke_count)" >&2
  exit 1
fi

if ! stage_count=$(awk '
  /^[[:space:]]*stage\(/ {
    if (state != 0) exit 1
    state=1
    stage_count++
    next
  }
  state == 1 && /^[[:space:]]*when[[:space:]]*\{[[:space:]]*$/ {
    state=2
    next
  }
  state == 2 && /^[[:space:]]*branch '\''main'\''[[:space:]]*$/ {
    state=3
    next
  }
  state == 3 && /^[[:space:]]*\}[[:space:]]*$/ {
    state=4
    next
  }
  state == 4 && /^[[:space:]]*steps[[:space:]]*\{[[:space:]]*$/ {
    state=0
    next
  }
  state != 0 && /[^[:space:]]/ {
    exit 1
  }
  END {
    if (state != 0 || stage_count == 0) exit 1
    print stage_count
  }
' "$active_jenkinsfile"); then
  echo "Jenkinsfile contract: every stage must follow stage -> when -> branch 'main' -> } -> steps" >&2
  exit 1
fi

if grep -Eq 'docker[[:space:]]+compose.*[[:space:]]down.*[[:space:]](-v|--volumes)([^[:alnum:]_-]|$)' "$docker_scan_file"; then
  echo 'Jenkinsfile contract: docker compose down -v/--volumes is prohibited' >&2
  exit 1
fi

echo "Jenkinsfile contract: ok ($stage_count main-only stages, no image build executed)"
