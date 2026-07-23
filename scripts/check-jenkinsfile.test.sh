#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-jenkinsfile.sh"
source_jenkinsfile="$repo_root/Jenkinsfile"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jenkinsfile-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  local path=$2

  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (성공해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  local path=$2

  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

make_fixture() {
  local name=$1
  local pattern=$2
  local replacement=$3

  sed "s|$pattern|$replacement|" "$source_jenkinsfile" >"$fixture_dir/$name"
  if cmp -s "$source_jenkinsfile" "$fixture_dir/$name"; then
    printf 'fixture pattern not found: %s\n' "$pattern" >&2
    exit 1
  fi
}

cp "$source_jenkinsfile" "$fixture_dir/valid"
make_fixture missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture missing-production-label "label 'oss-hub-production'" "label 'any'"
make_fixture missing-release-tag "string(name: 'RELEASE_TAG'" "string(name: 'REMOVED_RELEASE_TAG'"
make_fixture main-mode-drift "env.RUN_MODE = 'main'" "env.RUN_MODE = 'release'"
make_fixture missing-created-action "action == 'created'" "action == 'removed'"
make_fixture missing-published-action "action == 'published'" "action == 'removed'"
make_fixture missing-latest-release '/releases/latest' '/releases/removed'
make_fixture missing-draft-check "jq -r '.draft'" "jq -r '.removedDraft'"
make_fixture missing-prerelease-check "jq -r '.prerelease'" "jq -r '.removedPrerelease'"
make_fixture missing-tag-format 'tag ==~ /' 'tag !=~ /'
make_fixture missing-tag-resolution 'git rev-parse "${RELEASE_TAG}^{commit}"' 'git rev-parse HEAD'
make_fixture missing-main-ancestry 'git merge-base --is-ancestor "$release_sha" origin/main' 'true'
make_fixture moving-checkout 'git checkout --detach "$IMAGE_TAG"' 'git checkout main'
make_fixture missing-noop-sort 'sort -V' 'sort'
make_fixture missing-retag-guard 'env.RELEASE_TAG == currentTag && env.IMAGE_TAG != env.CURRENT_DEPLOY_SHA' 'false'
make_fixture missing-state-file "DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'" "DEPLOY_STATE_FILE = '/tmp/current-release'"
make_fixture missing-test 'pnpm test' 'true'
make_fixture missing-backup 'pg_dump' 'pg_isready'
make_fixture missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture missing-no-build 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --wait'
make_fixture missing-state-update 'mv "$state_tmp" "$DEPLOY_STATE_FILE"' 'true'
make_fixture missing-rollback-guard 'if (env.PREV_TAG?.trim())' 'if (false)'
make_fixture missing-production-credential "credentialsId: 'oss-hub-production-env'" "credentialsId: 'removed'"
make_fixture missing-stopped-container-scan 'ps --all -q' 'ps -q'

cp "$source_jenkinsfile" "$fixture_dir/destructive-volume-removal"
printf '\ndocker compose down -v\n' >>"$fixture_dir/destructive-volume-removal"
cp "$source_jenkinsfile" "$fixture_dir/main-auto-deploy"
printf "\nbranch 'main'\n" >>"$fixture_dir/main-auto-deploy"
cp "$source_jenkinsfile" "$fixture_dir/duplicate-frontend-build"
printf '\ndocker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .\n' >>"$fixture_dir/duplicate-frontend-build"
cp "$source_jenkinsfile" "$fixture_dir/duplicate-state-update"
printf '\nmv "$state_tmp" "$DEPLOY_STATE_FILE"\n' >>"$fixture_dir/duplicate-state-update"
cp "$source_jenkinsfile" "$fixture_dir/reassigned-image-tag"
printf "\nenv.IMAGE_TAG = 'latest'\n" >>"$fixture_dir/reassigned-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/exported-image-tag"
printf "\nsh 'export IMAGE_TAG=latest'\n" >>"$fixture_dir/exported-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/bracket-image-tag"
printf "\nenv['IMAGE_TAG'] = 'latest'\n" >>"$fixture_dir/bracket-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/quoted-image-tag"
printf '\nenv."IMAGE_TAG" = '\''latest'\''\n' >>"$fixture_dir/quoted-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/extra-image-build"
printf "\nsh 'docker image build --tag extra:latest .'\n" >>"$fixture_dir/extra-image-build"
cp "$source_jenkinsfile" "$fixture_dir/compose-image-build"
printf "\nsh 'docker compose build'\n" >>"$fixture_dir/compose-image-build"
cp "$source_jenkinsfile" "$fixture_dir/compose-up-build"
printf "\nsh 'docker compose up -d --build'\n" >>"$fixture_dir/compose-up-build"
cp "$source_jenkinsfile" "$fixture_dir/continued-image-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker image \'
  printf '%s\n' '    build --tag extra:latest .'
  printf "'''\n"
} >>"$fixture_dir/continued-image-build"
cp "$source_jenkinsfile" "$fixture_dir/continued-volume-removal"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose down \'
  printf '%s\n' '    --volumes'
  printf "'''\n"
} >>"$fixture_dir/continued-volume-removal"

expect_pass '현재 Release 배포 계약' "$fixture_dir/valid"
expect_fail '동시 배포 방지 누락' "$fixture_dir/missing-concurrency"
expect_fail '전용 production executor 누락' "$fixture_dir/missing-production-label"
expect_fail 'Release tag 입력 누락' "$fixture_dir/missing-release-tag"
expect_fail '빈 입력의 main 검증 경계 drift' "$fixture_dir/main-mode-drift"
expect_fail 'created 이벤트 허용 누락' "$fixture_dir/missing-created-action"
expect_fail 'published 이벤트 허용 누락' "$fixture_dir/missing-published-action"
expect_fail 'latest full Release 검증 누락' "$fixture_dir/missing-latest-release"
expect_fail 'draft 거절 누락' "$fixture_dir/missing-draft-check"
expect_fail 'prerelease 거절 누락' "$fixture_dir/missing-prerelease-check"
expect_fail 'SemVer tag 검증 누락' "$fixture_dir/missing-tag-format"
expect_fail 'Release tag SHA 해석 누락' "$fixture_dir/missing-tag-resolution"
expect_fail 'main ancestry 검증 누락' "$fixture_dir/missing-main-ancestry"
expect_fail '정확한 SHA checkout 누락' "$fixture_dir/moving-checkout"
expect_fail '동일·하위 버전 no-op 비교 누락' "$fixture_dir/missing-noop-sort"
expect_fail '동일 Release tag의 SHA 변경 차단 누락' "$fixture_dir/missing-retag-guard"
expect_fail '영속 배포 상태 경로 누락' "$fixture_dir/missing-state-file"
expect_fail '배포 전 test 누락' "$fixture_dir/missing-test"
expect_fail 'migration 전 backup 누락' "$fixture_dir/missing-backup"
expect_fail 'Prisma migration 누락' "$fixture_dir/missing-migration"
expect_fail 'Compose 교체의 --no-build 누락' "$fixture_dir/missing-no-build"
expect_fail '성공 상태 원자 갱신 누락' "$fixture_dir/missing-state-update"
expect_fail '이전 이미지 rollback guard 누락' "$fixture_dir/missing-rollback-guard"
expect_fail '운영 환경 credential 주입 누락' "$fixture_dir/missing-production-credential"
expect_fail '중지 container rollback 기준 누락' "$fixture_dir/missing-stopped-container-scan"
expect_fail 'main production 자동 배포 재도입' "$fixture_dir/main-auto-deploy"
expect_fail '영속 volume 파괴 명령 추가' "$fixture_dir/destructive-volume-removal"
expect_fail 'frontend 이미지 중복 빌드' "$fixture_dir/duplicate-frontend-build"
expect_fail '성공 상태 중복 갱신' "$fixture_dir/duplicate-state-update"
expect_fail 'IMAGE_TAG 재할당' "$fixture_dir/reassigned-image-tag"
expect_fail 'shell IMAGE_TAG export' "$fixture_dir/exported-image-tag"
expect_fail 'bracket IMAGE_TAG 재할당' "$fixture_dir/bracket-image-tag"
expect_fail 'quoted IMAGE_TAG 재할당' "$fixture_dir/quoted-image-tag"
expect_fail '추가 Docker image build' "$fixture_dir/extra-image-build"
expect_fail 'Compose image build' "$fixture_dir/compose-image-build"
expect_fail 'Compose up --build' "$fixture_dir/compose-up-build"
expect_fail '줄 연속 Docker image build' "$fixture_dir/continued-image-build"
expect_fail '줄 연속 volume 삭제' "$fixture_dir/continued-volume-removal"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
