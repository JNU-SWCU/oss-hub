#!/usr/bin/env bash

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
