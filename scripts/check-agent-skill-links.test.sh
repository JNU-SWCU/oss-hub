#!/usr/bin/env bash
# check-agent-skill-links.sh 계약 회귀 — 합성 fixture 루트만 쓴다.
# 실제 저장소 상태에 의존하지 않으며 외부 서비스·실데이터를 참조하지 않는다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="$ROOT/scripts/check-agent-skill-links.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-skill-links-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

failures=0

report_pass() { printf '  ok   %s\n' "$1"; }

report_fail() {
  printf '  FAIL %s\n' "$1" >&2
  failures=$((failures + 1))
}

# 원본 스킬과 세 런타임 링크가 정상인 fixture를 만든다.
make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/skills/manage-qa-tickets"
  printf '# fixture skill\n' >"$dir/skills/manage-qa-tickets/SKILL.md"
  local runtime
  for runtime in .claude .cursor .codex; do
    mkdir -p "$dir/$runtime/skills"
    ln -s ../../skills/manage-qa-tickets "$dir/$runtime/skills/manage-qa-tickets"
  done
}

expect_exit() {
  local label="$1" expected="$2" dir="$3"
  local actual=0
  bash "$CHECKER" "$dir" >"$TEMP_ROOT/out.log" 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    report_pass "$label"
  else
    report_fail "$label (기대 exit $expected, 실제 $actual)"
    sed 's/^/       /' "$TEMP_ROOT/out.log" >&2
  fi
}

# 1) 세 링크가 모두 원본을 가리키면 통과한다.
fixture="$TEMP_ROOT/valid"
make_fixture "$fixture"
expect_exit '정상 링크 세 개는 통과한다' 0 "$fixture"

# 2) 링크가 없으면 실패한다 — 그 런타임은 스킬을 못 찾는다.
fixture="$TEMP_ROOT/missing"
make_fixture "$fixture"
rm "$fixture/.codex/skills/manage-qa-tickets"
expect_exit '링크가 없으면 실패한다' 1 "$fixture"

# 3) 링크 대신 사본을 두면 실패한다 — 사본은 원본과 갈라진다.
fixture="$TEMP_ROOT/copy"
make_fixture "$fixture"
rm "$fixture/.cursor/skills/manage-qa-tickets"
mkdir -p "$fixture/.cursor/skills/manage-qa-tickets"
printf '# 갈라진 사본\n' >"$fixture/.cursor/skills/manage-qa-tickets/SKILL.md"
expect_exit '사본은 실패한다' 1 "$fixture"

# 4) 절대 경로 링크는 실패한다 — 남의 checkout에서 깨지고 개인 경로가 남는다.
fixture="$TEMP_ROOT/absolute"
make_fixture "$fixture"
rm "$fixture/.claude/skills/manage-qa-tickets"
ln -s "$fixture/skills/manage-qa-tickets" "$fixture/.claude/skills/manage-qa-tickets"
expect_exit '절대 경로 링크는 실패한다' 1 "$fixture"

# 4-1) 절대 경로 실패 메시지에 링크 대상 경로 자체가 새지 않는다.
bash "$CHECKER" "$fixture" >"$TEMP_ROOT/absolute.log" 2>&1 || true
if grep -q "$fixture/skills/manage-qa-tickets" "$TEMP_ROOT/absolute.log"; then
  report_fail '절대 경로 실패 메시지가 링크 대상 경로를 출력한다'
else
  report_pass '절대 경로 실패 메시지는 링크 대상 경로를 출력하지 않는다'
fi

# 5) 끊어진 링크는 실패한다.
fixture="$TEMP_ROOT/broken"
make_fixture "$fixture"
rm "$fixture/.codex/skills/manage-qa-tickets"
ln -s ../../skills/does-not-exist "$fixture/.codex/skills/manage-qa-tickets"
expect_exit '끊어진 링크는 실패한다' 1 "$fixture"

# 6) 다른 스킬을 가리키는 링크는 실패한다 — 원본이 하나여야 한다.
fixture="$TEMP_ROOT/wrong-target"
make_fixture "$fixture"
mkdir -p "$fixture/skills/other-skill"
printf '# 다른 스킬\n' >"$fixture/skills/other-skill/SKILL.md"
rm "$fixture/.cursor/skills/manage-qa-tickets"
ln -s ../../skills/other-skill "$fixture/.cursor/skills/manage-qa-tickets"
expect_exit '다른 스킬을 가리키면 실패한다' 1 "$fixture"

# 7) 원본 자체가 없으면 링크 검사 전에 멈춘다.
fixture="$TEMP_ROOT/no-canonical"
make_fixture "$fixture"
rm "$fixture/skills/manage-qa-tickets/SKILL.md"
expect_exit '원본이 없으면 멈춘다' 1 "$fixture"

# 8) 링크가 원본을 통해 SKILL.md 를 실제로 읽을 수 있어야 한다.
fixture="$TEMP_ROOT/reads-entrypoint"
make_fixture "$fixture"
if [ ! -f "$fixture/.codex/skills/manage-qa-tickets/SKILL.md" ]; then
  report_fail 'fixture 링크로 SKILL.md 를 읽지 못한다'
else
  report_pass '링크를 통해 SKILL.md 를 읽는다'
fi

# 9) 이 저장소의 실제 상태도 계약을 지킨다.
expect_exit '이 저장소의 실제 링크가 계약을 지킨다' 0 "$ROOT"

if [ "$failures" -ne 0 ]; then
  printf 'check-agent-skill-links.test.sh: %d건 실패.\n' "$failures" >&2
  exit 1
fi

printf 'check-agent-skill-links.test.sh: 모든 계약 통과.\n'
