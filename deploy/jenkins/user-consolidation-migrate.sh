#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077
helpers="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_tool="$helpers/user-consolidation-watchdog-state.mjs"
root="${UC_STATE_ROOT:-/var/lib/oss-hub/user-consolidation}"
driver_unit=oss-hub-user-consolidation-driver.service
watchdog_unit=oss-hub-user-consolidation-watchdog.service
fail() { printf 'FAIL_CLOSED %s\n' "$1" >&2; exit 1; }

root="$(node "$helpers/user-consolidation-watchdog-access.mjs" "$root" "${UC_ISOLATED_HOST:-0}")" || exit 1

guard() {
  [[ -e "$root/active" || -L "$root/active" ]] || return 0
  [[ -L "$root/active" ]] || fail invalid-active-receipt
  local phase
  phase="$(jq -er .phase "$root/active/receipt.json")"
  case "$phase" in OPEN|ROLLED_BACK) ;; *) fail "unresolved-migration:$phase";; esac
  node "$state_tool" terminal "$root/active"
}

detect() {
  local manifest ledger query
  manifest="$(node "$state_tool" manifest "$RELEASE_SOURCE")"
  if [[ "$manifest" == null ]]; then printf 'ordinary\n'; return; fi
  query="SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT migration_name, checksum, finished_at, rolled_back_at FROM \"_prisma_migrations\" ORDER BY started_at, id) t"
  ledger="$(timeout -k 5 20 docker exec "$PREV_POSTGRES_ID" sh -ec \
    'PGOPTIONS="-c statement_timeout=10000" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"' sh "$query")"
  node "$state_tool" classify "$RELEASE_SOURCE" "$ledger"
}

verify_prebuilt() {
  local rehearsal_file="${1:-${UC_REHEARSAL_RECEIPT:-/etc/oss-hub/user-consolidation-rehearsal.json}}"
  local previous_state="${2:-${PREVIOUS_STATE:?}}" previous_image candidate_id image_id
  : "${RELEASE_SHA:?}" "${RELEASE_TAG:?}"
  [[ -f "$rehearsal_file" && ! -L "$rehearsal_file" ]] || fail missing-rehearsal
  [[ "$(stat -c %u "$rehearsal_file")" == 0 ]] || fail untrusted-rehearsal
  [[ $((8#$(stat -c %a "$rehearsal_file") & 8#022)) == 0 ]] || fail writable-rehearsal
  previous_image="$(jq -er '.imageId | select(test("^sha256:[a-f0-9]{64}$"))' "$previous_state")" || fail rehearsal-required
  jq -e --arg sha "$RELEASE_SHA" --arg image "$previous_image" \
    '.releaseSha == $sha and .previousImageId == $image and
     (.candidateImageId | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
     .restoreValidated == true and .exclusiveWriters == true and
     (.writerUnits | type == "array") and
     all(.writerUnits[]; test("^[a-zA-Z0-9@_.-]+\\.(service|timer)$") and
       (startswith("oss-hub-user-consolidation-") | not) and
       . != "docker.service" and . != "nginx.service")' "$rehearsal_file" >/dev/null || fail rehearsal-required
  candidate_id="$(jq -er .candidateImageId "$rehearsal_file")" || fail rehearsal-required
  image_id="$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$RELEASE_TAG")" || fail candidate-image-required
  [[ "$image_id" == "$candidate_id" ]] || fail candidate-image-mismatch
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")" == "$RELEASE_SHA" ]] || fail candidate-revision-mismatch
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id")" == "$RELEASE_TAG" ]] || fail candidate-version-mismatch
  printf '%s\n' "$candidate_id"
}

load_run() {
  run="$(cd -P "${1:?durable run directory required}" && pwd -P)"
  [[ "$run" == "$root"/* ]] || fail untrusted-run
  # context.sh is written by prepare in the root-owned, mode-0700 durable bundle.
  source "$run/context.sh"
  root="$(node "$helpers/user-consolidation-watchdog-access.mjs" "$UC_STATE_ROOT" "${UC_ISOLATED_HOST:-0}")" || return 1
  [[ "$run" == "$root"/* ]] || fail untrusted-run
  state_tool="$run/helpers/user-consolidation-watchdog-state.mjs"
  boot="$(systemd-id128 boot-id)"
  exec 9>"$root/migration.lock"
  flock -n 9 || fail migration-lock-held
}

step() {
  local remaining limit
  remaining="$(node "$state_tool" remaining "$run" "$boot" "$budget")" || return 1
  [[ "$remaining" =~ ^[1-9][0-9]*$ ]] || return 1
  limit=$((remaining > 120 ? 120 : remaining))
  # timeout owns a process group. The systemd driver cgroup is the independent backstop.
  timeout --signal=TERM --kill-after=5 "$limit" bash "$run/helpers/user-consolidation-watchdog-host.sh" "$1" "$run" 9>&-
}

hold_fence() {
  timeout -k 5 30 bash "$run/helpers/user-consolidation-watchdog-host.sh" fence "$run" 9>&-
}

recover() {
  trap - ERR TERM INT
  budget=recovery
  if ! node "$state_tool" rollback-allowed "$run"; then
    hold_fence || return 1
    node "$state_tool" phase "$run" NEEDS_FORWARD_RECOVERY || return 1
    return 1
  fi
  node "$state_tool" phase "$run" RECOVERING || return 1
  if step fence && step stop-candidate && step rollback && step verify-previous; then
    node "$state_tool" commit-open "$run" previous || { hold_fence; return 1; }
    if step open-previous; then
      node "$state_tool" phase "$run" ROLLED_BACK || return 1
      return 0
    fi
    hold_fence || return 1
    node "$state_tool" phase "$run" NEEDS_FORWARD_RECOVERY || return 1
  else
    hold_fence || return 1
    node "$state_tool" phase "$run" RECOVERY_FAILED || return 1
  fi
  return 1
}

execute() {
  load_run "$1"
  budget=forward
  case "$(jq -er .phase "$run/receipt.json")" in
    OPEN) node "$state_tool" terminal "$run"; return 0 ;;
    ROLLED_BACK|NEEDS_FORWARD_RECOVERY|RECOVERY_FAILED) return 1 ;;
    PREPARED) ;;
    *) recover; exit 1 ;;
  esac
  node "$state_tool" check-armed "$run" "$boot"
  trap 'recover; exit 1' ERR TERM INT
  node "$state_tool" phase "$run" FENCING
  step fence
  node "$state_tool" phase "$run" FENCED
  step drain
  step preflight
  step backup
  node "$state_tool" backup "$run"
  step verify-backup
  node "$state_tool" phase "$run" BACKED_UP
  # The intent is durable before the first DDL, including a commit whose response is lost.
  node "$state_tool" phase "$run" MIGRATING
  step migrate
  node "$state_tool" phase "$run" MIGRATED
  step reconcile
  step verify-candidate
  step stop-candidate
  node "$state_tool" phase "$run" VERIFIED
  node "$state_tool" remaining "$run" "$boot" forward >/dev/null
  node "$state_tool" commit-open "$run" candidate
  step open-candidate
  node "$state_tool" phase "$run" OPEN
  trap - ERR TERM INT
}

prepare() {
  : "${RELEASE_SOURCE:?}" "${PREVIOUS_STATE:?}" "${PREVIOUS_KEY_IDENTITY:?}" "${OSS_HUB_ENV_FILE:?}"
  : "${CANDIDATE_COMPOSE:?}" "${STAGED_KEY_GENERATION:?}" "${RELEASE_SHA:?}" "${RELEASE_TAG:?}" "${SECRETS_DIR:?}"
  [[ "$EUID" == 0 ]] || fail root-host-service-required
  [[ "$root" == /* && "$root" != "$RELEASE_SOURCE"* ]] || fail durable-root-required
  for command in systemctl systemd-run systemd-id128 timeout flock node jq docker nginx; do
    command -v "$command" >/dev/null || fail "missing:$command"
  done
  local candidate_id rehearsal_file="${UC_REHEARSAL_RECEIPT:-/etc/oss-hub/user-consolidation-rehearsal.json}" bound
  candidate_id="$(verify_prebuilt)"
  mkdir -p "$root"
  chmod 700 "$root"
  exec 9>"$root/migration.lock"
  flock -n 9 || fail migration-lock-held
  guard
  [[ "$(detect)" == required ]] || fail migration-not-required
  [[ "$(systemctl is-enabled "$watchdog_unit")" == enabled ]] || fail boot-watchdog-required
  [[ "$(systemctl show "$watchdog_unit" -p User --value)" == root ]] || fail root-watchdog-required
  [[ "$(systemctl show "$watchdog_unit" -p Type --value)" == notify ]] || fail notify-watchdog-required
  [[ "$(systemctl show "$watchdog_unit" -p KillMode --value)" == control-group ]] || fail watchdog-cgroup-required
  systemctl show "$watchdog_unit" -p ExecStart --value | grep -F "$root/watchdog.sh --watch $root" >/dev/null || fail watchdog-exec-mismatch
  bound="$(jq -er .recoverySeconds "$rehearsal_file")"
  run="$(mktemp -d "$root/run.XXXXXXXX")"
  mkdir "$run/helpers" "$run/sql" "$run/candidate" "$run/previous"
  cp "$helpers"/user-consolidation-{migrate.sh,watchdog*.sh,watchdog-state.mjs,watchdog-access.mjs} "$run/helpers/"
  cp "$RELEASE_SOURCE/deploy/jenkins/user-consolidation/"* "$run/sql/"
  cp "$rehearsal_file" "$run/rehearsal.json"
  cp "$RELEASE_SOURCE/deploy/host-nginx/oss-hub.conf" "$run/expected-host-nginx.conf"
  cp "$PREVIOUS_STATE" "$run/previous-state.json"
  cp "$PREVIOUS_KEY_IDENTITY" "$run/previous-keys.json"
  cp -R "$(dirname "$CANDIDATE_COMPOSE")/." "$run/candidate/"
  cp -R "$(dirname "$(jq -er .compose "$PREVIOUS_STATE")")/deploy" "$run/previous/"
  cp "$(jq -er .compose "$PREVIOUS_STATE")" "$run/previous/compose.yml"
  cp "$OSS_HUB_ENV_FILE" "$run/candidate.env"
  printf '\nSUBMISSION_FILE_S3_ACCESS_KEY_ID=%s\nSUBMISSION_FILE_S3_SECRET_ACCESS_KEY=%s\n' \
    "${R2_STORAGE_ACCESS_KEY_ID:?}" "${R2_STORAGE_SECRET_ACCESS_KEY:?}" >>"$run/candidate.env"
  export UC_STATE_ROOT="$root" UC_RUN="$run" RELEASE_TAG RELEASE_SHA SECRETS_DIR STAGED_KEY_GENERATION
  export PREV_POSTGRES_ID="$(jq -er .postgresId "$PREVIOUS_STATE")"
  for variable in UC_STATE_ROOT UC_RUN RELEASE_TAG RELEASE_SHA SECRETS_DIR STAGED_KEY_GENERATION PREV_POSTGRES_ID; do
    printf 'export %s=%q\n' "$variable" "${!variable}"
  done >"$run/context.sh"
  if ! timeout -k 5 120 bash "$run/helpers/user-consolidation-watchdog-host.sh" prepare "$run"; then
    timeout -k 5 20 docker rm -f oss-hub-uc-capability oss-hub-uc-artifact oss-hub-uc-nginx-check >/dev/null 2>&1 ||
      printf 'PREPARE_CLEANUP_FAILED: inspect named preparation containers\n' >&2
    fail preparation-failed-before-fence
  fi
  [[ "$(verify_prebuilt "$run/rehearsal.json" "$run/previous-state.json")" == "$candidate_id" ]] || fail candidate-image-mismatch
  [[ "$(jq -er .services.backend.image "$run/candidate-image.json")" == "$candidate_id" ]] || fail candidate-image-mismatch
  node "$state_tool" init "$run" "$(systemd-id128 boot-id)" "$bound" \
    "$(jq -n --slurpfile old "$PREVIOUS_STATE" --slurpfile manifest "$run/sql/manifest.json" --slurpfile image "$run/candidate-image.json" --arg sha "$RELEASE_SHA" '{previous:$old[0],manifest:$manifest[0],candidateSha:$sha,candidateImageId:$image[0].services.backend.image}')"
  sync -f "$run"
  cp "$helpers/user-consolidation-watchdog.sh" "$root/watchdog.sh"
  ln -s "$run" "$root/active.next"
  mv -Tf "$root/active.next" "$root/active"
  sync -f "$root"
  # Type=notify returns only after the independent process has persisted its armed receipt.
  timeout -k 5 20 systemctl restart "$watchdog_unit"
  node "$state_tool" check-armed "$run" "$(systemd-id128 boot-id)"
  flock -u 9
  exec 9>&-
  systemd-run --unit="${driver_unit%.service}" --collect --wait --pipe \
    --setenv="UC_STATE_ROOT=$root" \
    --property=Type=exec --property=KillMode=control-group --property=TimeoutStopSec=5 \
    --property=RuntimeMaxSec=1800 /bin/bash "$run/helpers/user-consolidation-migrate.sh" --execute "$run"
}

case "${1:-}" in
  --guard) guard ;;
  --detect) guard; detect ;;
  --verify-prebuilt) verify_prebuilt ;;
  --start)
    [[ "$root" == /var/lib/oss-hub/user-consolidation ]] || fail production-state-root
    prepare ;;
  --rehearsal)
    [[ "${UC_ISOLATED_HOST:-}" == 1 && "$root" != /var/lib/oss-hub/user-consolidation ]] || fail isolated-host-required
    prepare ;;
  --execute) execute "${2:?}" ;;
  --recover) load_run "${2:?}"; recover ;;
  --hold)
    load_run "${2:?}"
    timeout -k 5 30 bash "$run/helpers/user-consolidation-watchdog-host.sh" fence "$run" 9>&-
    if [[ -e "$run/OPEN_COMMITTED" ]]; then
      node "$state_tool" phase "$run" NEEDS_FORWARD_RECOVERY
    else
      node "$state_tool" phase "$run" RECOVERY_FAILED
    fi ;;
  *) fail 'usage: --guard|--detect|--verify-prebuilt|--start|--rehearsal|--execute RUN|--recover RUN' ;;
esac
