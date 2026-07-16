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
}

cp "$source_jenkinsfile" "$fixture_dir/valid"
make_fixture missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture commented-concurrency 'disableConcurrentBuilds()' '// disableConcurrentBuilds()'
make_fixture missing-when 'when {' '/* removed when */'
make_fixture missing-main-guard "branch 'main'" "branch 'release'"
make_fixture missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture commented-migration 'npx prisma migrate deploy' 'true # npx prisma migrate deploy'
make_fixture missing-no-build 'docker compose up -d --no-build --wait' 'docker compose up -d --wait'
make_fixture missing-frontend-build 'docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .' 'true /* frontend build removed */'
make_fixture missing-backend-build 'docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${IMAGE_TAG}" .' 'true /* backend build removed */'
make_fixture frontend-tag-drift 'oss-hub-frontend:${IMAGE_TAG}' 'oss-hub-frontend:${PREV_TAG}'
make_fixture backend-tag-drift 'oss-hub-backend:${IMAGE_TAG}' 'oss-hub-backend:${PREV_TAG}'
cp "$source_jenkinsfile" "$fixture_dir/destructive-volume-removal"
printf '\ndocker compose down -v\n' >>"$fixture_dir/destructive-volume-removal"
cp "$source_jenkinsfile" "$fixture_dir/commented-volume-removal"
printf '\n// docker compose down -v\n' >>"$fixture_dir/commented-volume-removal"
cp "$source_jenkinsfile" "$fixture_dir/destructive-long-volume-removal"
printf "\nsh 'docker compose -p oss-hub down --volumes'\n" >>"$fixture_dir/destructive-long-volume-removal"
cp "$source_jenkinsfile" "$fixture_dir/duplicate-frontend-build"
printf '\ndocker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .\n' >>"$fixture_dir/duplicate-frontend-build"
cp "$source_jenkinsfile" "$fixture_dir/inline-duplicate-frontend-build"
printf '\ndocker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" . # duplicate\n' >>"$fixture_dir/inline-duplicate-frontend-build"
cp "$source_jenkinsfile" "$fixture_dir/extra-image-build"
printf "\nsh 'docker image build --tag extra-image:latest .'\n" >>"$fixture_dir/extra-image-build"
cp "$source_jenkinsfile" "$fixture_dir/compose-image-build"
printf "\nsh 'docker compose -f compose.yml build'\n" >>"$fixture_dir/compose-image-build"
cp "$source_jenkinsfile" "$fixture_dir/compose-up-build"
printf "\nsh 'docker compose up -d --build'\n" >>"$fixture_dir/compose-up-build"
cp "$source_jenkinsfile" "$fixture_dir/continued-image-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker \'
  printf '%s\n' '    image build --tag extra-image:latest .'
  printf "'''\n"
} >>"$fixture_dir/continued-image-build"
cp "$source_jenkinsfile" "$fixture_dir/continued-compose-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose \'
  printf '%s\n' '    -f compose.yml build'
  printf "'''\n"
} >>"$fixture_dir/continued-compose-build"
cp "$source_jenkinsfile" "$fixture_dir/continued-volume-removal"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose \'
  printf '%s\n' '    -p oss-hub down --volumes'
  printf "'''\n"
} >>"$fixture_dir/continued-volume-removal"
cp "$fixture_dir/missing-frontend-build" "$fixture_dir/comment-only-frontend-build"
printf '\n// docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .\n' >>"$fixture_dir/comment-only-frontend-build"
awk '
  !replaced && /branch .main./ {
    sub(/branch .main./, "branch '\''release'\''")
    replaced=1
  }
  replaced && !duplicated && /branch .main./ {
    print
    duplicated=1
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/shifted-main-guard"
awk '
  !replaced && /docker compose up -d --no-build --wait/ {
    sub(/docker compose up -d --no-build --wait/, "docker compose up -d --wait")
    replaced=1
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/primary-no-build-drift"
awk '
  !replaced && /http:\/\/127.0.0.1\// {
    sub(/http:\/\/127.0.0.1\//, "http://127.0.0.1/ready")
    replaced=1
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/primary-frontend-smoke-drift"
awk '
  /env.IMAGE_TAG = sh\(script:/ {
    print "          env.IMAGE_TAG = sh(script: \047true\047, returnStdout: true).trim() // git rev-parse HEAD"
    next
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/moving-image-tag"
awk '
  /if \(env.PREV_TAG/ {
    print "            if (false) { // env.PREV_TAG?.trim()"
    next
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/commented-rollback-guard"
cp "$source_jenkinsfile" "$fixture_dir/negated-main-guard"
awk '
  !replaced && /when \{/ {
    print "      when { not { branch \047main\047 } }"
    replaced=1
    next
  }
  { print }
' "$source_jenkinsfile" >"$fixture_dir/negated-main-guard"
cp "$source_jenkinsfile" "$fixture_dir/reassigned-image-tag"
printf "\nenv.IMAGE_TAG = 'latest'\n" >>"$fixture_dir/reassigned-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/exported-image-tag"
printf "\nsh 'export IMAGE_TAG=latest'\n" >>"$fixture_dir/exported-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/bracket-reassigned-image-tag"
printf "\nenv['IMAGE_TAG'] = 'latest'\n" >>"$fixture_dir/bracket-reassigned-image-tag"
cp "$source_jenkinsfile" "$fixture_dir/quoted-property-reassigned-image-tag"
printf '\nenv."IMAGE_TAG" = '\''latest'\''\n' >>"$fixture_dir/quoted-property-reassigned-image-tag"

expect_pass '현재 Jenkinsfile의 배포 계약' "$fixture_dir/valid"
expect_fail '동시 배포 방지 누락' "$fixture_dir/missing-concurrency"
expect_fail '주석뿐인 동시 배포 방지' "$fixture_dir/commented-concurrency"
expect_fail 'when 구조 누락' "$fixture_dir/missing-when"
expect_fail 'main 전용 stage guard 누락' "$fixture_dir/missing-main-guard"
expect_fail '다른 stage로 옮겨진 main guard' "$fixture_dir/shifted-main-guard"
expect_fail '부정된 main guard' "$fixture_dir/negated-main-guard"
expect_fail 'commit SHA 이미지 태그 누락' "$fixture_dir/moving-image-tag"
expect_fail 'commit SHA 이미지 태그 재할당' "$fixture_dir/reassigned-image-tag"
expect_fail 'shell export 이미지 태그 재할당' "$fixture_dir/exported-image-tag"
expect_fail 'bracket env 이미지 태그 재할당' "$fixture_dir/bracket-reassigned-image-tag"
expect_fail 'quoted property 이미지 태그 재할당' "$fixture_dir/quoted-property-reassigned-image-tag"
expect_fail '주석으로만 남은 rollback guard' "$fixture_dir/commented-rollback-guard"
expect_fail 'Prisma 배포 migration 누락' "$fixture_dir/missing-migration"
expect_fail '주석으로만 남은 Prisma migration' "$fixture_dir/commented-migration"
expect_fail '서비스 교체의 --no-build 누락' "$fixture_dir/missing-no-build"
expect_fail 'primary 서비스 교체의 --no-build 누락' "$fixture_dir/primary-no-build-drift"
expect_fail 'primary frontend smoke 경로 drift' "$fixture_dir/primary-frontend-smoke-drift"
expect_fail 'frontend 이미지 빌드 누락' "$fixture_dir/missing-frontend-build"
expect_fail 'backend 이미지 빌드 누락' "$fixture_dir/missing-backend-build"
expect_fail 'frontend 이미지 태그 drift' "$fixture_dir/frontend-tag-drift"
expect_fail 'backend 이미지 태그 drift' "$fixture_dir/backend-tag-drift"
expect_fail 'frontend 이미지 중복 빌드' "$fixture_dir/duplicate-frontend-build"
expect_fail 'inline 주석이 붙은 frontend 중복 빌드' "$fixture_dir/inline-duplicate-frontend-build"
expect_fail '허용되지 않은 추가 이미지 빌드' "$fixture_dir/extra-image-build"
expect_fail '허용되지 않은 Compose 이미지 빌드' "$fixture_dir/compose-image-build"
expect_fail 'Compose up의 --build 사용' "$fixture_dir/compose-up-build"
expect_fail '줄 연속 Docker 이미지 빌드' "$fixture_dir/continued-image-build"
expect_fail '줄 연속 Compose 이미지 빌드' "$fixture_dir/continued-compose-build"
expect_fail '주석뿐인 frontend 이미지 빌드' "$fixture_dir/comment-only-frontend-build"
expect_pass '주석뿐인 volume 삭제 명령' "$fixture_dir/commented-volume-removal"
expect_fail '영속 volume 파괴 명령 추가' "$fixture_dir/destructive-volume-removal"
expect_fail '영속 volume 장형 파괴 명령 추가' "$fixture_dir/destructive-long-volume-removal"
expect_fail '줄 연속 Compose volume 파괴 명령' "$fixture_dir/continued-volume-removal"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
