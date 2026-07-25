#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-host-nginx.sh"
source_config="$repo_root/deploy/host-nginx/oss-hub.conf"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/host-nginx-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

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

cp "$source_config" "$fixture_dir/valid"
make_fixture missing-tls-cert 'ssl_certificate /etc/letsencrypt/live/54.116.116.174/fullchain.pem;' 'ssl_certificate /tmp/removed.pem;'
make_fixture public-jenkins-wildcard 'location = /job/oss-hub-release-cd/buildWithParameters {' 'location /job/ {'
make_fixture missing-post-guard 'limit_except POST {' 'limit_except GET {'
make_fixture missing-trigger-rate-limit 'limit_req zone=jenkins_trigger burst=5 nodelay;' 'limit_req off;'
make_fixture query-leaking-log '"$request_method $uri $server_protocol"' '"$request"'
make_fixture public-compose-bind 'server 127.0.0.1:8081;' 'server 0.0.0.0:8081;'

expect_pass '현재 host nginx 계약' "$fixture_dir/valid"
expect_fail 'IP 인증서 경로 누락' "$fixture_dir/missing-tls-cert"
expect_fail 'Jenkins UI wildcard 공개' "$fixture_dir/public-jenkins-wildcard"
expect_fail 'Jenkins POST allowlist 누락' "$fixture_dir/missing-post-guard"
expect_fail 'Jenkins trigger rate limit 누락' "$fixture_dir/missing-trigger-rate-limit"
expect_fail 'query 포함 access log' "$fixture_dir/query-leaking-log"
expect_fail 'Compose upstream public bind' "$fixture_dir/public-compose-bind"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
