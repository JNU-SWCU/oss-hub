#!/usr/bin/env bash
set -euo pipefail

# check-submission-upload-route.sh 합성 fixture 회귀 테스트.
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-submission-upload-route.sh"
source_config="$repo_root/deploy/nginx/nginx.conf"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/submission-upload-route.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
passed=0
failed=0
expect_pass() { local name=$1 path=$2; if "$checker" "$path" >/dev/null 2>&1; then printf 'ok - %s\n' "$name"; passed=$((passed + 1)); else printf 'not ok - %s\n' "$name" >&2; failed=$((failed + 1)); fi; }
expect_fail() { local name=$1 path=$2; if "$checker" "$path" >/dev/null 2>&1; then printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2; failed=$((failed + 1)); else printf 'ok - %s\n' "$name"; passed=$((passed + 1)); fi; }
write_fixture() { local name=$1; cat >"$fixture_dir/$name"; }
write_fixture valid <<'EOF'
server_tokens off;
server {
  proxy_hide_header X-Powered-By;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
  add_header Content-Security-Policy "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" always;
  location /api/v1/ { client_max_body_size 52m; proxy_pass http://backend:4000; }
}
EOF
write_fixture missing-server-tokens <<'EOF'
server {
  proxy_hide_header X-Powered-By;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
  add_header Content-Security-Policy "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" always;
  location /api/v1/ { client_max_body_size 52m; proxy_pass http://backend:4000; }
}
EOF
write_fixture missing-powered-by-hide <<'EOF'
server_tokens off;
server {
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
  add_header Content-Security-Policy "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" always;
  location /api/v1/ { client_max_body_size 52m; proxy_pass http://backend:4000; }
}
EOF
write_fixture missing-nosniff <<'EOF'
server_tokens off;
server {
  proxy_hide_header X-Powered-By;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
  add_header Content-Security-Policy "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" always;
  location /api/v1/ { client_max_body_size 52m; proxy_pass http://backend:4000; }
}
EOF
write_fixture upload-body-missing <<'EOF'
server { location /api/v1/ { proxy_pass http://backend:4000; } }
EOF
write_fixture upload-body-too-small <<'EOF'
server { location /api/v1/ { client_max_body_size 1m; proxy_pass http://backend:4000; } }
EOF
write_fixture upload-body-kilobytes <<'EOF'
server { location /api/v1/ { client_max_body_size 8k; proxy_pass http://backend:4000; } }
EOF
write_fixture submission-files-return-403 <<'EOF'
server { location ~* ^/api/v1/submission-files(/|$) { return 403; } location /api/v1/ { proxy_pass http://backend:4000; } }
EOF
write_fixture submission-files-return-401 <<'EOF'
server { location ~* ^/api/v1/submission-files(/|$) { return 401; } location /api/v1/ { proxy_pass http://backend:4000; } }
EOF
write_fixture case-sensitive-return <<'EOF'
server { location = /api/v1/submission-files { return 403; } location ^~ /api/v1/submission-files/ { return 403; } location /api/v1/ { proxy_pass http://backend:4000; } }
EOF
write_fixture api-overblock <<'EOF'
server { location /api/v1/ { proxy_pass http://backend:4000; return 403; } }
EOF
write_fixture sibling-overblock <<'EOF'
server { location ~* ^/api/v1/submission-files { return 403; } location /api/v1/ { proxy_pass http://backend:4000; } }
EOF
write_fixture fake-proxy-string <<'EOF'
server { location /api/v1/ { add_header X-Note "proxy_pass http://backend:4000"; } }
EOF
cp "$source_config" "$fixture_dir/repo-config"
missing_path="$fixture_dir/does-not-exist.conf"
expect_pass '합성 backend proxy 계약' "$fixture_dir/valid"
expect_pass 'repo compose nginx 제출 경로 backend proxy 계약' "$fixture_dir/repo-config"
expect_fail 'compose server_tokens off 누락' "$fixture_dir/missing-server-tokens"
expect_fail 'compose X-Powered-By hide 누락' "$fixture_dir/missing-powered-by-hide"
expect_fail 'compose nosniff 누락' "$fixture_dir/missing-nosniff"
expect_fail '제출 파일 403 차단 회귀' "$fixture_dir/submission-files-return-403"
expect_fail '제출 파일 401 재송 차단' "$fixture_dir/submission-files-return-401"
expect_fail '대소문자 우회 가능 차단도 불허' "$fixture_dir/case-sensitive-return"
expect_fail '/api/ 과차단' "$fixture_dir/api-overblock"
expect_fail 'sibling 과차단' "$fixture_dir/sibling-overblock"
expect_fail '가짜 API proxy 문자열' "$fixture_dir/fake-proxy-string"
expect_fail '업로드 본문 한도 미설정(기본 1m 이면 1MB 초과 제출이 413)' "$fixture_dir/upload-body-missing"
expect_fail '업로드 본문 한도가 backend 50MiB 보다 작음' "$fixture_dir/upload-body-too-small"
expect_fail '업로드 본문 한도 단위 축소(8k)' "$fixture_dir/upload-body-kilobytes"
expect_fail '설정 파일 부재' "$missing_path"
printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
