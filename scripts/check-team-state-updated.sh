#!/usr/bin/env bash
# PR 제출 전 docs/handoff/TEAM-STATE.md 갱신을 강제하는 pre-push 가드 로직.
# .githooks/pre-push의 얇은 래퍼가 이 스크립트를 호출한다. 훅은 오프라인·즉답이어야 하므로
# 네트워크 fetch를 하지 않고 로컬에 이미 있는 refs/remotes/origin/main(또는 그 대체)만 비교 기준으로 쓴다.
# 사실 일치(문서 내용이 GitHub 상태와 맞는지)는 검사하지 않는다 — 그건 team-state-drift advisory job의 몫이다.
#
# 표준입력: git pre-push 프로토콜 그대로 —
#   <local ref> <local sha1> <remote ref> <remote sha1>  줄 단위, 여러 ref를 한 번에 받을 수 있다.
#
# 제외 대상: main으로의 direct push(remote ref가 refs/heads/main), 브랜치 삭제 push(local sha1이 전부 0).
# 우회: TEAM_STATE_SKIP=1 (경고만 출력하고 검사 자체를 생략 — PR 본문에 사유를 남겨야 한다).

set -euo pipefail

TEAM_STATE_PATH='docs/handoff/TEAM-STATE.md'
ZERO_SHA='0000000000000000000000000000000000000000'

if [ "${TEAM_STATE_SKIP:-}" = '1' ]; then
  echo 'check-team-state-updated: TEAM_STATE_SKIP=1 — 검사를 건너뜁니다. PR 본문에 우회 사유를 남기세요.' >&2
  cat >/dev/null || true
  exit 0
fi

resolve_base_ref() {
  if git rev-parse --verify -q refs/remotes/origin/main >/dev/null 2>&1; then
    printf 'refs/remotes/origin/main\n'
  elif git rev-parse --verify -q refs/heads/main >/dev/null 2>&1; then
    printf 'refs/heads/main\n'
  fi
}

base_ref="$(resolve_base_ref)"
blocked=0

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_ref:-}" ] || continue

  if [ "$local_sha" = "$ZERO_SHA" ]; then
    continue # 브랜치 삭제 push는 검사 제외
  fi
  if [ "$remote_ref" = 'refs/heads/main' ]; then
    continue # main으로의 direct push는 검사 제외
  fi
  if [ -z "$base_ref" ]; then
    echo "check-team-state-updated: 비교 기준(origin/main)을 찾을 수 없어 ${local_ref} 검사를 건너뜁니다." >&2
    continue
  fi

  merge_base="$(git merge-base "$base_ref" "$local_sha" 2>/dev/null || true)"
  if [ -z "$merge_base" ]; then
    echo "check-team-state-updated: ${local_ref} 병합 기준점을 계산할 수 없어 검사를 건너뜁니다." >&2
    continue
  fi

  changed_files="$(git diff --name-only "$merge_base" "$local_sha")"
  if ! grep -qxF -- "$TEAM_STATE_PATH" <<<"$changed_files"; then
    blocked=1
  fi
done

if [ "$blocked" -eq 1 ]; then
  cat >&2 <<EOF
check-team-state-updated: ${TEAM_STATE_PATH} 갱신이 감지되지 않았습니다.
PR 제출 전 ${TEAM_STATE_PATH}의 해당 기능 행(상태·PR·blocker)을 이 브랜치에서 갱신하세요.
문서 갱신이 정말 불필요한 사소한 변경이면 TEAM_STATE_SKIP=1 git push 로 우회하고 사유를 PR 본문에 적으세요.
EOF
  exit 1
fi

exit 0
