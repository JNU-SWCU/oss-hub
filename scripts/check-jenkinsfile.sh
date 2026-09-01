#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: scripts/check-jenkinsfile.sh [v2] [Jenkinsfile]\n' >&2
  exit 2
}

case $# in
  0) jenkinsfile=Jenkinsfile ;;
  1) [[ $1 != v2 && $1 != -h && $1 != --help ]] || usage; jenkinsfile=$1 ;;
  2) [[ $1 == v2 ]] || usage; jenkinsfile=$2 ;;
  *) usage ;;
esac

[[ -f $jenkinsfile ]] || { printf 'Jenkinsfile contract: file not found: %s\n' "$jenkinsfile" >&2; exit 1; }

active=$(mktemp "${TMPDIR:-/tmp}/jenkinsfile-active.XXXXXX")
trap 'rm -f "$active"' EXIT
# Contract tokens in comments cannot satisfy the deployment contract.
awk '
  /^[[:space:]]*(\/\/|#)/ { next }
  { sub(/[[:space:]]+\/\/.*/, ""); sub(/[[:space:]]+#.*/, ""); print }
' "$jenkinsfile" >"$active"

fail() {
  printf 'Jenkinsfile contract: %s\n' "$1" >&2
  exit 1
}

require() {
  local description=$1 pattern=$2
  grep -Fq -- "$pattern" "$active" || fail "$description"
}

require_absent() {
  local description=$1 pattern=$2
  ! grep -Fq -- "$pattern" "$active" || fail "$description"
}

require_regex() {
  local description=$1 pattern=$2
  grep -Eq -- "$pattern" "$active" || fail "$description"
}

require_regex_absent() {
  local description=$1 pattern=$2
  ! grep -Eq -- "$pattern" "$active" || fail "$description"
}

require_count() {
  local description=$1 pattern=$2 expected=$3 actual
  actual=$(grep -Fc -- "$pattern" "$active" || true)
  [[ $actual == "$expected" ]] || fail "$description (expected=${expected}, actual=${actual})"
}

require_regex_count() {
  local description=$1 pattern=$2 expected=$3 actual
  actual=$(grep -Ec -- "$pattern" "$active" || true)
  [[ $actual == "$expected" ]] || fail "$description (expected=${expected}, actual=${actual})"
}

require_order() {
  local description=$1 before=$2 after=$3 before_line after_line
  before_line=$(grep -nF -- "$before" "$active" | head -n1 | cut -d: -f1)
  after_line=$(grep -nF -- "$after" "$active" | head -n1 | cut -d: -f1)
  [[ -n $before_line && -n $after_line && $before_line -lt $after_line ]] || fail "$description"
}

stage_section() {
  local marker=$1
  awk -v marker="$marker" '
    found && /stage[(]/ && index($0, marker) == 0 { exit }
    index($0, marker) { found = 1 }
    found { print }
  ' "$active"
}

require_stage() {
  local description=$1 stage=$2 pattern=$3
  stage_section "$stage" | grep -Fq -- "$pattern" || fail "$description"
}

require_stage_absent() {
  local description=$1 stage=$2 pattern=$3
  ! stage_section "$stage" | grep -Fq -- "$pattern" || fail "$description"
}

# Release identity and backend-only running authority.
require 'pipeline serialization must remain' 'disableConcurrentBuilds()'
require 'RELEASE_TAG must remain the image tag' 'env.IMAGE_TAG = tag'
require 'exact Release SHA resolution must remain' 'git rev-parse "${RELEASE_TAG}^{commit}"'
require 'Release commit must remain on main' 'git merge-base --is-ancestor "$release_sha" origin/main'
require 'exact SHA checkout must remain' 'git checkout --detach "$RELEASE_SHA"'
require 'production env preflight must remain' 'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"'
require 'greenfield host-clean guard must remain' 'bash scripts/jenkins/assert-greenfield-host-clean.sh'
require_absent 'production volume destruction must remain absent' 'down -v'
require 'backend running probe must remain' 'ps -q backend'
require 'backend stopped-state probe must remain' 'ps --all -q backend'
require 'backend OCI version label must remain' 'org.opencontainers.image.version'
require 'backend OCI revision label must remain' 'org.opencontainers.image.revision=${RELEASE_SHA}'
require 'same-tag/different-SHA must fail closed' 'FAIL_CLOSED same_tag_different_sha'
require 'backend immutable rollback identity must remain' 'PREV_BE_IMAGE_ID'
require 'backend-only rollback helper input must remain' 'PREV_BE_IMAGE_ID=${env.PREV_BE_IMAGE_ID'
require_absent 'legacy frontend image must be absent' 'oss-hub-frontend'
require_absent 'legacy frontend rollback identity must be absent' 'PREV_FE_IMAGE_ID'
require_absent 'legacy frontend build must be absent' 'apps/frontend/Dockerfile'
require_absent 'legacy frontend running probe must be absent' 'ps -q frontend'
require_absent 'legacy frontend state probe must be absent' 'ps --all -q frontend'
require_absent 'paired deployment authority must be absent' 'partial_deployment'
require_absent 'paired running authority must be absent' 'partial_running'

# Managed backup remains before rollout and uses the previous backend image.
require 'managed storage mode must be validated' "[ \"\$storage_mode\" = 'managed' ]"
require 'managed backup must retain the R2 credential boundary' "credentialsId: 'oss-hub-r2-s3-credentials'"
require 'managed object backup must use the previous backend image' '"oss-hub-backend:${PREV_TAG}"'
require 'managed backup pagination must remain' 'ListObjectsV2Command'
require 'managed backup object download must remain' 'GetObjectCommand'
require 'managed backup missing-token guard must remain' 'missing continuation token'
require 'managed backup listed-size check must remain' 'statSync(destination).size !== Number(object.Size)'
require 'managed backup manifest verification must remain' 'sha256sum -c .manifest.sha256'
require 'fresh SQL backup target must remain' 'backup_target="${BACKUP_DIR}/${RELEASE_TAG}-${BUILD_NUMBER}.sql"'
require 'fresh object backup target must remain' 'object_backup_target="${object_backup_parent}/${RELEASE_TAG}-${BUILD_NUMBER}"'
require_order 'backup must precede backend build' "stage('PostgreSQL 기동 및 배포 전 백업')" "stage('버전 이미지 빌드')"

# Backend image, migration, rollout and rollback remain explicit.
require_count 'backend image must be built exactly once' '--file apps/backend/Dockerfile' 1
require 'Prisma deploy must use the versioned backend image' '"oss-hub-backend:${IMAGE_TAG}"'
require 'production Prisma migration must remain' 'npx prisma migrate deploy'
require 'rollback image validation must remain' 'bash scripts/jenkins/validate-rollback-images.sh'
require 'rollback must set the previous backend tag' 'withEnv(["IMAGE_TAG=${env.PREV_TAG}"])'
require 'rollout compose wait must remain' 'up -d --no-build --wait --wait-timeout 180'
require 'nginx config test must remain' 'exec -T nginx nginx -t'
require 'nginx reload must remain' 'exec -T nginx nginx -s reload'
require 'read-only no-op drift stage must remain' "stage('no-op 실행 중 nginx 드리프트 검증')"
require_stage 'production env preflight must execute unconditionally' \
  "stage('운영 환경 사전 검증')" \
  'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"'
require_stage_absent 'production env preflight must not have a when gate' \
  "stage('운영 환경 사전 검증')" 'when {'
require_stage 'no-op drift must run only for DEPLOY_NOOP true' \
  "stage('no-op 실행 중 nginx 드리프트 검증')" \
  "expression { env.DEPLOY_NOOP == 'true' }"
for forbidden_noop_mutation in 'up -d' 'pull ' 'force-recreate' 'image rm' 'prune '; do
  require_stage_absent 'no-op drift stage must remain read-only' \
    "stage('no-op 실행 중 nginx 드리프트 검증')" \
    "$forbidden_noop_mutation"
done

# Production nginx now serves no local frontend, but public TLS preserves Vercel canonical redirect.
require_regex_count 'loopback root must assert 404 for rollout, rollback, and no-op drift' 'require_status 404 GET http://127[.]0[.]0[.]1:8081/([[:space:]]|$)' 3
require_regex_absent 'loopback root 200 smoke must be absent' 'require_status 200 GET http://127[.]0[.]0[.]1:8081/([[:space:]]|$)'
require_regex_count 'public TLS root must retain canonical 308' 'require_status 308 GET https://54[.]116[.]116[.]174/([[:space:]]|$)' 3
require 'loopback API health smoke must remain' 'require_status 200 GET http://127.0.0.1:8081/api/v1/health'
require 'public API health smoke must remain' 'require_status 200 GET https://54.116.116.174/api/v1/health'
require 'submission authentication smoke must remain' 'require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files'
require 'OAuth/session authentication ingress smoke must remain' 'require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files/1'

# Successful deployment retains only backend images and bounded backups/cache.
require 'backend-only retention inventory must remain' "\$1==\"oss-hub-backend\""
require_absent 'frontend retention must be absent' 'oss-hub-frontend'
require 'BuildKit pruning must remain' 'docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"'
require 'SQL backup pruning must remain' 'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"'
require 'object backup pruning must remain' 'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR/objects" "$BACKUP_RETENTION_N" --objects'

require_order 'production env preflight must precede mutation stages' \
  'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"' \
  "stage('PostgreSQL 기동 및 배포 전 백업')"
require_order 'greenfield host-clean guard must precede backup' \
  'bash scripts/jenkins/assert-greenfield-host-clean.sh' \
  "stage('PostgreSQL 기동 및 배포 전 백업')"
