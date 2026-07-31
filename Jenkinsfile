// Jenkinsfile — 파라미터 없는 latest Release 수렴 배포.
//
// 계약 요약:
// - RELEASE_TAG = 이미지 태그(IMAGE_TAG). RELEASE_SHA = checkout 불변 신원. 둘 다 OCI label.
// - 영속 배포 상태 파일 없음. no-op 권위는 실행 중(frontend+backend) 컨테이너 두 개뿐.
// - 동일 실행 중 tag+SHA만 성공 no-op. 하위 SemVer는 양쪽 실행 중이고 metadata가 일치할 때만 no-op.
// - same-tag/different-SHA, partial, stopped-only, missing/invalid label·SemVer는 fail-closed.
// - 중지·모호 상태는 deploy 권한 없음. no-op은 완전 증명된 running metadata만.
// - 성공 후에만 이미지/백업 정리. 실행 중+직전 이미지 보존. 백업 최근 N=120.
pipeline {
  agent {
    label 'oss-hub-production'
  }

  options {
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  environment {
    COMPOSE_PROJECT_NAME = 'oss-hub'
    BACKUP_DIR = '/var/lib/oss-hub/backups'
    // C4 승인 상수. 성공 배포 뒤에만 적용하고 최신 N개를 보존한다.
    BACKUP_RETENTION_N = '120'
  }

  stages {
    stage('소스 체크아웃') {
      steps {
        checkout scm
      }
    }

    stage('latest Release 검증 및 exact SHA 해석') {
      steps {
        script {
          env.DEPLOY_NOOP = 'false'
          env.PREV_TAG = ''
          env.PREV_FE_IMAGE_ID = ''
          env.PREV_BE_IMAGE_ID = ''
          env.PREV_SHA = ''

          def tag = sh(
            script: '''#!/usr/bin/env bash
set -euo pipefail

release_file="$(mktemp)"
trap 'rm -f "$release_file"' EXIT

curl --fail --silent --show-error \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  https://api.github.com/repos/JNU-SWCU/oss-hub/releases/latest \
  --output "$release_file"

test "$(jq -r '.draft' "$release_file")" = 'false'
test "$(jq -r '.prerelease' "$release_file")" = 'false'
jq -r '.tag_name' "$release_file"
''',
            returnStdout: true,
          ).trim()

          if (!(tag ==~ /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)) {
            error('Release tag는 vMAJOR.MINOR.PATCH full SemVer 형식이어야 합니다.')
          }
          env.RELEASE_TAG = tag
          // 이미지 태그는 release tag. SHA 이름공간을 이미지 태그로 쓰지 않는다.
          env.IMAGE_TAG = tag

          def releaseSha = sh(
            script: '''#!/usr/bin/env bash
set -euo pipefail

git fetch --quiet origin refs/heads/main:refs/remotes/origin/main
git fetch --quiet origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}"
release_sha="$(git rev-parse "${RELEASE_TAG}^{commit}")"
git merge-base --is-ancestor "$release_sha" origin/main
printf '%s' "$release_sha"
''',
            returnStdout: true,
          ).trim()

          if (!(releaseSha ==~ /^[0-9a-f]{40}$/)) {
            error('Release tag를 정확한 commit SHA로 해석하지 못했습니다.')
          }
          env.RELEASE_SHA = releaseSha
        }
      }
    }

    stage('exact SHA checkout') {
      steps {
        sh 'git checkout --detach "$RELEASE_SHA"'
      }
    }

    stage('실행 중 이미지 기준 no-op 및 이전 태그 캡처') {
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          script {
            // no-op 권위는 실행 중 컨테이너만. 존재/부분 배포 판정은 --all.
            def probe = sh(
              script: '''#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose --env-file "$OSS_HUB_ENV_FILE")

fe_running="$("${compose[@]}" ps -q frontend)"
be_running="$("${compose[@]}" ps -q backend)"
fe_all="$("${compose[@]}" ps --all -q frontend)"
be_all="$("${compose[@]}" ps --all -q backend)"

# partial deployment: 한쪽만 컨테이너가 있으면 치명.
if { [ -n "$fe_all" ] && [ -z "$be_all" ]; } || { [ -z "$fe_all" ] && [ -n "$be_all" ]; }; then
  echo 'FAIL_CLOSED partial_deployment: frontend/backend 컨테이너 존재 상태가 일치하지 않습니다.' >&2
  exit 2
fi

# greenfield: 어느 쪽도 존재하지 않음.
if [ -z "$fe_all" ] && [ -z "$be_all" ]; then
  printf 'state=greenfield\n'
  exit 0
fi

# 한 쪽만 실행 중이면 partial/stopped 혼합 — fail-closed.
if { [ -n "$fe_running" ] && [ -z "$be_running" ]; } || { [ -z "$fe_running" ] && [ -n "$be_running" ]; }; then
  echo 'FAIL_CLOSED partial_running: 한쪽만 실행 중이라 no-op/배포 기준을 확정할 수 없습니다.' >&2
  exit 2
fi

read_meta() {
  local container="$1"
  local image version revision image_id
  image="$(docker inspect --format '{{.Config.Image}}' "$container")"
  version="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$container")"
  revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")"
  # 컨테이너가 가리키는 불변 이미지 ID. 태그 이동과 무관한 rollback 바이트 신원.
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  printf '%s\t%s\t%s\t%s\n' "$image" "$version" "$revision" "$image_id"
}

# stopped-only: 존재하지만 둘 다 비실행. no-op·deploy 모두 금지 (fail-closed).
if [ -z "$fe_running" ] && [ -z "$be_running" ]; then
  echo 'FAIL_CLOSED stopped_container: 중지된 frontend/backend는 no-op/배포 기준이 될 수 없습니다.' >&2
  exit 2
fi

# 여기까지 오면 양쪽 모두 실행 중 — no-op 권위는 완전 증명된 metadata에만 부여.
fe_meta="$(read_meta "$fe_running")"
be_meta="$(read_meta "$be_running")"
fe_image="$(printf '%s' "$fe_meta" | cut -f1)"
be_image="$(printf '%s' "$be_meta" | cut -f1)"
fe_version="$(printf '%s' "$fe_meta" | cut -f2)"
be_version="$(printf '%s' "$be_meta" | cut -f2)"
fe_revision="$(printf '%s' "$fe_meta" | cut -f3)"
be_revision="$(printf '%s' "$be_meta" | cut -f3)"
fe_image_id="$(printf '%s' "$fe_meta" | cut -f4)"
be_image_id="$(printf '%s' "$be_meta" | cut -f4)"

if [[ "$fe_image" != oss-hub-frontend:* ]] || [[ "$be_image" != oss-hub-backend:* ]]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 이미지 참조가 oss-hub app 형식이 아닙니다.' >&2
  exit 2
fi

fe_tag="${fe_image#oss-hub-frontend:}"
be_tag="${be_image#oss-hub-backend:}"
if [ "$fe_tag" != "$be_tag" ]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 frontend/backend 태그가 서로 다릅니다.' >&2
  exit 2
fi

if [ -z "$fe_image_id" ] || [ -z "$be_image_id" ]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 컨테이너 immutable Image ID를 읽지 못했습니다.' >&2
  exit 2
fi

# 완전 증명된 running metadata만 진행. 누락·불일치·비SemVer는 deploy 권한 없음.
if [ -z "$fe_version" ] || [ -z "$be_version" ] || [ -z "$fe_revision" ] || [ -z "$be_revision" ]; then
  echo 'FAIL_CLOSED running_metadata: OCI label 누락 — no-op/배포 기준을 확정할 수 없습니다.' >&2
  exit 2
fi

if [ "$fe_version" != "$be_version" ] || [ "$fe_revision" != "$be_revision" ]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 frontend/backend OCI label이 서로 다릅니다.' >&2
  exit 2
fi
if [ "$fe_version" != "$fe_tag" ]; then
  echo 'FAIL_CLOSED running_metadata: image tag와 org.opencontainers.image.version 불일치.' >&2
  exit 2
fi
if [[ ! "$fe_revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'FAIL_CLOSED running_metadata: org.opencontainers.image.revision이 40-hex SHA가 아닙니다.' >&2
  exit 2
fi
if [[ ! "$fe_tag" =~ ^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$ ]]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 태그가 full SemVer가 아닙니다.' >&2
  exit 2
fi

printf 'state=running\n'
printf 'prev_tag=%s\n' "$fe_tag"
printf 'prev_sha=%s\n' "$fe_revision"
printf 'prev_fe_image_id=%s\n' "$fe_image_id"
printf 'prev_be_image_id=%s\n' "$be_image_id"
''',
              returnStdout: true,
            ).trim()

            def fields = [:]
            probe.split(/\r?\n/).each { line ->
              def idx = line.indexOf('=')
              if (idx > 0) {
                fields[line.substring(0, idx)] = line.substring(idx + 1)
              }
            }
            def state = fields.get('state', '')

            if (state == 'greenfield') {
              env.PREV_TAG = ''
              env.PREV_SHA = ''
              env.PREV_FE_IMAGE_ID = ''
              env.PREV_BE_IMAGE_ID = ''
              env.DEPLOY_NOOP = 'false'
              echo 'greenfield: 실행/존재 컨테이너 없음. 최초 배포를 계속합니다.'
              return
            }

            if (state != 'running') {
              error("FAIL_CLOSED unexpected_probe_state: ${state}")
            }

            def prevTag = fields.get('prev_tag', '')
            def prevSha = fields.get('prev_sha', '')
            def prevFeImageId = fields.get('prev_fe_image_id', '')
            def prevBeImageId = fields.get('prev_be_image_id', '')
            if (!prevTag?.trim() || !prevSha?.trim() || !prevFeImageId?.trim() || !prevBeImageId?.trim()) {
              error('FAIL_CLOSED running_metadata: running probe가 tag/SHA/Image ID를 모두 반환하지 않았습니다.')
            }
            env.PREV_TAG = prevTag
            env.PREV_SHA = prevSha
            env.PREV_FE_IMAGE_ID = prevFeImageId
            env.PREV_BE_IMAGE_ID = prevBeImageId

            // same-tag/different-SHA → fail-closed (재태깅·이동 태그 방어)
            if (prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA) {
              error("FAIL_CLOSED same_tag_different_sha: tag ${prevTag} 실행 중 SHA(${prevSha}) ≠ release SHA(${env.RELEASE_SHA})")
            }

            // 동일 실행 중 tag+SHA → 성공 no-op
            if (prevTag == env.RELEASE_TAG && prevSha == env.RELEASE_SHA) {
              env.DEPLOY_NOOP = 'true'
              currentBuild.description = "${env.RELEASE_TAG} no-op (running ${prevTag}@${prevSha.take(12)})"
              echo "${env.RELEASE_TAG}(${env.RELEASE_SHA})는 실행 중 tag+SHA와 같아 성공 no-op 처리합니다."
              return
            }

            // 하위 SemVer 타깃: 양쪽 실행 중이고 metadata 일치할 때만 성공 no-op (downgrade guard).
            // SemVer 구성요소는 선행 0이 없는 십진 문자열이므로 길이 후 사전순으로 비교한다.
            // Jenkins sandbox 승인이 필요한 숫자 생성자를 사용하지 않는다.
            def parseFullSemVer = { String raw ->
              if (!(raw ==~ /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)) {
                error("FAIL_CLOSED semver: full SemVer가 아닙니다: ${raw}")
              }
              return raw.substring(1).split(/\./)
            }
            def compareDecimal = { String left, String right ->
              def lengthCmp = left.length() <=> right.length()
              return lengthCmp != 0 ? lengthCmp : (left <=> right)
            }
            def targetParts = parseFullSemVer(env.RELEASE_TAG)
            def runningParts = parseFullSemVer(prevTag)
            def cmp = compareDecimal(targetParts[0], runningParts[0])
            if (cmp == 0) { cmp = compareDecimal(targetParts[1], runningParts[1]) }
            if (cmp == 0) { cmp = compareDecimal(targetParts[2], runningParts[2]) }

            if (cmp < 0) {
              env.DEPLOY_NOOP = 'true'
              currentBuild.description = "${env.RELEASE_TAG} no-op downgrade (running ${prevTag})"
              echo "downgrade_noop: 대상 ${env.RELEASE_TAG} < 실행 중 ${prevTag} 이고 실행 metadata 일치 → 성공 no-op."
              return
            }

            env.DEPLOY_NOOP = 'false'
            echo "deploy_required: PREV_TAG=${env.PREV_TAG} PREV_SHA=${env.PREV_SHA} → target ${env.RELEASE_TAG}@${env.RELEASE_SHA}"
          }
        }
      }
    }

    stage('FRONTEND_URL HTTPS 사전 검증') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail
# credential file을 source/print 하지 않는다. FRONTEND_URL 키만 추출해 유일 할당·스킴을 검사한다.
# 값은 로그에 남기지 않는다. 주석이 아닌 할당이 정확히 하나여야 한다(중복 순서 무관).
frontend_url="$(
  awk '
    BEGIN { count = 0; value = "" }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      eq = index(line, "=")
      if (eq < 1) next
      key = substr(line, 1, eq - 1)
      val = substr(line, eq + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
      if (key != "FRONTEND_URL") next
      count++
      if (val ~ /^".*"$/) {
        val = substr(val, 2, length(val) - 2)
      }
      if (count == 1) {
        value = val
      }
    }
    END {
      if (count == 0) {
        exit 2
      }
      if (count != 1) {
        exit 3
      }
      print value
    }
  ' "$OSS_HUB_ENV_FILE"
)" || {
  awk_rc=$?
  if [ "$awk_rc" -eq 2 ]; then
    echo 'FAIL_CLOSED https_preflight: FRONTEND_URL 키가 운영 env에 없습니다.' >&2
  elif [ "$awk_rc" -eq 3 ]; then
    echo 'FAIL_CLOSED https_preflight: FRONTEND_URL 할당이 둘 이상입니다 (value not logged).' >&2
  else
    echo 'FAIL_CLOSED https_preflight: FRONTEND_URL 파싱에 실패했습니다.' >&2
  fi
  exit 1
}

if [ -z "$frontend_url" ]; then
  echo 'FAIL_CLOSED https_preflight: FRONTEND_URL 키가 운영 env에 없습니다.' >&2
  exit 1
fi

case "$frontend_url" in
  https://*)
    echo 'https_preflight: FRONTEND_URL scheme is HTTPS (value not logged).'
    ;;
  *)
    echo 'FAIL_CLOSED https_preflight: FRONTEND_URL must use https:// scheme.' >&2
    exit 1
    ;;
esac
'''
        }
      }
    }

    stage('롤백 이미지 사전 검증') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        script {
          if (!env.PREV_TAG?.trim()) {
            echo 'rollback_preflight: greenfield — 이전 이미지 없음. 계속합니다.'
            return
          }
          withEnv([
            "PREV_TAG=${env.PREV_TAG}",
            "PREV_SHA=${env.PREV_SHA ?: ''}",
            "PREV_FE_IMAGE_ID=${env.PREV_FE_IMAGE_ID ?: ''}",
            "PREV_BE_IMAGE_ID=${env.PREV_BE_IMAGE_ID ?: ''}",
          ]) {
            sh 'bash scripts/jenkins/validate-rollback-images.sh'
          }
        }
      }
    }

    stage('빌드·테스트 검증') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''
          pnpm install --frozen-lockfile
          pnpm --filter backend exec prisma generate
          pnpm lint
          pnpm typecheck
          pnpm test
          pnpm build
        '''
      }
    }

    stage('PostgreSQL 기동 및 배포 전 백업') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh '''
            docker compose --env-file "$OSS_HUB_ENV_FILE" up -d postgres --wait --wait-timeout 90
            docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
            umask 077
            backup_target="${BACKUP_DIR}/${RELEASE_TAG}-${BUILD_NUMBER}.sql"
            test ! -e "$backup_target"
            backup_tmp="$(mktemp "${backup_target}.XXXXXX")"
            trap 'rm -f "$backup_tmp"' EXIT
            docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_tmp"
            test -s "$backup_tmp"
            mv "$backup_tmp" "$backup_target"
            trap - EXIT
          '''
        }
      }
    }

    stage('버전 이미지 빌드') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
# release-tag 이름 + OCI label(RELEASE_TAG, RELEASE_SHA). 이미지는 1회만 빌드.
docker build \
  --file apps/frontend/Dockerfile \
  --tag "oss-hub-frontend:${IMAGE_TAG}" \
  --label "org.opencontainers.image.version=${RELEASE_TAG}" \
  --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  .
docker build \
  --file apps/backend/Dockerfile \
  --tag "oss-hub-backend:${IMAGE_TAG}" \
  --label "org.opencontainers.image.version=${RELEASE_TAG}" \
  --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  .
'''
      }
    }

    stage('Prisma 마이그레이션') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh '''
            docker run --rm \
              --network "${COMPOSE_PROJECT_NAME}_default" \
              --env-file "$OSS_HUB_ENV_FILE" \
              "oss-hub-backend:${IMAGE_TAG}" \
              npx prisma migrate deploy
          '''
        }
      }
    }

    stage('서비스 교체 및 스모크 확인') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          script {
            try {
              sh '''
                # 레지스트리에서 받아오는 이미지는 미리 당겨둔다. 받는 시간이 아래 --wait 예산에
                # 섞이지 않고, 레지스트리 장애도 교체 전에 드러난다.
                # rollout 동안 PREV_TAG rollback 이미지는 삭제하지 않는다(성공 후 retention만 정리).
                docker compose --env-file "$OSS_HUB_ENV_FILE" pull --quiet postgres minio minio-bucket nginx
                docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 180
                curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:8081/
                curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:8081/api/v1/health
                submission_upload_status="$(curl -o /dev/null -w '%{http_code}' --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:8081/api/v1/submission-files)"
                test "$submission_upload_status" = '403'
                curl --fail --silent --show-error --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1' https://54.116.116.174/
                curl --fail --silent --show-error --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1' https://54.116.116.174/api/v1/health
              '''
            } catch (deploymentFailure) {
              sh '''
                docker compose --env-file "$OSS_HUB_ENV_FILE" ps || true
                docker compose --env-file "$OSS_HUB_ENV_FILE" logs --no-color || true
              '''

              if (env.PREV_TAG?.trim()) {
                echo "서비스 교체 또는 스모크 실패: ${env.PREV_TAG} 이미지로 한 번 복구합니다."
                withEnv(["IMAGE_TAG=${env.PREV_TAG}"]) {
                  sh '''
                    docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 180
                    curl --fail --silent --show-error http://127.0.0.1:8081/
                    curl --fail --silent --show-error http://127.0.0.1:8081/api/v1/health
                    submission_upload_status="$(curl -o /dev/null -w '%{http_code}' --silent --show-error http://127.0.0.1:8081/api/v1/submission-files)"
                    test "$submission_upload_status" = '403'
                    curl --fail --silent --show-error \
                      --resolve '54.116.116.174:443:127.0.0.1' https://54.116.116.174/
                    curl --fail --silent --show-error \
                      --resolve '54.116.116.174:443:127.0.0.1' https://54.116.116.174/api/v1/health
                  '''
                }
              } else {
                echo '첫 배포 실패라 이전 이미지가 없습니다. 로그와 백업을 보존하고 수동 복구로 전환합니다.'
              }

              throw deploymentFailure
            }
          }
        }
      }
    }

    stage('성공 후 이미지·백업 보존 정리') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

# success-only retention. 실패 경로에서는 이 stage에 들어오지 않는다.
# 실행 중(방금 배포한 IMAGE_TAG)과 직전 PREV_TAG는 절대 삭제하지 않는다.
# oss-hub-frontend / oss-hub-backend 앱 이미지만 대상으로 하며 무관 이미지는 건드리지 않는다.

retention_keep_tags=()
retention_keep_tags+=("${IMAGE_TAG}")
if [ -n "${PREV_TAG:-}" ] && [ "$PREV_TAG" != "$IMAGE_TAG" ]; then
  retention_keep_tags+=("${PREV_TAG}")
fi

is_kept_tag() {
  local candidate="$1"
  local kept
  for kept in "${retention_keep_tags[@]}"; do
    if [ "$candidate" = "$kept" ]; then
      return 0
    fi
  done
  return 1
}

# docker images 포맷: repository:tag. dangling/untagged 는 스킵.
# producer 실패는 빈 목록 성공으로 취급하지 않는다. 상태 검사된 임시 파일로 목록을 고정한 뒤 소비한다.
images_raw="$(mktemp)"
images_inventory="$(mktemp)"
trap 'rm -f "$images_raw" "$images_inventory"' EXIT
docker images --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}' > "$images_raw"
awk -F '\t' '$1=="oss-hub-frontend" || $1=="oss-hub-backend"' "$images_raw" > "$images_inventory"
rm -f "$images_raw"

while IFS="$(printf '\t')" read -r repo tag image_id; do
  [ -n "$repo" ] || continue
  [ -n "$tag" ] || continue
  [ "$tag" = "<none>" ] && continue
  case "$repo" in
    oss-hub-frontend|oss-hub-backend) ;;
    *) continue ;;
  esac
  if is_kept_tag "$tag"; then
    continue
  fi
  # 결정적 삭제. 참조 중이면 실패 → fail-closed.
  docker image rm "${repo}:${tag}"
done < "$images_inventory"

# backup retention N=120 (C4). Jenkins와 격리 fixture가 같은 fail-closed 구현을 호출한다.
bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"

echo "retention: kept image tags=${retention_keep_tags[*]}; backup keep newest n=${BACKUP_RETENTION_N}"
'''
      }
    }
  }

  post {
    failure {
      echo 'Jenkins 배포가 실패했습니다. 기존 서비스 상태와 보존된 build·Compose 로그를 확인하십시오.'
      script {
        // 실패 알림은 email-ext 플러그인으로 보낸다. 수신자·SMTP는 Jenkins UI 설정에만 둔다
        // (Manage Jenkins → System → Extended E-mail Notification: Default Recipients + SMTP).
        // 저장소엔 이메일 주소를 남기지 않으며 '$DEFAULT_RECIPIENTS'가 그 UI 값으로 치환된다.
        emailext(
          to: '$DEFAULT_RECIPIENTS',
          subject: "[oss-hub] 배포 실패 ${env.RELEASE_TAG ?: ''} #${env.BUILD_NUMBER}",
          body: "Jenkins 배포가 실패했습니다.\nJob: ${env.JOB_NAME} #${env.BUILD_NUMBER}\nRELEASE_TAG: ${env.RELEASE_TAG ?: '(n/a)'}\nRELEASE_SHA: ${env.RELEASE_SHA ?: '(n/a)'}\n콘솔 로그: ${env.BUILD_URL}console",
        )
      }
    }
  }
}
