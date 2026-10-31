#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-empty-docs.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/empty-docs-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

git -C "$TEMP_ROOT" init -q
printf '# 제목\n' > "$TEMP_ROOT/filled.md"
: > "$TEMP_ROOT/.gitkeep"
git -C "$TEMP_ROOT" add filled.md .gitkeep
bash "$CHECK" "$TEMP_ROOT"

mkdir -p "$TEMP_ROOT/docs"
: > "$TEMP_ROOT/docs/empty.md"
git -C "$TEMP_ROOT" add docs/empty.md
if output="$(bash "$CHECK" "$TEMP_ROOT" 2>&1)"; then
  printf 'FAIL: 빈 Markdown 문서를 통과시켰습니다\n' >&2
  exit 1
fi
grep -q 'docs/empty.md' <<<"$output"

printf 'check-empty-docs: ok\n'
