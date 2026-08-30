#!/usr/bin/env bash
# 에이전트 런타임별 스킬 진입 경로가 저장소 원본 하나를 가리키는지 검사한다.
#
# 왜 필요한가: Claude·Cursor·Codex는 각자 자기 디렉터리(`.claude/skills`·`.cursor/skills`·
# `.codex/skills`)에서만 스킬을 찾는다. 원본을 런타임마다 복사하면 세 사본이 조용히
# 갈라지고, 갈라진 사본을 따른 작업은 리뷰에서야 발견된다(AGENTS.md §2 canonical store).
# 그래서 세 경로를 원본 하나를 가리키는 상대 심볼릭 링크로 두고 이 스크립트가 그 계약을 지킨다.
#
# 절대 경로 링크를 막는 이유는 두 가지다. 다른 사람의 checkout에서 깨지고,
# 개인 머신 경로가 공개 저장소에 남는다(AGENTS.md §4·docs/rules/security.md).
#
# 사용법:
#   bash scripts/check-agent-skill-links.sh          # 이 저장소를 검사
#   bash scripts/check-agent-skill-links.sh <root>   # 합성 fixture 루트를 검사(테스트용)

set -euo pipefail

DEFAULT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${1:-$DEFAULT_ROOT}"

# 원본은 하나뿐이다. 링크는 전부 이 경로로 수렴해야 한다.
CANONICAL_PATH='skills/manage-qa-tickets'
CANONICAL_ENTRYPOINT='SKILL.md'

# 각 에이전트 런타임이 스킬을 찾는 경로.
LINK_PATHS=(
  '.claude/skills/manage-qa-tickets'
  '.cursor/skills/manage-qa-tickets'
  '.codex/skills/manage-qa-tickets'
)

failures=0

fail() {
  printf 'agent-skill-links: %s\n' "$1" >&2
  failures=$((failures + 1))
}

if [ ! -d "$TARGET_ROOT" ]; then
  printf 'agent-skill-links: 검사 대상 루트가 없습니다.\n' >&2
  exit 1
fi

cd "$TARGET_ROOT"

if [ ! -f "$CANONICAL_PATH/$CANONICAL_ENTRYPOINT" ]; then
  printf 'agent-skill-links: 스킬 원본 %s/%s 이 없습니다.\n' \
    "$CANONICAL_PATH" "$CANONICAL_ENTRYPOINT" >&2
  exit 1
fi

canonical_real="$(cd -P "$CANONICAL_PATH" && pwd)"

for link in "${LINK_PATHS[@]}"; do
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    fail "$link 이 없습니다. 원본을 가리키는 상대 심볼릭 링크를 만드세요."
    continue
  fi

  if [ ! -L "$link" ]; then
    fail "$link 이 심볼릭 링크가 아닙니다. 사본은 원본과 갈라지므로 링크로 두세요."
    continue
  fi

  target="$(readlink "$link")"

  case "$target" in
    /*)
      # 링크 대상 값 자체는 출력하지 않는다 — 개인 머신 경로일 수 있다.
      fail "$link 의 링크 대상이 절대 경로입니다. 저장소 상대 경로로 바꾸세요."
      continue
      ;;
  esac

  if [ ! -d "$link" ]; then
    fail "$link 링크가 실제 디렉터리로 이어지지 않습니다(끊어진 링크)."
    continue
  fi

  link_real="$(cd -P "$link" && pwd)"

  if [ "$link_real" != "$canonical_real" ]; then
    fail "$link 이 원본 $CANONICAL_PATH 이 아닌 다른 경로를 가리킵니다."
    continue
  fi

  if [ ! -f "$link/$CANONICAL_ENTRYPOINT" ]; then
    fail "$link/$CANONICAL_ENTRYPOINT 을 링크를 통해 읽을 수 없습니다."
    continue
  fi

  printf 'agent-skill-links: %s -> %s 확인\n' "$link" "$CANONICAL_PATH"
done

if [ "$failures" -ne 0 ]; then
  printf 'agent-skill-links: %d건 실패.\n' "$failures" >&2
  exit 1
fi

printf 'agent-skill-links: %d개 진입 경로가 모두 원본 하나를 가리킵니다.\n' "${#LINK_PATHS[@]}"
