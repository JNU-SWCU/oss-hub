#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/check-jenkinsfile.sh [Jenkinsfile]
  scripts/check-jenkinsfile.sh v2 [Jenkinsfile]
EOF
  exit 2
}

if [[ $# -eq 0 ]]; then
  jenkinsfile=Jenkinsfile
elif [[ $# -eq 1 && "$1" != "v2" && "$1" != "-h" && "$1" != "--help" ]]; then
  jenkinsfile=$1
elif [[ $# -le 2 && "$1" == "v2" ]]; then
  jenkinsfile=${2:-Jenkinsfile}
else
  usage
fi

if [[ ! -f "$jenkinsfile" ]]; then
  printf 'Jenkinsfile contract: file not found: %s\n' "$jenkinsfile" >&2
  exit 1
fi

label="Jenkinsfile contract"

active_jenkinsfile=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-active.XXXXXX")
docker_scan_file=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-docker-scan.XXXXXX")
trap 'rm -f "$active_jenkinsfile" "$docker_scan_file"' EXIT

# 주석에 계약 문자열을 남겨 검사를 우회하지 못하도록 실행 가능한 줄만 검사한다.
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

# shell에서 하나의 명령인 backslash-newline을 합쳐 우회된 build·volume 삭제도 검사한다.
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

count_fixed() {
  local pattern=$1
  { grep -F -- "$pattern" "$active_jenkinsfile" || true; } | wc -l | tr -d ' '
}

count_regex() {
  local pattern=$1
  { grep -Ec -- "$pattern" "$active_jenkinsfile" || true; } | tr -d ' '
}

require_exact() {
  local description=$1
  local pattern=$2
  local expected=$3
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual != expected)); then
    printf '%s: %s (expected=%s, actual=%s)\n' "$label" "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

require_at_least() {
  local description=$1
  local pattern=$2
  local minimum=$3
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual < minimum)); then
    printf '%s: %s (minimum=%s, actual=%s)\n' "$label" "$description" "$minimum" "$actual" >&2
    exit 1
  fi
}

require_absent() {
  local description=$1
  local pattern=$2
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual != 0)); then
    printf '%s: %s (expected=absent, actual=%s)\n' "$label" "$description" "$actual" >&2
    exit 1
  fi
}

require_regex_at_least() {
  local description=$1
  local pattern=$2
  local minimum=$3
  local actual
  actual=$(count_regex "$pattern")
  if ((actual < minimum)); then
    printf '%s: %s (minimum=%s, actual=%s)\n' "$label" "$description" "$minimum" "$actual" >&2
    exit 1
  fi
}

require_regex_absent() {
  local description=$1
  local pattern=$2
  local actual
  actual=$(count_regex "$pattern")
  if ((actual != 0)); then
    printf '%s: %s (expected=absent, actual=%s)\n' "$label" "$description" "$actual" >&2
    exit 1
  fi
}

line_of() {
  local pattern=$1
  grep -nF "$pattern" "$active_jenkinsfile" | head -n 1 | cut -d: -f1
}

line_of_regex() {
  local pattern=$1
  grep -nE "$pattern" "$active_jenkinsfile" | head -n 1 | cut -d: -f1
}

require_common_executor_guards() {
  require_exact '동시 실행 차단은 한 번이어야 함' 'disableConcurrentBuilds()' 1
  require_exact '기본 checkout 차단은 한 번이어야 함' 'skipDefaultCheckout(true)' 1
  require_exact 'Docker 권한은 전용 production executor에서만 사용해야 함' "label 'oss-hub-production'" 1
}

require_common_smoke_and_build_guards() {
  require_exact '의존성 설치는 한 번이어야 함' 'pnpm install --frozen-lockfile' 1
  require_exact '재사용 workspace에서도 Prisma client를 명시 생성해야 함' 'pnpm --filter backend exec prisma generate' 1
  require_exact 'test는 한 번이어야 함' 'pnpm test' 1
  require_exact 'DB backup은 한 번이어야 함' 'pg_dump' 1
  require_exact 'migration은 한 번이어야 함' 'npx prisma migrate deploy' 1
  require_exact 'primary·rollback은 기존 이미지만 사용해야 함' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 2
  require_exact '내부 backend smoke는 primary·rollback에 있어야 함' 'http://127.0.0.1:8081/api/v1/health' 2
  require_exact 'TLS backend smoke는 primary·rollback에 있어야 함' 'https://54.116.116.174/api/v1/health' 2
  require_exact 'TLS smoke는 인증서의 IP SAN을 검증해야 함' "--resolve '54.116.116.174:443:127.0.0.1'" 4
  require_at_least '운영 환경은 Jenkins file credential로 주입해야 함' "credentialsId: 'oss-hub-production-env'" 1

  local internal_frontend_smoke_count tls_frontend_smoke_count docker_build_count
  internal_frontend_smoke_count=$(grep -Ec 'http://127\.0\.0\.1:8081/[[:space:]]*$' "$active_jenkinsfile" || true)
  if ((internal_frontend_smoke_count != 2)); then
    printf '%s: 내부 frontend smoke는 primary·rollback에 있어야 함 (expected=2, actual=%s)\n' "$label" "$internal_frontend_smoke_count" >&2
    exit 1
  fi

  tls_frontend_smoke_count=$(grep -Ec 'https://54\.116\.116\.174/[[:space:]]*$' "$active_jenkinsfile" || true)
  if ((tls_frontend_smoke_count != 2)); then
    printf '%s: TLS frontend smoke는 primary·rollback에 있어야 함 (expected=2, actual=%s)\n' "$label" "$tls_frontend_smoke_count" >&2
    exit 1
  fi

  if grep -Fq "branch 'main'" "$active_jenkinsfile"; then
    printf '%s: main production branch 배포 guard를 둘 수 없음\n' "$label" >&2
    exit 1
  fi
  if grep -Eq 'docker[[:space:]]+compose.*[[:space:]]down.*[[:space:]](-v|--volumes)([^[:alnum:]_-]|$)' "$docker_scan_file"; then
    printf '%s: docker compose down -v/--volumes is prohibited\n' "$label" >&2
    exit 1
  fi
  if grep -Eq 'docker[[:space:]]+compose.*([[:space:]]build|[[:space:]]--build)([^[:alnum:]_-]|$)' "$docker_scan_file"; then
    printf '%s: Compose may not rebuild production images\n' "$label" >&2
    exit 1
  fi

  docker_build_count=$(grep -Ec 'docker[[:space:]]+((image|buildx)[[:space:]]+)?build([[:space:]]|$)' "$docker_scan_file" || true)
  if ((docker_build_count != 2)); then
    printf '%s: canonical frontend/backend 외 image build는 금지됨 (actual=%s)\n' "$label" "$docker_build_count" >&2
    exit 1
  fi
}

require_single_image_tag_assignment() {
  local image_tag_assignment_count
  image_tag_assignment_count=$(grep -Ec 'env\.IMAGE_TAG[[:space:]]*=' "$active_jenkinsfile" || true)
  if ((image_tag_assignment_count != 1)) ||
     grep -Eq 'env\[['\''"]IMAGE_TAG['\''"][[:space:]]*\][[:space:]]*=' "$active_jenkinsfile" ||
     grep -Eq 'env\."IMAGE_TAG"[[:space:]]*=' "$active_jenkinsfile" ||
     grep -Eq 'export[[:space:]]+IMAGE_TAG=' "$active_jenkinsfile" ||
     grep -Eq '^[[:space:]]*(export[[:space:]]+)?IMAGE_TAG=' "$active_jenkinsfile"; then
    printf '%s: IMAGE_TAG는 한 번만 할당해야 함\n' "$label" >&2
    exit 1
  fi
}

check_v2() {
  require_common_executor_guards

  # parameterless latest-Release surface — legacy inputs must stay gone
  require_absent 'parameters 블록은 없어야 함' 'parameters {'
  require_absent 'RELEASE_ACTION 파라미터는 없어야 함' 'RELEASE_ACTION'
  require_absent 'RELEASE_TAG 파라미터 입력은 없어야 함' "string(name: 'RELEASE_TAG'"
  require_absent 'RUN_MODE는 없어야 함' 'RUN_MODE'
  require_absent 'DEPLOY_STATE_FILE은 없어야 함' 'DEPLOY_STATE_FILE'
  require_absent 'RELEASE_ACCEPT role=TECH_LEAD는 없어야 함' 'RELEASE_ACCEPT role=TECH_LEAD'
  require_absent 'RELEASE_OVERRIDE role=PM는 없어야 함' 'RELEASE_OVERRIDE role=PM'
  require_absent 'Release 승인 marker는 없어야 함' 'RELEASE_ACCEPT'
  require_absent 'Release 승인 댓글 scraping은 없어야 함' 'issues/199/comments'
  require_absent 'PM 승인 actor 파싱은 없어야 함' "--arg actor 'GoBeromsu'"
  require_absent 'Tech Lead 승인 actor(Lumiere001)는 없어야 함' "--arg actor 'Lumiere001'"
  require_absent 'sort -V 버전 비교는 없어야 함' 'sort -V'
  require_absent 'sandbox 승인이 필요한 BigInteger 생성자는 없어야 함' 'new BigInteger'
  require_absent 'created action 분기 경로는 없어야 함' "action == 'created'"
  require_absent 'published action 분기 경로는 없어야 함' "action == 'published'"
  require_absent 'SHA를 IMAGE_TAG로 할당하면 안 됨' 'env.IMAGE_TAG = releaseSha'
  require_absent 'RELEASE_SHA를 IMAGE_TAG로 할당하면 안 됨' 'env.IMAGE_TAG = env.RELEASE_SHA'
  require_absent 'IMAGE_TAG head 승인 바인딩은 없어야 함' 'RELEASE_ACCEPT role=PM tag=${RELEASE_TAG} head=${IMAGE_TAG}'
  require_absent 'IMAGE_TAG detached checkout은 없어야 함' 'git checkout --detach "$IMAGE_TAG"'

  require_exact 'latest Release API 조회는 한 번이어야 함' '/releases/latest' 1
  require_exact 'draft 거절은 한 번이어야 함' "jq -r '.draft'" 1
  require_exact 'prerelease 거절은 한 번이어야 함' "jq -r '.prerelease'" 1
  require_exact 'latest tag_name 추출은 한 번이어야 함' "jq -r '.tag_name'" 1
  require_exact 'full SemVer tag 검증은 한 번이어야 함' 'tag ==~ /' 1
  require_exact 'Release tag의 commit 해석은 한 번이어야 함' 'git rev-parse "${RELEASE_TAG}^{commit}"' 1
  require_exact 'main ancestry 검증은 한 번이어야 함' 'git merge-base --is-ancestor "$release_sha" origin/main' 1
  require_exact 'IMAGE_TAG는 RELEASE_TAG(tag)로 한 번만 할당해야 함' 'env.IMAGE_TAG = tag' 1
  require_exact 'RELEASE_SHA 바인딩은 한 번이어야 함' 'env.RELEASE_SHA = releaseSha' 1
  require_exact 'exact RELEASE_SHA checkout은 한 번이어야 함' 'git checkout --detach "$RELEASE_SHA"' 1

  # no-op authority: running ps -q only; --all is classification
  require_regex_at_least 'no-op 권위는 실행 중 ps -q frontend여야 함' 'ps[[:space:]]+-q[[:space:]]+frontend' 1
  require_regex_at_least 'no-op 권위는 실행 중 ps -q backend여야 함' 'ps[[:space:]]+-q[[:space:]]+backend' 1
  require_regex_at_least '존재/부분/중지 분류는 ps --all -q frontend여야 함' 'ps[[:space:]]+--all[[:space:]]+-q[[:space:]]+frontend' 1
  require_regex_at_least '존재/부분/중지 분류는 ps --all -q backend여야 함' 'ps[[:space:]]+--all[[:space:]]+-q[[:space:]]+backend' 1
  require_exact 'greenfield는 양쪽 서비스 부재일 때만이어야 함' 'state=greenfield' 1
  require_exact '완전 증명된 running 상태만 진행해야 함' 'state=running' 1
  require_absent 'stopped_proceed 성공 경로는 없어야 함' 'stopped_proceed'
  require_absent 'running_deploy 성공 경로는 없어야 함' 'running_deploy'
  require_absent 'same-tag nonrunning proceed 경로는 없어야 함' 'same_tag_nonrunning_or_ambiguous'
  require_at_least '중지 전용 진단 마커가 있어야 함' 'FAIL_CLOSED stopped_container' 1
  require_at_least '부분 배포 진단 마커가 있어야 함' 'FAIL_CLOSED partial' 1
  require_exact '실행 중 exact tag+SHA no-op 판정이 있어야 함' 'prevTag == env.RELEASE_TAG && prevSha == env.RELEASE_SHA' 1
  require_at_least 'same-tag/different-SHA 진단 마커가 있어야 함' 'FAIL_CLOSED same_tag_different_sha' 1
  require_at_least '배포 stage는 no-op을 건너뛰어야 함' "env.DEPLOY_NOOP != 'true'" 5

  # Authoritative compose ps probes must propagate nonzero status (no 2>/dev/null || true swallow).
  if ! awk '
    {
      line = $0
      if (line ~ /ps[[:space:]]+-q[[:space:]]+frontend/) {
        fe_q++
        if (line ~ /2>\/dev\/null/ || line ~ /\|\|[[:space:]]*true/) fe_q_bad=1
      }
      if (line ~ /ps[[:space:]]+-q[[:space:]]+backend/) {
        be_q++
        if (line ~ /2>\/dev\/null/ || line ~ /\|\|[[:space:]]*true/) be_q_bad=1
      }
      if (line ~ /ps[[:space:]]+--all[[:space:]]+-q[[:space:]]+frontend/) {
        fe_all++
        if (line ~ /2>\/dev\/null/ || line ~ /\|\|[[:space:]]*true/) fe_all_bad=1
      }
      if (line ~ /ps[[:space:]]+--all[[:space:]]+-q[[:space:]]+backend/) {
        be_all++
        if (line ~ /2>\/dev\/null/ || line ~ /\|\|[[:space:]]*true/) be_all_bad=1
      }
    }
    END {
      ok = (fe_q >= 1 && be_q >= 1 && fe_all >= 1 && be_all >= 1 &&
            !fe_q_bad && !be_q_bad && !fe_all_bad && !be_all_bad)
      exit ok ? 0 : 1
    }
  ' "$active_jenkinsfile"; then
    printf '%s: authoritative docker compose ps probes must not swallow nonzero status\n' "$label" >&2
    exit 1
  fi

  # Condition→terminal: exactly one fully anchored executable opener per contract,
  # terminals only inside that opener's own closing delimiter/block.
  # Reject echo/println/quoted openers, substring spoofs, and duplicate real openers.

  # stopped-only branch: condition → terminal exit (marker text alone is insufficient)
  if ! awk '
    {
      if ($0 ~ /^[[:space:]]*if[[:space:]]+\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\][[:space:]]*;[[:space:]]*then[[:space:]]*$/) {
        openers++
        if (openers == 1) grab = 1
        next
      }
      if (grab) {
        if ($0 ~ /^[[:space:]]*exit[[:space:]]+[1-9][0-9]*[[:space:]]*$/) term = 1
        if ($0 ~ /^[[:space:]]*fi[[:space:]]*$/) grab = 0
      }
    }
    END { exit (openers == 1 && term) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: stopped container 분기는 유일 executable opener 와 단말 exit 로 실패해야 함 (marker-only 금지)\n' "$label" >&2
    exit 1
  fi

  # partial existence branch: one-sided container presence → terminal exit
  if ! awk '
    {
      if ($0 ~ /^[[:space:]]*if[[:space:]]+\{[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*\|\|[[:space:]]*\{[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*;[[:space:]]*then[[:space:]]*$/) {
        openers++
        if (openers == 1) grab = 1
        next
      }
      if (grab) {
        if ($0 ~ /^[[:space:]]*exit[[:space:]]+[1-9][0-9]*[[:space:]]*$/) term = 1
        if ($0 ~ /^[[:space:]]*fi[[:space:]]*$/) grab = 0
      }
    }
    END { exit (openers == 1 && term) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: partial deployment 분기는 유일 executable opener 와 단말 exit 로 실패해야 함 (marker-only 금지)\n' "$label" >&2
    exit 1
  fi

  # Groovy non-running probe state must terminal-error (not a renamed condition alone)
  if ! awk '
    {
      if ($0 ~ /^[[:space:]]*if[[:space:]]*\([[:space:]]*state[[:space:]]*!=[[:space:]]*'\''running'\''[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/) {
        openers++
        if (openers == 1) grab = 1
        next
      }
      if (grab) {
        if ($0 ~ /^[[:space:]]*error[[:space:]]*\(/) term = 1
        if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) grab = 0
      }
    }
    END { exit (openers == 1 && term) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: non-running probe state는 유일 executable opener 와 error(...) 단말 실패여야 함\n' "$label" >&2
    exit 1
  fi

  # same-tag/different-SHA: condition → error(...) terminal (marker rename must not pass)
  if ! awk '
    {
      if ($0 ~ /^[[:space:]]*if[[:space:]]*\([[:space:]]*prevTag[[:space:]]*==[[:space:]]*env\.RELEASE_TAG[[:space:]]*&&[[:space:]]*prevSha[[:space:]]*!=[[:space:]]*env\.RELEASE_SHA[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/) {
        openers++
        if (openers == 1) grab = 1
        next
      }
      if (grab) {
        if ($0 ~ /^[[:space:]]*error[[:space:]]*\(/) term = 1
        if ($0 ~ /^[[:space:]]*(env\.)?DEPLOY_NOOP[[:space:]]*=[[:space:]]*'\''true'\''/) bad = 1
        if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) grab = 0
      }
    }
    END { exit (openers == 1 && term && !bad) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: same-tag/different-SHA는 유일 executable opener 와 error(...) 단말 실패여야 함 (marker-only 금지)\n' "$label" >&2
    exit 1
  fi

  # SemVer downgrade: bounded cmp < 0 → DEPLOY_NOOP=true → return (not a log marker)
  if ! awk '
    {
      if ($0 ~ /^[[:space:]]*if[[:space:]]*\([[:space:]]*cmp[[:space:]]*<[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/) {
        openers++
        if (openers == 1) grab = 1
        next
      }
      if (grab) {
        if ($0 ~ /^[[:space:]]*(env\.)?DEPLOY_NOOP[[:space:]]*=[[:space:]]*'\''true'\''/) noop = 1
        if ($0 ~ /^[[:space:]]*return[[:space:]]*;?[[:space:]]*$/) ret = 1
        if ($0 ~ /^[[:space:]]*(env\.)?DEPLOY_NOOP[[:space:]]*=[[:space:]]*'\''false'\''/) bad = 1
        if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) grab = 0
      }
    }
    END { exit (openers == 1 && noop && ret && !bad) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: full SemVer downgrade는 유일 cmp < 0 opener 후 DEPLOY_NOOP=true 와 return 이어야 함\n' "$label" >&2
    exit 1
  fi

  # HTTPS FRONTEND_URL preflight: scheme + exactly-one assignment rejection (order-independent)
  require_at_least 'FRONTEND_URL 사전 검증이 있어야 함' 'FRONTEND_URL' 1
  require_regex_at_least 'FRONTEND_URL은 https:// scheme만 허용해야 함' 'https://\*' 1
  require_regex_absent 'HTTP FRONTEND_URL 허용은 금지' 'http://\*'
  if ! awk '
    {
      if ($0 ~ /FRONTEND_URL/) seen = 1
      if ($0 ~ /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*==[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/) {
        missing_openers++
        if (missing_openers == 1) grab_missing = 1
        grab_uniq = 0
        next
      }
      if ($0 ~ /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*!=[[:space:]]*1[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/) {
        uniq_openers++
        if (uniq_openers == 1) grab_uniq = 1
        grab_missing = 0
        next
      }
      if (grab_missing) {
        if ($0 ~ /^[[:space:]]*exit[[:space:]]+2[[:space:]]*$/) e2 = 1
        if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) grab_missing = 0
      }
      if (grab_uniq) {
        if ($0 ~ /^[[:space:]]*exit[[:space:]]+3[[:space:]]*$/) e3 = 1
        if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) grab_uniq = 0
      }
    }
    END { exit (seen && missing_openers == 1 && uniq_openers == 1 && e2 && e3) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: FRONTEND_URL는 유일 count==0/count!=1 opener 로 누락·중복을 단말 거절해야 함\n' "$label" >&2
    exit 1
  fi

  require_exact 'rollback 사전 검증은 외부 스크립트를 한 번 호출해야 함' \
    "sh 'bash scripts/jenkins/validate-rollback-images.sh'" 1
  require_exact 'rollback 스크립트 nonzero는 Jenkins sh 단계에서 전파되어야 함' \
    "sh 'bash scripts/jenkins/validate-rollback-images.sh'" 1
  require_exact 'rollback greenfield는 이전 태그가 없을 때 건너뛰어야 함' 'if (!env.PREV_TAG?.trim())' 1
  require_exact 'rollback greenfield skip 진단이 있어야 함' \
    "echo 'rollback_preflight: greenfield — 이전 이미지 없음. 계속합니다.'" 1
  require_exact 'rollback PREV_TAG를 withEnv로 전달해야 함' '"PREV_TAG=${env.PREV_TAG}",' 1
  require_exact 'rollback PREV_SHA를 withEnv로 전달해야 함' "PREV_SHA=\${env.PREV_SHA ?: ''}" 1
  require_exact 'rollback frontend Image ID를 withEnv로 전달해야 함' \
    "PREV_FE_IMAGE_ID=\${env.PREV_FE_IMAGE_ID ?: ''}" 1
  require_exact 'rollback backend Image ID를 withEnv로 전달해야 함' \
    "PREV_BE_IMAGE_ID=\${env.PREV_BE_IMAGE_ID ?: ''}" 1
  require_absent 'rollback image inspect 구현은 Jenkinsfile에 남아 있으면 안 됨' \
    'docker image inspect "oss-hub-frontend:${PREV_TAG}"'

  require_regex_at_least '실행 중 컨테이너 .Image ID 캡처가 있어야 함' '\{\{\.Image\}\}' 1
  require_at_least 'probe는 prev_fe_image_id를 내보내야 함' 'prev_fe_image_id=' 1
  require_at_least 'probe는 prev_be_image_id를 내보내야 함' 'prev_be_image_id=' 1

  # release-tag builds with OCI labels; each build command carries both labels independently
  require_at_least 'frontend release-tag 빌드가 있어야 함' '--tag "oss-hub-frontend:${IMAGE_TAG}"' 1
  require_at_least 'backend release-tag 빌드가 있어야 함' '--tag "oss-hub-backend:${IMAGE_TAG}"' 1
  if ! awk '
    {
      line = $0
      if (line ~ /docker[[:space:]]+((image|buildx)[[:space:]]+)?build/ && line ~ /apps\/frontend\/Dockerfile/) {
        fe++
        if (line !~ /--label[[:space:]]+"org\.opencontainers\.image\.version=\$\{RELEASE_TAG\}"/) fe_bad=1
        if (line !~ /--label[[:space:]]+"org\.opencontainers\.image\.revision=\$\{RELEASE_SHA\}"/) fe_bad=1
        # exactly one of each label token on this build line
        nver = gsub(/org\.opencontainers\.image\.version=\$\{RELEASE_TAG\}/, "&", line)
        nrev = gsub(/org\.opencontainers\.image\.revision=\$\{RELEASE_SHA\}/, "&", line)
        if (nver != 1 || nrev != 1) fe_bad=1
      }
      if (line ~ /docker[[:space:]]+((image|buildx)[[:space:]]+)?build/ && line ~ /apps\/backend\/Dockerfile/) {
        be++
        if (line !~ /--label[[:space:]]+"org\.opencontainers\.image\.version=\$\{RELEASE_TAG\}"/) be_bad=1
        if (line !~ /--label[[:space:]]+"org\.opencontainers\.image\.revision=\$\{RELEASE_SHA\}"/) be_bad=1
        nver = gsub(/org\.opencontainers\.image\.version=\$\{RELEASE_TAG\}/, "&", line)
        nrev = gsub(/org\.opencontainers\.image\.revision=\$\{RELEASE_SHA\}/, "&", line)
        if (nver != 1 || nrev != 1) be_bad=1
      }
    }
    END { exit (fe == 1 && be == 1 && !fe_bad && !be_bad) ? 0 : 1 }
  ' "$docker_scan_file"; then
    printf '%s: frontend/backend 각 build 명령은 version·revision label을 정확히 하나씩 가져야 함\n' "$label" >&2
    exit 1
  fi

  # success-only retention: N=120, app repos only, keep IMAGE_TAG+PREV_TAG, under BACKUP_DIR
  require_exact 'backup retention N=120이어야 함' "BACKUP_RETENTION_N = '120'" 1
  require_at_least 'retention은 oss-hub-frontend app repo만 대상이어야 함' 'oss-hub-frontend' 1
  require_at_least 'retention은 oss-hub-backend app repo만 대상이어야 함' 'oss-hub-backend' 1
  require_regex_at_least 'retention은 현재 IMAGE_TAG를 보존해야 함' 'retention_keep_tags\+=\("\$\{IMAGE_TAG\}"\)' 1
  require_regex_at_least 'retention은 직전 PREV_TAG를 보존해야 함' 'retention_keep_tags\+=\("\$\{PREV_TAG\}"\)' 1
  require_exact 'backup cleanup은 같은 production pruner를 호출해야 함' \
    'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"' 1
  require_regex_at_least 'success-only image 삭제가 있어야 함' 'docker[[:space:]]+image[[:space:]]+rm[[:space:]]+' 1

  # Docker image inventory must be status-checked into a file before iteration.
  # Reject unchecked process substitution / swallowed producer failure (empty → successful no-op).
  require_regex_absent 'docker images process substitution inventory는 금지' \
    'done[[:space:]]*<[[:space:]]*<\([[:space:]]*docker[[:space:]]+images'
  if ! awk '
    {
      if ($0 ~ /docker[[:space:]]+images/) {
        imgs=1
        if ($0 ~ /\|\|[[:space:]]*true/ || $0 ~ /2>\/dev\/null/) swallow=1
        if ($0 ~ />/) redirect=1
      }
      if ($0 ~ /done[[:space:]]*<[[:space:]]*"\$/) fromfile=1
      if ($0 ~ /done[[:space:]]*<[[:space:]]*<\(/) procsub=1
      if ($0 ~ /images_inventory/ || $0 ~ /images_raw/) named=1
    }
    END { exit (imgs && redirect && fromfile && named && !swallow && !procsub) ? 0 : 1 }
  ' "$active_jenkinsfile"; then
    printf '%s: docker image inventory는 status-checked temp file 후 소비해야 함 (producer 실패 fail-open 금지)\n' "$label" >&2
    exit 1
  fi

  require_common_smoke_and_build_guards
  require_single_image_tag_assignment

  local checkout_line https_line rollback_stage_line rollback_input_line rollback_call_line
  local prisma_generate_line test_line
  local backup_line frontend_build_line backend_build_line migration_line rollout_line retention_line
  local image_rm_line backup_prune_line retention_stage_line
  checkout_line=$(line_of 'git checkout --detach "$RELEASE_SHA"')
  https_line=$(line_of 'FRONTEND_URL')
  rollback_stage_line=$(line_of "stage('롤백 이미지 사전 검증')")
  rollback_input_line=$(line_of "PREV_BE_IMAGE_ID=\${env.PREV_BE_IMAGE_ID ?: ''}")
  rollback_call_line=$(line_of "sh 'bash scripts/jenkins/validate-rollback-images.sh'")
  prisma_generate_line=$(line_of 'pnpm --filter backend exec prisma generate')
  test_line=$(line_of 'pnpm test')
  backup_line=$(line_of 'pg_dump')
  frontend_build_line=$(line_of_regex 'apps/frontend/Dockerfile')
  backend_build_line=$(line_of_regex 'apps/backend/Dockerfile')
  migration_line=$(line_of 'npx prisma migrate deploy')
  rollout_line=$(line_of 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait')
  retention_line=$(line_of "BACKUP_RETENTION_N = '120'")
  retention_stage_line=$(line_of "stage('성공 후 이미지·백업 보존 정리')")
  image_rm_line=$(line_of_regex 'docker[[:space:]]+image[[:space:]]+rm[[:space:]]+')
  backup_prune_line=$(line_of 'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"')

  if [[ -z "$checkout_line" || -z "$https_line" || -z "$rollback_stage_line" ||
         -z "$rollback_input_line" || -z "$rollback_call_line" || -z "$prisma_generate_line" || -z "$test_line" || -z "$backup_line" ||
        -z "$frontend_build_line" || -z "$backend_build_line" || -z "$migration_line" ||
        -z "$rollout_line" || -z "$retention_line" || -z "$retention_stage_line" ||
        -z "$image_rm_line" || -z "$backup_prune_line" ]]; then
    printf '%s: required stage markers missing for order check\n' "$label" >&2
    exit 1
  fi

  if ! ((checkout_line < https_line &&
         https_line < rollback_stage_line &&
          rollback_stage_line <= rollback_input_line &&
          rollback_input_line < rollback_call_line &&
          rollback_call_line < prisma_generate_line &&
         prisma_generate_line < test_line &&
         test_line < backup_line &&
         backup_line < frontend_build_line &&
         frontend_build_line < backend_build_line &&
         backend_build_line < migration_line &&
         migration_line < rollout_line &&
         rollout_line < retention_stage_line &&
         retention_stage_line < image_rm_line &&
         retention_stage_line < backup_prune_line)); then
    printf '%s: required order is checkout -> HTTPS+rollback preflight(input/call) -> generate/test -> backup -> two image builds -> migration -> rollout/smoke -> success-only image/backup deletion\n' "$label" >&2
    exit 1
  fi

  echo "$label: ok (parameterless latest Release, exact RELEASE_SHA checkout, RELEASE_TAG images, running-only no-op, fail-closed stopped/ambiguous, HTTPS+external rollback preflight, success-only retention)"
}

check_v2
