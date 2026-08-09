#!/usr/bin/env bash
# diagnose-collection.sh 계약 검사 — 합성 입력만 쓴다.
#
# 이 테스트는 실 DB·운영 자격증명·외부 서비스에 붙지 않는다(scripts/AGENTS.md).
# 진단 스크립트가 지켜야 하는 계약만 정적으로 검증한다:
#   1. 자격증명이 없으면 fail-closed 로 멈춘다
#   2. read-only 다 — 쓰기 구문이 없고 트랜잭션을 READ ONLY 로 연다
#   3. 공개 범위를 지킨다 — 저장소 이름·학생 식별자·접속 문자열을 출력하지 않는다
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
target="$script_dir/diagnose-collection.sh"

failures=0

fail() {
  echo "  FAIL: $1" >&2
  failures=$((failures + 1))
}

pass() {
  echo "  ok: $1"
}

require_grep() {
  local pattern=$1 description=$2
  if grep -Eq "$pattern" "$target"; then
    pass "$description"
  else
    fail "$description (패턴 없음: $pattern)"
  fi
}

refute_grep() {
  local pattern=$1 description=$2
  if grep -Eq "$pattern" "$target"; then
    fail "$description (금지 패턴 발견: $pattern)"
  else
    pass "$description"
  fi
}

echo "diagnose-collection 계약 검사"

# ── 존재와 실행 권한 ─────────────────────────────────────────────────────────
if [[ ! -f $target ]]; then
  echo "  FAIL: 대상 스크립트가 없다: $target" >&2
  exit 1
fi
if [[ ! -x $target ]]; then
  fail "실행 권한이 없다 — chmod +x 가 커밋에 포함돼야 한다"
else
  pass "실행 권한"
fi

# ── 1. fail-closed ──────────────────────────────────────────────────────────
require_grep '^set -euo pipefail$' "set -euo pipefail"

# DATABASE_URL 없이 돌리면 0이 아닌 코드로 멈춰야 한다. 합성 환경이라 DB 에 붙지 않는다.
set +e
output=$(env -u DATABASE_URL PATH="$PATH" bash "$target" 2>&1)
status=$?
set -e
if [[ $status -eq 0 ]]; then
  fail "DATABASE_URL 없이도 성공했다 — fail-closed 가 아니다"
else
  pass "DATABASE_URL 없으면 종료 코드 $status"
fi
if grep -q 'DATABASE_URL' <<<"$output"; then
  pass "누락 원인을 이름으로 알린다"
else
  fail "누락 원인을 알리지 않는다"
fi

# ── 2. read-only ────────────────────────────────────────────────────────────
require_grep 'BEGIN TRANSACTION READ ONLY' "read-only 트랜잭션으로 연다"

# 쓰기 구문이 SQL 문자열 안에 없어야 한다. 주석과 한글 설명은 대상이 아니므로
# SQL 키워드 형태(대문자 + 공백)로만 찾는다.
for verb in INSERT UPDATE DELETE DROP ALTER TRUNCATE GRANT CREATE; do
  refute_grep "\\b${verb}[[:space:]]+(INTO|FROM|TABLE|SET|SCHEMA|INDEX|DATABASE|ALL)\\b" \
    "쓰기 구문 없음: $verb"
done

# psql 은 반드시 ON_ERROR_STOP 으로 돈다 — 중간 실패를 삼키지 않는다.
require_grep 'ON_ERROR_STOP=1' "psql ON_ERROR_STOP"

# ── 3. 공개 범위 ────────────────────────────────────────────────────────────
# 저장소 이름과 학생 식별자를 SELECT 목록에 넣지 않는다.
# 이 저장소는 PUBLIC 이고 출력이 CI 로그·PR 본문으로 갈 수 있다(AGENTS.md §6).
for column in nameWithOwner githubLogin authorGithubLogin studentId email; do
  refute_grep "\"${column}\"" "개인·저장소 식별 칸 미조회: $column"
done

# 접속 문자열을 출력하지 않는다.
refute_grep "echo[^|]*[$]DATABASE_URL" "DATABASE_URL 값 미출력"
refute_grep "printf[^|]*[$]DATABASE_URL" "DATABASE_URL 값 미출력(printf)"

# 진단 4층이 모두 있어야 한다 — 하나라도 빠지면 후보를 못 가른다.
for layer in "O0 접근성" "O1 시간축" "O2 집합축" "O3 표면축"; do
  require_grep "$layer" "진단 층 존재: $layer"
done

# 후보 판정이 실제로 붙어 있는지 — 계획 §2 의 C1~C10 중 코드가 가르는 것들.
for candidate in C1 C2 C3 C4 C7 C9 C10; do
  require_grep "\\b${candidate}\\(" "후보 판정 문구: $candidate"
done

echo
if [[ $failures -gt 0 ]]; then
  echo "diagnose-collection 계약 검사 실패: ${failures}건" >&2
  exit 1
fi
echo "diagnose-collection 계약 검사 통과"
