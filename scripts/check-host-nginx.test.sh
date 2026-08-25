#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-host-nginx.sh"
source_config="$repo_root/deploy/host-nginx/oss-hub.conf"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/host-nginx-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

new_location='location = /job/oss-hub-release-cd/build {'

expect_pass() {
  local name=$1 path=$2
  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1 path=$2
  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

make_fixture() {
  local name=$1 pattern=$2 replacement=$3
  sed "s|$pattern|$replacement|" "$source_config" > "$fixture_dir/$name"
  if cmp -s "$source_config" "$fixture_dir/$name"; then
    printf 'fixture pattern not found: %s\n' "$pattern" >&2
    exit 1
  fi
}

remove_location_block() {
  local name=$1
  local marker=$2
  awk -v marker="$marker" '
    index($0, marker) {
      skip=1
      brace=0
    }
    skip {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "{") brace++
        if (c == "}") brace--
      }
      if (brace == 0) {
        skip=0
      }
      next
    }
    { print }
  ' "$source_config" > "$fixture_dir/$name"
  if cmp -s "$source_config" "$fixture_dir/$name"; then
    printf 'fixture block not removed: %s\n' "$marker" >&2
    exit 1
  fi
}

duplicate_location_block() {
  local name=$1
  local marker=$2
  awk -v marker="$marker" '
    index($0, marker) {
      capture=1
      brace=0
      block=""
    }
    capture {
      block = block $0 ORS
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "{") brace++
        if (c == "}") brace--
      }
      print
      if (brace == 0) {
        printf "%s", block
        capture=0
      }
      next
    }
    { print }
  ' "$source_config" > "$fixture_dir/$name"
  if cmp -s "$source_config" "$fixture_dir/$name"; then
    printf 'fixture block not duplicated: %s\n' "$marker" >&2
    exit 1
  fi
}

edit_location_block() {
  local name=$1
  local marker=$2
  local pattern=$3
  local replacement=$4
  awk -v marker="$marker" -v pat="$pattern" -v rep="$replacement" '
    index($0, marker) {
      inblock=1
      brace=0
    }
    {
      if (inblock && index($0, pat)) {
        gsub(pat, rep)
        edited=1
      }
      print
      if (inblock) {
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "{") brace++
          if (c == "}") brace--
        }
        if (brace == 0) inblock=0
      }
    }
    END {
      if (!edited) {
        print "fixture block edit not applied: " pat > "/dev/stderr"
        exit 1
      }
    }
  ' "$source_config" > "$fixture_dir/$name"
}

comment_limit_except_blocks() {
  local name=$1
  awk '
    /limit_except POST[[:space:]]*\{/ {
      inblock=1
      brace=0
    }
    {
      if (inblock) {
        print "        # " $0
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "{") brace++
          if (c == "}") brace--
        }
        if (brace == 0) inblock=0
        next
      }
      print
    }
  ' "$source_config" > "$fixture_dir/$name"
}

# Move the exact Jenkins trigger block from the TLS server into the HTTP server.
# The resulting config is nginx-valid but violates the public HTTPS trigger boundary.
move_jenkins_locations_to_http() {
  local name=$1
  python3 - "$source_config" "$fixture_dir/$name" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()
markers = ('location = /job/oss-hub-release-cd/build {',)

def extract_block(source: str, marker: str) -> tuple[str, str]:
    start = source.index(marker)
    # Walk back to include leading indentation on the marker line.
    line_start = source.rfind('\n', 0, start) + 1
    i = start + len(marker) - 1
    depth = 0
    while i < len(source):
        ch = source[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                if end < len(source) and source[end] == '\n':
                    end += 1
                block = source[line_start:end]
                remainder = source[:line_start] + source[end:]
                return block, remainder
        i += 1
    raise SystemExit(f'block not closed for marker: {marker}')

blocks: list[str] = []
for marker in markers:
    block, text = extract_block(text, marker)
    blocks.append(block)

# Insert the relocated blocks into the first (HTTP) server, before its closing brace.
http_listen = text.index('listen 80;')
server_start = text.rfind('server {', 0, http_listen)
if server_start < 0:
    raise SystemExit('HTTP server not found')
depth = 0
i = server_start
end = None
while i < len(text):
    if text[i] == '{':
        depth += 1
    elif text[i] == '}':
        depth -= 1
        if depth == 0:
            end = i
            break
    i += 1
if end is None:
    raise SystemExit('HTTP server not closed')

insertion = '\n'.join(blocks)
if not insertion.endswith('\n'):
    insertion += '\n'
text = text[:end] + insertion + text[end:]
Path(sys.argv[2]).write_text(text)
PY
  if cmp -s "$source_config" "$fixture_dir/$name"; then
    printf 'fixture jenkins locations not moved to HTTP: %s\n' "$name" >&2
    exit 1
  fi
}

write_increment_a_complete() {
  python3 - "$source_config" "$fixture_dir/complete" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text()
dst = Path(sys.argv[2])
if (
    'server_tokens off;' in src
    and 'zone=api:10m' in src
    and 'location /api/ {' in src
    and 'proxy_hide_header X-Powered-By;' in src
):
    dst.write_text(src)
    raise SystemExit(0)
zones = (
    'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;\n'
)
added_zones = (
    'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;\n'
    'server_tokens off;\n'
    'limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;\n'
    'limit_req_zone $binary_remote_addr zone=oauth:10m rate=10r/m;\n'
    'limit_req_zone $binary_remote_addr zone=admin_collection:10m rate=2r/m;\n'
)
if zones not in src:
    raise SystemExit('complete fixture: jenkins zone anchor missing')
src = src.replace(zones, added_zones, 1)

tls_headers_anchor = (
    '    access_log /var/log/nginx/oss-hub.access.log oss_hub_safe;\n'
    '\n'
    '    # 공개 Jenkins 표면은'
)
tls_headers = (
    '    access_log /var/log/nginx/oss-hub.access.log oss_hub_safe;\n'
    '\n'
    '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n'
    '    add_header X-Content-Type-Options "nosniff" always;\n'
    '    add_header X-Frame-Options "DENY" always;\n'
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n'
    '    add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;\n'
    "    add_header Content-Security-Policy \"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'\" always;\n"
    '    proxy_hide_header X-Powered-By;\n'
    '\n'
    '    # 공개 Jenkins 표면은'
)
if tls_headers_anchor not in src:
    raise SystemExit('complete fixture: TLS header anchor missing')
src = src.replace(tls_headers_anchor, tls_headers, 1)

api_locations = (
    '    location /api/ {\n'
    '        limit_req zone=api burst=30 nodelay;\n'
    '        limit_req_status 429;\n'
    '        client_max_body_size 6m;\n'
    '        proxy_pass http://oss_hub_compose;\n'
    '    }\n'
    '\n'
    '    location = /api/v1/auth/github {\n'
    '        limit_req zone=oauth burst=5 nodelay;\n'
    '        limit_req_status 429;\n'
    '        proxy_pass http://oss_hub_compose;\n'
    '    }\n'
    '\n'
    '    location = /api/v1/auth/github/callback {\n'
    '        limit_req zone=oauth burst=5 nodelay;\n'
    '        limit_req_status 429;\n'
    '        add_header Referrer-Policy "no-referrer" always;\n'
    '        proxy_pass http://oss_hub_compose;\n'
    '    }\n'
    '\n'
    '    location = /api/v1/admin/collection/trigger {\n'
    '        limit_req zone=admin_collection burst=1 nodelay;\n'
    '        limit_req_status 429;\n'
    '        proxy_pass http://oss_hub_compose;\n'
    '    }\n'
    '\n'
    '    location = /api/v1/admin/collection/discover-external {\n'
    '        limit_req zone=admin_collection burst=1 nodelay;\n'
    '        limit_req_status 429;\n'
    '        proxy_pass http://oss_hub_compose;\n'
    '    }\n'
    '\n'
)
tls_root = (
    '    location / {\n'
    '        # 제출 파일 업로드가 이 경로를 지난다'
)
if tls_root not in src:
    raise SystemExit('complete fixture: TLS location / anchor missing')
src = src.replace(tls_root, api_locations + tls_root, 1)
dst.write_text(src)
PY
  if [[ ! -s "$fixture_dir/complete" ]] || ! grep -q 'server_tokens off;' "$fixture_dir/complete"; then
    printf 'complete fixture missing increment A\n' >&2
    exit 1
  fi
}

make_complete_fixture() {
  local name=$1 pattern=$2 replacement=$3
  sed "s|$pattern|$replacement|" "$fixture_dir/complete" > "$fixture_dir/$name"
  if cmp -s "$fixture_dir/complete" "$fixture_dir/$name"; then
    printf 'complete fixture pattern not found: %s\n' "$pattern" >&2
    exit 1
  fi
}

strip_from_complete() {
  local name=$1 pattern=$2
  grep -v -F -- "$pattern" "$fixture_dir/complete" > "$fixture_dir/$name"
  if cmp -s "$fixture_dir/complete" "$fixture_dir/$name"; then
    printf 'complete strip pattern not found: %s\n' "$pattern" >&2
    exit 1
  fi
}

remove_location_from_complete() {
  local name=$1
  local marker=$2
  awk -v marker="$marker" '
    index($0, marker) {
      skip=1
      brace=0
    }
    skip {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "{") brace++
        if (c == "}") brace--
      }
      if (brace == 0) {
        skip=0
      }
      next
    }
    { print }
  ' "$fixture_dir/complete" > "$fixture_dir/$name"
  if cmp -s "$fixture_dir/complete" "$fixture_dir/$name"; then
    printf 'complete fixture block not removed: %s\n' "$marker" >&2
    exit 1
  fi
}

cp "$source_config" "$fixture_dir/valid"
write_increment_a_complete
make_fixture missing-tls-cert 'ssl_certificate /etc/letsencrypt/live/54.116.116.174/fullchain.pem;' 'ssl_certificate /tmp/removed.pem;'
make_fixture public-jenkins-wildcard "$new_location" 'location /job/ {'
make_fixture missing-post-guard 'limit_except POST {' 'limit_except GET {'
make_fixture missing-trigger-rate-limit 'limit_req zone=jenkins_trigger burst=5 nodelay;' 'limit_req off;'
make_fixture query-leaking-log '"$request_method $uri $server_protocol"' '"$request"'
make_fixture public-compose-bind 'server 127.0.0.1:8081;' 'server 0.0.0.0:8081;'
remove_location_block missing-new-build-path "$new_location"
make_fixture legacy-path-restored "$new_location" 'location = /job/oss-hub-release-cd/buildWithParameters {'
duplicate_location_block duplicate-new-build-path "$new_location"
make_fixture overbroad-new-build-path "$new_location" 'location /job/oss-hub-release-cd/build {'
edit_location_block mismatched-new-post-guard "$new_location" 'limit_except POST {' 'limit_except GET {'
edit_location_block mismatched-new-body-limit "$new_location" 'client_max_body_size 8k;' 'client_max_body_size 1m;'
edit_location_block mismatched-new-rate "$new_location" 'limit_req zone=jenkins_trigger burst=5 nodelay;' 'limit_req zone=jenkins_trigger burst=1;'
edit_location_block mismatched-new-status "$new_location" 'limit_req_status 429;' 'limit_req_status 503;'
edit_location_block mismatched-new-proxy "$new_location" 'proxy_pass http://127.0.0.1:8080;' 'proxy_pass http://127.0.0.1:8081;'
edit_location_block mismatched-new-header "$new_location" 'proxy_set_header X-Forwarded-Proto' 'proxy_set_header X-Forwarded-Host'
edit_location_block neutralized-new-access "$new_location" 'deny all;' 'deny all; allow all;'
edit_location_block duplicate-new-status "$new_location" 'limit_req_status 429;' 'limit_req_status 429; limit_req_status 429;'
comment_limit_except_blocks commented-post-guard
cp "$fixture_dir/missing-new-build-path" "$fixture_dir/comment-only-new-path"
printf '%s\n' '# location = /job/oss-hub-release-cd/build {' '#   limit_except POST { deny all; }' '# }' >> "$fixture_dir/comment-only-new-path"

# Ancestry / public routing fail-open fixtures (Architect HIGH).
move_jenkins_locations_to_http jenkins-triggers-on-http
make_fixture https-catchall-to-jenkins 'proxy_pass http://oss_hub_compose;' 'proxy_pass http://127.0.0.1:8080;'
make_fixture inherited-error-page 'server_name 54.116.116.174;' 'server_name 54.116.116.174; error_page 403 =200 /;'
make_fixture unresolved-include 'server_name 54.116.116.174;' 'server_name 54.116.116.174; include /tmp/unexpanded.conf;'

# Lexical fixtures (Architect MEDIUM).
# Multiline double-quoted value containing '#' must remain active config, not a comment.
cp "$fixture_dir/complete" "$fixture_dir/multiline-quoted-hash"
python3 - "$fixture_dir/multiline-quoted-hash" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
needle = 'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;\n'
insert = (
    'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;\n'
    'set $oss_hub_lexer_probe "line-one\n'
    '# not-a-comment inside quotes\n'
    'line-three";\n'
)
if needle not in text:
    raise SystemExit('multiline-quoted-hash anchor not found')
path.write_text(text.replace(needle, insert, 1))
PY

# Adjacent quoted fragments are invalid nginx and must not normalize to deny all.
edit_location_block adjacent-quoted-deny "$new_location" 'deny all;' 'deny "all""";'

strip_from_complete missing-server-tokens 'server_tokens off;'
strip_from_complete missing-powered-by-hide '    proxy_hide_header X-Powered-By;'
strip_from_complete missing-hsts '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
strip_from_complete missing-nosniff '    add_header X-Content-Type-Options "nosniff" always;'
strip_from_complete missing-csp "    add_header Content-Security-Policy \"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'\" always;"
strip_from_complete missing-callback-no-referrer '        add_header Referrer-Policy "no-referrer" always;'
make_complete_fixture csp-with-script-src "form-action 'self'" "form-action 'self'; script-src 'self'"
strip_from_complete missing-api-zone 'limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;'
strip_from_complete missing-oauth-zone 'limit_req_zone $binary_remote_addr zone=oauth:10m rate=10r/m;'
strip_from_complete missing-admin-zone 'limit_req_zone $binary_remote_addr zone=admin_collection:10m rate=2r/m;'
remove_location_from_complete missing-api-location 'location /api/ {'
remove_location_from_complete missing-oauth-start 'location = /api/v1/auth/github {'
remove_location_from_complete missing-admin-trigger 'location = /api/v1/admin/collection/trigger {'
make_complete_fixture weak-api-burst 'limit_req zone=api burst=30 nodelay;' 'limit_req zone=api burst=1 nodelay;'

expect_pass 'increment A 합성 host nginx 계약' "$fixture_dir/complete"
expect_pass '현재 host nginx 계약' "$fixture_dir/valid"
expect_fail 'IP 인증서 경로 누락' "$fixture_dir/missing-tls-cert"
expect_fail 'Jenkins UI wildcard 공개' "$fixture_dir/public-jenkins-wildcard"
expect_fail 'Jenkins POST allowlist 누락' "$fixture_dir/missing-post-guard"
expect_fail 'Jenkins trigger rate limit 누락' "$fixture_dir/missing-trigger-rate-limit"
expect_fail 'query 포함 access log' "$fixture_dir/query-leaking-log"
expect_fail 'Compose upstream public bind' "$fixture_dir/public-compose-bind"
expect_fail '신 /build 경로 누락' "$fixture_dir/missing-new-build-path"
expect_fail '구 buildWithParameters 경로 부활' "$fixture_dir/legacy-path-restored"
expect_fail '신 /build 경로 중복' "$fixture_dir/duplicate-new-build-path"
expect_fail '신 /build 경로 비정확 매칭' "$fixture_dir/overbroad-new-build-path"
expect_fail '신 경로 POST allowlist 불일치' "$fixture_dir/mismatched-new-post-guard"
expect_fail '신 경로 body limit 불일치' "$fixture_dir/mismatched-new-body-limit"
expect_fail '신 경로 rate limit 불일치' "$fixture_dir/mismatched-new-rate"
expect_fail '신 경로 429 status 불일치' "$fixture_dir/mismatched-new-status"
expect_fail '신 경로 proxy 불일치' "$fixture_dir/mismatched-new-proxy"
expect_fail '신 경로 proxy header 불일치' "$fixture_dir/mismatched-new-header"
expect_fail '신 경로 allow all 중화' "$fixture_dir/neutralized-new-access"
expect_fail '신 경로 동일 directive 중복' "$fixture_dir/duplicate-new-status"
expect_fail 'OAuth callback no-referrer 누락' "$fixture_dir/missing-callback-no-referrer"
expect_fail 'POST guard 주석 처리' "$fixture_dir/commented-post-guard"
expect_fail '주석 marker로 신 경로 위조' "$fixture_dir/comment-only-new-path"
expect_fail 'Jenkins trigger 가 HTTP server 로 이동' "$fixture_dir/jenkins-triggers-on-http"
expect_fail 'HTTPS catch-all 이 Jenkins upstream' "$fixture_dir/https-catchall-to-jenkins"
expect_fail '403 응답 remap 상속' "$fixture_dir/inherited-error-page"
expect_fail '미확장 include 주입' "$fixture_dir/unresolved-include"
expect_pass 'multiline quoted # 보존' "$fixture_dir/multiline-quoted-hash"
expect_fail 'adjacent quoted deny 토큰' "$fixture_dir/adjacent-quoted-deny"
expect_fail 'server_tokens off 누락' "$fixture_dir/missing-server-tokens"
expect_fail 'X-Powered-By hide 누락' "$fixture_dir/missing-powered-by-hide"
expect_fail 'HSTS 누락' "$fixture_dir/missing-hsts"
expect_fail 'nosniff 누락' "$fixture_dir/missing-nosniff"
expect_fail 'CSP 누락' "$fixture_dir/missing-csp"
expect_fail 'CSP script-src 확장' "$fixture_dir/csp-with-script-src"
expect_fail '일반 API limit zone 누락' "$fixture_dir/missing-api-zone"
expect_fail 'OAuth limit zone 누락' "$fixture_dir/missing-oauth-zone"
expect_fail 'admin collection limit zone 누락' "$fixture_dir/missing-admin-zone"
expect_fail '일반 /api/ location 누락' "$fixture_dir/missing-api-location"
expect_fail 'OAuth start location 누락' "$fixture_dir/missing-oauth-start"
expect_fail 'admin trigger location 누락' "$fixture_dir/missing-admin-trigger"
expect_fail '일반 API burst 완화' "$fixture_dir/weak-api-burst"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
