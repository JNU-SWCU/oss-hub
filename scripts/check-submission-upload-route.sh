#!/usr/bin/env bash
set -euo pipefail

# Compose nginx 제출 파일 업로드 경로 fail-closed 계약 검사 (G004 D6).
# 실제 nginx 기동 없이 결정론적으로 검증한다:
#   1) exact path location = /api/v1/submission-files 가 유효 구성으로 존재한다
#   2) trailing-slash/subpath location ^~ /api/v1/submission-files/ 가 유효 구성으로 존재한다
#   3) 두 블록 모두 명시적 return 403 이고 proxy_pass 가 없다
#   4) 무관한 /api/ 경로는 계속 backend 로 proxy 한다 (과차단 금지)
# 주석·redirect·malformed·duplicate·sibling over-match 는 계약 위반.
# 위반·파일 부재는 exit 1.

config=${1:-deploy/nginx/nginx.conf}

if [[ ! -f "$config" ]]; then
  printf 'submission-upload-route contract: file not found: %s\n' "$config" >&2
  exit 1
fi

effective_config=$(mktemp "${TMPDIR:-/tmp}/submission-upload-route-effective.XXXXXX")
trap 'rm -f "$effective_config"' EXIT

# 주석에 계약 문자열을 남겨 검사를 우회하지 못하도록 실행 가능한 줄만 남긴다.
# nginx 는 # 줄 주석만 지원한다. 이 계약 경로의 지시어 인용 문자열에는 # 가 없다.
awk '
  /^[[:space:]]*#/ { next }
  {
    sub(/[[:space:]]+#.*$/, "")
    if ($0 ~ /[^[:space:]]/) print
  }
' "$config" >"$effective_config"

if [[ ! -s "$effective_config" ]]; then
  echo 'submission-upload-route contract: no effective nginx directives after comment strip' >&2
  exit 1
fi

# 유효 구성에서 대상 location 블록 본문(헤더·최외곽 닫는 중괄호 제외)을 추출한다.
# exit: 0=ok, 1=missing, 2=duplicate, 3=unclosed
extract_location_body() {
  local kind=$1
  awk -v kind="$kind" '
    function norm_header(s,    t) {
      t = s
      gsub(/^[[:space:]]+/, "", t)
      gsub(/[[:space:]]+/, " ", t)
      sub(/[[:space:]]*\{[[:space:]]*$/, " {", t)
      return t
    }
    function target_header() {
      if (kind == "exact") return "location = /api/v1/submission-files {"
      if (kind == "prefix") return "location ^~ /api/v1/submission-files/ {"
      if (kind == "api") return "location /api/ {"
      return ""
    }
    function brace_delta(s,    i, ch, d) {
      d = 0
      for (i = 1; i <= length(s); i++) {
        ch = substr(s, i, 1)
        if (ch == "{") d++
        if (ch == "}") d--
      }
      return d
    }
    BEGIN { want = target_header() }
    {
      line = $0
      if (!capture) {
        # 한 줄 location 헤더(+optional 본문/닫기) 매칭
        # "location ... { ... }" 형태도 헤더 정규화로 잡기 위해
        # 첫 { 앞까지만 헤더로 본다.
        header_src = line
        brace_at = index(header_src, "{")
        if (brace_at == 0) next
        header = norm_header(substr(header_src, 1, brace_at))
        if (header != want) next

        blocks++
        if (blocks > 1) {
          print "duplicate" > "/dev/stderr"
          exit 2
        }

        depth = brace_delta(line)
        # 헤더 줄에서 { 이후 토큰이 있으면 본문으로 취급
        after = substr(line, brace_at + 1)
        # 닫는 } 와 그 이후는 본문에서 제거
        if (depth == 0) {
          sub(/\}[^{]*$/, "", after)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", after)
          if (after != "") print after
          next
        }
        # 아직 열린 블록 — 헤더 줄의 trailing 본문
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", after)
        if (after != "") print after
        capture = 1
        next
      }

      # 본문 수집
      depth += brace_delta(line)
      if (depth < 0) {
        print "unclosed" > "/dev/stderr"
        exit 3
      }
      if (depth == 0) {
        # 닫는 줄: } 이전만 본문
        before = line
        sub(/\}[^{]*$/, "", before)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", before)
        if (before != "") print before
        capture = 0
        next
      }
      print line
    }
    END {
      if (capture) {
        print "unclosed" > "/dev/stderr"
        exit 3
      }
      if (blocks == 0) exit 1
    }
  ' "$effective_config"
}

require_fail_closed_location() {
  local description=$1
  local kind=$2
  local block
  local extract_status=0
  local err

  err=$(mktemp "${TMPDIR:-/tmp}/submission-upload-route-extract-err.XXXXXX")
  set +e
  block=$(extract_location_body "$kind" 2>"$err")
  extract_status=$?
  set -e

  if ((extract_status == 2)) || grep -Eq 'duplicate' "$err" 2>/dev/null; then
    rm -f "$err"
    printf 'submission-upload-route contract: duplicate %s\n' "$description" >&2
    exit 1
  fi
  if ((extract_status == 3)) || grep -Eq 'unclosed' "$err" 2>/dev/null; then
    rm -f "$err"
    printf 'submission-upload-route contract: unclosed %s\n' "$description" >&2
    exit 1
  fi
  rm -f "$err"

  if ((extract_status != 0)); then
    printf 'submission-upload-route contract: missing effective %s\n' "$description" >&2
    exit 1
  fi

  if grep -Eq 'proxy_pass[[:space:]]' <<<"$block"; then
    printf 'submission-upload-route contract: %s still proxies upstream\n' "$description" >&2
    exit 1
  fi

  local return_count status
  return_count=$(grep -cE '^[[:space:]]*return[[:space:]]+[0-9]{3}([[:space:];]|$)' <<<"$block" || true)
  if ((return_count < 1)); then
    printf 'submission-upload-route contract: %s missing explicit return 403\n' "$description" >&2
    exit 1
  fi
  if ((return_count != 1)); then
    printf 'submission-upload-route contract: %s has multiple return directives\n' "$description" >&2
    exit 1
  fi

  status=$(sed -nE 's/^[[:space:]]*return[[:space:]]+([0-9]{3}).*/\1/p' <<<"$block" | head -n 1)
  if [[ -z "$status" ]]; then
    printf 'submission-upload-route contract: %s malformed return status\n' "$description" >&2
    exit 1
  fi
  if [[ "$status" != "403" ]]; then
    printf 'submission-upload-route contract: %s returns %s; expected exact 403 fail-closed\n' \
      "$description" "$status" >&2
    exit 1
  fi
}

require_fail_closed_location \
  'exact submission-files location' \
  'exact'
require_fail_closed_location \
  'trailing-slash/subpath submission-files location' \
  'prefix'

api_err=$(mktemp "${TMPDIR:-/tmp}/submission-upload-route-api-err.XXXXXX")
set +e
api_block=$(extract_location_body 'api' 2>"$api_err")
api_status=$?
set -e

if ((api_status == 2)) || grep -Eq 'duplicate' "$api_err" 2>/dev/null; then
  rm -f "$api_err"
  echo 'submission-upload-route contract: duplicate location /api/ block' >&2
  exit 1
fi
if ((api_status == 3)) || grep -Eq 'unclosed' "$api_err" 2>/dev/null; then
  rm -f "$api_err"
  echo 'submission-upload-route contract: unclosed location /api/ block' >&2
  exit 1
fi
rm -f "$api_err"

if ((api_status != 0)); then
  echo 'submission-upload-route contract: missing effective location /api/ block' >&2
  exit 1
fi

if ! grep -Eq 'proxy_pass[[:space:]]+http://backend:4000' <<<"$api_block"; then
  echo 'submission-upload-route contract: location /api/ must keep backend proxy_pass' >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*return[[:space:]]+[45][0-9]{2}' <<<"$api_block"; then
  echo 'submission-upload-route contract: location /api/ over-blocks unrelated routes' >&2
  exit 1
fi

# exact/prefix deny 가 bare prefix 로 대체되어 sibling 경로까지 삼키는 구성을 거절한다.
if awk '
  function norm_header(s,    t) {
    t = s
    gsub(/^[[:space:]]+/, "", t)
    gsub(/[[:space:]]+/, " ", t)
    sub(/[[:space:]]*\{[[:space:]]*$/, " {", t)
    return t
  }
  {
    brace_at = index($0, "{")
    if (brace_at == 0) next
    h = norm_header(substr($0, 1, brace_at))
    if (h == "location ^~ /api/v1/submission-files {") {
      found = 1
      exit
    }
  }
  END { exit found ? 0 : 1 }
' "$effective_config"; then
  echo 'submission-upload-route contract: bare prefix ^~ /api/v1/submission-files over-matches sibling paths' >&2
  exit 1
fi

echo 'submission-upload-route contract: ok (exact+prefix deny 403, no proxy, /api/ intact, comments ignored)'
