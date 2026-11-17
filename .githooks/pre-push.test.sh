#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
hook="$root/.githooks/pre-push"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

mkdir -p "$work/bin" "$work/repo"
cat >"$work/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >>"$CALL_LOG"
exit "${FORMAT_EXIT:-0}"
STUB
chmod +x "$work/bin/pnpm"
cp -R "$root/verify" "$work/repo/verify"
rm -rf "$work/repo/verify/reports"

cd "$work/repo"
git init -q -b main
git config user.email t@example.test
git config user.name t
git add -A
git -c core.hooksPath=/dev/null commit -q -m init
sha="$(git rev-parse HEAD)"
zero=0000000000000000000000000000000000000000

run() {
  local label="$1" expected="$2" stdin="$3"
  export CALL_LOG="$work/calls.log"
  : >"$CALL_LOG"
  local code=0
  printf '%s' "$stdin" | PATH="$work/bin:$PATH" bash "$hook" >"$work/out" 2>&1 || code=$?
  if [ "$code" -ne "$expected" ]; then
    echo "FAIL $label: exit $code, expected $expected" >&2
    cat "$work/out" >&2
    fail=1
  else
    echo "ok $label"
  fi
}

FORMAT_EXIT=1 run "format failure stops the push" 1 "refs/heads/main $sha refs/heads/main $zero"$'\n'
if grep -q 'verify' "$work/out"; then
  echo "FAIL format failure still ran verify" >&2
  fail=1
fi
FORMAT_EXIT=0 run "deletion-only push passes without checks" 0 "(delete) $zero refs/heads/gone $sha"$'\n'
if ! grep -q 'deletions only' "$work/out"; then
  echo "FAIL deletion-only push did not skip checks" >&2
  fail=1
fi
FORMAT_EXIT=0 run "malformed push input fails closed" 2 "garbage"$'\n'
if ! grep -q 'pnpm format:check' "$CALL_LOG"; then
  echo "FAIL format:check was not called" >&2
  fail=1
fi

exit "$fail"
