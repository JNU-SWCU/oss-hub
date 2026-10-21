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

PATTERNS=(
  '주민등록번호|(^|[^0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}($|[^0-9])'
  '전화번호|(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}($|[^0-9])'
  '이메일|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '개인 머신 경로|/Users/[A-Za-z0-9._-]+|/home/[a-z][a-z0-9._-]*|C:\\Users'
  '학번 추정(20으로 시작하는 연속 9자리)|(^|[^0-9])20[0-9]{7}($|[^0-9])'
)

ALLOW_EMAIL_RE='^[0-9]+:(noreply@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9._%+-]+@users\.noreply\.github\.com|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(example|test|invalid|localhost)|[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)*example\.(com|org|net))$'

PERMISSIVE_LOCAL_RE='[^[:space:]@"]+'
QUOTED_LOCAL_RE='"([^"\\]|\\.)*"'
DOMAIN_LABEL_RE='[[:alnum:]][[:alnum:]-]*'
DOMAIN_TLD_RE='[[:alnum:]][[:alnum:]-]*[[:alnum:]]'
DOTTED_DOMAIN_RE="$DOMAIN_LABEL_RE(\\.$DOMAIN_LABEL_RE)*\\.$DOMAIN_TLD_RE"
CANDIDATE_EMAIL_RE='('"$QUOTED_LOCAL_RE"'|'"$PERMISSIVE_LOCAL_RE"')@'"$DOTTED_DOMAIN_RE"

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

report_unsupported_email_candidates() {
  local src="$1" text="$2"
  local candidates quoted_candidates non_ascii_candidates punycode_candidates unsupported

  candidates="$(printf '%s\n' "$text" | run_grep -EIno "$CANDIDATE_EMAIL_RE")" || return 2
  [ -z "$candidates" ] && return 0

  quoted_candidates="$(printf '%s\n' "$candidates" | run_grep -E '^[0-9]+:"')" || return 2
  non_ascii_candidates="$(printf '%s\n' "$candidates" | LC_ALL=C run_grep -E '[^ -~]')" || return 2
  punycode_candidates="$(printf '%s\n' "$candidates" | run_grep -Ei '@[^[:space:]@]*xn--')" || return 2

  unsupported="$(printf '%s\n%s\n%s\n' \
    "$quoted_candidates" "$non_ascii_candidates" "$punycode_candidates" | sed '/^$/d')"
  if [ -n "$unsupported" ]; then
    report "quoted·비ASCII·IDN 이메일 후보 @ $src" "$(line_evidence "$unsupported")"
  fi
  return 0
}

scan_text() {
  local src="$1" skip_email="$2" text entry label re hits name name_hits
  text="$(cat)"
  [ -z "$text" ] && return 0
  for entry in "${PATTERNS[@]}"; do
    label="${entry%%|*}"
    re="${entry#*|}"
    if [ "$label" = "이메일" ]; then
      [ "$skip_email" -eq 1 ] && continue
      hits="$(printf '%s\n' "$text" | run_grep -EIno "$re")" || return 2
      if [ -n "$hits" ]; then
        hits="$(printf '%s\n' "$hits" | run_grep -Eiv "$ALLOW_EMAIL_RE")" || return 2
      fi
    else
      hits="$(printf '%s\n' "$text" | run_grep -EIn "$re")" || return 2
    fi
    if [ -n "$hits" ]; then
      report "$label @ $src" "$(line_evidence "$hits")"
    fi
  done

  if [ "$skip_email" -eq 0 ]; then
    report_unsupported_email_candidates "$src" "$text" || return 2
  fi

  if [ -n "${BLOCKED_NAMES:-}" ]; then
    local OLDIFS="$IFS"
    IFS=','
    for name in $BLOCKED_NAMES; do
      IFS="$OLDIFS"
      name="$(printf '%s' "$name" | sed 's/^ *//;s/ *$//')"
      [ -z "$name" ] && continue
      name_hits="$(printf '%s\n' "$text" | run_grep -Fn -- "$name")" || return 2
      if [ -n "$name_hits" ]; then
        report "실명 @ $src" "$(line_evidence "$name_hits")"
      fi
    done
    IFS="$OLDIFS"
  fi
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
    scan_text "파일 $file_id" 0 <<<"$file_text"
  done <"$changed_file_list"

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
    echo "  → env 실값은 secret store에, 실데이터는 repo 밖 격리 경로에 둔다"
  fi

  if ! commit_text="$(git log --no-merges --format='%s%n%b' "$BASE_REF"..HEAD)"; then
    echo "::error::public-safe 커밋 메시지를 읽을 수 없습니다."
    exit 2
  fi
  scan_text "커밋 메시지" 1 <<<"$commit_text"

  scan_text "PR 제목·본문" 0 <<<"${PR_TEXT:-}"
fi

scan_text "Issue 본문·댓글" 0 <<<"${ISSUE_TEXT:-}"

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
