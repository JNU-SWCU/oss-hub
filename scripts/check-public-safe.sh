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
#   scripts/check-public-safe.sh [BASE_REF]     # 기본값 origin/main. PR diff·커밋 메시지·PR_TEXT 검사
#   scripts/check-public-safe.sh --text-only    # git 컨텍스트 없이 ISSUE_TEXT만 검사 (Issue 본문·댓글)
#
# 검사 대상 5종 (deny-list가 정의한 공개 표면):
#   0) 커밋된 파일 경로 자체 — .env·개인키·DB 파일 등 존재만으로 유출인 파일
#      (.gitignore가 막지만 `git add -f`로 우회 가능하므로 CI에서 재차단) — full 모드만
#   1) BASE_REF...HEAD 에서 추가·수정된 파일 내용 — full 모드만
#   2) BASE_REF..HEAD  커밋 메시지 — full 모드만
#   3) $PR_TEXT        (CI가 PR 제목+본문을 주입) — full 모드만
#   4) $ISSUE_TEXT     (CI가 Issue/댓글 제목+본문을 주입) — 두 모드 모두
#
# 실명 차단:
#   실명 목록 파일을 repo에 두면 그 자체가 deny-list 1번(실명) 위반이므로,
#   `BLOCKED_NAMES`(쉼표 구분)는 신뢰된 수동 실행에서만 주입한다.
#   pull_request CI는 PR-controlled script에 repository secret을 전달하지 않는다.

set -euo pipefail

# POSIX 문자 클래스([:alnum:] 등)의 Unicode 판정은 로케일에 의존한다. 이 스크립트는
# 로컬 훅과 CI 양쪽에서 실행되는 보안 게이트이므로 실행 환경이 물려준 로케일에 기대지
# 않고 스스로 UTF-8 로케일을 고정한다. 사용 가능한 UTF-8 로케일이 하나도 없으면
# 조용히 넘어가지 않고 즉시 실패한다(fail-closed).
pick_utf8_locale() { # 이식성을 위해 후보를 복수로 두고 locale -a로 실제 지원 여부를 확인
  local candidates=(C.UTF-8 en_US.UTF-8 en_US.utf8 C.utf8 UTF-8) cand available
  if ! available="$(locale -a 2>/dev/null)"; then
    return 1
  fi
  for cand in "${candidates[@]}"; do
    if printf '%s\n' "$available" | grep -qiFx "$cand"; then
      printf '%s' "$cand"
      return 0
    fi
  done
  return 1
}

if ! UTF8_LOCALE="$(pick_utf8_locale)"; then
  echo "::error::public-safe 사용 가능한 UTF-8 로케일을 찾을 수 없습니다(locale -a로 확인 요망). 이메일 후보 검사가 로케일에 따라 바이트 단위로 오동작할 수 있어 fail-closed로 중단합니다." >&2
  exit 2
fi
export LC_ALL="$UTF8_LOCALE"

TEXT_ONLY=0
if [ "${1:-}" = "--text-only" ]; then
  TEXT_ONLY=1
  shift
fi

BASE_REF="${1:-origin/main}"
SELF="scripts/check-public-safe.sh"
FAIL=0

if [ "$TEXT_ONLY" -eq 0 ]; then
  if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
    echo "::error::public-safe 기준 ref를 확인할 수 없습니다."
    exit 2
  fi
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

# quoted·비ASCII·IDN 보조 검사는 "점으로 구분된 도메인 + 2자 이상 마지막 label"을 가진
# 토큰만 이메일 후보로 본다. 점 없는 GitHub handle, 멘션 나열, 셸 변수와 말줄임표를
# 연락처로 오인하지 않는 것이 이 보조 검사의 우선 경계다. local part는 quoted/EAI를
# 보수적으로 잡기 위해 관대하게 두되, domain은 Unicode 문자를 포함한 영숫자·하이픈
# label만 허용한다. 점 없는 사내 도메인 형태는 자동 검사의 대상이 아니라 리뷰 경계다.
PERMISSIVE_LOCAL_RE='[^[:space:]@"]+'
QUOTED_LOCAL_RE='"([^"\\]|\\.)*"'
DOMAIN_LABEL_RE='[[:alnum:]][[:alnum:]-]*'
DOMAIN_TLD_RE='[[:alnum:]][[:alnum:]-]*[[:alnum:]]'
DOTTED_DOMAIN_RE="$DOMAIN_LABEL_RE(\\.$DOMAIN_LABEL_RE)*\\.$DOMAIN_TLD_RE"
CANDIDATE_EMAIL_RE='('"$QUOTED_LOCAL_RE"'|'"$PERMISSIVE_LOCAL_RE"')@'"$DOTTED_DOMAIN_RE"

# 존재 자체가 유출인 파일 — env 실값, 개인키·인증서 키, 로컬 DB·덤프(실데이터 반입 금지, deny-list 6번),
# 그리고 자격증명을 모아두는 관례적 메모 파일. 후자는 확장자가 문서라 내용 스캔만으로는
# 늦게 잡히므로 파일명 단계에서 차단한다(AGENTS.md §4 시크릿 반입 금지).
FORBIDDEN_FILE_RE='(^|/)\.env(\..+)?$|\.(pem|key|p12|pfx|jks|keystore)$|(^|/)id_(rsa|ed25519|ecdsa|dsa)$|(^|/)\.netrc$|\.(sqlite3?|db|dump)$|(^|/)(credentials?|secrets?|creds)([._-][^/]*)?\.(md|txt|json|ya?ml|csv)$'
ALLOWED_FILE_RE='(^|/)\.env\.example$'

report() { # $1=라벨 $2=매치 내용
  echo "::error::public-safe 위반 [$1]"
  echo "$2"
  FAIL=1
}

safe_path_id() { # 파일명 원문을 로그에 내보내지 않는 안정적 식별자
  local path="$1" digest
  if ! digest="$(printf '%s' "$path" | git hash-object --stdin 2>/dev/null)"; then
    return 1
  fi
  printf 'path-id:%s' "$digest"
}

is_forbidden_file() { # 금지 확장자는 대소문자 무관, 허용 예외는 정확한 소문자만
  local path="$1" matched=1 nocase_was_set=0
  if shopt -q nocasematch; then
    nocase_was_set=1
  fi

  shopt -s nocasematch
  if [[ "$path" =~ $FORBIDDEN_FILE_RE ]]; then
    matched=0
  fi
  shopt -u nocasematch

  if [ "$matched" -eq 0 ] && [[ "$path" =~ $ALLOWED_FILE_RE ]]; then
    matched=1
  fi

  if [ "$nocase_was_set" -eq 1 ]; then
    shopt -s nocasematch
  fi
  return "$matched"
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
  local candidates quoted_candidates non_ascii_candidates punycode_candidates unsupported_candidates
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

  # EAI·Unicode domain은 허용 예외로 지원하지 않는다. 비ASCII email-shaped token과
  # punycode IDN 후보는 ASCII 이메일 허용 목록보다 우선해 보수적으로 차단한다.
  if candidates="$(printf '%s\n' "$text" | run_grep -EIno "$CANDIDATE_EMAIL_RE")"; then
    unsupported_candidates=""
    if quoted_candidates="$(printf '%s\n' "$candidates" | run_grep -E '^[0-9]+:"')"; then
      unsupported_candidates="$quoted_candidates"
    else
      status=$?
      [ "$status" -eq 1 ] || return 2
    fi
    if non_ascii_candidates="$(printf '%s\n' "$candidates" | LC_ALL=C run_grep -E '[^ -~]')"; then
      unsupported_candidates="${unsupported_candidates}${unsupported_candidates:+$'\n'}${non_ascii_candidates}"
    else
      status=$?
      [ "$status" -eq 1 ] || return 2
    fi
    if punycode_candidates="$(printf '%s\n' "$candidates" | run_grep -Ei '@[^[:space:]@]*xn--')"; then
      unsupported_candidates="${unsupported_candidates}${unsupported_candidates:+$'\n'}${punycode_candidates}"
    else
      status=$?
      [ "$status" -eq 1 ] || return 2
    fi
    if [ -n "$unsupported_candidates" ]; then
      evidence="$(printf '%s\n' "$unsupported_candidates" | cut -d: -f1 | sort -nu | sed 's/^/  line /')"
      report "quoted·비ASCII·IDN 이메일 후보 @ $src" "$evidence"
    fi
  else
    status=$?
    [ "$status" -eq 1 ] || return 2
  fi

  if [ -n "${BLOCKED_NAMES:-}" ]; then
    local OLDIFS="$IFS"
    IFS=','
    for name in $BLOCKED_NAMES; do
      IFS="$OLDIFS"
      name="$(printf '%s' "$name" | sed 's/^ *//;s/ *$//')"
      [ -z "$name" ] && continue
      if name_hits="$(printf '%s\n' "$text" | run_grep -Fn -- "$name")"; then
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

if [ "$TEXT_ONLY" -eq 0 ]; then
  # 1) 변경 파일 내용 (신규 A·복사 C·수정 M·이름변경 R만 — 삭제 제외)
  #    자기 자신(패턴 정의)과 lockfile(해시 오탐)은 제외
  if ! changed_file_list="$(mktemp "${TMPDIR:-/tmp}/public-safe-files.XXXXXX")"; then
    echo "::error::public-safe 임시 파일을 만들 수 없습니다."
    exit 2
  fi
  trap 'rm -f "$changed_file_list"' EXIT
  if ! git diff --name-only -z --diff-filter=ACMR "$BASE_REF"...HEAD -- \
    >"$changed_file_list"; then
    echo "::error::public-safe 변경 파일 목록을 읽을 수 없습니다."
    exit 2
  fi
  changed_files=()
  changed_file_ids=()
  changed_file_count=0
  while IFS= read -r -d '' f; do
    [ "$f" = "$SELF" ] && continue
    [ "$f" = "pnpm-lock.yaml" ] && continue
    if ! file_id="$(safe_path_id "$f")"; then
      echo "::error::public-safe 변경 파일 식별자를 만들 수 없습니다."
      exit 2
    fi
    changed_files+=("$f")
    changed_file_ids+=("$file_id")
    changed_file_count=$((changed_file_count + 1))
    if ! file_text="$(git show "HEAD:$f" 2>/dev/null)"; then
      echo "::error::public-safe 변경 파일 blob을 읽을 수 없습니다."
      exit 2
    fi
    scan_text "파일 $file_id" <<<"$file_text"
  done <"$changed_file_list"

  # 0) 금지 파일 경로 — 내용과 무관하게 커밋 자체를 차단
  bad_files=()
  bad_file_count=0
  if [ "$changed_file_count" -gt 0 ]; then
    for ((i = 0; i < changed_file_count; i++)); do
      f="${changed_files[$i]}"
      if is_forbidden_file "$f"; then
        bad_files+=("${changed_file_ids[$i]}")
        bad_file_count=$((bad_file_count + 1))
      fi
    done
  fi
  if [ "$bad_file_count" -gt 0 ]; then
    report "금지 파일(.env 실값·개인키·로컬 DB류)" \
      "$(printf '  %s\n' "${bad_files[@]}")"
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
fi

# 4) Issue·댓글 제목+본문 (CI에서 env로 주입 — text-only 모드, issues·issue_comment 이벤트)
scan_text "Issue 본문·댓글" <<<"${ISSUE_TEXT:-}"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "docs/rules/security.md deny-list 위반이 감지되었습니다. 해당 값을 제거한 뒤 다시 push하세요."
  echo "이미 push된 커밋에 포함됐다면 삭제가 아니라 security.md의 '유출 사고 절차'를 따르세요."
  exit 1
fi
if [ "$TEXT_ONLY" -eq 1 ]; then
  echo "public-safe 검사 통과 (Issue 본문·댓글)"
else
  echo "public-safe 검사 통과 (기준: $BASE_REF...HEAD)"
fi
