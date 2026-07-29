#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-jenkinsfile.sh"
legacy_source="$repo_root/Jenkinsfile"
v2_source="$repo_root/deploy/jenkins/Jenkinsfile.v2"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jenkinsfile-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  local mode=$2
  local path=$3

  if "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (성공해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  local mode=$2
  local path=$3

  if "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

make_fixture() {
  local source=$1
  local name=$2
  local pattern=$3
  local replacement=$4

  sed "s|$pattern|$replacement|" "$source" >"$fixture_dir/$name"
  if cmp -s "$source" "$fixture_dir/$name"; then
    printf 'fixture pattern not found: %s (%s)\n' "$pattern" "$name" >&2
    exit 1
  fi
}

append_fixture() {
  local source=$1
  local name=$2
  shift 2
  cp "$source" "$fixture_dir/$name"
  printf '%s\n' "$@" >>"$fixture_dir/$name"
}

# ---------------------------------------------------------------------------
# Legacy mode — root Jenkinsfile contract (unchanged)
# ---------------------------------------------------------------------------
cp "$legacy_source" "$fixture_dir/legacy-valid"
make_fixture "$legacy_source" legacy-missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture "$legacy_source" legacy-missing-production-label "label 'oss-hub-production'" "label 'any'"
make_fixture "$legacy_source" legacy-missing-release-tag "string(name: 'RELEASE_TAG'" "string(name: 'REMOVED_RELEASE_TAG'"
make_fixture "$legacy_source" legacy-main-mode-drift "env.RUN_MODE = 'main'" "env.RUN_MODE = 'release'"
make_fixture "$legacy_source" legacy-missing-created-action "action == 'created'" "action == 'removed'"
make_fixture "$legacy_source" legacy-missing-published-action "action == 'published'" "action == 'removed'"
make_fixture "$legacy_source" legacy-missing-latest-release '/releases/latest' '/releases/removed'
make_fixture "$legacy_source" legacy-missing-draft-check "jq -r '.draft'" "jq -r '.removedDraft'"
make_fixture "$legacy_source" legacy-missing-prerelease-check "jq -r '.prerelease'" "jq -r '.removedPrerelease'"
make_fixture "$legacy_source" legacy-missing-tag-format 'tag ==~ /' 'tag !=~ /'
make_fixture "$legacy_source" legacy-missing-tag-resolution 'git rev-parse "${RELEASE_TAG}^{commit}"' 'git rev-parse HEAD'
make_fixture "$legacy_source" legacy-missing-main-ancestry 'git merge-base --is-ancestor "$release_sha" origin/main' 'true'
make_fixture "$legacy_source" legacy-missing-approval-pagination 'for page in $(seq 1 20); do' 'for page in 1; do'
make_fixture "$legacy_source" legacy-missing-pm-approval "--arg actor 'GoBeromsu'" "--arg actor 'RemovedPm'"
make_fixture "$legacy_source" legacy-moving-checkout 'git checkout --detach "$IMAGE_TAG"' 'git checkout main'
make_fixture "$legacy_source" legacy-missing-noop-sort 'sort -V' 'sort'
make_fixture "$legacy_source" legacy-missing-retag-guard 'env.RELEASE_TAG == currentTag && env.IMAGE_TAG != env.CURRENT_DEPLOY_SHA' 'false'
make_fixture "$legacy_source" legacy-missing-state-file "DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'" "DEPLOY_STATE_FILE = '/tmp/current-release'"
make_fixture "$legacy_source" legacy-missing-prisma-generate 'pnpm --filter backend exec prisma generate' 'true'
make_fixture "$legacy_source" legacy-missing-test 'pnpm test' 'true'
make_fixture "$legacy_source" legacy-missing-backup 'pg_dump' 'pg_isready'
make_fixture "$legacy_source" legacy-missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture "$legacy_source" legacy-missing-no-build 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --wait'
make_fixture "$legacy_source" legacy-missing-state-update 'mv "$state_tmp" "$DEPLOY_STATE_FILE"' 'true'
make_fixture "$legacy_source" legacy-missing-rollback-guard 'if (env.PREV_TAG?.trim())' 'if (false)'
make_fixture "$legacy_source" legacy-missing-production-credential "credentialsId: 'oss-hub-production-env'" "credentialsId: 'removed'"
make_fixture "$legacy_source" legacy-missing-stopped-container-scan 'ps --all -q' 'ps -q'

append_fixture "$legacy_source" legacy-destructive-volume-removal 'docker compose down -v'
append_fixture "$legacy_source" legacy-main-auto-deploy "branch 'main'"
append_fixture "$legacy_source" legacy-duplicate-frontend-build 'docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .'
append_fixture "$legacy_source" legacy-duplicate-state-update 'mv "$state_tmp" "$DEPLOY_STATE_FILE"'
append_fixture "$legacy_source" legacy-reassigned-image-tag "env.IMAGE_TAG = 'latest'"
append_fixture "$legacy_source" legacy-exported-image-tag "sh 'export IMAGE_TAG=latest'"
append_fixture "$legacy_source" legacy-bracket-image-tag "env['IMAGE_TAG'] = 'latest'"
cp "$legacy_source" "$fixture_dir/legacy-quoted-image-tag"
printf '\nenv."IMAGE_TAG" = '\''latest'\''\n' >>"$fixture_dir/legacy-quoted-image-tag"
append_fixture "$legacy_source" legacy-extra-image-build "sh 'docker image build --tag extra:latest .'"
append_fixture "$legacy_source" legacy-compose-image-build "sh 'docker compose build'"
append_fixture "$legacy_source" legacy-compose-up-build "sh 'docker compose up -d --build'"

cp "$legacy_source" "$fixture_dir/legacy-continued-image-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker image \'
  printf '%s\n' '    build --tag extra:latest .'
  printf "'''\n"
} >>"$fixture_dir/legacy-continued-image-build"

cp "$legacy_source" "$fixture_dir/legacy-continued-volume-removal"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose down \'
  printf '%s\n' '    --volumes'
  printf "'''\n"
} >>"$fixture_dir/legacy-continued-volume-removal"

sed \
  -e "s|--arg actor 'GoBeromsu'|--arg actor 'Lumiere001'|" \
  -e 's|RELEASE_ACCEPT role=PM tag=${RELEASE_TAG} head=${IMAGE_TAG}|RELEASE_ACCEPT role=TECH_LEAD tag=${RELEASE_TAG} head=${IMAGE_TAG}|' \
  "$legacy_source" >"$fixture_dir/legacy-tech-lead-only-no-pm-accept"
if cmp -s "$legacy_source" "$fixture_dir/legacy-tech-lead-only-no-pm-accept"; then
  printf 'fixture pattern not found: legacy-tech-lead-only-no-pm-accept\n' >&2
  exit 1
fi

# comment-only marker spoof must not pass legacy mode
cp "$legacy_source" "$fixture_dir/legacy-comment-spoof-concurrency"
sed "s|disableConcurrentBuilds()|// disableConcurrentBuilds()|" \
  "$legacy_source" >"$fixture_dir/legacy-comment-spoof-concurrency"
if cmp -s "$legacy_source" "$fixture_dir/legacy-comment-spoof-concurrency"; then
  printf 'fixture pattern not found: legacy-comment-spoof-concurrency\n' >&2
  exit 1
fi

expect_pass 'legacy: 현재 Release 배포 계약' legacy "$fixture_dir/legacy-valid"
expect_pass 'legacy: 기본 인자 호환 (mode=legacy path)' legacy "$legacy_source"
expect_fail 'legacy: 동시 배포 방지 누락' legacy "$fixture_dir/legacy-missing-concurrency"
expect_fail 'legacy: 전용 production executor 누락' legacy "$fixture_dir/legacy-missing-production-label"
expect_fail 'legacy: Release tag 입력 누락' legacy "$fixture_dir/legacy-missing-release-tag"
expect_fail 'legacy: 빈 입력의 main 검증 경계 drift' legacy "$fixture_dir/legacy-main-mode-drift"
expect_fail 'legacy: created 이벤트 허용 누락' legacy "$fixture_dir/legacy-missing-created-action"
expect_fail 'legacy: published 이벤트 허용 누락' legacy "$fixture_dir/legacy-missing-published-action"
expect_fail 'legacy: latest full Release 검증 누락' legacy "$fixture_dir/legacy-missing-latest-release"
expect_fail 'legacy: draft 거절 누락' legacy "$fixture_dir/legacy-missing-draft-check"
expect_fail 'legacy: prerelease 거절 누락' legacy "$fixture_dir/legacy-missing-prerelease-check"
expect_fail 'legacy: SemVer tag 검증 누락' legacy "$fixture_dir/legacy-missing-tag-format"
expect_fail 'legacy: Release tag SHA 해석 누락' legacy "$fixture_dir/legacy-missing-tag-resolution"
expect_fail 'legacy: main ancestry 검증 누락' legacy "$fixture_dir/legacy-missing-main-ancestry"
expect_fail 'legacy: Release 승인 댓글 pagination 누락' legacy "$fixture_dir/legacy-missing-approval-pagination"
expect_fail 'legacy: PM Release 승인 검증 누락' legacy "$fixture_dir/legacy-missing-pm-approval"
expect_fail 'legacy: 정확한 SHA checkout 누락' legacy "$fixture_dir/legacy-moving-checkout"
expect_fail 'legacy: 동일·하위 버전 no-op 비교 누락' legacy "$fixture_dir/legacy-missing-noop-sort"
expect_fail 'legacy: 동일 Release tag의 SHA 변경 차단 누락' legacy "$fixture_dir/legacy-missing-retag-guard"
expect_fail 'legacy: 영속 배포 상태 경로 누락' legacy "$fixture_dir/legacy-missing-state-file"
expect_fail 'legacy: 명시적 Prisma client 생성 누락' legacy "$fixture_dir/legacy-missing-prisma-generate"
expect_fail 'legacy: 배포 전 test 누락' legacy "$fixture_dir/legacy-missing-test"
expect_fail 'legacy: migration 전 backup 누락' legacy "$fixture_dir/legacy-missing-backup"
expect_fail 'legacy: Prisma migration 누락' legacy "$fixture_dir/legacy-missing-migration"
expect_fail 'legacy: Compose 교체의 --no-build 누락' legacy "$fixture_dir/legacy-missing-no-build"
expect_fail 'legacy: 성공 상태 원자 갱신 누락' legacy "$fixture_dir/legacy-missing-state-update"
expect_fail 'legacy: 이전 이미지 rollback guard 누락' legacy "$fixture_dir/legacy-missing-rollback-guard"
expect_fail 'legacy: 운영 환경 credential 주입 누락' legacy "$fixture_dir/legacy-missing-production-credential"
expect_fail 'legacy: 중지 container rollback 기준 누락' legacy "$fixture_dir/legacy-missing-stopped-container-scan"
expect_fail 'legacy: main production 자동 배포 재도입' legacy "$fixture_dir/legacy-main-auto-deploy"
expect_fail 'legacy: 영속 volume 파괴 명령 추가' legacy "$fixture_dir/legacy-destructive-volume-removal"
expect_fail 'legacy: frontend 이미지 중복 빌드' legacy "$fixture_dir/legacy-duplicate-frontend-build"
expect_fail 'legacy: 성공 상태 중복 갱신' legacy "$fixture_dir/legacy-duplicate-state-update"
expect_fail 'legacy: IMAGE_TAG 재할당' legacy "$fixture_dir/legacy-reassigned-image-tag"
expect_fail 'legacy: shell IMAGE_TAG export' legacy "$fixture_dir/legacy-exported-image-tag"
expect_fail 'legacy: bracket IMAGE_TAG 재할당' legacy "$fixture_dir/legacy-bracket-image-tag"
expect_fail 'legacy: quoted IMAGE_TAG 재할당' legacy "$fixture_dir/legacy-quoted-image-tag"
expect_fail 'legacy: 추가 Docker image build' legacy "$fixture_dir/legacy-extra-image-build"
expect_fail 'legacy: Compose image build' legacy "$fixture_dir/legacy-compose-image-build"
expect_fail 'legacy: Compose up --build' legacy "$fixture_dir/legacy-compose-up-build"
expect_fail 'legacy: 줄 연속 Docker image build' legacy "$fixture_dir/legacy-continued-image-build"
expect_fail 'legacy: 줄 연속 volume 삭제' legacy "$fixture_dir/legacy-continued-volume-removal"
expect_fail 'legacy: TECH_LEAD accept만 있고 PM accept 없음' legacy "$fixture_dir/legacy-tech-lead-only-no-pm-accept"
expect_fail 'legacy: 주석만으로 concurrency marker spoof' legacy "$fixture_dir/legacy-comment-spoof-concurrency"

# default path without explicit mode still validates legacy
if "$checker" "$fixture_dir/legacy-valid" >/dev/null 2>&1; then
  printf 'ok - legacy: 기본 path-only 호출\n'
  passed=$((passed + 1))
else
  printf 'not ok - legacy: 기본 path-only 호출 (성공해야 하지만 실패)\n' >&2
  failed=$((failed + 1))
fi

# ---------------------------------------------------------------------------
# V2 mode — candidate contract (independent invariants)
# ---------------------------------------------------------------------------
cp "$v2_source" "$fixture_dir/v2-valid"
make_fixture "$v2_source" v2-missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture "$v2_source" v2-missing-production-label "label 'oss-hub-production'" "label 'any'"
make_fixture "$v2_source" v2-missing-latest-release '/releases/latest' '/releases/removed'
make_fixture "$v2_source" v2-missing-draft-check "jq -r '.draft'" "jq -r '.removedDraft'"
make_fixture "$v2_source" v2-missing-prerelease-check "jq -r '.prerelease'" "jq -r '.removedPrerelease'"
make_fixture "$v2_source" v2-missing-tag-format 'tag ==~ /' 'tag !=~ /'
make_fixture "$v2_source" v2-missing-tag-resolution 'git rev-parse "${RELEASE_TAG}^{commit}"' 'git rev-parse HEAD'
make_fixture "$v2_source" v2-missing-main-ancestry 'git merge-base --is-ancestor "$release_sha" origin/main' 'true'
make_fixture "$v2_source" v2-missing-approval-pagination 'for page in $(seq 1 20); do' 'for page in 1; do'
make_fixture "$v2_source" v2-missing-pm-approval "--arg actor 'GoBeromsu'" "--arg actor 'RemovedPm'"
make_fixture "$v2_source" v2-moving-checkout 'git checkout --detach "$RELEASE_SHA"' 'git checkout main'
make_fixture "$v2_source" v2-missing-image-tag-release 'env.IMAGE_TAG = tag' 'env.IMAGE_TAG = releaseSha'
make_fixture "$v2_source" v2-missing-release-sha-binding 'env.RELEASE_SHA = releaseSha' 'env.RELEASE_SHA = env.IMAGE_TAG'
make_fixture "$v2_source" v2-missing-pm-sha-approval 'RELEASE_ACCEPT role=PM tag=${RELEASE_TAG} head=${RELEASE_SHA}' 'RELEASE_ACCEPT role=PM tag=${RELEASE_TAG} head=${IMAGE_TAG}'
make_fixture "$v2_source" v2-missing-prisma-generate 'pnpm --filter backend exec prisma generate' 'true'
make_fixture "$v2_source" v2-missing-test 'pnpm test' 'true'
make_fixture "$v2_source" v2-missing-backup 'pg_dump' 'pg_isready'
make_fixture "$v2_source" v2-missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture "$v2_source" v2-missing-no-build 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --wait'
make_fixture "$v2_source" v2-missing-rollback-guard 'if (env.PREV_TAG?.trim())' 'if (false)'
make_fixture "$v2_source" v2-missing-production-credential "credentialsId: 'oss-hub-production-env'" "credentialsId: 'removed'"
make_fixture "$v2_source" v2-missing-running-ps-q 'ps -q frontend' 'ps --status frontend'
make_fixture "$v2_source" v2-missing-all-ps 'ps --all -q frontend' 'ps -q frontend-all'
make_fixture "$v2_source" v2-missing-oci-version-label '--label "org.opencontainers.image.version=${RELEASE_TAG}"' '--label "org.opencontainers.image.title=${RELEASE_TAG}"'
make_fixture "$v2_source" v2-missing-oci-revision-label '--label "org.opencontainers.image.revision=${RELEASE_SHA}"' '--label "org.opencontainers.image.source=${RELEASE_SHA}"'
make_fixture "$v2_source" v2-restored-run-mode "env.DEPLOY_NOOP = 'false'" "env.RUN_MODE = 'release'"
make_fixture "$v2_source" v2-restored-deploy-state-file "BACKUP_DIR = '/var/lib/oss-hub/backups'" "DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'"

# parameters 블록 부활 → FAIL
{
  printf '%s\n' 'pipeline {'
  printf '%s\n' '  parameters {'
  printf '%s\n' "    string(name: 'RELEASE_ACTION', defaultValue: '', description: 'x')"
  printf '%s\n' "    string(name: 'RELEASE_TAG', defaultValue: '', description: 'x')"
  printf '%s\n' '  }'
  tail -n +2 "$v2_source"
} >"$fixture_dir/v2-restored-parameters"
if cmp -s "$v2_source" "$fixture_dir/v2-restored-parameters"; then
  printf 'fixture not distinct: v2-restored-parameters\n' >&2
  exit 1
fi

sed \
  -e "s|--arg actor 'GoBeromsu'|--arg actor 'Lumiere001'|" \
  -e 's|RELEASE_ACCEPT role=PM tag=${RELEASE_TAG} head=${RELEASE_SHA}|RELEASE_ACCEPT role=TECH_LEAD tag=${RELEASE_TAG} head=${RELEASE_SHA}|' \
  "$v2_source" >"$fixture_dir/v2-restored-tech-lead-accept"
if cmp -s "$v2_source" "$fixture_dir/v2-restored-tech-lead-accept"; then
  printf 'fixture pattern not found: v2-restored-tech-lead-accept\n' >&2
  exit 1
fi

append_fixture "$v2_source" v2-destructive-volume-removal 'docker compose down -v'
append_fixture "$v2_source" v2-main-auto-deploy "branch 'main'"
append_fixture "$v2_source" v2-duplicate-frontend-build 'docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .'
append_fixture "$v2_source" v2-reassigned-image-tag "env.IMAGE_TAG = 'latest'"
append_fixture "$v2_source" v2-exported-image-tag "sh 'export IMAGE_TAG=latest'"
append_fixture "$v2_source" v2-extra-image-build "sh 'docker image build --tag extra:latest .'"
append_fixture "$v2_source" v2-compose-image-build "sh 'docker compose build'"
append_fixture "$v2_source" v2-compose-up-build "sh 'docker compose up -d --build'"

cp "$v2_source" "$fixture_dir/v2-continued-image-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker image \'
  printf '%s\n' '    build --tag extra:latest .'
  printf "'''\n"
} >>"$fixture_dir/v2-continued-image-build"

cp "$v2_source" "$fixture_dir/v2-continued-volume-removal"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose down \'
  printf '%s\n' '    --volumes'
  printf "'''\n"
} >>"$fixture_dir/v2-continued-volume-removal"

# --- Architecture blocker synthetic mutations (independent of checker text) ---

# 1) SemVer downgrade: mutate the bounded comparison (cmp < 0 → cmp > 0)
make_fixture "$v2_source" v2-blocker-downgrade-cmp-flipped 'if (cmp < 0)' 'if (cmp > 0)'

# 1b) SemVer downgrade: mutate the no-op assignment inside the cmp branch
awk '
  /if \(cmp < 0\) \{/ { print; getline; sub(/DEPLOY_NOOP = '\''true'\''/, "DEPLOY_NOOP = '\''false'\''"); print; next }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-downgrade-noop-false"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-downgrade-noop-false"; then
  printf 'fixture not distinct: v2-blocker-downgrade-noop-false\n' >&2
  exit 1
fi

# 2) stopped container: keep diagnostic marker, remove terminal exit → proceeds
awk '
  /FAIL_CLOSED stopped_container/ {
    print
    # drop following terminal exit line(s) until fi, keep diagnostics
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) continue
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-stopped-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture not distinct: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi
# sanity: diagnostic remains, terminal exit in stopped branch is gone
if ! grep -Fq 'FAIL_CLOSED stopped_container' "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture lost diagnostic: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi
if awk '
  /FAIL_CLOSED stopped_container/ { grab=1; next }
  grab {
    if ($0 ~ /exit[[:space:]]+[0-9]+/) found=1
    if ($0 ~ /^[[:space:]]*fi[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture still terminals: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi

# 2b) non-running probe state: keep condition, remove terminal error(...)
awk '
  /if \(state != '\''running'\''\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /error[[:space:]]*\(/) continue
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-ambiguous-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture not distinct: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi
if ! grep -Fq "if (state != 'running')" "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture lost condition: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi
if awk '
  /if \(state != '\''running'\''\) \{/ { grab=1; next }
  grab {
    if ($0 ~ /error[[:space:]]*\(/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture still terminals: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi

# 2c) partial deployment: keep diagnostic, remove terminal exit
awk '
  /FAIL_CLOSED partial_deployment/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) continue
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-partial-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-partial-proceeds"; then
  printf 'fixture not distinct: v2-blocker-partial-proceeds\n' >&2
  exit 1
fi
if ! grep -Fq 'FAIL_CLOSED partial_deployment' "$fixture_dir/v2-blocker-partial-proceeds"; then
  printf 'fixture lost diagnostic: v2-blocker-partial-proceeds\n' >&2
  exit 1
fi

# 3) same-tag/different-SHA: keep condition + diagnostic text, remove terminal error(...)
awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ {
    print
    while ((getline line) > 0) {
      if (index(line, "error(") > 0) {
        # keep diagnostic marker text as a non-terminal echo
        print "              echo \"FAIL_CLOSED same_tag_different_sha: retag SHA mismatch (non-terminal)\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-same-tag-different-sha-removed"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture not distinct: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if ! grep -Fq 'prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA' \
  "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture lost condition: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if ! grep -Fq 'FAIL_CLOSED same_tag_different_sha' \
  "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture lost diagnostic: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ { grab=1; next }
  grab {
    if (index($0, "error(") > 0) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture still terminals: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi

# 4) missing rollback image/label validation (image inspect preflight gone)
make_fixture "$v2_source" v2-blocker-missing-rollback-inspect \
  'docker image inspect' \
  'docker image history'

# 4b) rollback Image ID binding removed/inverted
make_fixture "$v2_source" v2-blocker-rollback-id-unbound \
  '"$fe_id" != "$PREV_FE_IMAGE_ID"' \
  '"$fe_id" == "$PREV_FE_IMAGE_ID"'

# 5a) HTTP FRONTEND_URL acceptance
make_fixture "$v2_source" v2-blocker-http-frontend-url \
  'https://\*)' \
  'http://*)'

# 5b) missing FRONTEND_URL acceptance
make_fixture "$v2_source" v2-blocker-missing-frontend-url \
  'FRONTEND_URL' \
  'FRONTEND_ORIGIN'

# 5c) duplicate FRONTEND_URL rejection inverted in both assignment orders.
# Both remove the count!=1 terminal rejection while leaving https:// scheme check intact.
# Order annotations document HTTPS→HTTP and HTTP→HTTPS; uniqueness failure is order-independent.
python3 - "$v2_source" "$fixture_dir" <<'PYDUP'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text()
out_dir = Path(sys.argv[2])

# Remove the terminal uniqueness rejection body (exit 3), keep count==0 missing path.
old = """      if (count != 1) {
        exit 3
      }
"""
if old not in src:
    raise SystemExit('FRONTEND_URL uniqueness block not found')

# HTTPS then HTTP: uniqueness inverted; first-value wins semantics implied.
https_http = src.replace(
    old,
    """      if (count != 1) {
        # uniqueness inverted (order: HTTPS then HTTP) — extras ignored, no terminal reject
      }
""",
    1,
)
# HTTP then HTTPS: same uniqueness inversion, distinct order annotation.
http_https = src.replace(
    old,
    """      if (count != 1) {
        # uniqueness inverted (order: HTTP then HTTPS) — extras ignored, no terminal reject
      }
""",
    1,
)
if https_http == src or http_https == src:
    raise SystemExit('duplicate FRONTEND_URL fixtures not distinct from source')
if https_http == http_https:
    raise SystemExit('duplicate FRONTEND_URL order fixtures not distinct from each other')
(out_dir / 'v2-blocker-duplicate-frontend-url-https-http').write_text(https_http)
(out_dir / 'v2-blocker-duplicate-frontend-url-http-https').write_text(http_https)
PYDUP

# 5d) each authoritative compose ps probe swallows nonzero status
# (avoid make_fixture/sed '|' delimiter — replacement contains '||')
python3 - "$v2_source" "$fixture_dir" <<'PYPS'
from pathlib import Path
import sys
src_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
src = src_path.read_text()
specs = [
    (
        "v2-blocker-ps-fe-running-swallowed",
        'fe_running="$("${compose[@]}" ps -q frontend)"',
        'fe_running="$("${compose[@]}" ps -q frontend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-be-running-swallowed",
        'be_running="$("${compose[@]}" ps -q backend)"',
        'be_running="$("${compose[@]}" ps -q backend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-fe-all-swallowed",
        'fe_all="$("${compose[@]}" ps --all -q frontend)"',
        'fe_all="$("${compose[@]}" ps --all -q frontend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-be-all-swallowed",
        'be_all="$("${compose[@]}" ps --all -q backend)"',
        'be_all="$("${compose[@]}" ps --all -q backend 2>/dev/null || true)"',
    ),
]
for name, old, new in specs:
    if old not in src:
        raise SystemExit(f"ps fixture pattern missing: {name}: {old!r}")
    out = src.replace(old, new, 1)
    if out == src:
        raise SystemExit(f"ps fixture not distinct: {name}")
    (out_dir / name).write_text(out)
PYPS

# 5e) docker image inventory fail-open via unchecked process substitution
python3 - "$v2_source" "$fixture_dir/v2-blocker-image-inventory-fail-open" <<'PYFIXTURE'
from pathlib import Path
import re
import sys
src = Path(sys.argv[1]).read_text()
pat = re.compile(
    r"# docker images 포맷:.*?\ndone < \"\$images_inventory\"\n",
    re.S,
)
repl = (
    "# docker images 포맷: repository:tag. dangling/untagged 는 스킵.\n"
    "# FAIL-OPEN mutation: unchecked process substitution swallows docker images failure\n"
    "while IFS=\"$(printf '\\t')\" read -r repo tag image_id; do\n"
    "  [ -n \"$repo\" ] || continue\n"
    "  [ -n \"$tag\" ] || continue\n"
    "  [ \"$tag\" = \"<none>\" ] && continue\n"
    "  case \"$repo\" in\n"
    "    oss-hub-frontend|oss-hub-backend) ;;\n"
    "    *) continue ;;\n"
    "  esac\n"
    "  if is_kept_tag \"$tag\"; then\n"
    "    continue\n"
    "  fi\n"
    "  # 결정적 삭제. 참조 중이면 실패 → fail-closed.\n"
    "  docker image rm \"${repo}:${tag}\"\n"
    "done < <(docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.ID}}')\n"
)
out, n = pat.subn(repl, src, count=1)
if n != 1:
    raise SystemExit(f'inventory block not replaced: n={n}')
Path(sys.argv[2]).write_text(out)
PYFIXTURE
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-image-inventory-fail-open"; then
  printf 'fixture not distinct: v2-blocker-image-inventory-fail-open\n' >&2
  exit 1
fi
if ! grep -Eq 'done[[:space:]]*<[[:space:]]*<\([[:space:]]*docker[[:space:]]+images' \
  "$fixture_dir/v2-blocker-image-inventory-fail-open"; then
  printf 'fixture missing procsub: v2-blocker-image-inventory-fail-open\n' >&2
  exit 1
fi

# 6) destructive retention commands moved before smoke (not keep-tag marker arrays)
awk '
  {
    if ($0 ~ /docker[[:space:]]+image[[:space:]]+rm[[:space:]]+"/ ||
        index($0, "bash scripts/prune-deploy-backups.sh") > 0) {
      pending = pending $0 ORS
      next
    }
    buf[++n] = $0
    if (!inject_at && index($0, "pg_dump") > 0) inject_at = n
  }
  END {
    for (i = 1; i <= n; i++) {
      print buf[i]
      if (i == inject_at) printf "%s", pending
    }
  }
' "$v2_source" >"$fixture_dir/v2-blocker-retention-before-smoke"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-retention-before-smoke"; then
  printf 'fixture not distinct: v2-blocker-retention-before-smoke\n' >&2
  exit 1
fi
# sanity: destructive commands must precede smoke rollout in the fixture
rollout_ln=$(grep -nF 'up -d --no-build --wait' "$fixture_dir/v2-blocker-retention-before-smoke" | head -n1 | cut -d: -f1)
image_rm_ln=$(grep -nE 'docker[[:space:]]+image[[:space:]]+rm[[:space:]]+' "$fixture_dir/v2-blocker-retention-before-smoke" | head -n1 | cut -d: -f1)
if [[ -z "$rollout_ln" || -z "$image_rm_ln" || ! ((image_rm_ln < rollout_ln)) ]]; then
  printf 'fixture order broken: v2-blocker-retention-before-smoke (rm=%s rollout=%s)\n' "$image_rm_ln" "$rollout_ln" >&2
  exit 1
fi

# 6b) image deletion command removed entirely
make_fixture "$v2_source" v2-blocker-missing-image-rm \
  'docker image rm "${repo}:${tag}"' \
  'echo "skip image rm ${repo}:${tag}"'

# 6c) production backup pruner 호출 제거
make_fixture "$v2_source" v2-blocker-missing-backup-rm \
  'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"' \
  'echo "skip backup pruning"'

# 7) current/previous image preservation removed
make_fixture "$v2_source" v2-blocker-no-image-preserve-current \
  'retention_keep_tags+=("${IMAGE_TAG}")' \
  'retention_keep_tags+=("never-match-current")'
make_fixture "$v2_source" v2-blocker-no-image-preserve-previous \
  'retention_keep_tags+=("${PREV_TAG}")' \
  'retention_keep_tags+=("never-match-previous")'

# 8) independent per-build OCI label mutations (frontend-only / backend-only)
awk '
  BEGIN { fe=0 }
  {
    if ($0 ~ /--file apps\/frontend\/Dockerfile/) {
      fe=1
      print
      next
    }
    if (fe && $0 ~ /--label "org.opencontainers.image.version=\$\{RELEASE_TAG\}"/) {
      sub(/org.opencontainers.image.version/, "org.opencontainers.image.title")
      fe=0
    }
    if ($0 ~ /--file apps\/backend\/Dockerfile/) fe=0
    print
  }
' "$v2_source" >"$fixture_dir/v2-blocker-frontend-missing-version-label"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-frontend-missing-version-label"; then
  printf 'fixture not distinct: v2-blocker-frontend-missing-version-label\n' >&2
  exit 1
fi

awk '
  BEGIN { be=0 }
  {
    if ($0 ~ /--file apps\/backend\/Dockerfile/) {
      be=1
      print
      next
    }
    if (be && $0 ~ /--label "org.opencontainers.image.revision=\$\{RELEASE_SHA\}"/) {
      sub(/org.opencontainers.image.revision/, "org.opencontainers.image.source")
      be=0
    }
    print
  }
' "$v2_source" >"$fixture_dir/v2-blocker-backend-missing-revision-label"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-backend-missing-revision-label"; then
  printf 'fixture not distinct: v2-blocker-backend-missing-revision-label\n' >&2
  exit 1
fi

# comment-only marker spoof must not pass v2 mode
sed "s|disableConcurrentBuilds()|// disableConcurrentBuilds()|" \
  "$v2_source" >"$fixture_dir/v2-comment-spoof-concurrency"
if cmp -s "$v2_source" "$fixture_dir/v2-comment-spoof-concurrency"; then
  printf 'fixture pattern not found: v2-comment-spoof-concurrency\n' >&2
  exit 1
fi

# spoof: comment-only cmp/downgrade text must not satisfy the bounded branch
awk '
  /if \(cmp < 0\) \{/ {
    print "              // if (cmp < 0) { env.DEPLOY_NOOP = '\''true'\''; return }"
    print "            if (cmp > 0) {"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-comment-spoof-downgrade"
if cmp -s "$v2_source" "$fixture_dir/v2-comment-spoof-downgrade"; then
  printf 'fixture pattern not found: v2-comment-spoof-downgrade\n' >&2
  exit 1
fi

expect_pass 'v2: 현재 candidate Release 배포 계약' v2 "$fixture_dir/v2-valid"
expect_pass 'v2: 기본 path 호출' v2 "$v2_source"
expect_fail 'v2: parameters 블록 부활' v2 "$fixture_dir/v2-restored-parameters"
expect_fail 'v2: DEPLOY_STATE_FILE 부활' v2 "$fixture_dir/v2-restored-deploy-state-file"
expect_fail 'v2: RELEASE_ACCEPT role=TECH_LEAD 부활' v2 "$fixture_dir/v2-restored-tech-lead-accept"
expect_fail 'v2: releases/latest 조회 제거' v2 "$fixture_dir/v2-missing-latest-release"
expect_fail 'v2: RUN_MODE 부활' v2 "$fixture_dir/v2-restored-run-mode"
expect_fail 'v2: 동시 배포 방지 누락' v2 "$fixture_dir/v2-missing-concurrency"
expect_fail 'v2: 전용 production executor 누락' v2 "$fixture_dir/v2-missing-production-label"
expect_fail 'v2: draft 거절 누락' v2 "$fixture_dir/v2-missing-draft-check"
expect_fail 'v2: prerelease 거절 누락' v2 "$fixture_dir/v2-missing-prerelease-check"
expect_fail 'v2: SemVer tag 검증 누락' v2 "$fixture_dir/v2-missing-tag-format"
expect_fail 'v2: Release tag SHA 해석 누락' v2 "$fixture_dir/v2-missing-tag-resolution"
expect_fail 'v2: main ancestry 검증 누락' v2 "$fixture_dir/v2-missing-main-ancestry"
expect_fail 'v2: Release 승인 댓글 pagination 누락' v2 "$fixture_dir/v2-missing-approval-pagination"
expect_fail 'v2: PM Release 승인 검증 누락' v2 "$fixture_dir/v2-missing-pm-approval"
expect_fail 'v2: 정확한 RELEASE_SHA checkout 누락' v2 "$fixture_dir/v2-moving-checkout"
expect_fail 'v2: IMAGE_TAG=RELEASE_TAG 계약 파손' v2 "$fixture_dir/v2-missing-image-tag-release"
expect_fail 'v2: RELEASE_SHA 바인딩 파손' v2 "$fixture_dir/v2-missing-release-sha-binding"
expect_fail 'v2: PM 승인 head=RELEASE_SHA 파손' v2 "$fixture_dir/v2-missing-pm-sha-approval"
expect_fail 'v2: 명시적 Prisma client 생성 누락' v2 "$fixture_dir/v2-missing-prisma-generate"
expect_fail 'v2: 배포 전 test 누락' v2 "$fixture_dir/v2-missing-test"
expect_fail 'v2: migration 전 backup 누락' v2 "$fixture_dir/v2-missing-backup"
expect_fail 'v2: Prisma migration 누락' v2 "$fixture_dir/v2-missing-migration"
expect_fail 'v2: Compose 교체의 --no-build 누락' v2 "$fixture_dir/v2-missing-no-build"
expect_fail 'v2: 이전 이미지 rollback guard 누락' v2 "$fixture_dir/v2-missing-rollback-guard"
expect_fail 'v2: 운영 환경 credential 주입 누락' v2 "$fixture_dir/v2-missing-production-credential"
expect_fail 'v2: 실행 중 ps -q 권위 누락' v2 "$fixture_dir/v2-missing-running-ps-q"
expect_fail 'v2: 존재 분류 ps --all 누락' v2 "$fixture_dir/v2-missing-all-ps"
expect_fail 'v2: OCI version label 누락' v2 "$fixture_dir/v2-missing-oci-version-label"
expect_fail 'v2: OCI revision label 누락' v2 "$fixture_dir/v2-missing-oci-revision-label"
expect_fail 'v2: main production 자동 배포 재도입' v2 "$fixture_dir/v2-main-auto-deploy"
expect_fail 'v2: 영속 volume 파괴 명령 추가' v2 "$fixture_dir/v2-destructive-volume-removal"
expect_fail 'v2: frontend 이미지 중복 빌드' v2 "$fixture_dir/v2-duplicate-frontend-build"
expect_fail 'v2: IMAGE_TAG 재할당' v2 "$fixture_dir/v2-reassigned-image-tag"
expect_fail 'v2: shell IMAGE_TAG export' v2 "$fixture_dir/v2-exported-image-tag"
expect_fail 'v2: 추가 Docker image build' v2 "$fixture_dir/v2-extra-image-build"
expect_fail 'v2: Compose image build' v2 "$fixture_dir/v2-compose-image-build"
expect_fail 'v2: Compose up --build' v2 "$fixture_dir/v2-compose-up-build"
expect_fail 'v2: 줄 연속 Docker image build' v2 "$fixture_dir/v2-continued-image-build"
expect_fail 'v2: 줄 연속 volume 삭제' v2 "$fixture_dir/v2-continued-volume-removal"

# architecture blockers
expect_fail 'v2 blocker: SemVer downgrade cmp 조건 반전' v2 "$fixture_dir/v2-blocker-downgrade-cmp-flipped"
expect_fail 'v2 blocker: SemVer downgrade DEPLOY_NOOP 할당 파손' v2 "$fixture_dir/v2-blocker-downgrade-noop-false"
expect_fail 'v2 blocker: stopped 상태 단말 실패 제거' v2 "$fixture_dir/v2-blocker-stopped-proceeds"
expect_fail 'v2 blocker: ambiguous/non-running 단말 실패 제거' v2 "$fixture_dir/v2-blocker-ambiguous-proceeds"
expect_fail 'v2 blocker: partial 상태 단말 실패 제거' v2 "$fixture_dir/v2-blocker-partial-proceeds"
expect_fail 'v2 blocker: same-tag different-SHA fail-closed 제거' v2 "$fixture_dir/v2-blocker-same-tag-different-sha-removed"
expect_fail 'v2 blocker: rollback image/label 검증 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-inspect"
expect_fail 'v2 blocker: rollback Image ID 바인딩 파손' v2 "$fixture_dir/v2-blocker-rollback-id-unbound"
expect_fail 'v2 blocker: HTTP FRONTEND_URL 허용' v2 "$fixture_dir/v2-blocker-http-frontend-url"
expect_fail 'v2 blocker: FRONTEND_URL 누락 허용' v2 "$fixture_dir/v2-blocker-missing-frontend-url"
expect_fail 'v2 blocker: 중복 FRONTEND_URL (HTTPS→HTTP) 허용' v2 "$fixture_dir/v2-blocker-duplicate-frontend-url-https-http"
expect_fail 'v2 blocker: 중복 FRONTEND_URL (HTTP→HTTPS) 허용' v2 "$fixture_dir/v2-blocker-duplicate-frontend-url-http-https"
expect_fail 'v2 blocker: ps -q frontend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-fe-running-swallowed"
expect_fail 'v2 blocker: ps -q backend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-be-running-swallowed"
expect_fail 'v2 blocker: ps --all -q frontend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-fe-all-swallowed"
expect_fail 'v2 blocker: ps --all -q backend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-be-all-swallowed"
expect_fail 'v2 blocker: docker images inventory producer fail-open' v2 "$fixture_dir/v2-blocker-image-inventory-fail-open"
expect_fail 'v2 blocker: destructive retention이 smoke 이전으로 이동' v2 "$fixture_dir/v2-blocker-retention-before-smoke"
expect_fail 'v2 blocker: docker image rm 삭제 명령 누락' v2 "$fixture_dir/v2-blocker-missing-image-rm"
expect_fail 'v2 blocker: production backup pruner 호출 누락' v2 "$fixture_dir/v2-blocker-missing-backup-rm"
expect_fail 'v2 blocker: 현재 IMAGE_TAG 보존 제거' v2 "$fixture_dir/v2-blocker-no-image-preserve-current"
expect_fail 'v2 blocker: 직전 PREV_TAG 보존 제거' v2 "$fixture_dir/v2-blocker-no-image-preserve-previous"
expect_fail 'v2 blocker: frontend build version label 단독 누락' v2 "$fixture_dir/v2-blocker-frontend-missing-version-label"
expect_fail 'v2 blocker: backend build revision label 단독 누락' v2 "$fixture_dir/v2-blocker-backend-missing-revision-label"
expect_fail 'v2: 주석만으로 concurrency marker spoof' v2 "$fixture_dir/v2-comment-spoof-concurrency"
expect_fail 'v2: 주석만으로 downgrade branch spoof' v2 "$fixture_dir/v2-comment-spoof-downgrade"

# legacy source must not pass v2 mode; v2 source must not pass legacy mode
expect_fail 'cross: root Jenkinsfile는 v2 mode 실패' v2 "$legacy_source"
expect_fail 'cross: Jenkinsfile.v2는 legacy mode 실패' legacy "$v2_source"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
