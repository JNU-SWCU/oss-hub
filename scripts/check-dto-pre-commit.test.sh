#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/.githooks/pre-commit"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dto-precommit-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

REPO="$TEMP_ROOT/repo"
BIN="$TEMP_ROOT/bin"
CALLS="$TEMP_ROOT/calls"
mkdir -p "$REPO/apps/backend/src/auth/dto" "$BIN"
git -C "$REPO" init -q

cat >"$BIN/git" <<'EOF'
#!/usr/bin/env bash
if [ "${FAIL_GIT_SHOW:-0}" = 1 ] && [ "${1:-}" = show ]; then
  exit 42
fi
exec /usr/bin/git "$@"
EOF

cat >"$BIN/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
printf '%s\n' "$input" >>"$CALLS"
if printf '%s\n' "$input" | grep -Eq '(class|interface|type)[[:space:]]+[A-Za-z0-9]+([[:space:]=<{]|$)' &&
  ! printf '%s\n' "$input" | grep -Eq '(class|interface|type)[[:space:]]+[A-Za-z0-9]*(Request|Response)Dto([[:space:]=<{]|$)'; then
  echo '@typescript-eslint/naming-convention: DTO 이름은 RequestDto 또는 ResponseDto로 끝나야 합니다.' >&2
  exit 1
fi
EOF
chmod +x "$BIN/git" "$BIN/pnpm"

run_hook() {
  (cd "$REPO" && PATH="$BIN:$PATH" CALLS="$CALLS" "$HOOK")
}

assert_pass() { local name="$1"; shift; "$@" >/dev/null 2>&1 || { echo "not ok - $name"; exit 1; }; echo "ok - $name"; }
assert_fail() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then echo "not ok - $name"; exit 1; fi; echo "ok - $name"; }

touch "$CALLS"
printf 'unrelated\n' >"$REPO/README.md"
git -C "$REPO" add README.md
assert_pass 'unrelated staged file skips lint' run_hook
test ! -s "$CALLS"

dto="$REPO/apps/backend/src/auth/dto/example.dto.ts"
printf 'export class ExampleRequestDto {}\n' >"$dto"
git -C "$REPO" add "${dto#$REPO/}"
assert_pass 'valid request DTO passes' run_hook

printf 'export class ExampleDto {}\n' >"$dto"
git -C "$REPO" add "${dto#$REPO/}"
assert_fail 'invalid DTO fails' run_hook

printf 'export class MissingSuffix {}\n' >"$dto"
git -C "$REPO" add "${dto#$REPO/}"
assert_fail 'missing DTO suffix fails' run_hook

printf 'export class ExampleRequestDto {}\n' >"$dto"
assert_fail 'invalid staged blob beats valid worktree' run_hook

FAIL_GIT_SHOW=1 assert_fail 'staged blob read failure propagates' run_hook

second="$REPO/apps/backend/src/auth/dto/second.dto.ts"
printf 'export interface SecondResponseDto {}\n' >"$second"
git -C "$REPO" add "${second#$REPO/}"
assert_fail 'multiple files propagate one failure' run_hook

git -C "$REPO" rm -f --cached -q "${dto#$REPO/}" "${second#$REPO/}"
assert_pass 'deleted DTOs are skipped' run_hook

echo '8 passed, 0 failed'
