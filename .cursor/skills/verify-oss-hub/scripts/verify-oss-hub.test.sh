#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$SCRIPT_DIR/verify-oss-hub"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_fail() {
  local expected="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    printf 'expected failure: %s\n%s\n' "$*" "$output" >&2
    exit 1
  fi
  printf '%s' "$output" | grep -F "$expected" >/dev/null
}

assert_fail 'Node.js 24' env PATH="/usr/bin:/bin" "$BIN" launch

node -e '
  const fixture = require(process.argv[1]);
  const activity = fixture.ledgerActivity;
  const counts = [activity.commitCount, activity.pullRequestCount, activity.issueCount, activity.starCount];
  if (counts.some((count) => count < 1)) process.exit(1);
  if (fixture.ranking[0].nickname !== "verify-rank-alpha") process.exit(1);
  if (fixture.ranking[1].nickname !== "verify-rank-beta") process.exit(1);
' "$SCRIPT_DIR/verification-fixtures.json"

assert_fail 'usage:' "$BIN"
assert_fail 'no instance state' "$BIN" doctor
"$BIN" cleanup >/dev/null
test ! -d "$ROOT/run"

printf 'verify-oss-hub.test.sh: ok\n'
