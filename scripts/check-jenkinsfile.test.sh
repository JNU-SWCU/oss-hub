#!/usr/bin/env bash
# shellcheck disable=SC1003,SC2016,SC2050
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-jenkinsfile.sh"
current_source="$repo_root/Jenkinsfile"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jenkinsfile-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
v2_source="$fixture_dir/v2-green-source"

python3 - "$current_source" "$v2_source" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
checkout = """    stage('exact SHA checkout') {
      steps {
        sh 'git checkout --detach "$RELEASE_SHA"'
      }
    }
"""
preflight = """
    stage('운영 환경 사전 검증') {
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh 'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"'
        }
      }
    }
"""
preflight_marker = "stage('운영 환경 사전 검증')"
if source.count(preflight_marker) == 0:
    if source.count(checkout) != 1:
        raise SystemExit('exact SHA checkout fixture anchor must occur once')
    source = source.replace(checkout, checkout + preflight, 1)
elif source.count(preflight_marker) != 1:
    raise SystemExit('production env preflight fixture marker must occur once')

retention_120 = source.count("BACKUP_RETENTION_N = '120'")
retention_30 = source.count("BACKUP_RETENTION_N = '30'")
if retention_120 == 1 and retention_30 == 0:
    source = source.replace("BACKUP_RETENTION_N = '120'", "BACKUP_RETENTION_N = '30'", 1)
elif retention_120 != 0 or retention_30 != 1:
    raise SystemExit('backup retention fixture must be exactly 120 or 30')
Path(sys.argv[2]).write_text(source)
PY

passed=0
failed=0

expect_pass() {
  local name=$1
  local mode=$2
  local path=$3

  if bash "$checker" "$mode" "$path" >/dev/null 2>&1; then
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

  if bash "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

expect_fail_with_code() {
  local name=$1
  local mode=$2
  local path=$3
  local status

  if bash "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    status=$?
    printf 'ok - %s (checker exit=%s)\n' "$name" "$status"
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

# Root Jenkinsfile — 단일 parameterless Release 배포 계약
# ---------------------------------------------------------------------------
cp "$v2_source" "$fixture_dir/v2-valid"

# Object backup must preserve MinIO while making managed S3 backup configuration-driven.
expect_pass 'v2: mode-aware object backup contract is present' v2 "$fixture_dir/v2-valid"
if grep -Fq "credentialsId: 'oss-hub-r2-s3-credentials'" "$v2_source" && \
   grep -Fq 'storage_mode="$(awk -F=' "$v2_source" && \
   grep -Fq '"remote/$SUBMISSION_FILE_S3_BUCKET"' "$v2_source" && \
   grep -Fq 'planned_restore_drill_prefix=".restore-drill/${RELEASE_TAG}-${BUILD_NUMBER}"' "$v2_source" && \
   ! grep -Fq 'oss-hub-submission-files' "$v2_source"; then
  printf 'ok - v2: managed backup credential/mode/receipt paths\n'
  passed=$((passed + 1))
else
  printf 'not ok - v2: mode-aware object backup paths are incomplete\n' >&2
  failed=$((failed + 1))
fi

# Greenfield host-clean: empty daemon + leftover host artifacts must fail closed.
# Synthetic fixtures only — docker is stubbed, no production paths, no sleeps.
greenfield_guard="$repo_root/scripts/jenkins/assert-greenfield-host-clean.sh"
greenfield_stub_dir="$fixture_dir/greenfield-docker-bin"
mkdir -p "$greenfield_stub_dir"
cat >"$greenfield_stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == volume && "${2:-}" == ls ]]; then
  if [[ -n "${DOCKER_VOLUME_LS_OUTPUT:-}" ]]; then
    printf '%s\n' "$DOCKER_VOLUME_LS_OUTPUT"
  fi
  exit 0
fi
printf 'unexpected docker invocation\n' >&2
exit 64
STUB
chmod +x "$greenfield_stub_dir/docker"

run_greenfield_guard() {
  local backup_dir=$1
  shift
  env -u GREENFIELD_DEPLOY_ACK \
    BACKUP_DIR="$backup_dir" \
    COMPOSE_PROJECT_NAME=oss-hub \
    PATH="$greenfield_stub_dir:$PATH" \
    "$@" \
    bash "$greenfield_guard"
}

if [[ -f "$greenfield_guard" ]]; then
  printf 'ok - greenfield host-clean helper exists\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean helper exists\n' >&2
  failed=$((failed + 1))
fi

if grep -Fq 'bash scripts/jenkins/assert-greenfield-host-clean.sh' "$v2_source"; then
  printf 'ok - v2: greenfield host-clean guard is wired\n'
  passed=$((passed + 1))
else
  printf 'not ok - v2: greenfield host-clean guard is wired\n' >&2
  failed=$((failed + 1))
fi

greenfield_sql_dir="$fixture_dir/greenfield-sql"
mkdir -p "$greenfield_sql_dir"
: >"$greenfield_sql_dir/v1.2.3-161.sql"
greenfield_sql_rc=0
greenfield_sql_err=$(run_greenfield_guard "$greenfield_sql_dir" 2>&1 >/dev/null) || greenfield_sql_rc=$?
if ((greenfield_sql_rc != 0)) &&
   [[ "$greenfield_sql_err" == *FAIL_CLOSED*greenfield_host* ]] &&
   [[ "$greenfield_sql_err" == *v1.2.3-161.sql* ]] &&
   [[ "$greenfield_sql_err" == *GREENFIELD_DEPLOY_ACK=1* ]]; then
  printf 'ok - greenfield host-clean: prior sql backup fails closed\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean: prior sql backup fails closed (rc=%s)\n' "$greenfield_sql_rc" >&2
  failed=$((failed + 1))
fi

greenfield_objects_dir="$fixture_dir/greenfield-objects"
mkdir -p "$greenfield_objects_dir/objects/v1.2.3-162"
greenfield_objects_rc=0
greenfield_objects_err=$(run_greenfield_guard "$greenfield_objects_dir" 2>&1 >/dev/null) || greenfield_objects_rc=$?
if ((greenfield_objects_rc != 0)) &&
   [[ "$greenfield_objects_err" == *FAIL_CLOSED*greenfield_host* ]] &&
   [[ "$greenfield_objects_err" == *objects/v1.2.3-162* ]] &&
   [[ "$greenfield_objects_err" == *GREENFIELD_DEPLOY_ACK=1* ]]; then
  printf 'ok - greenfield host-clean: prior objects entry fails closed\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean: prior objects entry fails closed (rc=%s)\n' "$greenfield_objects_rc" >&2
  failed=$((failed + 1))
fi

greenfield_volume_dir="$fixture_dir/greenfield-volume"
mkdir -p "$greenfield_volume_dir"
greenfield_volume_rc=0
greenfield_volume_err=$(run_greenfield_guard "$greenfield_volume_dir" \
  DOCKER_VOLUME_LS_OUTPUT='oss-hub_pgdata' 2>&1 >/dev/null) || greenfield_volume_rc=$?
if ((greenfield_volume_rc != 0)) &&
   [[ "$greenfield_volume_err" == *FAIL_CLOSED*greenfield_host* ]] &&
   [[ "$greenfield_volume_err" == *oss-hub_pgdata* ]] &&
   [[ "$greenfield_volume_err" == *GREENFIELD_DEPLOY_ACK=1* ]]; then
  printf 'ok - greenfield host-clean: named volume fails closed\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean: named volume fails closed (rc=%s)\n' "$greenfield_volume_rc" >&2
  failed=$((failed + 1))
fi

greenfield_ack_dir="$fixture_dir/greenfield-ack"
mkdir -p "$greenfield_ack_dir"
: >"$greenfield_ack_dir/v1.2.3-163.sql"
if run_greenfield_guard "$greenfield_ack_dir" GREENFIELD_DEPLOY_ACK=1 >/dev/null 2>&1; then
  printf 'ok - greenfield host-clean: ACK=1 allows re-provision\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean: ACK=1 allows re-provision\n' >&2
  failed=$((failed + 1))
fi

greenfield_true_dir="$fixture_dir/greenfield-true"
mkdir -p "$greenfield_true_dir/objects"
if run_greenfield_guard "$greenfield_true_dir" >/dev/null 2>&1; then
  printf 'ok - greenfield host-clean: true greenfield continues\n'
  passed=$((passed + 1))
else
  printf 'not ok - greenfield host-clean: true greenfield continues\n' >&2
  failed=$((failed + 1))
fi

make_fixture "$v2_source" v2-missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture "$v2_source" v2-missing-production-label "label 'oss-hub-production'" "label 'any'"
make_fixture "$v2_source" v2-missing-latest-release '/releases/latest' '/releases/removed'
make_fixture "$v2_source" v2-missing-draft-check "jq -r '.draft'" "jq -r '.removedDraft'"
make_fixture "$v2_source" v2-missing-prerelease-check "jq -r '.prerelease'" "jq -r '.removedPrerelease'"
make_fixture "$v2_source" v2-missing-tag-format 'tag ==~ /' 'tag !=~ /'
make_fixture "$v2_source" v2-missing-tag-resolution 'git rev-parse "${RELEASE_TAG}^{commit}"' 'git rev-parse HEAD'
make_fixture "$v2_source" v2-missing-main-ancestry 'git merge-base --is-ancestor "$release_sha" origin/main' 'true'
make_fixture "$v2_source" v2-restored-member-authority-backfill "stage('서비스 교체 및 스모크 확인')" "stage('회원 권한 backfill')"
make_fixture "$v2_source" v2-moving-checkout 'git checkout --detach "$RELEASE_SHA"' 'git checkout main'
make_fixture "$v2_source" v2-missing-production-env-preflight \
  'node scripts/jenkins/validate-production-env.mjs "$OSS_HUB_ENV_FILE"' \
  'node scripts/jenkins/validate-production-env-removed.mjs "$OSS_HUB_ENV_FILE"'
make_fixture "$v2_source" v2-disabled-production-env-preflight \
  "stage('운영 환경 사전 검증') {" \
  "stage('운영 환경 사전 검증') { when { expression { false } }"
make_fixture "$v2_source" v2-mutation-before-production-env-preflight \
  'sh '\''git checkout --detach "$RELEASE_SHA"'\''' \
  'sh '\''git checkout --detach "$RELEASE_SHA"'\''; sh '\''mkdir -p "$SECRETS_DIR"'\'''
make_fixture "$v2_source" v2-backup-retention-120 \
  "BACKUP_RETENTION_N = '30'" \
  "BACKUP_RETENTION_N = '120'"
make_fixture "$v2_source" v2-missing-image-tag-release 'env.IMAGE_TAG = tag' 'env.IMAGE_TAG = releaseSha'
make_fixture "$v2_source" v2-missing-release-sha-binding 'env.RELEASE_SHA = releaseSha' 'env.RELEASE_SHA = env.IMAGE_TAG'
make_fixture "$v2_source" v2-missing-backup 'pg_dump' 'pg_isready'
make_fixture "$v2_source" v2-missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture "$v2_source" v2-missing-no-build 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --wait'
make_fixture "$v2_source" v2-missing-primary-upload-401-smoke \
  'require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused' \
  'require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files-removed --retry 5 --retry-connrefused'
make_fixture "$v2_source" v2-missing-rollback-upload-401-smoke \
  'require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files$' \
  'require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files-removed'
make_fixture "$v2_source" v2-weakened-upload-401-status \
  'require_status 404 GET http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused' \
  'require_status 000 GET http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused'
make_fixture "$v2_source" v2-upload-401-curl-fail \
  'curl -o /dev/null -w' \
  'curl --fail -o /dev/null -w'
make_fixture "$v2_source" v2-missing-rollback-guard 'if (!env.PREV_TAG?.trim())' 'if (false)'
make_fixture "$v2_source" v2-missing-greenfield-host-guard \
  'bash scripts/jenkins/assert-greenfield-host-clean.sh' \
  'true'
append_fixture "$v2_source" v2-hardcoded-greenfield-ack 'GREENFIELD_DEPLOY_ACK=1'
make_fixture "$v2_source" v2-missing-production-credential "credentialsId: 'oss-hub-production-env'" "credentialsId: 'removed'"
make_fixture "$v2_source" v2-missing-r2-credential \
  "credentialsId: 'oss-hub-r2-s3-credentials'" "credentialsId: 'removed-r2'"
make_fixture "$v2_source" v2-direct-r2-contract-binding \
  "usernameVariable: 'R2_STORAGE_ACCESS_KEY_ID'" \
  "usernameVariable: 'SUBMISSION_FILE_S3_ACCESS_KEY_ID'"
make_fixture "$v2_source" v2-missing-inherited-storage-credential-clear \
  'unset SUBMISSION_FILE_S3_ACCESS_KEY_ID SUBMISSION_FILE_S3_SECRET_ACCESS_KEY' \
  'true # inherited storage credential clear removed'
make_fixture "$v2_source" v2-missing-managed-mode-guard \
  "elif \\[ \"\$storage_mode\" = 'managed' \\]; then" "elif false; then"
make_fixture "$v2_source" v2-missing-managed-mode-agreement \
  'active backend storage tuple disagrees with validated configuration.' \
  'active backend tuple check removed.'
make_fixture "$v2_source" v2-missing-object-backup-parity \
  'mc diff --json' \
  'true # object backup parity removed'
make_fixture "$v2_source" v2-missing-storage-tuple-hash \
  'candidate_storage_hash="$(' \
  'candidate_storage_hash="removed"'
make_fixture "$v2_source" v2-missing-running-storage-tuple-guard \
  'FAIL_CLOSED running_storage_tuple: candidate storage tuple differs from the active backend.' \
  'running storage tuple guard removed.'
make_fixture "$v2_source" v2-missing-restore-prefix \
  'planned_restore_drill_prefix=".restore-drill/${RELEASE_TAG}-${BUILD_NUMBER}"' \
  'planned_restore_drill_prefix=""'
make_fixture "$v2_source" v2-missing-rollback-minio-bucket \
  'ROLLBACK_MINIO_BUCKET' 'REMOVED_MINIO_BUCKET'
make_fixture "$v2_source" v2-missing-object-manifest-verify \
  'sha256sum -c .manifest.sha256 >/dev/null' \
  'true # object manifest verification removed'
make_fixture "$v2_source" v2-missing-empty-object-manifest-verify \
  'test ! -s .manifest.sha256' \
  'true # empty object manifest verification removed'
make_fixture "$v2_source" v2-missing-retention-protection-validator \
  'protection_state=$(bash scripts/jenkins/r2-retention-protection.sh)' \
  'protection_state=cleanup-allowed'
make_fixture "$v2_source" v2-missing-cutover-hold-guard \
  'if \[ "$protection_active" = true \]; then' \
  'if false; then'
make_fixture "$v2_source" v2-groovy-unsafe-retention-tag-regex \
  'v\[0-9\]+\[.\]\[0-9\]+\[.\]\[0-9\]+' \
  'v[0-9]+\\.[0-9]+\\.[0-9]+'
append_fixture "$v2_source" v2-hardcoded-stale-minio-bucket \
  'sh '\''echo oss-hub-submission-files'\'''
append_fixture "$v2_source" v2-destructive-object-operation \
  'sh '\''mc rm remote/synthetic'\'''
append_fixture "$v2_source" v2-bash-only-without-interpreter \
  'managed_s3_env=()'
make_fixture "$v2_source" v2-missing-running-ps-q 'ps -q frontend' 'ps --status frontend'
make_fixture "$v2_source" v2-missing-all-ps 'ps --all -q frontend' 'ps -q frontend-all'
make_fixture "$v2_source" v2-missing-oci-version-label '--label "org.opencontainers.image.version=${RELEASE_TAG}"' '--label "org.opencontainers.image.title=${RELEASE_TAG}"'
make_fixture "$v2_source" v2-missing-oci-revision-label '--label "org.opencontainers.image.revision=${RELEASE_SHA}"' '--label "org.opencontainers.image.source=${RELEASE_SHA}"'
make_fixture "$v2_source" v2-restored-run-mode "env.DEPLOY_NOOP = 'false'" "env.RUN_MODE = 'release'"
append_fixture "$v2_source" v2-restored-big-integer 'new BigInteger("1")'
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

append_fixture "$v2_source" v2-restored-release-accept \
  "sh \"echo 'RELEASE_ACCEPT role=PM tag=v0.0.0 head=0000000000000000000000000000000000000000'\""
append_fixture "$v2_source" v2-restored-release-comment-scraping \
  "sh 'curl https://api.github.com/repos/JNU-SWCU/oss-hub/issues/199/comments'"
append_fixture "$v2_source" v2-restored-pm-actor-parsing \
  "sh \"jq --arg actor 'GoBeromsu'\""
append_fixture "$v2_source" v2-restored-tech-lead-accept \
  "sh \"echo 'RELEASE_ACCEPT role=TECH_LEAD tag=v0.0.0 head=0000000000000000000000000000000000000000'\""
append_fixture "$v2_source" v2-restored-pm-override \
  "sh \"echo 'RELEASE_OVERRIDE role=PM tag=v0.0.0 head=0000000000000000000000000000000000000000'\""

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

make_fixture "$v2_source" v2-blocker-missing-rollback-script \
  'bash scripts/jenkins/validate-rollback-images.sh' \
  'true'
make_fixture "$v2_source" v2-blocker-rollback-nonzero-swallowed \
  "sh 'bash scripts/jenkins/validate-rollback-images.sh'" \
  "sh(script: 'bash scripts/jenkins/validate-rollback-images.sh', returnStatus: true)"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-tag \
  '"PREV_TAG=${env.PREV_TAG}",' \
  '"PREV_TAG=${MISSING_PREV_TAG}",'
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-sha \
  "PREV_SHA=\${env.PREV_SHA ?: ''}" \
  "PREV_SHA=\${MISSING_PREV_SHA ?: ''}"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-fe-id \
  "PREV_FE_IMAGE_ID=\${env.PREV_FE_IMAGE_ID ?: ''}" \
  "PREV_FE_IMAGE_ID=\${MISSING_PREV_FE_IMAGE_ID ?: ''}"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-be-id \
  "PREV_BE_IMAGE_ID=\${env.PREV_BE_IMAGE_ID ?: ''}" \
  "PREV_BE_IMAGE_ID=\${MISSING_PREV_BE_IMAGE_ID ?: ''}"

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
    r"# docker images 포맷:.*?\n[ ]*done < \"\$images_inventory\"\n",
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

# ---------------------------------------------------------------------------
# Adversarial: live diagnostics that only *mention* terminal tokens must fail.
# Real condition remains; executable terminal is replaced by echo/println/string.
# ---------------------------------------------------------------------------

# Two Python helpers generalize the terminal-spoof adversarial fixtures below:
# spoof_terminal() finds an anchor branch, walks forward replacing the first
# executable terminal token(s) it meets with a non-executable echo/println
# string, and stops at the branch's closing token (skip_closes lets a branch
# skip over intermediate closes when a sibling branch must stay untouched).
python3 - "$v2_source" "$fixture_dir" <<'PYTERM'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
fixture_dir = Path(sys.argv[2])
lines = source.splitlines(keepends=True)


def write_fixture(name: str, content: str) -> None:
    if content == source:
        raise SystemExit(f"fixture not distinct: {name}")
    (fixture_dir / name).write_text(content)


def find_anchor(pattern: str) -> int:
    rx = re.compile(pattern)
    for i, line in enumerate(lines):
        if rx.search(line):
            return i
    raise SystemExit(f"fixture pattern not found: {pattern!r}")


def spoof_terminal(
    name: str,
    anchor: str,
    terminal: str,
    replacement: str,
    end: str,
    skip_closes: int = 0,
) -> None:
    rx_terminal = re.compile(terminal)
    rx_end = re.compile(end)
    idx = find_anchor(anchor)
    out = lines[: idx + 1]
    i = idx + 1
    closes = 0
    while i < len(lines):
        line = lines[i]
        if rx_terminal.search(line):
            out.append(replacement)
            i += 1
            continue
        out.append(line)
        i += 1
        if rx_end.search(line):
            if closes < skip_closes:
                closes += 1
                continue
            break
    else:
        raise SystemExit(f"fixture end pattern not found: {name}")
    out.extend(lines[i:])
    write_fixture(name, "".join(out))


FI = r"^\s*fi\s*$"
BRACE = r"^\s*\}\s*$"
EXIT_N = r"^\s*exit\s+[0-9]+\s*$"
EXIT2 = r"^\s*exit\s+2\s*$"
EXIT3 = r"^\s*exit\s+3\s*$"
ERROR_OPEN = r"^\s*error\s*\("
RETURN = r"^\s*return\s*;?\s*$"
DEPLOY_NOOP = r"^\s*(env\.)?DEPLOY_NOOP\s*=\s*'true'"

ANCHOR_STOPPED = r'\[\s*-z\s+"\$fe_running"\s*\]\s*&&\s*\[\s*-z\s+"\$be_running"\s*\]'
ANCHOR_PARTIAL = r'\[\s*-n\s+"\$fe_all"\s*\]\s*&&\s*\[\s*-z\s+"\$be_all"\s*\]'
ANCHOR_AMBIGUOUS = r"if \(state != 'running'\) \{"
ANCHOR_SAME_TAG = r"prevTag == env\.RELEASE_TAG && prevSha != env\.RELEASE_SHA"
ANCHOR_DOWNGRADE = r"if \(cmp < 0\) \{"
ANCHOR_FRONTEND_MISSING = r"count\s*==\s*0"
ANCHOR_FRONTEND_UNIQ = r"count\s*!=\s*1"

# stopped: shell echo 'exit 2' instead of executable exit
spoof_terminal(
    "v2-spoof-stopped-echo-exit", ANCHOR_STOPPED, EXIT_N, "  echo 'exit 2'\n", FI
)
# partial: shell echo 'exit 2' instead of executable exit
spoof_terminal(
    "v2-spoof-partial-echo-exit", ANCHOR_PARTIAL, EXIT_N, "  echo 'exit 2'\n", FI
)
# non-running: Groovy echo "error(...)" instead of executable error(...)
spoof_terminal(
    "v2-spoof-ambiguous-echo-error",
    ANCHOR_AMBIGUOUS,
    ERROR_OPEN,
    '              echo "error(FAIL_CLOSED unexpected_probe_state: spoof)"\n',
    BRACE,
)
# non-running: Groovy println "error(...)" variant
spoof_terminal(
    "v2-spoof-ambiguous-println-error",
    ANCHOR_AMBIGUOUS,
    ERROR_OPEN,
    '              println("error(FAIL_CLOSED unexpected_probe_state: spoof)")\n',
    BRACE,
)
# same-tag/different-SHA: echo error(...) keeps marker text, no executable error
spoof_terminal(
    "v2-spoof-same-tag-echo-error",
    ANCHOR_SAME_TAG,
    ERROR_OPEN,
    '              echo "error(FAIL_CLOSED same_tag_different_sha: retag SHA mismatch)"\n',
    BRACE,
)
# SemVer downgrade: string-wrapped return (echo "return") keeps DEPLOY_NOOP assignment
spoof_terminal(
    "v2-spoof-downgrade-string-return",
    ANCHOR_DOWNGRADE,
    RETURN,
    '              echo "return"\n',
    BRACE,
)
# SemVer downgrade: string-wrapped no-op assignment; keep executable return
spoof_terminal(
    "v2-spoof-downgrade-string-noop",
    ANCHOR_DOWNGRADE,
    DEPLOY_NOOP,
    "              echo \"env.DEPLOY_NOOP = 'true'\"\n",
    BRACE,
)
# FRONTEND_URL missing path: replace executable exit 2 with echo 'exit 2'
# (skip_closes=1 leaves the sibling count!=1 / exit 3 branch untouched)
spoof_terminal(
    "v2-spoof-frontend-url-echo-exit2",
    ANCHOR_FRONTEND_MISSING,
    EXIT2,
    "        echo 'exit 2'\n",
    BRACE,
    skip_closes=1,
)
# FRONTEND_URL uniqueness path: replace executable exit 3 with echo 'exit 3'
spoof_terminal(
    "v2-spoof-frontend-url-echo-exit3", ANCHOR_FRONTEND_UNIQ, EXIT3, "        echo 'exit 3'\n", BRACE
)
PYTERM


# ---------------------------------------------------------------------------
# Adversarial: quoted/echoed/println openers and duplicate real openers.
# Real executable condition is removed or duplicated; a spoofed opener must not
# bind terminals from an unrelated branch.
# ---------------------------------------------------------------------------

# Two Python helpers generalize the opener-spoof adversarial fixtures below:
# spoof_opener_echo() drops the real opener/branch entirely and replaces it
# with an echo/println-quoted opener plus an if(false) branch that keeps the
# same terminal tokens present but unreachable; spoof_opener_duplicate() keeps
# the real opener/branch intact and appends a second, identical, executable
# opener so a checker that only requires "at least one occurrence" is fooled.
python3 - "$v2_source" "$fixture_dir" <<'PYOPENER'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
fixture_dir = Path(sys.argv[2])
lines = source.splitlines(keepends=True)


def write_fixture(name: str, content: str) -> None:
    if content == source:
        raise SystemExit(f"fixture not distinct: {name}")
    (fixture_dir / name).write_text(content)


def find_anchor_in(lines_, pattern: str) -> int:
    rx = re.compile(pattern)
    for i, line in enumerate(lines_):
        if rx.search(line):
            return i
    raise SystemExit(f"fixture pattern not found: {pattern!r}")


def consume_until(lines_, start: int, end: str) -> int:
    rx = re.compile(end)
    i = start
    while i < len(lines_):
        if rx.search(lines_[i]):
            return i + 1
        i += 1
    raise SystemExit(f"fixture end pattern not found: {end!r}")


def spoof_opener_echo(name: str, anchor: str, replacement_lines, end: str) -> None:
    idx = find_anchor_in(lines, anchor)
    block_end = consume_until(lines, idx + 1, end)
    out = lines[:idx] + replacement_lines + lines[block_end:]
    write_fixture(name, "".join(out))


def duplicate_block(lines_, anchor: str, end: str, duplicate_lines):
    idx = find_anchor_in(lines_, anchor)
    block_end = consume_until(lines_, idx, end)
    return lines_[:block_end] + duplicate_lines + lines_[block_end:]


def spoof_opener_duplicate(name: str, anchor: str, end: str, duplicate_lines) -> None:
    write_fixture(name, "".join(duplicate_block(lines, anchor, end, duplicate_lines)))


FI = r"^\s*fi\s*$"
BRACE = r"^\s*\}\s*$"

ANCHOR_STOPPED = r'^\s*if\s+\[\s*-z\s+"\$fe_running"\s*\]\s*&&\s*\[\s*-z\s+"\$be_running"\s*\]\s*;\s*then\s*$'
ANCHOR_PARTIAL = (
    r'^\s*if\s+\{\s*\[\s*-n\s+"\$fe_all"\s*\]\s*&&\s*\[\s*-z\s+"\$be_all"\s*\]\s*;\s*\}'
    r'\s*\|\|\s*\{\s*\[\s*-z\s+"\$fe_all"\s*\]\s*&&\s*\[\s*-n\s+"\$be_all"\s*\]\s*;\s*\}\s*;\s*then\s*$'
)
ANCHOR_AMBIGUOUS = r"^\s*if\s*\(\s*state\s*!=\s*'running'\s*\)\s*\{\s*$"
ANCHOR_SAME_TAG = r"^\s*if\s*\(\s*prevTag\s*==\s*env\.RELEASE_TAG\s*&&\s*prevSha\s*!=\s*env\.RELEASE_SHA\s*\)\s*\{\s*$"
ANCHOR_DOWNGRADE = r"^\s*if\s*\(\s*cmp\s*<\s*0\s*\)\s*\{\s*$"
ANCHOR_FRONTEND_MISSING = r"^\s*if\s*\(\s*count\s*==\s*0\s*\)\s*\{\s*$"
ANCHOR_FRONTEND_UNIQ = r"^\s*if\s*\(\s*count\s*!=\s*1\s*\)\s*\{\s*$"

# stopped: replace real opener with echo '...condition...' and keep a false branch exit
spoof_opener_echo(
    "v2-spoof-stopped-echo-opener",
    ANCHOR_STOPPED,
    [
        "echo 'if [ -z \"$fe_running\" ] && [ -z \"$be_running\" ]; then'\n",
        "if false; then\n",
        "  exit 2\n",
        "fi\n",
    ],
    FI,
)
# stopped: duplicate real opener; second branch is no-op (exit removed in first would still pass old checker)
spoof_opener_duplicate(
    "v2-spoof-stopped-duplicate-opener",
    ANCHOR_STOPPED,
    FI,
    [
        'if [ -z "$fe_running" ] && [ -z "$be_running" ]; then\n',
        "  exit 2\n",
        "fi\n",
    ],
)
# partial: echo-wrapped opener + false branch terminal
spoof_opener_echo(
    "v2-spoof-partial-echo-opener",
    ANCHOR_PARTIAL,
    [
        "echo 'if { [ -n \"$fe_all\" ] && [ -z \"$be_all\" ]; } || { [ -z \"$fe_all\" ] && [ -n \"$be_all\" ]; }; then'\n",
        "if false; then\n",
        "  exit 2\n",
        "fi\n",
    ],
    FI,
)
# partial: duplicate real opener
spoof_opener_duplicate(
    "v2-spoof-partial-duplicate-opener",
    ANCHOR_PARTIAL,
    FI,
    [
        'if { [ -n "$fe_all" ] && [ -z "$be_all" ]; } || { [ -z "$fe_all" ] && [ -n "$be_all" ]; }; then\n',
        "  exit 2\n",
        "fi\n",
    ],
)
# non-running Groovy: println-wrapped opener + unrelated error terminal
spoof_opener_echo(
    "v2-spoof-ambiguous-println-opener",
    ANCHOR_AMBIGUOUS,
    [
        '              println("if (state != \'running\') {")\n',
        "            if (false) {\n",
        '              error("FAIL_CLOSED unexpected_probe_state: spoof")\n',
        "            }\n",
    ],
    BRACE,
)
# non-running Groovy: duplicate real opener
spoof_opener_duplicate(
    "v2-spoof-ambiguous-duplicate-opener",
    ANCHOR_AMBIGUOUS,
    BRACE,
    [
        "            if (state != 'running') {\n",
        '              error("FAIL_CLOSED unexpected_probe_state: dup")\n',
        "            }\n",
    ],
)
# same-tag/different-SHA: echo-quoted opener + false branch error
spoof_opener_echo(
    "v2-spoof-same-tag-echo-opener",
    ANCHOR_SAME_TAG,
    [
        '              echo "if (prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA) {"\n',
        "            if (false) {\n",
        '              error("FAIL_CLOSED same_tag_different_sha: spoof")\n',
        "            }\n",
    ],
    BRACE,
)
# same-tag/different-SHA: duplicate real opener
spoof_opener_duplicate(
    "v2-spoof-same-tag-duplicate-opener",
    ANCHOR_SAME_TAG,
    BRACE,
    [
        "            if (prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA) {\n",
        '              error("FAIL_CLOSED same_tag_different_sha: dup")\n',
        "            }\n",
    ],
)
# SemVer downgrade: echo-quoted opener + false branch with real terminals
spoof_opener_echo(
    "v2-spoof-downgrade-echo-opener",
    ANCHOR_DOWNGRADE,
    [
        '              echo "if (cmp < 0) {"\n',
        "            if (false) {\n",
        "              env.DEPLOY_NOOP = 'true'\n",
        "              return\n",
        "            }\n",
    ],
    BRACE,
)
# SemVer downgrade: duplicate real opener
spoof_opener_duplicate(
    "v2-spoof-downgrade-duplicate-opener",
    ANCHOR_DOWNGRADE,
    BRACE,
    [
        "            if (cmp < 0) {\n",
        "              env.DEPLOY_NOOP = 'true'\n",
        "              return\n",
        "            }\n",
    ],
)
# FRONTEND_URL missing path: echo-quoted count==0 opener + false exit 2
spoof_opener_echo(
    "v2-spoof-frontend-url-echo-opener-missing",
    ANCHOR_FRONTEND_MISSING,
    [
        '      echo "if (count == 0) {"\n',
        "      if (false) {\n",
        "        exit 2\n",
        "      }\n",
    ],
    BRACE,
)
# FRONTEND_URL uniqueness path: echo-quoted count!=1 opener + false exit 3
spoof_opener_echo(
    "v2-spoof-frontend-url-echo-opener-uniq",
    ANCHOR_FRONTEND_UNIQ,
    [
        '      echo "if (count != 1) {"\n',
        "      if (false) {\n",
        "        exit 3\n",
        "      }\n",
    ],
    BRACE,
)
# FRONTEND_URL: duplicate real openers for both count branches
_frontend_dup = duplicate_block(
    lines,
    ANCHOR_FRONTEND_MISSING,
    BRACE,
    ["      if (count == 0) {\n", "        exit 2\n", "      }\n"],
)
_frontend_dup = duplicate_block(
    _frontend_dup,
    ANCHOR_FRONTEND_UNIQ,
    BRACE,
    ["      if (count != 1) {\n", "        exit 3\n", "      }\n"],
)
write_fixture("v2-spoof-frontend-url-duplicate-openers", "".join(_frontend_dup))
PYOPENER

python3 - "$v2_source" "$fixture_dir" <<'PYHARDEN'
from pathlib import Path
import sys


source = Path(sys.argv[1]).read_text()
fixture_dir = Path(sys.argv[2])


def write_fixture(name: str, content: str) -> None:
    if content == source:
        raise SystemExit(f"fixture not distinct: {name}")
    (fixture_dir / name).write_text(content)


def replace_once(name: str, old: str, new: str) -> None:
    if source.count(old) < 1:
        raise SystemExit(f"fixture pattern missing: {name}: {old!r}")
    write_fixture(name, source.replace(old, new, 1))


def status_region(rollout: bool) -> tuple[int, int, str]:
    if rollout:
        anchor = "                require_status 200 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused\n"
        closing = "              '''"
        indent = "                "
    else:
        anchor = "                    require_status 200 GET http://127.0.0.1:8081/\n"
        closing = "                  '''"
        indent = "                    "
    start = source.index(anchor)
    end = source.index(closing, start)
    return start, end, indent


def wrap_status_region(name: str, opener: str, closer: str, rollout: bool = True) -> None:
    start, end, indent = status_region(rollout)
    wrapped = f"{indent}{opener}\n{source[start:end]}{indent}{closer}\n"
    write_fixture(name, source[:start] + wrapped + source[end:])


wrap_status_region("v2-hardening-smoke-if-false", "if false; then", "fi")
wrap_status_region("v2-hardening-smoke-if-bracket-false", "if [ 1 -eq 0 ]; then", "fi")
wrap_status_region("v2-hardening-smoke-if-test-false", "if test 1 -eq 0; then", "fi")
wrap_status_region("v2-hardening-smoke-function-body", "dead_smoke() {", "}")
wrap_status_region("v2-hardening-smoke-heredoc", ": <<'SMOKE_DISABLED'", "SMOKE_DISABLED")
wrap_status_region("v2-hardening-rollback-smoke-if-false", "if false; then", "fi", rollout=False)

case_start, case_end, case_indent = status_region(True)
case_wrapped = (
    f"{case_indent}case never in\n"
    f"{case_indent}  matching)\n"
    f"{source[case_start:case_end]}"
    f"{case_indent}    ;;\n"
    f"{case_indent}esac\n"
)
write_fixture(
    "v2-hardening-smoke-case-no-match",
    source[:case_start] + case_wrapped + source[case_end:],
)

prune_command = 'docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"'
prune_line = prune_command + "\n"

replace_once("v2-hardening-prebuild-prune-deleted", prune_command, "echo 'BuildKit cache prune removed'")
replace_once(
    "v2-hardening-prebuild-prune-if-false",
    prune_line,
    f"if false; then\n  {prune_command}\nfi\n",
)
replace_once(
    "v2-hardening-prebuild-prune-function-body",
    prune_line,
    f"dead_prune() {{\n  {prune_command}\n}}\n",
)
replace_once(
    "v2-hardening-prebuild-prune-injected",
    prune_line,
    prune_line + prune_line,
)
replace_once(
    "v2-hardening-prebuild-prune-all-deleted",
    "--all --force --max-used-space",
    "--force --max-used-space",
)
retention_prune_start = source.rfind(prune_command)
if retention_prune_start < 0:
    raise SystemExit("success retention prune source line missing")
write_fixture(
    "v2-hardening-success-retention-prune-reverted",
    source[:retention_prune_start]
    + source[retention_prune_start:].replace(
        prune_command,
        'docker buildx prune --force --max-used-space "$BUILD_CACHE_MAX_SPACE"',
        1,
    ),
)
prebuild_stage_start = source.index("    stage('Buildx 캐시 상한 사전 정리') {")
prebuild_stage_end = source.index("    stage('FRONTEND_URL HTTPS 사전 검증') {", prebuild_stage_start)
prebuild_stage = source[prebuild_stage_start:prebuild_stage_end]
without_prebuild_stage = source[:prebuild_stage_start] + source[prebuild_stage_end:]
write_fixture("v2-hardening-prebuild-prune-stage-deleted", without_prebuild_stage)
write_fixture(
    "v2-hardening-prebuild-prune-noop-condition-deleted",
    source.replace(
        "    stage('Buildx 캐시 상한 사전 정리') {\n      when {\n        expression { env.DEPLOY_NOOP != 'true' }\n      }\n",
        "    stage('Buildx 캐시 상한 사전 정리') {\n",
        1,
    ),
)
write_fixture(
    "v2-hardening-prebuild-prune-noop-condition-inverted",
    source.replace(
        "    stage('Buildx 캐시 상한 사전 정리') {\n      when {\n        expression { env.DEPLOY_NOOP != 'true' }\n      }\n",
        "    stage('Buildx 캐시 상한 사전 정리') {\n      when {\n        expression { env.DEPLOY_NOOP == 'true' }\n      }\n",
        1,
    ),
)
build_stage_start = without_prebuild_stage.index("    stage('버전 이미지 빌드') {")
build_stage_end = without_prebuild_stage.index("    stage('Prisma 마이그레이션') {", build_stage_start)
write_fixture(
    "v2-hardening-prebuild-prune-after-image-build",
    without_prebuild_stage[:build_stage_end]
    + prebuild_stage
    + without_prebuild_stage[build_stage_end:],
)

replace_once(
    "v2-hardening-cache-cap-changed",
    "BUILD_CACHE_MAX_SPACE = '5GB'",
    "BUILD_CACHE_MAX_SPACE = '6GB'",
)
cache_line = "    BUILD_CACHE_MAX_SPACE = '5GB'\n"
without_cache = source.replace(cache_line, "", 1)
if without_cache == source:
    raise SystemExit("cache environment line missing")
write_fixture(
    "v2-hardening-cache-cap-outside-environment",
    without_cache.replace("  stages {\n", cache_line + "  stages {\n", 1),
)

replace_once(
    "v2-hardening-exact-200-restored-curl-fail",
    "require_status 200 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused",
    "curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:8081/",
)
replace_once(
    "v2-hardening-status-helper-weakened",
    'if [ "$actual" != "$expected" ]; then',
    'if [ "$actual" = "$expected" ]; then',
)
replace_once(
    "v2-hardening-loopback-mixed-case-deleted",
    "require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused",
    "require_status 401 GET http://127.0.0.1:8081/api/v1/Submission-Files-removed --retry 5 --retry-connrefused",
)
replace_once(
    "v2-hardening-tls-mixed-case-deleted",
    "require_status 404 GET https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused",
    "require_status 401 GET https://54.116.116.174/api/v1/Submission-Files-removed --retry 5 --retry-connrefused",
)
replace_once(
    "v2-hardening-loopback-post-deleted",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files-removed --retry 5 --retry-connrefused",
)
replace_once(
    "v2-hardening-tls-post-deleted",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files-removed --retry 5 --retry-connrefused",
)
replace_once(
    "v2-hardening-descendant-deleted",
    "require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files/1 --retry 5 --retry-connrefused",
    "require_status 401 GET http://127.0.0.1:8081/api/v1/submission-files-removed/1 --retry 5 --retry-connrefused",
)
replace_once(
    "v2-hardening-rollback-loopback-mixed-case-deleted",
    "require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files\n",
    "require_status 401 GET http://127.0.0.1:8081/api/v1/Submission-Files-removed\n",
)
replace_once(
    "v2-hardening-rollback-loopback-post-deleted",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files\n",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files-removed\n",
)
replace_once(
    "v2-hardening-rollback-tls-mixed-case-deleted",
    "require_status 404 GET https://54.116.116.174/api/v1/Submission-Files \\\n",
    "require_status 401 GET https://54.116.116.174/api/v1/Submission-Files-removed \\\n",
)
replace_once(
    "v2-hardening-rollback-tls-post-deleted",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files \\\n",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files-removed \\\n",
)

preflight_start = source.index("    stage('Buildx 캐시 상한 사전 검증') {")
frontend_preflight_start = source.index("    stage('FRONTEND_URL HTTPS 사전 검증') {", preflight_start)
preflight_block = source[preflight_start:frontend_preflight_start]
without_preflight = source[:preflight_start] + source[frontend_preflight_start:]
write_fixture("v2-hardening-buildx-preflight-deleted", without_preflight)
build_stage_start = without_preflight.index("    stage('버전 이미지 빌드') {")
write_fixture(
    "v2-hardening-buildx-preflight-after-mutation",
    without_preflight[:build_stage_start] + preflight_block + without_preflight[build_stage_start:],
)
noop_probe_stage_start = source.index("    stage('실행 중 이미지 기준 no-op 및 이전 태그 캡처') {")
buildx_preflight_stage_start = source.index("    stage('Buildx 캐시 상한 사전 검증') {")
preflight_before_probe = (
    source[:noop_probe_stage_start]
    + source[buildx_preflight_stage_start:frontend_preflight_start]
    + source[noop_probe_stage_start:buildx_preflight_stage_start]
    + source[frontend_preflight_start:]
)
write_fixture(
    "v2-hardening-buildx-preflight-before-noop-probe",
    preflight_before_probe,
)
prebuild_stage_start = source.index("    stage('Buildx 캐시 상한 사전 정리') {")
prebuild_stage_end = source.index("    stage('FRONTEND_URL HTTPS 사전 검증') {", prebuild_stage_start)
prebuild_before_probe = (
    source[:noop_probe_stage_start]
    + source[prebuild_stage_start:prebuild_stage_end]
    + source[noop_probe_stage_start:prebuild_stage_start]
    + source[prebuild_stage_end:]
)
write_fixture(
    "v2-hardening-prebuild-prune-before-noop-probe",
    prebuild_before_probe,
)
replace_once(
    "v2-hardening-buildx-preflight-capability-deleted",
    "grep -F -- '--max-used-space'",
    "grep -F -- '--max-used-space-removed'",
)
replace_once(
    "v2-hardening-buildx-preflight-destructive",
    "docker buildx prune --help 2>&1",
    "docker buildx prune --force 2>&1",
)

rollout_nginx_test = '                docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -t\n'
rollout_nginx_reload = '                docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -s reload\n'
rollout_smoke = "                require_status 200 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused\n"
rollback_nginx_test = '                    docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -t\n'
rollback_nginx_reload = '                    docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T nginx nginx -s reload\n'
rollback_smoke = "                    require_status 200 GET http://127.0.0.1:8081/\n"

replace_once("v2-nginx-rollout-test-deleted", rollout_nginx_test, "")
replace_once("v2-nginx-rollout-reload-deleted", rollout_nginx_reload, "")
replace_once(
    "v2-nginx-rollout-reload-if-false",
    rollout_nginx_reload,
    f"                if false; then\n{rollout_nginx_reload}                fi\n",
)
rollout_without_reload = source.replace(rollout_nginx_reload, "", 1)
write_fixture(
    "v2-nginx-rollout-reload-after-smoke",
    rollout_without_reload.replace(rollout_smoke, rollout_smoke + rollout_nginx_reload, 1),
)

replace_once("v2-nginx-rollback-test-deleted", rollback_nginx_test, "")
replace_once("v2-nginx-rollback-reload-deleted", rollback_nginx_reload, "")
rollback_without_reload = source.replace(rollback_nginx_reload, "", 1)
write_fixture(
    "v2-nginx-rollback-reload-after-smoke",
    rollback_without_reload.replace(rollback_smoke, rollback_smoke + rollback_nginx_reload, 1),
)

noop_stage_marker = "    stage('no-op 실행 중 nginx 드리프트 검증') {"
retention_stage_marker = "    stage('성공 후 이미지·백업 보존 정리') {"
noop_stage_start = source.index(noop_stage_marker)
retention_stage_start = source.index(retention_stage_marker, noop_stage_start)
noop_stage = source[noop_stage_start:retention_stage_start]


def mutate_noop(name: str, old: str, new: str) -> None:
    if old not in noop_stage:
        raise SystemExit(f"no-op fixture pattern missing: {name}: {old!r}")
    mutated_stage = noop_stage.replace(old, new, 1)
    write_fixture(name, source[:noop_stage_start] + mutated_stage + source[retention_stage_start:])


write_fixture(
    "v2-nginx-noop-stage-deleted",
    source[:noop_stage_start] + source[retention_stage_start:],
)
replace_once(
    "v2-nginx-noop-when-inverted",
    "expression { env.DEPLOY_NOOP == 'true' }",
    "expression { env.DEPLOY_NOOP != 'true' }",
)

noop_anchor = "          require_status 200 GET http://127.0.0.1:8081/ --retry 5 --retry-connrefused\n"
noop_mutations = {
    "v2-nginx-noop-up-injected": '          docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait\n',
    "v2-nginx-noop-reload-injected": "          nginx -s reload\n",
    "v2-nginx-noop-force-recreate-injected": '          docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --force-recreate nginx\n',
    "v2-nginx-noop-pull-injected": '          docker compose --env-file "$OSS_HUB_ENV_FILE" pull nginx\n',
    "v2-nginx-noop-image-rm-injected": "          docker image rm forbidden:latest\n",
    "v2-nginx-noop-prune-injected": "          docker buildx prune --force\n",
}
for name, mutation in noop_mutations.items():
    mutate_noop(name, noop_anchor, mutation + noop_anchor)

mutate_noop(
    "v2-nginx-noop-loopback-mixed-case-deleted",
    "require_status 404 GET http://127.0.0.1:8081/api/v1/Submission-Files --retry 5 --retry-connrefused",
    "require_status 401 GET http://127.0.0.1:8081/api/v1/Submission-Files-removed --retry 5 --retry-connrefused",
)
mutate_noop(
    "v2-nginx-noop-tls-mixed-case-deleted",
    "require_status 404 GET https://54.116.116.174/api/v1/Submission-Files --retry 5 --retry-connrefused",
    "require_status 401 GET https://54.116.116.174/api/v1/Submission-Files-removed --retry 5 --retry-connrefused",
)
mutate_noop(
    "v2-nginx-noop-loopback-post-deleted",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files --retry 5 --retry-connrefused",
    "require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files-removed --retry 5 --retry-connrefused",
)
mutate_noop(
    "v2-nginx-noop-tls-post-deleted",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files --retry 5 --retry-connrefused",
    "require_status 401 POST https://54.116.116.174/api/v1/submission-files-removed --retry 5 --retry-connrefused",
)

noop_smoke_start = noop_stage.index(noop_anchor)
noop_smoke_end = noop_stage.index("        '''", noop_smoke_start)
noop_smoke = noop_stage[noop_smoke_start:noop_smoke_end]
noop_wrapped = f"          if false; then\n{noop_smoke}          fi\n"
write_fixture(
    "v2-nginx-noop-smoke-if-false",
    source[:noop_stage_start]
    + noop_stage[:noop_smoke_start]
    + noop_wrapped
    + noop_stage[noop_smoke_end:]
    + source[retention_stage_start:],
)
PYHARDEN

expect_pass 'v2: 현재 candidate Release 배포 계약' v2 "$fixture_dir/v2-valid"
expect_pass 'v2: 기본 path 호출' v2 "$v2_source"
expect_fail 'v2: parameters 블록 부활' v2 "$fixture_dir/v2-restored-parameters"
expect_fail 'v2: DEPLOY_STATE_FILE 부활' v2 "$fixture_dir/v2-restored-deploy-state-file"
expect_fail 'v2: RELEASE_ACCEPT role=PM 부활' v2 "$fixture_dir/v2-restored-release-accept"
expect_fail 'v2: #199 Release 승인 댓글 scraping 부활' v2 "$fixture_dir/v2-restored-release-comment-scraping"
expect_fail 'v2: PM 승인 actor 파싱 부활' v2 "$fixture_dir/v2-restored-pm-actor-parsing"
expect_fail 'v2: RELEASE_ACCEPT role=TECH_LEAD 부활' v2 "$fixture_dir/v2-restored-tech-lead-accept"
expect_fail 'v2: RELEASE_OVERRIDE role=PM 부활' v2 "$fixture_dir/v2-restored-pm-override"
expect_fail 'v2: releases/latest 조회 제거' v2 "$fixture_dir/v2-missing-latest-release"
expect_fail 'v2: RUN_MODE 부활' v2 "$fixture_dir/v2-restored-run-mode"
expect_fail 'v2: 동시 배포 방지 누락' v2 "$fixture_dir/v2-missing-concurrency"
expect_fail 'v2: 전용 production executor 누락' v2 "$fixture_dir/v2-missing-production-label"
expect_fail 'v2: draft 거절 누락' v2 "$fixture_dir/v2-missing-draft-check"
expect_fail 'v2: prerelease 거절 누락' v2 "$fixture_dir/v2-missing-prerelease-check"
expect_fail 'v2: SemVer tag 검증 누락' v2 "$fixture_dir/v2-missing-tag-format"
expect_fail 'v2: sandbox 비승인 BigInteger 생성자 부활' v2 "$fixture_dir/v2-restored-big-integer"
expect_fail 'v2: Release tag SHA 해석 누락' v2 "$fixture_dir/v2-missing-tag-resolution"
expect_fail 'v2: main ancestry 검증 누락' v2 "$fixture_dir/v2-missing-main-ancestry"
expect_fail 'v2: 완료된 회원 권한 backfill stage 부활' v2 "$fixture_dir/v2-restored-member-authority-backfill"
expect_fail 'v2: 정확한 RELEASE_SHA checkout 누락' v2 "$fixture_dir/v2-moving-checkout"
expect_fail 'v2: production env preflight 누락' v2 "$fixture_dir/v2-missing-production-env-preflight"
expect_fail 'v2: production env preflight 조건부 비활성화' v2 "$fixture_dir/v2-disabled-production-env-preflight"
expect_fail 'v2: production env preflight 전 mutation' v2 "$fixture_dir/v2-mutation-before-production-env-preflight"
expect_fail 'v2: production backup retention 120 부활' v2 "$fixture_dir/v2-backup-retention-120"
expect_fail 'v2: IMAGE_TAG=RELEASE_TAG 계약 파손' v2 "$fixture_dir/v2-missing-image-tag-release"
expect_fail 'v2: RELEASE_SHA 바인딩 파손' v2 "$fixture_dir/v2-missing-release-sha-binding"
expect_fail 'v2: migration 전 backup 누락' v2 "$fixture_dir/v2-missing-backup"
expect_fail 'v2: Prisma migration 누락' v2 "$fixture_dir/v2-missing-migration"
expect_fail 'v2: 이미지 빌드 후 권한 매트릭스 검증 누락' v2 "$fixture_dir/v2-restored-auth-release-image"
expect_fail 'v2: Compose 교체의 --no-build 누락' v2 "$fixture_dir/v2-missing-no-build"
expect_fail 'v2: primary 제출 파일 401 smoke 누락' v2 "$fixture_dir/v2-missing-primary-upload-401-smoke"
expect_fail 'v2: rollback 제출 파일 401 smoke 누락' v2 "$fixture_dir/v2-missing-rollback-upload-401-smoke"
expect_fail 'v2: 제출 파일 smoke의 exact 401 단언 약화' v2 "$fixture_dir/v2-weakened-upload-401-status"
expect_fail 'v2: 제출 파일 401 smoke에 curl --fail 사용' v2 "$fixture_dir/v2-upload-401-curl-fail"
expect_fail 'v2: greenfield rollback skip guard 누락' v2 "$fixture_dir/v2-missing-rollback-guard"
expect_fail 'v2: greenfield host-clean guard 누락' v2 "$fixture_dir/v2-missing-greenfield-host-guard"
expect_fail 'v2: greenfield ACK 소스 고정' v2 "$fixture_dir/v2-hardcoded-greenfield-ack"
expect_fail 'v2: 운영 환경 credential 주입 누락' v2 "$fixture_dir/v2-missing-production-credential"
expect_fail 'v2: managed R2 credential binding 누락' v2 "$fixture_dir/v2-missing-r2-credential"
expect_fail 'v2: managed R2 direct backend-contract credential binding' v2 "$fixture_dir/v2-direct-r2-contract-binding"
expect_fail 'v2: inherited storage credential clear 누락' v2 "$fixture_dir/v2-missing-inherited-storage-credential-clear"
expect_fail 'v2: managed object backup mode branch 누락' v2 "$fixture_dir/v2-missing-managed-mode-guard"
expect_fail 'v2: active managed mode agreement fail-closed 누락' v2 "$fixture_dir/v2-missing-managed-mode-agreement"
expect_fail 'v2: configured endpoint object backup parity 누락' v2 "$fixture_dir/v2-missing-object-backup-parity"
expect_fail 'v2: active storage tuple hash 누락' v2 "$fixture_dir/v2-missing-storage-tuple-hash"
expect_fail 'v2: running no-op storage tuple guard 누락' v2 "$fixture_dir/v2-missing-running-storage-tuple-guard"
expect_fail 'v2: isolated restore-prefix receipt 누락' v2 "$fixture_dir/v2-missing-restore-prefix"
expect_fail 'v2: MinIO rollback bucket contract 누락' v2 "$fixture_dir/v2-missing-rollback-minio-bucket"
expect_fail 'v2: object backup manifest 검증 누락' v2 "$fixture_dir/v2-missing-object-manifest-verify"
expect_fail 'v2: empty object backup manifest 검증 누락' v2 "$fixture_dir/v2-missing-empty-object-manifest-verify"
expect_fail 'v2: retention protection validator 호출 누락' v2 "$fixture_dir/v2-missing-retention-protection-validator"
expect_fail 'v2: cutover hold retention guard 누락' v2 "$fixture_dir/v2-missing-cutover-hold-guard"
expect_fail 'v2: Groovy-unsafe retention tag regex 사용' v2 "$fixture_dir/v2-groovy-unsafe-retention-tag-regex"
expect_fail 'v2: stale hard-coded MinIO bucket 추가' v2 "$fixture_dir/v2-hardcoded-stale-minio-bucket"
expect_fail 'v2: destructive object operation 추가' v2 "$fixture_dir/v2-destructive-object-operation"
expect_fail 'v2: Bash-only body without interpreter 추가' v2 "$fixture_dir/v2-bash-only-without-interpreter"
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
expect_fail 'v2 blocker: rollback 외부 스크립트 호출 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-script"
expect_fail 'v2 blocker: rollback 스크립트 nonzero swallow' v2 "$fixture_dir/v2-blocker-rollback-nonzero-swallowed"
expect_fail 'v2 blocker: rollback PREV_TAG withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-tag"
expect_fail 'v2 blocker: rollback PREV_SHA withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-sha"
expect_fail 'v2 blocker: rollback frontend Image ID withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-fe-id"
expect_fail 'v2 blocker: rollback backend Image ID withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-be-id"
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
expect_fail 'v2 spoof: stopped 분기 echo exit 토큰' v2 "$fixture_dir/v2-spoof-stopped-echo-exit"
expect_fail 'v2 spoof: partial 분기 echo exit 토큰' v2 "$fixture_dir/v2-spoof-partial-echo-exit"
expect_fail 'v2 spoof: non-running echo error(...) 토큰' v2 "$fixture_dir/v2-spoof-ambiguous-echo-error"
expect_fail 'v2 spoof: non-running println error(...) 토큰' v2 "$fixture_dir/v2-spoof-ambiguous-println-error"
expect_fail 'v2 spoof: same-tag/different-SHA echo error(...) 토큰' v2 "$fixture_dir/v2-spoof-same-tag-echo-error"
expect_fail 'v2 spoof: SemVer downgrade string-wrapped return' v2 "$fixture_dir/v2-spoof-downgrade-string-return"
expect_fail 'v2 spoof: SemVer downgrade string-wrapped DEPLOY_NOOP' v2 "$fixture_dir/v2-spoof-downgrade-string-noop"
expect_fail 'v2 spoof: FRONTEND_URL missing path echo exit 2' v2 "$fixture_dir/v2-spoof-frontend-url-echo-exit2"
expect_fail 'v2 spoof: FRONTEND_URL uniqueness path echo exit 3' v2 "$fixture_dir/v2-spoof-frontend-url-echo-exit3"


expect_fail 'v2 spoof: stopped echo/quoted opener' v2 "$fixture_dir/v2-spoof-stopped-echo-opener"
expect_fail 'v2 spoof: stopped duplicate real opener' v2 "$fixture_dir/v2-spoof-stopped-duplicate-opener"
expect_fail 'v2 spoof: partial echo/quoted opener' v2 "$fixture_dir/v2-spoof-partial-echo-opener"
expect_fail 'v2 spoof: partial duplicate real opener' v2 "$fixture_dir/v2-spoof-partial-duplicate-opener"
expect_fail 'v2 spoof: non-running println/quoted opener' v2 "$fixture_dir/v2-spoof-ambiguous-println-opener"
expect_fail 'v2 spoof: non-running duplicate real opener' v2 "$fixture_dir/v2-spoof-ambiguous-duplicate-opener"
expect_fail 'v2 spoof: same-tag echo/quoted opener' v2 "$fixture_dir/v2-spoof-same-tag-echo-opener"
expect_fail 'v2 spoof: same-tag duplicate real opener' v2 "$fixture_dir/v2-spoof-same-tag-duplicate-opener"
expect_fail 'v2 spoof: SemVer downgrade echo/quoted opener' v2 "$fixture_dir/v2-spoof-downgrade-echo-opener"
expect_fail 'v2 spoof: SemVer downgrade duplicate real opener' v2 "$fixture_dir/v2-spoof-downgrade-duplicate-opener"
expect_fail 'v2 spoof: FRONTEND_URL missing echo/quoted opener' v2 "$fixture_dir/v2-spoof-frontend-url-echo-opener-missing"
expect_fail 'v2 spoof: FRONTEND_URL uniqueness echo/quoted opener' v2 "$fixture_dir/v2-spoof-frontend-url-echo-opener-uniq"
expect_fail 'v2 spoof: FRONTEND_URL duplicate real openers' v2 "$fixture_dir/v2-spoof-frontend-url-duplicate-openers"

expect_fail_with_code 'v2 hardening: rollout smoke를 if false로 비활성화' v2 "$fixture_dir/v2-hardening-smoke-if-false"
expect_fail_with_code 'v2 hardening: rollout smoke를 불일치 case에 배치' v2 "$fixture_dir/v2-hardening-smoke-case-no-match"
expect_fail_with_code 'v2 hardening: rollout smoke를 bracket 거짓 guard로 비활성화' v2 "$fixture_dir/v2-hardening-smoke-if-bracket-false"
expect_fail_with_code 'v2 hardening: rollout smoke를 test 거짓 guard로 비활성화' v2 "$fixture_dir/v2-hardening-smoke-if-test-false"
expect_fail_with_code 'v2 hardening: rollout smoke를 미호출 함수 본문에 배치' v2 "$fixture_dir/v2-hardening-smoke-function-body"
expect_fail_with_code 'v2 hardening: rollout smoke를 heredoc으로 주석화' v2 "$fixture_dir/v2-hardening-smoke-heredoc"
expect_fail_with_code 'v2 hardening: rollback smoke를 if false로 비활성화' v2 "$fixture_dir/v2-hardening-rollback-smoke-if-false"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune 삭제' v2 "$fixture_dir/v2-hardening-prebuild-prune-deleted"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune stage 삭제' v2 "$fixture_dir/v2-hardening-prebuild-prune-stage-deleted"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune no-op 조건 삭제' v2 "$fixture_dir/v2-hardening-prebuild-prune-noop-condition-deleted"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune no-op 조건 반전' v2 "$fixture_dir/v2-hardening-prebuild-prune-noop-condition-inverted"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune를 if false로 비활성화' v2 "$fixture_dir/v2-hardening-prebuild-prune-if-false"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune를 미호출 함수 본문에 배치' v2 "$fixture_dir/v2-hardening-prebuild-prune-function-body"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune 주입' v2 "$fixture_dir/v2-hardening-prebuild-prune-injected"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune의 --all 삭제' v2 "$fixture_dir/v2-hardening-prebuild-prune-all-deleted"
expect_fail_with_code 'v2 hardening: 성공 retention BuildKit prune 되돌림' v2 "$fixture_dir/v2-hardening-success-retention-prune-reverted"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune를 이미지 빌드 뒤로 이동' v2 "$fixture_dir/v2-hardening-prebuild-prune-after-image-build"
expect_fail_with_code 'v2 hardening: BuildKit cache 상한을 5GB에서 변경' v2 "$fixture_dir/v2-hardening-cache-cap-changed"
expect_fail_with_code 'v2 hardening: BuildKit cache 상한을 environment 밖으로 이동' v2 "$fixture_dir/v2-hardening-cache-cap-outside-environment"
expect_fail_with_code 'v2 hardening: exact 200 대신 curl --fail 복원' v2 "$fixture_dir/v2-hardening-exact-200-restored-curl-fail"
expect_fail_with_code 'v2 hardening: require_status equality 검사를 반전' v2 "$fixture_dir/v2-hardening-status-helper-weakened"
expect_fail_with_code 'v2 hardening: loopback mixed-case 401 삭제' v2 "$fixture_dir/v2-hardening-loopback-mixed-case-deleted"
expect_fail_with_code 'v2 hardening: TLS mixed-case 401 삭제' v2 "$fixture_dir/v2-hardening-tls-mixed-case-deleted"
expect_fail_with_code 'v2 hardening: loopback POST 401 삭제' v2 "$fixture_dir/v2-hardening-loopback-post-deleted"
expect_fail_with_code 'v2 hardening: TLS POST 401 삭제' v2 "$fixture_dir/v2-hardening-tls-post-deleted"
expect_fail_with_code 'v2 hardening: descendant 401 삭제' v2 "$fixture_dir/v2-hardening-descendant-deleted"
expect_fail_with_code 'v2 hardening: rollback loopback mixed-case 401 삭제' v2 "$fixture_dir/v2-hardening-rollback-loopback-mixed-case-deleted"
expect_fail_with_code 'v2 hardening: rollback loopback POST 401 삭제' v2 "$fixture_dir/v2-hardening-rollback-loopback-post-deleted"
expect_fail_with_code 'v2 hardening: rollback TLS mixed-case 401 삭제' v2 "$fixture_dir/v2-hardening-rollback-tls-mixed-case-deleted"
expect_fail_with_code 'v2 hardening: rollback TLS POST 401 삭제' v2 "$fixture_dir/v2-hardening-rollback-tls-post-deleted"
expect_fail_with_code 'v2 hardening: Buildx capability preflight 삭제' v2 "$fixture_dir/v2-hardening-buildx-preflight-deleted"
expect_fail_with_code 'v2 hardening: Buildx capability preflight를 production mutation 뒤로 이동' v2 "$fixture_dir/v2-hardening-buildx-preflight-after-mutation"
expect_fail_with_code 'v2 hardening: Buildx capability preflight를 no-op probe 앞으로 이동' v2 "$fixture_dir/v2-hardening-buildx-preflight-before-noop-probe"
expect_fail_with_code 'v2 hardening: BuildKit 사전 prune를 no-op probe 앞으로 이동' v2 "$fixture_dir/v2-hardening-prebuild-prune-before-noop-probe"
expect_fail_with_code 'v2 hardening: Buildx capability token 삭제' v2 "$fixture_dir/v2-hardening-buildx-preflight-capability-deleted"
expect_fail_with_code 'v2 hardening: Buildx preflight에서 destructive prune 실행' v2 "$fixture_dir/v2-hardening-buildx-preflight-destructive"
expect_fail_with_code 'v2 nginx: rollout nginx -t 삭제' v2 "$fixture_dir/v2-nginx-rollout-test-deleted"
expect_fail_with_code 'v2 nginx: rollout reload 삭제' v2 "$fixture_dir/v2-nginx-rollout-reload-deleted"
expect_fail_with_code 'v2 nginx: rollout reload를 if false로 비활성화' v2 "$fixture_dir/v2-nginx-rollout-reload-if-false"
expect_fail_with_code 'v2 nginx: rollout reload를 smoke 뒤로 이동' v2 "$fixture_dir/v2-nginx-rollout-reload-after-smoke"
expect_fail_with_code 'v2 nginx: rollback nginx -t 삭제' v2 "$fixture_dir/v2-nginx-rollback-test-deleted"
expect_fail_with_code 'v2 nginx: rollback reload 삭제' v2 "$fixture_dir/v2-nginx-rollback-reload-deleted"
expect_fail_with_code 'v2 nginx: rollback reload를 smoke 뒤로 이동' v2 "$fixture_dir/v2-nginx-rollback-reload-after-smoke"
expect_fail_with_code 'v2 nginx: no-op drift stage 삭제' v2 "$fixture_dir/v2-nginx-noop-stage-deleted"
expect_fail_with_code 'v2 nginx: no-op when 조건 반전' v2 "$fixture_dir/v2-nginx-noop-when-inverted"
expect_fail_with_code 'v2 nginx: no-op stage에 up 주입' v2 "$fixture_dir/v2-nginx-noop-up-injected"
expect_fail_with_code 'v2 nginx: no-op stage에 reload 주입' v2 "$fixture_dir/v2-nginx-noop-reload-injected"
expect_fail_with_code 'v2 nginx: no-op stage에 force-recreate 주입' v2 "$fixture_dir/v2-nginx-noop-force-recreate-injected"
expect_fail_with_code 'v2 nginx: no-op stage에 pull 주입' v2 "$fixture_dir/v2-nginx-noop-pull-injected"
expect_fail_with_code 'v2 nginx: no-op stage에 image rm 주입' v2 "$fixture_dir/v2-nginx-noop-image-rm-injected"
expect_fail_with_code 'v2 nginx: no-op stage에 prune 주입' v2 "$fixture_dir/v2-nginx-noop-prune-injected"
expect_fail_with_code 'v2 nginx: no-op loopback mixed-case 401 삭제' v2 "$fixture_dir/v2-nginx-noop-loopback-mixed-case-deleted"
expect_fail_with_code 'v2 nginx: no-op TLS mixed-case 401 삭제' v2 "$fixture_dir/v2-nginx-noop-tls-mixed-case-deleted"
expect_fail_with_code 'v2 nginx: no-op loopback POST 401 삭제' v2 "$fixture_dir/v2-nginx-noop-loopback-post-deleted"
expect_fail_with_code 'v2 nginx: no-op TLS POST 401 삭제' v2 "$fixture_dir/v2-nginx-noop-tls-post-deleted"
expect_fail_with_code 'v2 nginx: no-op smoke를 if false로 비활성화' v2 "$fixture_dir/v2-nginx-noop-smoke-if-false"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
