#!/usr/bin/env bash
# public-safe 검사 — docs/rules/security.md deny-list 중 기계 검사 가능한 항목을 CI에서 강제한다.
#
# "프롬프트·눈검사만으로는 부족하다"는 벤더 공식 권고의 구현:
#   - OpenAI, A Practical Guide to Building Agents (Guardrails):
#     "Think of guardrails as a layered defense mechanism." + rules-based(regex) 가드레일 병행 권고
#     https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
#   - Anthropic, Claude Code hooks:
#     "Hooks ... provide deterministic control ... rather than relying on the LLM"
#     https://code.claude.com/docs/en/hooks-guide
#
# 패턴 출처 (기성 검증형 regex 채택):
#   - 주민등록번호: 생년월일 유효성(월 01-12, 일 01-31) + 뒷자리 첫 숫자 1-8(내국인 1-4, 외국인 5-8)
#     통용 검증형: \d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-?[1-8]\d{6}
#     참고: https://owen-cho-sik.github.io/java/regexp/ , gitleaks 커스텀 룰 관행
#   - 휴대폰번호: 01[016789] 국번 검증형 (통용 패턴)
#   - 여권번호([MSRODG]\d{8})·계좌번호는 오탐율이 높아 제외 — 필요 시 keyword 문맥과 함께 추가
#
# 사용법:
#   scripts/check-public-safe.sh [BASE_REF]     # 기본값 origin/main
#
# 검사 대상 4종 (deny-list가 정의한 공개 표면):
#   0) 커밋된 파일 경로 자체 — .env·개인키·DB 파일 등 존재만으로 유출인 파일
#      (.gitignore가 막지만 `git add -f`로 우회 가능하므로 CI에서 재차단)
#   1) BASE_REF...HEAD 에서 추가·수정된 파일 내용
#   2) BASE_REF..HEAD  커밋 메시지
#   3) $PR_TEXT        (CI가 PR 제목+본문을 주입)
#
# 실명 차단:
#   실명 목록 파일을 repo에 두면 그 자체가 deny-list 1번(실명) 위반이므로,
#   목록은 GitHub repo secret `BLOCKED_NAMES` (쉼표 구분)로만 주입한다.

set -euo pipefail

BASE_REF="${1:-origin/main}"
SELF="scripts/check-public-safe.sh"
FAIL=0

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "::error::public-safe 기준 ref를 확인할 수 없습니다."
  exit 2
fi

# "라벨|extended regex" — 첫 번째 |까지가 라벨, 나머지가 정규식. 새 금지 패턴은 한 줄 추가.
PATTERNS=(
  '주민등록번호|(^|[^0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}($|[^0-9])'
  '전화번호|(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}($|[^0-9])'
  '이메일|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '개인 머신 경로|/Users/[A-Za-z0-9._-]+|/home/[a-z][a-z0-9._-]*|C:\\Users'
  '학번 추정(20으로 시작하는 연속 9자리)|(^|[^0-9])20[0-9]{7}($|[^0-9])'
)

# 이메일 매치 중 허용할 예외 — 봇 이메일, 문서용 예시 도메인 (RFC 2606 reserved)
# grep -n 출력의 "line:email" 전체를 고정해 유사 도메인의 부분 일치를 막는다.
ALLOW_EMAIL_RE='^[0-9]+:(noreply@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9._%+-]+@users\.noreply\.github\.com|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(example|test|invalid|localhost)|[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)*example\.(com|org|net))$'

# 존재 자체가 유출인 파일 — env 실값, 개인키·인증서 키, 로컬 DB·덤프(실데이터 반입 금지, deny-list 6번)
FORBIDDEN_FILE_RE='(^|/)\.env(\..+)?$|\.(pem|key|p12|pfx|jks|keystore)$|(^|/)id_(rsa|ed25519|ecdsa|dsa)$|(^|/)\.netrc$|\.(sqlite3?|db|dump)$'
ALLOWED_FILE_RE='(^|/)\.env\.example$'

report() { # $1=라벨 $2=매치 내용
  echo "::error::public-safe 위반 [$1]"
  echo "$2"
  FAIL=1
}

run_grep() { # grep의 1(매치 없음)과 2+(검사 오류)를 구분한다.
  local output status
  if output="$(grep "$@")"; then
    printf '%s' "$output"
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 1 ] && return 1
  echo "::error::public-safe 텍스트 검사를 실행할 수 없습니다." >&2
  return 2
}

scan_text() { # $1=출처 라벨, stdin=텍스트
  local src="$1" text entry label re hits filtered evidence name name_hits status
  text="$(cat)"
  [ -z "$text" ] && return 0
  for entry in "${PATTERNS[@]}"; do
    label="${entry%%|*}"
    re="${entry#*|}"
    if [ "$label" = "이메일" ]; then
      if hits="$(printf '%s\n' "$text" | run_grep -EIno "$re")"; then
        if filtered="$(printf '%s\n' "$hits" | run_grep -Eiv "$ALLOW_EMAIL_RE")"; then
          hits="$filtered"
        else
          status=$?
          [ "$status" -eq 1 ] && hits="" || return 2
        fi
      else
        status=$?
        [ "$status" -eq 1 ] && hits="" || return 2
      fi
    else
      if hits="$(printf '%s\n' "$text" | run_grep -EIn "$re")"; then
        :
      else
        status=$?
        [ "$status" -eq 1 ] && hits="" || return 2
      fi
    fi
    if [ -n "$hits" ]; then
      evidence="$(printf '%s\n' "$hits" | cut -d: -f1 | sort -nu | sed 's/^/  line /')"
      report "$label @ $src" "$evidence"
    fi
  done
  if [ -n "${BLOCKED_NAMES:-}" ]; then
    local OLDIFS="$IFS"
    IFS=','
    for name in $BLOCKED_NAMES; do
      IFS="$OLDIFS"
      name="$(printf '%s' "$name" | sed 's/^ *//;s/ *$//')"
      [ -z "$name" ] && continue
      if name_hits="$(printf '%s\n' "$text" | run_grep -Fn "$name")"; then
        # 이름 자체를 로그에 남기면 그것도 유출이므로 라인 번호만 출력
        report "실명 @ $src" "$(printf '%s\n' "$name_hits" | cut -d: -f1 | sed 's/^/  line /')"
      else
        status=$?
        [ "$status" -eq 1 ] || return 2
      fi
    done
    IFS="$OLDIFS"
  fi
  return 0
}

# 1) 변경 파일 내용 (신규 A·복사 C·수정 M·이름변경 R만 — 삭제 제외)
#    자기 자신(패턴 정의)과 lockfile(해시 오탐)은 제외
if ! changed_all="$(git diff --name-only --diff-filter=ACMR "$BASE_REF"...HEAD --)"; then
  echo "::error::public-safe 변경 파일 목록을 읽을 수 없습니다."
  exit 2
fi
if changed="$(printf '%s\n' "$changed_all" \
  | run_grep -v -e "^${SELF}\$" -e '^pnpm-lock\.yaml$')"; then
  :
else
  status=$?
  [ "$status" -eq 1 ] && changed="" || exit 2
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! file_text="$(git show "HEAD:$f")"; then
    echo "::error::public-safe 변경 파일 blob을 읽을 수 없습니다."
    exit 2
  fi
  scan_text "파일 $f" <<<"$file_text"
done <<EOF
$changed
EOF

# 0) 금지 파일 경로 — 내용과 무관하게 커밋 자체를 차단
if bad_files="$(printf '%s\n' "$changed" | run_grep -E "$FORBIDDEN_FILE_RE")"; then
  if bad_files="$(printf '%s\n' "$bad_files" | run_grep -Ev "$ALLOWED_FILE_RE")"; then
    :
  else
    status=$?
    [ "$status" -eq 1 ] && bad_files="" || exit 2
  fi
else
  status=$?
  [ "$status" -eq 1 ] && bad_files="" || exit 2
fi
if [ -n "$bad_files" ]; then
  report "금지 파일(.env 실값·개인키·로컬 DB류)" "$bad_files"
  echo "  → env 실값은 secret store에, 실데이터는 repo 밖 격리 경로에 둔다 (docs/rules/security.md)"
fi

# 2) 커밋 메시지
if ! commit_text="$(git log --format='%h %s%n%b' "$BASE_REF"..HEAD)"; then
  echo "::error::public-safe 커밋 메시지를 읽을 수 없습니다."
  exit 2
fi
scan_text "커밋 메시지" <<<"$commit_text"

# 3) PR 제목·본문 (CI에서 env로 주입)
scan_text "PR 제목·본문" <<<"${PR_TEXT:-}"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "docs/rules/security.md deny-list 위반이 감지되었습니다. 해당 값을 제거한 뒤 다시 push하세요."
  echo "이미 push된 커밋에 포함됐다면 삭제가 아니라 security.md의 '유출 사고 절차'를 따르세요."
  exit 1
fi
echo "public-safe 검사 통과 (기준: $BASE_REF...HEAD)"
