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

# `--` 로 패턴과 옵션을 가른다. 이게 없으면 `--command=...` 같은 패턴을 grep 이
# 옵션으로 먹고 조용히 참을 돌려준다 — 검사가 통과처럼 보이는 가장 나쁜 실패다.
require_grep() {
  local pattern=$1 description=$2
  if grep -Eq -- "$pattern" "$target"; then
    pass "$description"
  else
    fail "$description (패턴 없음: $pattern)"
  fi
}

refute_grep() {
  local pattern=$1 description=$2
  if grep -Eq -- "$pattern" "$target"; then
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
# 서버측 세션 기본값으로 잠근다. 명시적 `BEGIN`/`COMMIT` 은 psql 이 명령 태그를
# stdout 에 찍어 값으로 오독되므로 쓰지 않는다(아래 동작 회귀가 이를 고정한다).
require_grep 'default_transaction_read_only=on' "read-only 를 세션 기본값으로 잠근다"
refute_grep '--command="BEGIN' "psql 명령에 BEGIN 을 넣지 않는다"

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

# ── 5. 동작 회귀 — 관측값에 psql 명령 태그가 섞이지 않는다 ────────────────────
#
# 정적 grep 은 이 결함을 못 잡았다. `BEGIN TRANSACTION READ ONLY; ... COMMIT;` 를
# 한 `--command` 로 보내면 psql 이 `--tuples-only` 로도 `BEGIN`/`COMMIT` 태그를
# stdout 에 찍고, 스크립트가 그 줄을 값으로 읽어 `EXTERNAL_PUBLIC=BEGIN` 같은
# 거짓 관측을 냈다. 프로덕션에서 실제로 그렇게 나왔다.
#
# 그래서 실 psql 의 그 동작을 흉내내는 stub 을 PATH 앞에 두고 한 번 돌린다.
# stub 은 자격증명도 네트워크도 쓰지 않는다(scripts/AGENTS.md).
stub_dir=$(mktemp -d)
trap 'rm -rf "$stub_dir"' EXIT
cat >"$stub_dir/psql" <<'STUB'
#!/usr/bin/env bash
# 실 psql 처럼, 명령 안에 BEGIN/COMMIT 이 있으면 태그를 그대로 찍는다.
command=""
for arg in "$@"; do
  case $arg in
    --command=*) command=${arg#--command=} ;;
  esac
done
[[ $command == *BEGIN* ]] && echo "BEGIN"
# 관측값 자리에는 항상 합성 숫자만 돌려준다.
echo "0"
[[ $command == *COMMIT* ]] && echo "COMMIT"
exit 0
STUB
chmod +x "$stub_dir/psql"

if diagnostic_output=$(
  PATH="$stub_dir:$PATH" DATABASE_URL='postgresql://synthetic/synthetic' \
    bash "$target" 2>&1
); then
  :
fi
if grep -Eq '\b(BEGIN|COMMIT)\b' <<<"$diagnostic_output"; then
  fail "관측 출력에 psql 명령 태그가 섞인다"
else
  pass "관측 출력에 psql 명령 태그가 섞이지 않는다"
fi

echo
if [[ $failures -gt 0 ]]; then
  echo "diagnose-collection 계약 검사 실패: ${failures}건" >&2
  exit 1
fi
echo "diagnose-collection 계약 검사 통과"
