#!/usr/bin/env bash

set -euo pipefail

git fetch --prune --quiet origin

git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null || {
  echo "tidy-branches: origin/main을 찾을 수 없어 중단합니다" >&2
  exit 1
}

current="$(git branch --show-current)"
deleted=0
held=0

while IFS='|' read -r br up remote track; do
  case "$br" in main | "$current" | "") continue ;; esac
  [ -n "$up" ] || continue
  [ "$remote" = "origin" ] || continue
  [ "$track" = "[gone]" ] || continue
  if git merge-base --is-ancestor "refs/heads/$br" refs/remotes/origin/main; then
    if git branch -d -- "$br" >/dev/null 2>&1; then
      echo "tidy-branches: 삭제 — $br (origin/main 이력에 반영 완료)"
      deleted=$((deleted + 1))
    else
      echo "tidy-branches: 보류 — $br (git branch -d 거부)"
      held=$((held + 1))
    fi
  else
    echo "tidy-branches: 보류 — $br (origin/main 이력 밖 커밋 존재 — 내용 확인 후 수동 삭제)"
    held=$((held + 1))
  fi
done < <(git for-each-ref refs/heads --format='%(refname:short)|%(upstream)|%(upstream:remotename)|%(upstream:track)')

if [ "$deleted" -eq 0 ] && [ "$held" -eq 0 ]; then
  echo "tidy-branches: 정리할 로컬 브랜치 없음"
fi
