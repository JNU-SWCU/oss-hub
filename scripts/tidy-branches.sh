#!/usr/bin/env bash
# 로컬 브랜치 뒷정리 — 원격은 repo 설정 delete_branch_on_merge가 처리한다. 이 스크립트는 로컬만 다룬다.
#
# 삭제 자격 (전부 만족할 때만):
#   1) origin에 upstream이 있었고 지금은 사라진(gone) 브랜치 — 원격에서 merge 후 삭제된 것
#   2) 커밋이 origin/main 이력에 포함됨 (merge-base --is-ancestor)
#   3) git branch -d가 동의 — Git 자체 안전장치 (-D는 쓰지 않는다)
# 그 외에는 전부 보류 안내만 한다. upstream이 없던 로컬 전용 브랜치와
# origin 외 remote를 쓰는 브랜치는 대상이 아니다 (prune도 origin만 하므로).
# 파싱은 for-each-ref(plumbing)만 사용 — 로케일 비의존.

set -euo pipefail

git fetch --prune --quiet origin

# origin/main 검증은 fetch 이후에 — fetch가 origin/main을 제거하는 경우의 오분류 방지
git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null || {
  echo "tidy-branches: origin/main을 찾을 수 없어 중단합니다" >&2
  exit 1
}

current="$(git branch --show-current)"
deleted=0
held=0

while IFS='|' read -r br up remote track; do
  case "$br" in main | "$current" | "") continue ;; esac
  [ -n "$up" ] || continue                 # upstream을 가진 적 없는 로컬 전용 브랜치 제외
  [ "$remote" = "origin" ] || continue     # origin 외 remote는 대상 아님
  [ "$track" = "[gone]" ] || continue      # upstream ref가 살아 있으면 제외
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
