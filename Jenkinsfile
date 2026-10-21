pipeline {
  agent {
    node {
      label 'oss-hub-production'
      customWorkspace '/var/lib/oss-hub/controller'
    }
  }
  options {
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }
  triggers { cron('H/10 * * * *') }
  environment {
    COMPOSE_PROJECT_NAME = 'oss-hub'
    BACKUP_DIR = '/var/lib/oss-hub/backups'
    BACKUP_RETENTION_N = '30'
    BUILD_CACHE_MAX_SPACE = '5GB'
    SECRETS_DIR = '/var/lib/oss-hub/secrets'
  }
  stages {
    stage('controller mount 경계 검증과 체크아웃') {
      steps {
        script {
          env.CONTROLLER_DIR = pwd()
          sh '''#!/usr/bin/env bash
set -euo pipefail
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
try {
const workspace = realpathSync(process.env.CONTROLLER_DIR);
const ids = execFileSync('docker', ['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=oss-hub'], {encoding:'utf8'}).trim().split(/\\s+/).filter(Boolean);
for (const id of ids) {
  const containers = JSON.parse(execFileSync('docker', ['inspect', id], {encoding:'utf8'}));
  if (containers.length !== 1) throw new Error('ambiguous mount inventory');
  for (const mount of containers[0].Mounts) {
    if (mount.Type !== 'bind') continue;
    const source = realpathSync(mount.Source);
    if (workspace === source || workspace.startsWith(source + sep) || source.startsWith(workspace + sep)) throw new Error('controller overlaps live bind source');
  }
}
} catch {
  console.error('FAIL_CLOSED controller mount inventory or checkout overlap');
  process.exit(1);
}
NODE
'''
          checkout scm
          env.CONTROLLER_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          echo "CONTROLLER_SHA=${env.CONTROLLER_SHA}; workspace=${env.CONTROLLER_DIR}"
        }
      }
    }
    stage('latest Release 검증 및 exact SHA 해석') {
      steps {
        script {
          env.DEPLOY_NOOP = 'false'
          env.PREV_TAG = ''
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

    stage('credential 없는 실행 상태 판단') {
      steps {
        script {
          def fields = sh(script: '''#!/usr/bin/env bash
set -euo pipefail
node "$CONTROLLER_DIR/scripts/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" | jq -er '[.decision,.tag,.sha,.imageId,.postgresId] | @tsv'
''', returnStdout: true).trim().split('\t')
          env.DEPLOY_NOOP = fields[0] == 'noop' ? 'true' : 'false'
          env.PREV_TAG = fields[1]
          env.PREV_SHA = fields[2]
          env.PREV_BE_IMAGE_ID = fields[3]
          env.PREV_POSTGRES_ID = fields[4]
          currentBuild.description = "${env.RELEASE_TAG} ${fields[0]} (running ${env.PREV_TAG})"
        }
      }
    }
    stage('exact release source와 복구 구성 캡처') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        script {
          env.RELEASE_SOURCE = "${env.CONTROLLER_DIR}/release-source"
          env.RECOVERY_DIR = sh(script: '''#!/usr/bin/env bash
set -euo pipefail
umask 077
mktemp -d "$SECRETS_DIR/recovery.XXXXXX"
''', returnStdout: true).trim()
          env.PREVIOUS_STATE = "${env.RECOVERY_DIR}/state.json"
          env.PREVIOUS_KEY_IDENTITY = "${env.RECOVERY_DIR}/keys.json"
          sh '''#!/usr/bin/env bash
set -euo pipefail
test -w /var/lib/oss-hub
mkdir -p /var/lib/oss-hub/runtime/releases
test -w /var/lib/oss-hub/runtime/releases
test -d "$SECRETS_DIR"
test -w "$SECRETS_DIR"
node "$CONTROLLER_DIR/scripts/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" --capture "$CONTROLLER_DIR" "$SECRETS_DIR" "$PREVIOUS_KEY_IDENTITY" > "$PREVIOUS_STATE"
bash "$CONTROLLER_DIR/scripts/jenkins/validate-rollback-images.sh"
test ! -L "$RELEASE_SOURCE"
if [ ! -d "$RELEASE_SOURCE" ]; then
  git clone --no-checkout --no-hardlinks "$CONTROLLER_DIR" "$RELEASE_SOURCE"
fi
git -C "$RELEASE_SOURCE" fetch --quiet "$CONTROLLER_DIR" "$RELEASE_SHA"
git -C "$RELEASE_SOURCE" checkout --detach --force "$RELEASE_SHA"
git -C "$RELEASE_SOURCE" clean -ffd
test "$(git -C "$RELEASE_SOURCE" rev-parse HEAD)" = "$RELEASE_SHA"
bash "$CONTROLLER_DIR/scripts/check-host-nginx-drift.sh" "$RELEASE_SOURCE/deploy/host-nginx/oss-hub.conf"
'''
          env.CANDIDATE_COMPOSE = sh(script: '''#!/usr/bin/env bash
set -euo pipefail
snapshot="$(mktemp -d /var/lib/oss-hub/runtime/releases/release.XXXXXX)"
mkdir "$snapshot/deploy"
cp "$RELEASE_SOURCE/compose.yml" "$snapshot/compose.yml"
cp -R "$RELEASE_SOURCE/deploy/nginx" "$snapshot/deploy/nginx"
printf '%s/compose.yml' "$snapshot"
''', returnStdout: true).trim()
        }
      }
    }
    stage('deploy credential 검증과 키 staging') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          file(credentialsId: 'oss-hub-collection-app-private-key', variable: 'COLLECTION_PEM_SRC'),
          file(credentialsId: 'oss-hub-operations-app-private-key', variable: 'OPERATIONS_PEM_SRC'),
        ]) {
          script {
            env.STAGED_KEY_GENERATION = sh(script: '''#!/usr/bin/env bash
set -euo pipefail
set +x
node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE"
node "$CONTROLLER_DIR/scripts/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" --storage "$OSS_HUB_ENV_FILE" >/dev/null
node "$CONTROLLER_DIR/scripts/jenkins/validate-github-app-credentials.mjs" "$OSS_HUB_ENV_FILE" "$COLLECTION_PEM_SRC" "$OPERATIONS_PEM_SRC" >&2
umask 027
generation="$(mktemp -d "$SECRETS_DIR/gen.XXXXXX")"
test "$(stat -c %g "$generation")" = 1000
install -m 640 "$COLLECTION_PEM_SRC" "$generation/collection.pem"
install -m 640 "$OPERATIONS_PEM_SRC" "$generation/operations.pem"
chmod 750 "$generation"
for role in collection operations; do
  openssl pkey -in "$generation/$role.pem" -noout 2>/dev/null
done
printf '%s' "$generation"
''', returnStdout: true).trim()
          }
        }
      }
    }
    stage('Buildx 캐시 상한') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
docker buildx prune --help | grep -F -- '--max-used-space' >/dev/null
docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"
'''
      }
    }
    stage('실행 중 PostgreSQL과 managed storage 백업') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail
set +x
node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE"
node "$CONTROLLER_DIR/scripts/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" --storage "$OSS_HUB_ENV_FILE" >/dev/null
export SUBMISSION_FILE_S3_ACCESS_KEY_ID="${R2_STORAGE_ACCESS_KEY_ID:?}"
export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="${R2_STORAGE_SECRET_ACCESS_KEY:?}"
docker exec "$PREV_POSTGRES_ID" sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
            umask 077
            backup_target="${BACKUP_DIR}/${RELEASE_TAG}-${BUILD_NUMBER}.sql"
            test ! -e "$backup_target"
            backup_tmp="$(mktemp "${backup_target}.XXXXXX")"
            trap 'rm -f "$backup_tmp"' EXIT
            docker exec "$PREV_POSTGRES_ID" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_tmp"
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

            # Validation requires configured HTTPS endpoint, region, bucket, and path-style;
            # credentials are Jenkins-only environment variables, never read from the env file.
            export SUBMISSION_FILE_S3_ENDPOINT="$(node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE" --value SUBMISSION_FILE_S3_ENDPOINT)"
            export SUBMISSION_FILE_S3_REGION="$(node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE" --value SUBMISSION_FILE_S3_REGION)"
            export SUBMISSION_FILE_S3_BUCKET="$(node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE" --value SUBMISSION_FILE_S3_BUCKET)"
            export SUBMISSION_FILE_S3_FORCE_PATH_STYLE="$(node "$CONTROLLER_DIR/scripts/jenkins/validate-production-env.mjs" "$OSS_HUB_ENV_FILE" --value SUBMISSION_FILE_S3_FORCE_PATH_STYLE)"
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
            trap - EXIT'''
        }
      }
    }
    stage('exact release 이미지 빌드') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        dir("${env.RELEASE_SOURCE}") {
          sh '''#!/usr/bin/env bash
set -euo pipefail
docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${IMAGE_TAG}" --label "org.opencontainers.image.version=${RELEASE_TAG}" --label "org.opencontainers.image.revision=${RELEASE_SHA}" .
'''
        }
      }
    }
    stage('migration과 후보 nginx 사전 검증') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail
set +x
export SUBMISSION_FILE_S3_ACCESS_KEY_ID="${R2_STORAGE_ACCESS_KEY_ID:?}"
export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="${R2_STORAGE_SECRET_ACCESS_KEY:?}"
export GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE="$STAGED_KEY_GENERATION/collection.pem"
export GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE="$STAGED_KEY_GENERATION/operations.pem"
compose=(docker compose -p oss-hub -f "$CANDIDATE_COMPOSE" --env-file "$OSS_HUB_ENV_FILE")
"${compose[@]}" run --rm --no-deps backend npx prisma migrate deploy
"${compose[@]}" pull --quiet postgres nginx
"${compose[@]}" run --rm --no-deps nginx nginx -t
'''
        }
      }
    }
    stage('활성화와 실패 복구') {
      when { expression { env.DEPLOY_NOOP == 'false' } }
      steps {
        withCredentials([
          file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE'),
          usernamePassword(credentialsId: 'oss-hub-r2-s3-credentials', usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID', passwordVariable: 'R2_STORAGE_SECRET_ACCESS_KEY'),
        ]) {
          sh 'bash "$CONTROLLER_DIR/scripts/jenkins/activate-release.sh"'
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
bash "$CONTROLLER_DIR/scripts/prune-deploy-backups.sh" "$BACKUP_DIR" "$BACKUP_RETENTION_N"
bash "$CONTROLLER_DIR/scripts/prune-deploy-backups.sh" "$BACKUP_DIR/objects" "$BACKUP_RETENTION_N" --objects

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
