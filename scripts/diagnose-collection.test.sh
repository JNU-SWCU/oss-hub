#!/usr/bin/env bash
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

if [[ ! -f $target ]]; then
  echo "  FAIL: 대상 스크립트가 없다: $target" >&2
  exit 1
fi
if [[ ! -x $target ]]; then
  fail "실행 권한이 없다 — chmod +x 가 커밋에 포함돼야 한다"
else
  pass "실행 권한"
fi

require_grep '^set -euo pipefail$' "set -euo pipefail"

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

require_grep 'default_transaction_read_only=on' "read-only 를 세션 기본값으로 잠근다"
refute_grep '--command="BEGIN' "psql 명령에 BEGIN 을 넣지 않는다"

for verb in INSERT UPDATE DELETE DROP ALTER TRUNCATE GRANT CREATE; do
  refute_grep "\\b${verb}[[:space:]]+(INTO|FROM|TABLE|SET|SCHEMA|INDEX|DATABASE|ALL)\\b" \
    "쓰기 구문 없음: $verb"
done

require_grep 'ON_ERROR_STOP=1' "psql ON_ERROR_STOP"

for column in nameWithOwner githubLogin authorGithubLogin studentId email; do
  refute_grep "\"${column}\"" "개인·저장소 식별 칸 미조회: $column"
done

refute_grep "echo[^|]*[$]DATABASE_URL" "DATABASE_URL 값 미출력"
refute_grep "printf[^|]*[$]DATABASE_URL" "DATABASE_URL 값 미출력(printf)"

for layer in "O0 접근성" "O1 시간축" "O2 집합축" "O3 표면축"; do
  require_grep "$layer" "진단 층 존재: $layer"
done

for candidate in C1 C2 C3 C4 C7 C9 C10; do
  require_grep "\\b${candidate}\\(" "후보 판정 문구: $candidate"
done

stub_dir=$(mktemp -d)
trap 'rm -rf "$stub_dir"' EXIT
cat >"$stub_dir/psql" <<'STUB'
#!/usr/bin/env bash
command=""
for arg in "$@"; do
  case $arg in
    --command=*) command=${arg#--command=} ;;
  esac
done
[[ $command == *BEGIN* ]] && echo "BEGIN"
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
