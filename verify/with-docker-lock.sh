#!/usr/bin/env bash
set -euo pipefail

lock="${OSS_HUB_DOCKER_LOCK:-/tmp/oss-hub-docker.lock}"
until mkdir "$lock" 2>/dev/null; do sleep 15; done
identity="$(LC_ALL=C ps -p "$$" -o lstart= -o command=)"
release() {
  local current
  current="$(printf '%s\n%s\n' "$$" "$identity")"
  if [ -f "$lock/owner" ] && [ "$(cat "$lock/owner")" = "$current" ]; then
    rm "$lock/owner"
    rmdir "$lock"
  fi
}
trap release EXIT
umask 077
printf '%s\n%s\n' "$$" "$identity" > "$lock/owner.tmp"
mv "$lock/owner.tmp" "$lock/owner"
"$@"
