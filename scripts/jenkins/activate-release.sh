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
export SUBMISSION_FILE_S3_ACCESS_KEY_ID="${R2_STORAGE_ACCESS_KEY_ID:?}"
export SUBMISSION_FILE_S3_SECRET_ACCESS_KEY="${R2_STORAGE_SECRET_ACCESS_KEY:?}"
export GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/collection.pem"
export GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/operations.pem"
compose=(docker compose -p oss-hub -f "$CANDIDATE_COMPOSE" --env-file "$OSS_HUB_ENV_FILE")
export IMAGE_TAG="$RELEASE_TAG"

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
  bash "$controller_dir/scripts/jenkins/smoke-release.sh"
}
recover() {
  local original=$?
  trap - ERR
  printf 'ACTIVATION_FAILED status=%s\n' "$original" >&2
  if (
    set -e
    node "$controller_dir/scripts/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify-keys "$PREVIOUS_KEY_IDENTITY" "$previous_generation" || exit $?
    switch_keys "$previous_generation" || exit $?
    export IMAGE_TAG="$previous_tag"
    compose=(docker compose -p oss-hub -f "$previous_compose" --env-file "$OSS_HUB_ENV_FILE")
    PREV_TAG="$previous_tag" PREV_SHA="$previous_sha" PREV_BE_IMAGE_ID="$previous_id" bash "$controller_dir/scripts/jenkins/validate-rollback-images.sh" || exit $?
    "${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180 backend nginx || exit $?
    node "$controller_dir/scripts/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify "$PREVIOUS_STATE" "$SECRETS_DIR" >/dev/null || exit $?
    check_serving "$PREVIOUS_KEY_IDENTITY"
  ); then
    printf 'RECOVERY=ok; deployment remains failed\n' >&2
  else
    printf 'RECOVERY_FAILED; preserve candidate, previous configuration, keys and backups for manual recovery\n' >&2
  fi
  exit "$original"
}

[[ -f "$CANDIDATE_COMPOSE" && -d "$STAGED_KEY_GENERATION" && -L "$SECRETS_DIR/current" ]]
node "$controller_dir/scripts/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify "$PREVIOUS_STATE" "$SECRETS_DIR" >/dev/null
node "$controller_dir/scripts/jenkins/probe-release-state.mjs" "$previous_tag" "$previous_sha" --verify-keys "$PREVIOUS_KEY_IDENTITY" "$previous_generation"
verify_keys "$PREVIOUS_KEY_IDENTITY"
trap recover ERR
set -E
switch_keys "$STAGED_KEY_GENERATION"
"${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180 backend nginx
node "$controller_dir/scripts/jenkins/probe-release-state.mjs" "$RELEASE_TAG" "$RELEASE_SHA" --capture "$RELEASE_SOURCE" "$SECRETS_DIR" | jq -e --arg tag "$RELEASE_TAG" --arg sha "$RELEASE_SHA" --arg compose "$CANDIDATE_COMPOSE" --arg generation "$STAGED_KEY_GENERATION" '.decision == "noop" and .tag == $tag and .sha == $sha and .compose == $compose and .generation == $generation' >/dev/null
check_serving
trap - ERR
printf 'ACTIVATION=ok\n'
