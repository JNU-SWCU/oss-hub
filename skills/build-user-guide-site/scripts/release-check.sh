#!/usr/bin/env bash
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
refs=$(mktemp)
trap 'rm -f "$refs"' EXIT
git ls-files --cached 'guide/src/content/*.mdx' | while read -r mdx; do
  git show ":$mdx" | grep -oE 'src="[a-z-]+/[a-z0-9-]+\.webp"' | sed -E 's/src="//;s/"//'
done | sort -u > "$refs"
miss=0
while read -r f; do
  git ls-files --cached --error-unmatch "guide/src/assets/shots/$f" >/dev/null 2>&1 || {
    echo "MISSING $f"
    miss=1
  }
done < "$refs"
exit $miss
