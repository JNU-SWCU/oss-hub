#!/usr/bin/env bash

set -euo pipefail

root="${1:-$(git rev-parse --show-toplevel)}"
cd "$root"

empty=()
while IFS= read -r -d '' file; do
  if [ -f "$file" ] && [ ! -s "$file" ]; then
    empty+=("$file")
  fi
done < <(git ls-files -z -- '*.md')

if [ "${#empty[@]}" -gt 0 ]; then
  printf '빈 Markdown 문서는 커밋할 수 없습니다. 내용을 쓰거나 파일을 지우세요.\n' >&2
  printf '  %s\n' "${empty[@]}" >&2
  exit 1
fi
