// Jenkinsfile — 파라미터 없는 latest Release 수렴 배포.
//
// 계약 요약:
// - RELEASE_TAG = 이미지 태그(IMAGE_TAG). RELEASE_SHA = checkout 불변 신원. 둘 다 OCI label.
// - 영속 배포 상태 파일 없음. no-op 권위는 실행 중 backend 컨테이너뿐.
// - 동일 실행 중 tag+SHA만 성공 no-op. 하위 SemVer는 실행 중 metadata가 일치할 때만 no-op.
// - same-tag/different-SHA, stopped-only, missing/invalid label·SemVer는 fail-closed.
// - 중지·모호 상태는 deploy 권한 없음. no-op은 완전 증명된 running metadata만.
// - BuildKit 캐시는 이미지 빌드·배포 전과 성공 뒤에 5GB 상한으로 정리한다. 이미지·백업 보존 정리는 성공 뒤에만 한다.
//   실행 중+직전 이미지를 보존하고, 백업은 최근 N=30을 보존한다.
// - 이미지 빌드 후 migration·rollout·health/smoke·rollback을 수행한다.
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
    // GREENFIELD_DEPLOY_ACK=1 만 호스트에 이전 배포 흔적이 있을 때
    // 최초 배포(재프로비저닝)를 허용한다. 기본은 차단(fail-closed).
    // C4 승인 상수. 성공 배포 뒤에만 적용하고 최신 N개를 보존한다.
    BACKUP_RETENTION_N = '30'
    // BuildKit shared/internal 캐시는 이미지 빌드·배포 전과 성공 뒤 LRU 기준 최대 5GB까지만 보존한다.
    BUILD_CACHE_MAX_SPACE = '5GB'
    // 개인키 SOURCE는 compose.yml이 :? 로 요구한다. compose 호출이 5곳이라 stage마다 넣으면
    // 하나만 빠뜨려도 배포가 멈추므로 pipeline 수준에 한 번만 둔다. rollback의 withEnv도
    // 이 값을 그대로 물려받는다.
    // 같은 블록 안의 변수를 참조하지 않고 경로를 반복한다 — 블록 내 상호참조는 실제 실행
    // 없이는 검증할 수 없고, 여기는 그 불확실성을 감당할 자리가 아니다.
    SECRETS_DIR = '/var/lib/oss-hub/secrets'
    GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE = '/var/lib/oss-hub/secrets/current/collection.pem'
    GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE = '/var/lib/oss-hub/secrets/current/operations.pem'
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
          env.PREV_BE_IMAGE_ID = ''
          env.PREV_SHA = ''
          env.PRIVATE_KEYS_CHANGED = 'false'
          env.PREV_PRIVATE_KEY_GENERATION = ''

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

    stage('운영 환경 사전 검증') {
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
        ]) {
          sh 'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"'
        }
      }
    }

    stage('개인키 검증 및 안정 경로 설치') {
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          file(credentialsId: 'oss-hub-collection-app-private-key', variable: 'COLLECTION_PEM_SRC'),
          file(credentialsId: 'oss-hub-operations-app-private-key', variable: 'OPERATIONS_PEM_SRC'),
        ]) {
          script {
            def keyState = sh(
              script: '''#!/usr/bin/env bash
set -euo pipefail

# App ID·조직과 각 file credential이 실제 GitHub에서 같은 App으로 인증되고
# installation token까지 발급하는지 먼저 확인한다. 값·JWT·token은 출력하지 않는다.
node scripts/jenkins/validate-github-app-credentials.mjs \
  "$OSS_HUB_ENV_FILE" "$COLLECTION_PEM_SRC" "$OPERATIONS_PEM_SRC"

# 이후 모든 compose 호출이 SECRETS_DIR/current 아래 파일을 요구하므로 probe보다 앞에 둔다.
# SECRETS_DIR의 setgid 비트가 gid 1000을 상속시켜 0640 + gid 1000을 만든다.
umask 027
mkdir -p "$SECRETS_DIR"
previous=''
if [ -L "${SECRETS_DIR}/current" ]; then
  previous="$(readlink -f "${SECRETS_DIR}/current")"
fi

if [ -n "$previous" ] && \
   cmp -s "$COLLECTION_PEM_SRC" "${SECRETS_DIR}/current/collection.pem" && \
   cmp -s "$OPERATIONS_PEM_SRC" "${SECRETS_DIR}/current/operations.pem"; then
  printf 'changed=false\nprevious=%s\n' "$previous"
  exit 0
fi

generation="${SECRETS_DIR}/gen-${BUILD_NUMBER}"
mkdir -p "$generation"
install -m 640 "$COLLECTION_PEM_SRC" "${generation}/collection.pem"
install -m 640 "$OPERATIONS_PEM_SRC" "${generation}/operations.pem"

for pem in collection operations; do
  if ! openssl pkey -in "${generation}/${pem}.pem" -noout 2>/dev/null; then
    echo "설치한 ${pem} 개인키를 파싱할 수 없습니다. 자격증명 내용을 확인하세요." >&2
    exit 1
  fi
done

# current 교체는 원자적이어야 한다. 직후 실경로까지 대조해 교체 실패를 숨기지 않는다.
ln -sfn "$generation" "${SECRETS_DIR}/.current-next"
mv -T "${SECRETS_DIR}/.current-next" "${SECRETS_DIR}/current"
if [ "$(readlink -f "${SECRETS_DIR}/current")" != "$generation" ]; then
  echo '개인키 활성 generation 검증에 실패했습니다.' >&2
  exit 1
fi
printf 'changed=true\nprevious=%s\n' "$previous"
''',
              returnStdout: true,
            ).trim()

            def keyFields = [:]
            keyState.split(/\r?\n/).each { line ->
              def idx = line.indexOf('=')
              if (idx > 0) keyFields[line.substring(0, idx)] = line.substring(idx + 1)
            }
            env.PRIVATE_KEYS_CHANGED = keyFields.get('changed', 'false')
            env.PREV_PRIVATE_KEY_GENERATION = keyFields.get('previous', '')
            echo env.PRIVATE_KEYS_CHANGED == 'true' ? 'GitHub App 개인키 generation을 교체했습니다.' : 'GitHub App 개인키가 같아 generation 교체를 생략합니다.'
          }
        }
      }
    }

    stage('실행 중 이미지 기준 no-op 및 이전 태그 캡처') {
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          script {
            // no-op 권위는 실행 중 컨테이너만. 존재/부분 배포 판정은 --all.
            def probe = sh(
              script: '''#!/usr/bin/env bash
set -euo pipefail

storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
[ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
: "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
: "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"


compose=(docker compose --env-file "$OSS_HUB_ENV_FILE")

be_running="$("${compose[@]}" ps -q backend)"
be_all="$("${compose[@]}" ps --all -q backend)"

# greenfield: backend 컨테이너가 존재하지 않음.
# 컨테이너 부재만으로 확정하지 않는다. 호스트 SQL/객체 백업이나 compose
# named volume 이 남아 있으면 fail-closed. 재프로비저닝만
# GREENFIELD_DEPLOY_ACK=1 로 우회한다.
if [ -z "$be_all" ]; then
  bash scripts/jenkins/assert-greenfield-host-clean.sh
  printf 'state=greenfield\n'
  exit 0
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

# stopped-only: 존재하지만 비실행. no-op·deploy 모두 금지 (fail-closed).
if [ -z "$be_running" ]; then
  echo 'FAIL_CLOSED stopped_container: 중지된 backend는 no-op/배포 기준이 될 수 없습니다.' >&2
  exit 2
fi

# 실행 중 backend와 candidate의 non-secret storage tuple은 모든 no-op·재생성 판정보다 먼저 같아야 한다.
read_storage_value() {
  awk -F= -v key="$1" '$1 == key { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE"
}
candidate_storage_hash="$(
  printf '%s\\0%s\\0%s\\0%s\\0%s' \
    "$storage_mode" \
    "$(read_storage_value SUBMISSION_FILE_S3_ENDPOINT)" \
    "$(read_storage_value SUBMISSION_FILE_S3_REGION)" \
    "$(read_storage_value SUBMISSION_FILE_S3_BUCKET)" \
    "$(read_storage_value SUBMISSION_FILE_S3_FORCE_PATH_STYLE)" |
    sha256sum | awk '{print $1}'
)"
docker exec "$be_running" \
  node -e 'const { createHash } = require("node:crypto"); const keys = ["SUBMISSION_FILE_STORAGE_MODE", "SUBMISSION_FILE_S3_ENDPOINT", "SUBMISSION_FILE_S3_REGION", "SUBMISSION_FILE_S3_BUCKET", "SUBMISSION_FILE_S3_FORCE_PATH_STYLE"]; const values = keys.map((key) => process.env[key] ?? ""); const digest = createHash("sha256").update(values.join("\\0")).digest("hex"); process.exit(digest === process.argv[1] ? 0 : 1)' \
  "$candidate_storage_hash" ||
  { echo 'FAIL_CLOSED running_storage_tuple: candidate storage tuple differs from the active backend.' >&2; exit 2; }

# 여기까지 오면 backend가 실행 중 — no-op 권위는 완전 증명된 metadata에만 부여.
be_meta="$(read_meta "$be_running")"
be_image="$(printf '%s' "$be_meta" | cut -f1)"
be_version="$(printf '%s' "$be_meta" | cut -f2)"
be_revision="$(printf '%s' "$be_meta" | cut -f3)"
be_image_id="$(printf '%s' "$be_meta" | cut -f4)"

if [[ "$be_image" != oss-hub-backend:* ]]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 이미지 참조가 oss-hub-backend 형식이 아닙니다.' >&2
  exit 2
fi

be_tag="${be_image#oss-hub-backend:}"

if [ -z "$be_image_id" ]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 컨테이너 immutable Image ID를 읽지 못했습니다.' >&2
  exit 2
fi

# 완전 증명된 running metadata만 진행. 누락·불일치·비SemVer는 deploy 권한 없음.
if [ -z "$be_version" ] || [ -z "$be_revision" ]; then
  echo 'FAIL_CLOSED running_metadata: OCI label 누락 — no-op/배포 기준을 확정할 수 없습니다.' >&2
  exit 2
fi

if [ "$be_version" != "$be_tag" ]; then
  echo 'FAIL_CLOSED running_metadata: image tag와 org.opencontainers.image.version 불일치.' >&2
  exit 2
fi
if [[ ! "$be_revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'FAIL_CLOSED running_metadata: org.opencontainers.image.revision이 40-hex SHA가 아닙니다.' >&2
  exit 2
fi
if [[ ! "$be_tag" =~ ^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$ ]]; then
  echo 'FAIL_CLOSED running_metadata: 실행 중 태그가 full SemVer가 아닙니다.' >&2
  exit 2
fi

printf 'state=running\n'
printf 'prev_tag=%s\n' "$be_tag"
printf 'prev_sha=%s\n' "$be_revision"
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
            def prevBeImageId = fields.get('prev_be_image_id', '')
            if (!prevTag?.trim() || !prevSha?.trim() || !prevBeImageId?.trim()) {
              error('FAIL_CLOSED running_metadata: running probe가 tag/SHA/Image ID를 모두 반환하지 않았습니다.')
            }
            env.PREV_TAG = prevTag
            env.PREV_SHA = prevSha
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

            // 하위 SemVer 타깃: 실행 중 metadata가 일치할 때만 성공 no-op (downgrade guard).
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

            if (cmp < 0 && env.PRIVATE_KEYS_CHANGED == 'true') {
              if (!env.PREV_PRIVATE_KEY_GENERATION?.trim()) {
                error('FAIL_CLOSED key_rotation_downgrade: 이전 개인키 generation이 없어 활성 포인터를 복구할 수 없습니다.')
              }
              sh '''#!/usr/bin/env bash
set -euo pipefail
ln -sfn "$PREV_PRIVATE_KEY_GENERATION" "${SECRETS_DIR}/.current-next"
mv -T "${SECRETS_DIR}/.current-next" "${SECRETS_DIR}/current"
'''
              error('FAIL_CLOSED key_rotation_downgrade: 하위 Release checkout으로 실행 중 상위 Release의 backend를 재생성할 수 없습니다.')
            }

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

    stage('Buildx 캐시 상한 사전 검증') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''
          if ! docker buildx prune --help 2>&1 | grep -F -- '--max-used-space' >/dev/null; then
            echo 'FAIL_CLOSED buildx_preflight: docker buildx prune가 --max-used-space를 지원하지 않습니다. Buildx를 업그레이드하십시오.' >&2
            exit 1
          fi
        '''
      }
    }

    stage('Buildx 캐시 상한 사전 정리') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"
'''
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
            "PREV_BE_IMAGE_ID=${env.PREV_BE_IMAGE_ID ?: ''}",
          ]) {
            sh 'bash scripts/jenkins/validate-rollback-images.sh'
          }
        }
      }
    }

    stage('호스트 nginx 드리프트 사전 검증') {
      steps {
        // 호스트 nginx 는 시스템 서비스라 이 파이프라인이 파일을 반영하지 않는다(#562).
        // 반영은 배포 런북 절차로 사람이 수행하므로, 저장소 원본과 실행 중 설정이 갈라진 채로
        // 배포가 흘러가지 않게 여기서 fail-closed 로 세운다. 새 권한은 필요하지 않다 —
        // 활성 설정이 0644 라 배포 계정이 읽을 수 있다.
        sh 'bash scripts/check-host-nginx-drift.sh'
      }
    }

    stage('PostgreSQL 기동 및 배포 전 백업') {
      when {
        expression { env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          sh '''#!/usr/bin/env bash
            set -euo pipefail
            set +x
            storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
            [ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
                : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
                : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
                export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
                export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"

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

            object_backup_parent="${BACKUP_DIR}/objects"
            object_backup_target="${object_backup_parent}/${RELEASE_TAG}-${BUILD_NUMBER}"
            object_backup_tmp=
            object_list=
            object_manifest_tmp=
            receipt_tmp=
            mkdir -p "$object_backup_parent"
            test ! -e "$object_backup_target"
            object_backup_tmp="$(mktemp -d "${object_backup_target}.XXXXXX")"
            object_list="$(mktemp "${object_backup_target}.objects.XXXXXX")"
            object_manifest_tmp="$(mktemp "${object_backup_target}.manifest.XXXXXX")"
            receipt_tmp="$(mktemp "${object_backup_target}.receipt.XXXXXX")"
            trap 'rm -rf "$object_backup_tmp"; rm -f "$object_list" "$object_manifest_tmp" "$receipt_tmp"' EXIT

            read_storage_value() {
              awk -F= -v key="$1" '$1 == key { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE"
            }
            if [ -n "${PREV_TAG:-}" ]; then
              candidate_storage_hash="$(
                printf '%s\\0%s\\0%s\\0%s\\0%s' \
                  "$storage_mode" \
                  "$(read_storage_value SUBMISSION_FILE_S3_ENDPOINT)" \
                  "$(read_storage_value SUBMISSION_FILE_S3_REGION)" \
                  "$(read_storage_value SUBMISSION_FILE_S3_BUCKET)" \
                  "$(read_storage_value SUBMISSION_FILE_S3_FORCE_PATH_STYLE)" |
                  sha256sum | awk '{print $1}'
              )"
              docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T backend \
                node -e 'const { createHash } = require("node:crypto"); const keys = ["SUBMISSION_FILE_STORAGE_MODE", "SUBMISSION_FILE_S3_ENDPOINT", "SUBMISSION_FILE_S3_REGION", "SUBMISSION_FILE_S3_BUCKET", "SUBMISSION_FILE_S3_FORCE_PATH_STYLE"]; const values = keys.map((key) => process.env[key] ?? ""); const digest = createHash("sha256").update(values.join("\\0")).digest("hex"); process.exit(digest === process.argv[1] ? 0 : 1)' \
                "$candidate_storage_hash" ||
                { echo 'FAIL_CLOSED object_backup: active backend storage tuple disagrees with validated configuration.' >&2; exit 1; }
            fi
            # Validation requires configured HTTPS endpoint, region, bucket, and path-style;
            # credentials are Jenkins-only environment variables, never read from the env file.
            export SUBMISSION_FILE_S3_ENDPOINT="$(read_storage_value SUBMISSION_FILE_S3_ENDPOINT)"
            export SUBMISSION_FILE_S3_REGION="$(read_storage_value SUBMISSION_FILE_S3_REGION)"
            export SUBMISSION_FILE_S3_BUCKET="$(read_storage_value SUBMISSION_FILE_S3_BUCKET)"
            export SUBMISSION_FILE_S3_FORCE_PATH_STYLE="$(read_storage_value SUBMISSION_FILE_S3_FORCE_PATH_STYLE)"
            case "$SUBMISSION_FILE_S3_FORCE_PATH_STYLE" in
              true|false) ;;
              *) echo 'FAIL_CLOSED object_backup: invalid validated path-style setting.' >&2; exit 1 ;;
            esac
            # The previous backend image's AWS SDK downloads every object and verifies listed size.
            [ -n "${PREV_TAG:-}" ] || { echo 'FAIL_CLOSED object_backup: managed backup requires a previous backend image.' >&2; exit 1; }
            docker run --rm \
                --env SUBMISSION_FILE_S3_ACCESS_KEY_ID \
                --env SUBMISSION_FILE_S3_SECRET_ACCESS_KEY \
                --env SUBMISSION_FILE_S3_ENDPOINT \
                --env SUBMISSION_FILE_S3_REGION \
                --env SUBMISSION_FILE_S3_BUCKET \
                --env SUBMISSION_FILE_S3_FORCE_PATH_STYLE \
                --volume "${object_backup_tmp}:/backup" \
                --user "$(id -u):$(id -g)" \
                --entrypoint node \
                "oss-hub-backend:${PREV_TAG}" \
                -e 'const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3"); const { createWriteStream, mkdirSync, statSync } = require("node:fs"); const { dirname, join } = require("node:path"); const { pipeline } = require("node:stream/promises"); const client = new S3Client({ endpoint: process.env.SUBMISSION_FILE_S3_ENDPOINT, region: process.env.SUBMISSION_FILE_S3_REGION, forcePathStyle: process.env.SUBMISSION_FILE_S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId: process.env.SUBMISSION_FILE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SUBMISSION_FILE_S3_SECRET_ACCESS_KEY } }); (async () => { let token; let count = 0; const tokens = new Set(); do { if (token !== undefined) { if (tokens.has(token)) throw new Error("repeated list token"); tokens.add(token); } const page = await client.send(new ListObjectsV2Command({ Bucket: process.env.SUBMISSION_FILE_S3_BUCKET, ContinuationToken: token })); for (const object of page.Contents ?? []) { const key = object.Key; if (typeof key !== "string" || key === "" || key.startsWith("/") || key.split("/").includes("..")) throw new Error("unsafe object key"); const destination = join("/backup", key); mkdirSync(dirname(destination), { recursive: true }); const got = await client.send(new GetObjectCommand({ Bucket: process.env.SUBMISSION_FILE_S3_BUCKET, Key: key })); await pipeline(got.Body, createWriteStream(destination, { flags: "wx", mode: 0o600 })); if (statSync(destination).size !== Number(object.Size)) throw new Error("downloaded size mismatch"); count += 1; } if (page.IsTruncated) { if (typeof page.NextContinuationToken !== "string" || page.NextContinuationToken === "") throw new Error("missing continuation token"); token = page.NextContinuationToken; } else { token = undefined; } } while (token !== undefined); console.log("object-backup-downloaded=" + count); })().catch(() => { console.error("FAIL_CLOSED object_backup: managed download failed."); process.exit(1); });'
            test -d "$object_backup_tmp"
            planned_restore_drill_prefix=".restore-drill/${RELEASE_TAG}-${BUILD_NUMBER}"
            object_count=0
            object_bytes=0
            find "$object_backup_tmp" -type f -print0 > "$object_list"
            while IFS= read -r -d '' object_file; do
              object_relative_path=${object_file#"$object_backup_tmp"/}
              object_hash=$(sha256sum "$object_file" | awk '{print $1}')
              printf '%s  %s\n' "$object_hash" "$object_relative_path" >> "$object_manifest_tmp"
              object_count=$((object_count + 1))
              object_bytes=$((object_bytes + $(wc -c < "$object_file")))
            done < "$object_list"
            printf 'object-count=%s\nobject-bytes=%s\n' "$object_count" "$object_bytes" > "$receipt_tmp"
            printf 'planned-restore-drill-prefix=%s\n' "$planned_restore_drill_prefix" >> "$receipt_tmp"
            mv "$object_manifest_tmp" "${object_backup_tmp}/.manifest.sha256"
            object_manifest_tmp=
            mv "$receipt_tmp" "${object_backup_tmp}/.receipt"
            receipt_tmp=
            test -f "${object_backup_tmp}/.receipt"
            mv "$object_backup_tmp" "$object_backup_target"
            object_backup_tmp=
            (
              cd "$object_backup_target"
              if [ "$object_count" -eq 0 ]; then
                test ! -s .manifest.sha256
              else
                sha256sum -c .manifest.sha256 >/dev/null
              fi
            )
            rm -f "$object_list"
            object_list=
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
# release-tag 이름 + OCI label(RELEASE_TAG, RELEASE_SHA). backend 이미지는 1회만 빌드.
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
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          sh '''#!/usr/bin/env bash
            set -euo pipefail
            set +x
            storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
            managed_s3_env=()
            [ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
                : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
                : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
                export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
                export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"
                managed_s3_env=(--env SUBMISSION_FILE_S3_ACCESS_KEY_ID --env SUBMISSION_FILE_S3_SECRET_ACCESS_KEY)

            docker run --rm \
              --network "${COMPOSE_PROJECT_NAME}_default" \
              --env-file "$OSS_HUB_ENV_FILE" \
              "${managed_s3_env[@]}" \
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
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          script {
            try {
              sh '''#!/usr/bin/env bash
                set -euo pipefail
                set +x
                storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
                [ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
                    : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
                    : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
                    export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
                    export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"

                require_status() {
                  expected=$1
                  method=$2
                  url=$3
                  shift 3
                  for status_attempt in 1 2 3 4 5; do
                    actual="$(curl -o /dev/null -w '%{http_code}' --silent --show-error --request "$method" "$@" "$url")"
                    [ "$actual" = "$expected" ] && return 0
                    [ "$status_attempt" = 5 ] || sleep 1
                  done
                  printf '스모크 실패: method=%s url=%s expected=%s actual=%s\n' "$method" "$url" "$expected" "$actual" >&2
                  return 1
                }

                # 레지스트리에서 받아오는 이미지는 미리 당겨둔다. 받는 시간이 아래 --wait 예산에
                # 섞이지 않고, 레지스트리 장애도 교체 전에 드러난다.
                # rollout 동안 PREV_TAG rollback 이미지는 삭제하지 않는다(성공 후 retention만 정리).
                docker compose --env-file "$OSS_HUB_ENV_FILE" pull --quiet postgres nginx
                docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 180
                mounted_digest() {
                  docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T backend \
                    node -e "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$1"
                }
                for pem in collection operations; do
                  host_digest="$(sha256sum "${SECRETS_DIR}/current/${pem}.pem" | cut -d' ' -f1)"
                  container_digest="$(mounted_digest "/run/secrets/github_${pem}_app_private_key")"
                  if [ "$host_digest" != "$container_digest" ]; then
                    echo "FAIL_CLOSED ${pem} 개인키 mount가 활성 generation과 다릅니다." >&2
                    exit 1
                  fi
                done
                # bind mount 내용은 Compose 서비스 해시에 없어 up -d가 nginx를 재생성하지 않으므로 명시적 reload 없이는 낡은 설정이 계속 서빙된다.
                docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -t
                docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -s reload
                require_status 404 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused
                require_status 200 GET http://127.0.0.1:8081/api/v1/health --retry 5 --retry-connrefused
                # 미인증 401은 nginx를 통과해 backend SessionGuard에 도달했음을 검증한다.
                require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused
                require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused
                require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused
                require_status 401 POST http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused
                require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files/1 --retry 5 --retry-connrefused
                # 실행 중 ingress 가 업로드 본문을 실제로 통과시키는지 확인한다.
                # 저장소 설정 검사만으로는 실행 중 설정 드리프트를 증명하지 못한다(ADR-002).
                bash scripts/check-upload-body-runtime.sh \
                  http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused
                bash scripts/check-upload-body-runtime.sh \
                  https://54.116.116.174/api/v1/submission-files \
                  --retry 5 --retry-connrefused --resolve '54.116.116.174:443:127.0.0.1'
                require_status 308 GET https://54.116.116.174/ --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 200 GET https://54.116.116.174/api/v1/health --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 404 GET https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 401 POST https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 404 GET https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 401 POST https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
                require_status 401 GET https://54.116.116.174/api/v1/submission-files/1 --retry 5 --retry-connrefused \
                  --resolve '54.116.116.174:443:127.0.0.1'
              '''
            } catch (deploymentFailure) {
              sh '''#!/usr/bin/env bash
                set -euo pipefail
                set +x
                storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
                [ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
                : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
                : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
                export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
                export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"
                docker compose --env-file "$OSS_HUB_ENV_FILE" ps || true
                docker compose --env-file "$OSS_HUB_ENV_FILE" logs --no-color || true
              '''

              if (env.PRIVATE_KEYS_CHANGED == 'true' && env.PREV_PRIVATE_KEY_GENERATION?.trim()) {
                sh '''#!/usr/bin/env bash
set -euo pipefail
ln -sfn "$PREV_PRIVATE_KEY_GENERATION" "${SECRETS_DIR}/.current-next"
mv -T "${SECRETS_DIR}/.current-next" "${SECRETS_DIR}/current"
'''
              }

              if (env.PREV_TAG?.trim()) {
                echo "서비스 교체 또는 스모크 실패: ${env.PREV_TAG} 이미지로 한 번 복구합니다."
                withEnv(["IMAGE_TAG=${env.PREV_TAG}"]) {
                  sh '''#!/usr/bin/env bash
                    set -euo pipefail
                    set +x
                    storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
                    [ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
                        : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
                        : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
                        export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
                        export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"

                    require_status() {
                      expected=$1
                      method=$2
                      url=$3
                      shift 3
                      for status_attempt in 1 2 3 4 5; do
                        actual="$(curl -o /dev/null -w '%{http_code}' --silent --show-error --request "$method" "$@" "$url")"
                        [ "$actual" = "$expected" ] && return 0
                        [ "$status_attempt" = 5 ] || sleep 1
                      done
                      printf '스모크 실패: method=%s url=%s expected=%s actual=%s\n' "$method" "$url" "$expected" "$actual" >&2
                      return 1
                    }

                    docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 180
                    # rollback은 이전 앱 이미지만 복구하고 nginx 설정은 현재 워크스페이스를 유지하므로 아래 스모크로 backend 인증 경로를 다시 검증한다.
                    docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -t
                    docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -s reload
                    require_status 404 GET http://127.0.0.1:8081/
                    require_status 200 GET http://127.0.0.1:8081/api/v1/health
                    require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files
                    require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files
                    require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files
                    require_status 401 POST http://127.0.0.1:8081/api/v1/Submission-Files
                    require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files/1
                    require_status 308 GET https://54.116.116.174/ \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 200 GET https://54.116.116.174/api/v1/health \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 404 GET https://54.116.116.174/api/v1/submission-files \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 401 POST https://54.116.116.174/api/v1/submission-files \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 404 GET https://54.116.116.174/api/v1/Submission-Files \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 401 POST https://54.116.116.174/api/v1/Submission-Files \
                      --resolve '54.116.116.174:443:127.0.0.1'
                    require_status 401 GET https://54.116.116.174/api/v1/submission-files/1 \
                      --resolve '54.116.116.174:443:127.0.0.1'
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

    stage('no-op 개인키 변경 반영') {
      when {
        expression { env.DEPLOY_NOOP == 'true' && env.PRIVATE_KEYS_CHANGED == 'true' }
      }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          script {
            try {
              sh '''#!/usr/bin/env bash
set -euo pipefail
set +x

storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
[ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
    : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
    : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
    export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
    export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"


docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build \
  --force-recreate --no-deps --wait --wait-timeout 180 backend

mounted_digest() {
  docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T backend \
    node -e "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$1"
}
for pem in collection operations; do
  host_digest="$(sha256sum "${SECRETS_DIR}/current/${pem}.pem" | cut -d' ' -f1)"
  container_digest="$(mounted_digest "/run/secrets/github_${pem}_app_private_key")"
  if [ "$host_digest" != "$container_digest" ]; then
    echo "FAIL_CLOSED ${pem} 개인키 mount가 활성 generation과 다릅니다." >&2
    exit 1
  fi
done
curl --fail --silent --show-error --retry 5 --retry-connrefused \
  http://127.0.0.1:8081/api/v1/health >/dev/null
'''
            } catch (keyReloadFailure) {
              if (env.PREV_PRIVATE_KEY_GENERATION?.trim()) {
                sh '''#!/usr/bin/env bash
set -euo pipefail
set +x

storage_mode="$(awk -F= '$1=="SUBMISSION_FILE_STORAGE_MODE" { if (++count == 1) value=$2 } END { if (count == 0 || count > 1 || value == "") exit 1; print value }' "$OSS_HUB_ENV_FILE")"
unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY
[ "$storage_mode" = 'managed' ] || { echo 'FAIL_CLOSED storage_mode: invalid validated storage mode.' >&2; exit 1; }
    : "${R2_STORAGE_ACCESS_KEY_ID:?missing Jenkins R2 access key}"
    : "${R2_STORAGE_SECRET_ACCESS_KEY:?missing Jenkins R2 secret key}"
    export SUBMISSION_FILE_S3_ACCESS_KEY_ID="$R2_STORAGE_ACCESS_KEY_ID"
    export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="$R2_STORAGE_SECRET_ACCESS_KEY"

ln -sfn "$PREV_PRIVATE_KEY_GENERATION" "${SECRETS_DIR}/.current-next"
mv -T "${SECRETS_DIR}/.current-next" "${SECRETS_DIR}/current"
docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build \
  --force-recreate --no-deps --wait --wait-timeout 180 backend
'''
              }
              throw keyReloadFailure
            }
          }
        }
      }
    }

    stage('no-op 실행 중 nginx 드리프트 검증') {
      when {
        expression { env.DEPLOY_NOOP == 'true' }
      }
      steps {
        sh '''
          require_status() {
            expected=$1
            method=$2
            url=$3
            shift 3
            for status_attempt in 1 2 3 4 5; do
              actual="$(curl -o /dev/null -w '%{http_code}' --silent --show-error --request "$method" "$@" "$url")"
              [ "$actual" = "$expected" ] && return 0
              [ "$status_attempt" = 5 ] || sleep 1
            done
            printf 'FAIL_CLOSED nginx_drift: 실행 중 nginx 설정이 저장소 계약과 다릅니다. method=%s url=%s expected=%s actual=%s\n' "$method" "$url" "$expected" "$actual" >&2
            return 1
          }

          # no-op은 checkout한 릴리스가 실행 중 버전보다 낮을 수 있으므로 reload 없이 읽기 전용 스모크로 드리프트만 검출한다.
          require_status 404 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused
          require_status 200 GET http://127.0.0.1:8081/api/v1/health --retry 5 --retry-connrefused
          require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused
          require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused
          require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused
          require_status 401 POST http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused
          require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files/1 --retry 5 --retry-connrefused
          require_status 308 GET https://54.116.116.174/ --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 200 GET https://54.116.116.174/api/v1/health --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 404 GET https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 401 POST https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 404 GET https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 401 POST https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
          require_status 401 GET https://54.116.116.174/api/v1/submission-files/1 --retry 5 --retry-connrefused \
            --resolve '54.116.116.174:443:127.0.0.1'
        '''
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
# oss-hub-backend 앱 이미지만 대상으로 하며 무관 이미지는 건드리지 않는다.

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
awk -F '\t' '$1=="oss-hub-backend"' "$images_raw" > "$images_inventory"
rm -f "$images_raw"


while IFS="$(printf '\t')" read -r repo tag image_id; do
  [ -n "$repo" ] || continue
  [ -n "$tag" ] || continue
  [ "$tag" = "<none>" ] && continue
  [ "$repo" = 'oss-hub-backend' ] || continue
  if is_kept_tag "$tag"; then
    continue
  fi
  # 결정적 삭제. 참조 중이면 실패 → fail-closed.
  docker image rm "${repo}:${tag}"
done < "$images_inventory"

# 성공 배포 뒤에만 shared/internal BuildKit 캐시를 LRU 기준 상한까지 정리한다.
docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"

# backup retention N=30 (C4). Jenkins와 격리 fixture가 같은 fail-closed 구현을 호출한다.
bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"
bash scripts/prune-deploy-backups.sh "$BACKUP_DIR/objects" "$BACKUP_RETENTION_N" --objects

echo "retention: kept image tags=${retention_keep_tags[*]}; backup keep newest n=${BACKUP_RETENTION_N}; build cache cap=${BUILD_CACHE_MAX_SPACE}"
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
