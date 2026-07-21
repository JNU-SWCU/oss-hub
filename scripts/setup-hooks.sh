#!/usr/bin/env bash
# 저장소 Git 훅(.githooks) 활성화 스위치 — 명시적 opt-in. install 과정에서는 호출되지 않는다.
#
# 계약:
#   - Git worktree가 아니면 조용히 종료 0 (CI·배포 빌드 등)
#   - effective core.hooksPath가 이미 .githooks면 멱등 성공
#   - 다른 값이 설정돼 있으면 보존하고 안내 후 종료 0 — 부트스트랩을 막지 않는다.
#     기존 값 자체는 출력하지 않는다 (개인 경로가 로그로 유출되는 것 방지, docs/rules/security.md)
#   - 미설정일 때만 이 저장소(--local)에 .githooks를 설정
#   - 진짜 실패(config 읽기/쓰기 오류)만 비0 종료

set -euo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

current="$(git config --get core.hooksPath || true)"
if [ "$current" = ".githooks" ]; then
  echo "setup-hooks: 이미 활성화됨 (.githooks)"
elif [ -n "$current" ]; then
  echo "setup-hooks: 다른 core.hooksPath가 설정되어 있어 보존했습니다 — 저장소 훅 비활성."
  echo "setup-hooks: 기존 설정 확인: git config --show-origin --get core.hooksPath"
else
  git config --local core.hooksPath .githooks
  echo "setup-hooks: 활성화 완료 — .githooks"
fi
