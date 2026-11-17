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
  shift 3
  export CALL_LOG="$work/calls.log"
  : >"$CALL_LOG"
  local code=0
  printf '%s' "$stdin" | PATH="$work/bin:$PATH" bash "$hook" "$@" >"$work/out" 2>&1 || code=$?
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
if ! grep -q 'nothing new to verify' "$work/out"; then
  echo "FAIL deletion-only push did not skip checks" >&2
  fail=1
fi
FORMAT_EXIT=0 run "malformed push input fails closed" 2 "garbage"$'\n'
if ! grep -q 'pnpm format:check' "$CALL_LOG"; then
  echo "FAIL format:check was not called" >&2
  fail=1
fi

fetch_url="$work/fetch.git"
push_url="$work/push.git"
git init -q --bare "$fetch_url"
git init -q --bare "$push_url"
git remote add origin "$fetch_url"
git remote set-url --push origin "$push_url"
token="ghp_$(printf 'A%.0s' $(seq 36))"
mkdir -p apps/backend/src
printf "export const token = '%s';\n" "$token" >apps/backend/src/config.ts
git add -A
git -c core.hooksPath=/dev/null commit -q -m "feat: backend with token"
head="$(git rev-parse HEAD)"
git push -q "$fetch_url" "HEAD:refs/heads/main"
git update-ref refs/remotes/origin/main "$head"
FORMAT_EXIT=0 run "empty range missing on the push URL fails closed" 2 "refs/heads/feature $head refs/heads/feature $zero"$'\n' origin "$push_url"
if ! grep -q "has no ref at that commit" "$work/out"; then
  echo "FAIL push URL check did not report the missing commit" >&2
  fail=1
fi
FORMAT_EXIT=0 run "empty range without a push URL fails closed" 2 "refs/heads/feature $head refs/heads/feature $zero"$'\n' origin
git push -q "$push_url" "HEAD:refs/heads/main"
FORMAT_EXIT=0 run "empty range already on the push URL passes" 0 "refs/heads/feature $head refs/heads/feature $zero"$'\n' origin "$push_url"
if ! grep -q 'nothing new to verify' "$work/out"; then
  echo "FAIL existing commit on the push URL was not skipped" >&2
  fail=1
fi

exit "$fail"
