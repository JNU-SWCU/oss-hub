#!/usr/bin/env bash
set -euo pipefail
set +x
: "${CANDIDATE_COMPOSE:?}" "${PREVIOUS_STATE:?}" "${PREVIOUS_KEY_IDENTITY:?}" "${STAGED_KEY_GENERATION:?}" "${SECRETS_DIR:?}" "${OSS_HUB_ENV_FILE:?}" "${RELEASE_TAG:?}" "${RELEASE_SHA:?}" "${RELEASE_SOURCE:?}"
controller_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
previous_compose="$(jq -er .compose "$PREVIOUS_STATE")"
previous_generation="$(jq -er .generation "$PREVIOUS_STATE")"
previous_tag="$(jq -er .tag "$PREVIOUS_STATE")"
previous_sha="$(jq -er .sha "$PREVIOUS_STATE")"
previous_id="$(jq -er .imageId "$PREVIOUS_STATE")"
previous_overlay="$(jq -r '.imageOverlay.path // empty' "$PREVIOUS_STATE")"
previous_overlay_hash="$(jq -r '.imageOverlay.hash // empty' "$PREVIOUS_STATE")"
export SUBMISSION_FILE_S3_ACCESS_KEY_ID="${R2_STORAGE_ACCESS_KEY_ID:?}"
export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="${R2_STORAGE_SECRET_ACCESS_KEY:?}"
export GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/collection.pem"
export GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/operations.pem"
compose=(docker compose -p oss-hub -f "$CANDIDATE_COMPOSE" --env-file "$OSS_HUB_ENV_FILE")
export IMAGE_TAG="$RELEASE_TAG"
source "$controller_dir/deploy/jenkins/mail-cutover.sh"
# The controller can be newer than the exact release being activated.
# Decide from the verified release source rather than the controller version.
jobs_release=false
if [[ -f "$RELEASE_SOURCE/apps/backend/prisma/migrations/20261123000000_mail_job_cutover/migration.sql" ]]; then jobs_release=true; fi

verify_keys() {
  local role host_digest mounted_digest expected_digest
  local identity=${1:-}
  for role in collection operations; do
    host_digest="$(sha256sum "$SECRETS_DIR/current/$role.pem")" || return $?
    host_digest="${host_digest%% *}"
    expected_digest="$host_digest"
    if [[ -n "$identity" ]]; then
      expected_digest="$(jq -er --arg role "$role" '.hashes[$role]' "$identity")" || return $?
      [[ "$host_digest" == "$expected_digest" ]] || { echo 'FAIL_CLOSED previous key bytes changed' >&2; return 1; }
    fi
    mounted_digest="$("${compose[@]}" exec -T backend node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "/run/secrets/github_${role}_app_private_key")" || return $?
    [[ "$expected_digest" == "$mounted_digest" ]] || { echo 'FAIL_CLOSED mounted key mismatch' >&2; return 1; }
  done
}
switch_keys() {
  local target=$1 next
  next="$(mktemp -d "$SECRETS_DIR/.switch.XXXXXX")" || return $?
  ln -s "$target" "$next/current" || return $?
  mv -Tf "$next/current" "$SECRETS_DIR/current" || return $?
  rmdir "$next" || return $?
  [[ "$(readlink -f "$SECRETS_DIR/current")" == "$target" ]]
}
check_serving() {
  verify_keys "${1:-}" || return $?
  "${compose[@]}" exec -T nginx nginx -t || return $?
  "${compose[@]}" exec -T nginx nginx -s reload || return $?
  local public_origin
  public_origin="$("${compose[@]}" exec -T backend printenv FRONTEND_URL)" || return $?
  PUBLIC_ORIGIN="${public_origin%/}" bash "$controller_dir/deploy/jenkins/smoke-release.sh"
}
recover() {
  local original=$?
  trap - ERR
  printf 'ACTIVATION_FAILED status=%s\n' "$original" >&2
  if (
    set -e
    if "$jobs_release"; then
    mail_pause || exit $?
    mail_stop mail-worker || exit $?
    # A bridge cannot drain native receipts. Keep the candidate reader
    # available and all admissions paused until a corrected image ships.
    native="$(mail_sql -c 'SELECT count(*) FROM "MailJob" WHERE "partNo"=0 AND "legacySnapshotStatus" IS NULL')" || exit $?
    if [[ "$native" != 0 ]]; then
      echo 'MAIL_READ_ONLY; native receipts retained; roll forward' >&2
      exit 1
    fi
    "${compose[@]}" rm --stop --force mail-worker || exit $?
    fi
    node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify-keys "$PREVIOUS_KEY_IDENTITY" "$previous_generation" || exit $?
    switch_keys "$previous_generation" || exit $?
    export IMAGE_TAG="$previous_tag"
    compose=(docker compose -p oss-hub -f "$previous_compose")
    node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify-image "$previous_id" || exit $?
    if [[ -n "$previous_overlay" ]]; then
      [[ "$(readlink -f "$previous_overlay")" == "$previous_overlay" ]] || exit 1
      overlay_digest="$(sha256sum "$previous_overlay")" || exit $?
      [[ "${overlay_digest%% *}" == "$previous_overlay_hash" ]] || { echo 'FAIL_CLOSED previous image overlay bytes changed' >&2; exit 1; }
      compose+=(-f "$previous_overlay")
    fi
    compose+=(--env-file "$OSS_HUB_ENV_FILE")
    "${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180 backend nginx || exit $?
    node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify "$PREVIOUS_STATE" "$SECRETS_DIR" >/dev/null || exit $?
    check_serving "$PREVIOUS_KEY_IDENTITY" || exit $?
    if "$jobs_release"; then mail_sql -c "UPDATE \"MailControl\" SET mode='LEGACY' WHERE id=1"; fi
  ); then
    printf 'RECOVERY=ok; deployment remains failed\n' >&2
  else
    printf 'RECOVERY_FAILED; preserve candidate, previous configuration, keys and backups for manual recovery\n' >&2
  fi
  exit "$original"
}

[[ -f "$CANDIDATE_COMPOSE" && -d "$STAGED_KEY_GENERATION" && -L "$SECRETS_DIR/current" ]]
node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify "$PREVIOUS_STATE" "$SECRETS_DIR" >/dev/null
node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify-keys "$PREVIOUS_KEY_IDENTITY" "$previous_generation"
verify_keys "$PREVIOUS_KEY_IDENTITY"
trap recover ERR
set -E
if "$jobs_release"; then
  mail_pause
  mail_stop mail-worker
  mail_stop backend
fi
switch_keys "$STAGED_KEY_GENERATION"
"${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180 backend nginx
check_serving
if "$jobs_release"; then
  mail_activate
  "${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 90 mail-worker
fi
node "$controller_dir/deploy/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" --capture "$RELEASE_SOURCE" "$SECRETS_DIR" | jq -e --arg tag "$RELEASE_TAG" --arg sha "$RELEASE_SHA" --arg compose "$CANDIDATE_COMPOSE" --arg generation "$STAGED_KEY_GENERATION" '.decision == "noop" and .tag == $tag and .sha == $sha and .compose == $compose and .generation == $generation' >/dev/null
trap - ERR
printf 'ACTIVATION=ok\n'
