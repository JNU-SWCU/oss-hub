#!/usr/bin/env bash
# Pre-push guard: the pushed range vs origin/main must change at least one
# member journal under docs/handoff/team-state/*.md.
# .githooks/pre-push is a thin wrapper. The hook must stay offline, so this
# script compares against the local refs/remotes/origin/main (or fallback) only.
# It does not check that journal contents match GitHub — that is the
# team-state-drift advisory job.
#
# stdin: git pre-push protocol —
#   <local ref> <local sha1> <remote ref> <remote sha1>  one line per ref
#
# Skipped: direct push to main (remote ref refs/heads/main), branch-delete
# push (local sha1 is all zeros).
# Bypass: TEAM_STATE_SKIP=1 (warn and skip the check — record the reason
# in the PR body).

set -euo pipefail

JOURNAL_PATH_PATTERN='docs/handoff/team-state/[^/]+\.md'
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
    continue # branch-delete push
  fi
  if [ "$remote_ref" = 'refs/heads/main' ]; then
    continue # direct push to main
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
  if ! printf '%s\n' "$changed_files" | grep -qxE -- "$JOURNAL_PATH_PATTERN"; then
    blocked=1
  fi
done

if [ "$blocked" -eq 1 ]; then
  cat >&2 <<EOF
check-team-state-updated: docs/handoff/team-state/ 저널 갱신이 감지되지 않았습니다.
PR 제출 전 작성자 저널(docs/handoff/team-state/)에 항목을 추가하세요.
문서 갱신이 정말 불필요한 사소한 변경이면 TEAM_STATE_SKIP=1 git push 로 우회하고 사유를 PR 본문에 적으세요.
EOF
  exit 1
fi

exit 0
