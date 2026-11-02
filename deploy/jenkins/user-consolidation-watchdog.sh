#!/usr/bin/env bash
set -euo pipefail
set +x
root="${3:-${UC_STATE_ROOT:-/var/lib/oss-hub/user-consolidation}}"
driver=oss-hub-user-consolidation-driver.service

once() {
  [[ -L "$root/active" ]] || return 0
  local run phase boot tool remaining
  run="$(readlink -f "$root/active")"
  tool="$run/helpers/user-consolidation-watchdog-state.mjs"
  phase="$(jq -er .phase "$run/receipt.json")"
  case "$phase" in
    OPEN|ROLLED_BACK)
      if node "$tool" terminal "$run"; then return 0; fi
      UC_STATE_ROOT="$root" bash "$run/helpers/user-consolidation-migrate.sh" --hold "$run"
      return 1 ;;
    NEEDS_FORWARD_RECOVERY|RECOVERY_FAILED) return 0 ;;
  esac
  boot="$(systemd-id128 boot-id)"
  if node "$tool" remaining "$run" "$boot" forward >/dev/null 2>&1; then
    # PREPARED is armed before systemd starts the driver; expiry still covers a lost launch.
    if [[ "$phase" == PREPARED ]] || systemctl is-active --quiet "$driver"; then return 0; fi
  fi
  # Never kill a numeric PID from a prior boot. systemd owns the complete driver cgroup.
  if systemctl is-active --quiet "$driver"; then
    timeout -k 2 10 systemctl kill --kill-whom=all --signal=KILL "$driver"
  fi
  timeout -k 2 10 systemctl stop "$driver"
  remaining="$(node "$tool" remaining "$run" "$boot" recovery)" || {
    printf 'RECOVERY_DEADLINE_EXPIRED: maintenance remains closed\n' >&2
    UC_STATE_ROOT="$root" bash "$run/helpers/user-consolidation-migrate.sh" --hold "$run"
    return 1
  }
  UC_STATE_ROOT="$root" timeout -k 5 "$remaining" \
    bash "$run/helpers/user-consolidation-migrate.sh" --recover "$run"
}

case "${1:-}" in
  --once)
    root="${2:?durable state root required}"
    once ;;
  --watch)
    root="${2:?durable state root required}"
    if [[ -L "$root/active" ]]; then
      run="$(readlink -f "$root/active")"
      node "$run/helpers/user-consolidation-watchdog-state.mjs" armed "$run" "$(systemd-id128 boot-id)"
    fi
    systemd-notify --ready
    while :; do
      # A failed recovery is visible in the journal and receipt, never a reason to reopen.
      once || printf 'WATCHDOG_RECOVERY_FAILED\n' >&2
      sleep 1
    done ;;
  *)
    printf 'Usage: watchdog --watch ROOT | --once ROOT\n' >&2
    exit 2 ;;
esac
