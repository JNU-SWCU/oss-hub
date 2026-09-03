#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-jenkinsfile.sh"
source_file="$repo_root/Jenkinsfile"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jenkinsfile-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1 path=$2
  if bash "$checker" v2 "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected success)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_failure() {
  local name=$1 path=$2 diagnostic=$3 output status
  output=$(bash "$checker" v2 "$path" 2>&1) && status=0 || status=$?
  if [[ $status -ne 0 && $output == *"$diagnostic"* ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected diagnostic: %s; output: %s)\n' "$name" "$diagnostic" "$output" >&2
    failed=$((failed + 1))
  fi
}

mutate_once() {
  local name=$1 old=$2 new=$3
  python3 - "$source_file" "$fixture_dir/$name" "$old" "$new" <<'PY'
from pathlib import Path
import sys

source, target, old, new = map(Path if False else str, sys.argv[1:])
text = Path(source).read_text()
if text.count(old) != 1:
    raise SystemExit(f"fixture anchor must occur exactly once: {old!r} ({text.count(old)})")
Path(target).write_text(text.replace(old, new, 1))
PY
}

mutate_all() {
  local name=$1 old=$2 new=$3
  python3 - "$source_file" "$fixture_dir/$name" "$old" "$new" <<'PY'
from pathlib import Path
import sys

source, target, old, new = sys.argv[1:]
text = Path(source).read_text()
if old not in text:
    raise SystemExit(f"fixture anchor is missing: {old!r}")
Path(target).write_text(text.replace(old, new))
PY
}

cp "$source_file" "$fixture_dir/valid"
expect_pass 'backend-only deployment contract' "$fixture_dir/valid"

# One mutation per current failure mode. Fixtures are synthetic Jenkinsfiles only.
mutate_once missing-convergence-cron "cron('H/10 * * * *')" "cron('H/15 * * * *')"
expect_failure 'Jenkins ten-minute convergence cron is required' \
  "$fixture_dir/missing-convergence-cron" \
  'Jenkins must converge outbound on the exact ten-minute cron'

mutate_once missing-backend-state 'ps --all -q backend' 'docker compose state probe removed'
expect_failure 'backend state is required' "$fixture_dir/missing-backend-state" 'backend stopped-state probe must remain'

mutate_once missing-oci-revision 'org.opencontainers.image.revision=${RELEASE_SHA}' 'org.opencontainers.image.label-removed=${RELEASE_SHA}'
expect_failure 'backend OCI revision is required' "$fixture_dir/missing-oci-revision" 'backend OCI revision label must remain'

mutate_once missing-rollback 'bash scripts/jenkins/validate-rollback-images.sh' 'true # rollback validation removed'
expect_failure 'rollback validation is required' "$fixture_dir/missing-rollback" 'rollback image validation must remain'

mutate_once missing-managed-backup 'object_backup_target="${object_backup_parent}/${RELEASE_TAG}-${BUILD_NUMBER}"' 'object_backup_target=removed'
expect_failure 'managed object backup is required' "$fixture_dir/missing-managed-backup" 'fresh object backup target must remain'

mutate_once missing-release-checkout 'git checkout --detach "$RELEASE_SHA"' 'git checkout --detach main'
expect_failure 'exact Release SHA checkout is required' "$fixture_dir/missing-release-checkout" 'exact SHA checkout must remain'

mutate_all wrong-loopback-root 'require_status 404 GET http://127.0.0.1:8081/' 'require_status 200 GET http://127.0.0.1:8081/'
expect_failure 'loopback frontend root must remain absent' "$fixture_dir/wrong-loopback-root" 'loopback root must assert 404'

mutate_all missing-public-root 'require_status 200 GET https://jnu-oss-hub.com/' 'require_status 404 GET https://jnu-oss-hub.com/'
expect_failure 'canonical public root smoke is required' "$fixture_dir/missing-public-root" 'canonical public root smoke must remain'

mutate_once missing-pruning 'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"' 'true # SQL backup pruning removed'
expect_failure 'backup pruning is required' "$fixture_dir/missing-pruning" 'SQL backup pruning must remain'

mutate_once conditional-env-preflight \
  "stage('운영 환경 사전 검증') {" \
  "stage('운영 환경 사전 검증') { when { expression { false } }"
expect_failure 'production env preflight is unconditional' \
  "$fixture_dir/conditional-env-preflight" \
  'production env preflight must not have a when gate'

mutate_once inverted-noop-drift \
  "expression { env.DEPLOY_NOOP == 'true' }" \
  "expression { env.DEPLOY_NOOP != 'true' }"
expect_failure 'no-op drift gate is exact' \
  "$fixture_dir/inverted-noop-drift" \
  'no-op drift must run only for DEPLOY_NOOP true'

mutate_once mutating-noop-drift \
  "stage('no-op 실행 중 nginx 드리프트 검증') {" \
  "stage('no-op 실행 중 nginx 드리프트 검증') { sh 'docker compose up -d'"
expect_failure 'no-op drift remains read-only' \
  "$fixture_dir/mutating-noop-drift" \
  'no-op drift stage must remain read-only'

printf '1..%s\n' "$((passed + failed))"
printf '# passed=%s failed=%s\n' "$passed" "$failed"
((failed == 0))
