#!/usr/bin/env bash
# 로컬 브랜치 뒷정리 — 원격은 repo 설정 delete_branch_on_merge가 처리하므로 이 스크립트는 로컬만 다룬다.
#
# 동작: origin을 prune한 뒤, upstream이 사라진(gone) 로컬 브랜치를 삭제한다.
# 안전장치:
#   - 현재 브랜치와 main은 대상에서 제외
#   - 커밋이 origin/main 이력에 그대로 있으면(merge commit 방식) 바로 삭제
#   - 그 외에는 git branch -d만 시도 — 실패하면 지우지 않고 보류로 알린다
#     (squash merge된 브랜치가 여기 해당: 내용이 main에 반영됐는지 확인 후 git branch -D <이름>)
#   - upstream을 한 번도 가진 적 없는 로컬 전용 브랜치는 건드리지 않는다

set -euo pipefail

git fetch --prune --quiet origin

current="$(git branch --show-current)"
deleted=0
held=0

while IFS= read -r br; do
  case "$br" in main | "$current" | "") continue ;; esac
  git branch -vv --list "$br" | grep -q ': gone]' || continue
  if git merge-base --is-ancestor "refs/heads/$br" origin/main 2>/dev/null; then
    git branch -D "$br" >/dev/null
    echo "tidy-branches: 삭제 — $br (main 이력에 반영 완료)"
    deleted=$((deleted + 1))
  elif git branch -d "$br" >/dev/null 2>&1; then
    echo "tidy-branches: 삭제 — $br (HEAD에 merge 완료)"
    deleted=$((deleted + 1))
  else
    echo "tidy-branches: 보류 — $br (main 이력에 없는 커밋 존재 — squash merge였다면 내용 확인 후 git branch -D $br)"
    held=$((held + 1))
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

if [ "$deleted" -eq 0 ] && [ "$held" -eq 0 ]; then
  echo "tidy-branches: 정리할 로컬 브랜치 없음"
fi
