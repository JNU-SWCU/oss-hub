#!/usr/bin/env bash
# Synthetic unit and wrapper contracts. It uses no Docker daemon, network, or provider.
set -euo pipefail
set +x
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/object-storage-migration.XXXXXX")
tmp=$(CDPATH='' cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/evidence"; chmod 700 "$tmp/evidence"
cat > "$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_DOCKER_LOG"
EOF
chmod 700 "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH" FAKE_DOCKER_LOG="$tmp/docker.log" ROOT="$root" TMP="$tmp"
node --test "$root/scripts/jenkins/object-storage-migration.test.mjs"
base_env() { export IMAGE_TAG=synthetic SOURCE_S3_MODE=managed SOURCE_S3_ENDPOINT=https://00000000000000000000000000000000.r2.cloudflarestorage.com SOURCE_S3_REGION=auto SOURCE_S3_ACCESS_KEY=source-secret SOURCE_S3_SECRET_KEY=source-secret SOURCE_S3_BUCKET=source-bucket SOURCE_S3_PATH_STYLE=true TARGET_S3_MODE=minio TARGET_S3_ENDPOINT=http://minio:9000 TARGET_S3_REGION=us-east-1 TARGET_S3_ACCESS_KEY=target-secret TARGET_S3_SECRET_KEY=target-secret TARGET_S3_BUCKET=target-bucket TARGET_S3_PATH_STYLE=true WRITERS_STOPPED_ACK=I_CONFIRM_WRITERS_STOPPED; }
base_env
"$root/scripts/jenkins/object-storage-migration.sh" rollback-drill drill-1 "$tmp/evidence"
grep -F -- '--entrypoint' "$tmp/docker.log" >/dev/null
grep -F -- '/app/object-storage-migration.mjs:ro' "$tmp/docker.log" >/dev/null
grep -F -- '--user' "$tmp/docker.log" >/dev/null
grep -F -- 'SOURCE_S3_REGION' "$tmp/docker.log" >/dev/null
grep -F -- 'TARGET_S3_REGION' "$tmp/docker.log" >/dev/null
grep -F -- 'source-secret' "$tmp/docker.log" >/dev/null && exit 1 || true
grep -F -- 'docker compose' "$tmp/docker.log" >/dev/null && exit 1 || true
(
  cd "$tmp"
  "$root/scripts/jenkins/object-storage-migration.sh" rollback-drill drill-2 evidence
) >/dev/null 2>&1 && exit 1 || true
ln -s "$tmp/evidence" "$tmp/evidence-link"
"$root/scripts/jenkins/object-storage-migration.sh" rollback-drill drill-2 "$tmp/evidence-link" >/dev/null 2>&1 && exit 1 || true
mkdir "$tmp/evidence:unsafe"
chmod 700 "$tmp/evidence:unsafe"
"$root/scripts/jenkins/object-storage-migration.sh" rollback-drill drill-2 "$tmp/evidence:unsafe" >/dev/null 2>&1 && exit 1 || true
printf '%s\n' 'object-storage-migration synthetic tests passed'
