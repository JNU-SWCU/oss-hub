#!/usr/bin/env bash

set -euo pipefail

pick_utf8_locale() {
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
if [ "${1:-}" = "--event" ]; then
  shift
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request) event_fields='[.pull_request.title, .pull_request.body]' ;;
    issues | issue_comment)
      TEXT_ONLY=1
      event_fields='[.issue.title, .issue.body, .comment.body]'
      ;;
    *) echo "::error::public-safe 지원하지 않는 이벤트입니다." >&2; exit 2 ;;
  esac
  # Read at runtime: Actions prints step env values before scanners can redact them.
  if ! event_text="$(jq -er "$event_fields"' | map(. // "") | join("\n")' "${GITHUB_EVENT_PATH:-}" 2>/dev/null)"; then
    echo "::error::public-safe 이벤트 파일을 읽을 수 없습니다." >&2
    exit 2
  fi
  if [ "$TEXT_ONLY" -eq 0 ]; then
    PR_TEXT="$event_text" ISSUE_TEXT=''
  else
    PR_TEXT='' ISSUE_TEXT="$event_text"
  fi
fi
if [ "${1:-}" = "--text-only" ]; then
  TEXT_ONLY=1
  shift
fi

BASE_REF="${1:-origin/main}"
SELF=".github/check-public-safe.sh"
FAIL=0

if [ "$TEXT_ONLY" -eq 0 ]; then
  if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
    echo "::error::public-safe 기준 ref를 확인할 수 없습니다."
    exit 2
  fi
fi

PATTERNS=(
  '주민등록번호|(^|[^0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}($|[^0-9])'
  '전화번호|(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}($|[^0-9])'
  '개인 머신 경로|/Users/[A-Za-z0-9._-]+|/home/[a-z][a-z0-9._-]*|C:\\Users|(^|[[:space:]`":(=])/(private|tmp)/[^[:space:]/]'
  '내부 호스트|[[:alnum:]-]+\.internal($|[^[:alnum:]_.-])'
  '비공개 볼트 참조|obsidian://'
  '학번 추정(20으로 시작하는 연속 9자리)|(^|[^0-9])20[0-9]{7}($|[^0-9])'
)

EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
ALLOW_EMAIL_RE='^[0-9]+:(noreply@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9._%+-]+@users\.noreply\.github\.com|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(example|test|invalid|localhost)|[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)*example\.(com|org|net))$'
# Dotted candidates only: keep quoted and international-address detection
# without parsing or validating RFC addresses.
EMAIL_CANDIDATE_RE='("([^"\\]|\\.)*"|[^[:space:]@"]+)@([[:alnum:]][[:alnum:]-]*\.)+[[:alnum:]][[:alnum:]-]*[[:alnum:]]'
SPECIAL_EMAIL_RE='^[0-9]+:"|[^ -~]|@[^[:space:]@]*xn--'

FORBIDDEN_FILE_RE='(^|/)\.env(\..+)?$|\.(pem|key|p12|pfx|jks|keystore)$|(^|/)id_(rsa|ed25519|ecdsa|dsa)$|(^|/)\.netrc$|\.(sqlite3?|db|dump)$|(^|/)(credentials?|secrets?|creds)([._-][^/]*)?\.(md|txt|json|ya?ml|csv)$'
ALLOWED_FILE_RE='(^|/)\.env\.example$'

report() {
  echo "::error::public-safe 위반 [$1]"
  echo "$2"
  FAIL=1
}

line_evidence() {
  printf '%s\n' "$1" | cut -d: -f1 | sort -nu | sed 's/^/  line /'
}

safe_path_id() {
  local path="$1" digest
  if ! digest="$(printf '%s' "$path" | git hash-object --stdin 2>/dev/null)"; then
    return 1
  fi
  printf 'path-id:%s' "$digest"
}

is_forbidden_file() {
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

run_grep() {
  local output status=0
  output="$(grep "$@")" || status=$?
  if [ "$status" -gt 1 ]; then
    echo "::error::public-safe 텍스트 검사를 실행할 수 없습니다." >&2
    return 2
  fi
  printf '%s' "$output"
}

scan_email() {
  local src="$1" text="$2" addresses candidates special
  addresses="$(printf '%s\n' "$text" | run_grep -EIno "$EMAIL_RE" |
    run_grep -Eiv "$ALLOW_EMAIL_RE")" || return 2
  candidates="$(printf '%s\n' "$text" | run_grep -EIno "$EMAIL_CANDIDATE_RE")" || return 2
  special="$(printf '%s\n' "$candidates" | LC_ALL=C run_grep -Ei "$SPECIAL_EMAIL_RE")" || return 2
  if [ -n "$addresses$special" ]; then
    report "이메일 @ $src" "$(line_evidence "$addresses${addresses:+${special:+$'\n'}}$special")"
  fi
  return 0
}

scan_text() {
  local src="$1" scan_credentials="${2:-1}" text entry label re hits name status=0
  text="$(cat)" || return 2
  [ -z "$text" ] && return 0
  for entry in "${PATTERNS[@]}"; do
    label="${entry%%|*}"
    re="${entry#*|}"
    hits="$(printf '%s\n' "$text" | run_grep -EIn "$re")" || return 2
    if [ -n "$hits" ]; then
      report "$label @ $src" "$(line_evidence "$hits")"
    fi
  done

  scan_email "$src" "$text" || return 2

  # Caller-supplied only: the public PR and issue workflows do not receive this list.
  if [ -n "${BLOCKED_NAMES:-}" ]; then
    local names name_patterns=()
    IFS=, read -r -d '' -a names < <(printf '%s\0' "$BLOCKED_NAMES")
    for name in "${names[@]}"; do
      name="$(printf '%s' "$name" | sed 's/^ *//;s/ *$//')"
      [ -z "$name" ] && continue
      name_patterns+=(-e "$name")
    done
    if [ "${#name_patterns[@]}" -gt 0 ]; then
      hits="$(printf '%s\n' "$text" | run_grep -Fn "${name_patterns[@]}")" || return 2
      if [ -n "$hits" ]; then
        report "실명 @ $src" "$(line_evidence "$hits")"
      fi
    fi
  fi
  # File credentials are already covered by the caller's gitleaks git scan.
  [ "$scan_credentials" -eq 0 ] && return 0
  printf '%s\n' "$text" | gitleaks stdin --no-banner --redact \
    --ignore-gitleaks-allow --exit-code 3 >/dev/null 2>&1 || status=$?
  case "$status" in
    0) ;;
    3) report "시크릿 @ $src" "  gitleaks stdin: secret detected" ;;
    *)
      echo "::error::public-safe gitleaks 검사를 실행할 수 없습니다." >&2
      return 2
      ;;
  esac
  return 0
}

if [ "$TEXT_ONLY" -eq 0 ]; then
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
  bad_files=()
  while IFS= read -r -d '' f; do
    [ "$f" = "$SELF" ] && continue
    [ "$f" = "pnpm-lock.yaml" ] && continue
    if ! file_id="$(safe_path_id "$f")"; then
      echo "::error::public-safe 변경 파일 식별자를 만들 수 없습니다."
      exit 2
    fi
    if is_forbidden_file "$f"; then
      bad_files+=("$file_id")
    fi
    if ! file_text="$(
      git show "HEAD:$f" 2>/dev/null |
        case "$f" in
          *.webp | *.ico)
            # A NUL marks a binary image. Drain the pipe so Git can finish.
            if LC_ALL=C IFS= read -r -d '' image_text; then
              cat >/dev/null
            else
              printf '%s' "$image_text"
            fi
            ;;
          *) LC_ALL=C tr -d '\000' ;;
        esac
    )"; then
      echo "::error::public-safe 변경 파일 blob을 읽을 수 없습니다."
      exit 2
    fi
    scan_text "파일 $file_id" 0 <<<"$file_text"
  done <"$changed_file_list"

  if [ "${#bad_files[@]}" -gt 0 ]; then
    report "금지 파일(.env 실값·개인키·로컬 DB류)" \
      "$(printf '  %s\n' "${bad_files[@]}")"
    echo "  → env 실값은 secret store에, 실데이터는 repo 밖 격리 경로에 둔다"
  fi

  # Ignore only GitHub's generated hash-only subject, never a merge's human text.
  if ! commit_text="$(git log --format='%s%n%b' "$BASE_REF"..HEAD \
    | sed -E '/^Merge [0-9a-f]{40} into [0-9a-f]{40}$/d')"; then
    echo "::error::public-safe 커밋 메시지를 읽을 수 없습니다."
    exit 2
  fi
  scan_text "커밋 메시지" <<<"$commit_text"

  scan_text "PR 제목·본문" <<<"${PR_TEXT:-}"
fi

scan_text "Issue 본문·댓글" <<<"${ISSUE_TEXT:-}"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "public-safe deny-list 위반이 감지되었습니다. 해당 값을 제거한 뒤 다시 push하세요."
  echo "이미 push된 자격증명은 즉시 폐기·재발급하고, 노출된 공개 이력과 로그도 정리하세요. 값만 삭제해도 기존 자격증명은 무효화되지 않습니다."
  exit 1
fi
if [ "$TEXT_ONLY" -eq 1 ]; then
  echo "public-safe 검사 통과 (Issue 본문·댓글)"
else
  echo "public-safe 검사 통과 (기준: $BASE_REF...HEAD)"
fi
