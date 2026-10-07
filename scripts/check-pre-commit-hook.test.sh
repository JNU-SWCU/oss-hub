#!/usr/bin/env bash
# .githooks/pre-commit이 특수 문자 파일명을 앱 상대 경로 그대로 ESLint에 넘기는지 확인한다.
# 실제 ESLint 대신 받은 인자와 stdin을 기록하는 spy를 쓴다.
set -euo pipefail

hook="$(cd "$(dirname "$0")/.." && pwd)/.githooks/pre-commit"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

cd "$work"
git init -q
git config user.email t@example.test
git config user.name t
mkdir -p apps/frontend/src apps/frontend/node_modules/.bin apps/backend
cat >apps/frontend/node_modules/.bin/eslint <<'SPY'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  case "$1" in
    --stdin-filename) shift; printf 'stdin\0%s\0%s\0' "$1" "$(cat)" >>"$SPY_LOG" ;;
    --) shift; for f in "$@"; do printf 'file\0%s\0' "$f" >>"$SPY_LOG"; done; break ;;
  esac
  shift
done
SPY
chmod +x apps/frontend/node_modules/.bin/eslint
git commit -q --allow-empty -m init

names=('src/한글.ts' $'src/줄\n바꿈.ts' 'src/따"옴표.ts')

check() {
  local label="$1" expected="$2"
  export SPY_LOG="$work/spy.log"
  : >"$SPY_LOG"
  if ! bash "$hook" >"$work/out" 2>&1; then
    echo "FAIL $label: hook exit $?" >&2
    cat "$work/out" >&2
    fail=1
  elif ! cmp -s "$SPY_LOG" <(printf '%b' "$expected"); then
    echo "FAIL $label: eslint 인자가 다르다" >&2
    od -c "$SPY_LOG" | head -5 >&2
    fail=1
  else
    echo "ok $label"
  fi
  git reset -q
  git clean -qfd apps/frontend/src
}

labels=(한글 줄바꿈 큰따옴표)
for i in "${!names[@]}"; do
  n="${names[$i]}"
  mkdir -p apps/frontend/src
  printf 'export const a = 1;\n' >"apps/frontend/$n"
  git add -- "apps/frontend/$n"
  check "batch ${labels[$i]}" "file\0$n\0"

  mkdir -p apps/frontend/src
  printf 'export const a = 1;\n' >"apps/frontend/$n"
  git add -- "apps/frontend/$n"
  printf 'export const b = 2;\n' >"apps/frontend/$n"
  check "stdin ${labels[$i]}" "stdin\0$n\0export const a = 1;\0"
done

exit $fail
