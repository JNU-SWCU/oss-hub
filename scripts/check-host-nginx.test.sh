#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-host-nginx.sh"
host_source="$repo_root/deploy/host-nginx/oss-hub.conf"
compose_source="$repo_root/deploy/nginx/nginx.conf"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/host-nginx-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
passed=0
failed=0

expect_pass() { if "$checker" "$2" "$3" >/dev/null; then printf 'ok - %s\n' "$1"; passed=$((passed + 1)); else printf 'not ok - %s\n' "$1" >&2; failed=$((failed + 1)); fi; }
expect_fail() { if "$checker" "$2" "$3" >/dev/null; then printf 'not ok - %s (expected failure)\n' "$1" >&2; failed=$((failed + 1)); else printf 'ok - %s\n' "$1"; passed=$((passed + 1)); fi; }

mutate() {
  local source=$1 destination=$2 old=$3 new=$4
  python3 - "$source" "$destination" "$old" "$new" <<'PY'
from pathlib import Path
import sys
source, destination, old, new = sys.argv[1:]
text = Path(source).read_text()
if old not in text:
    raise SystemExit(f'mutation anchor missing: {old}')
Path(destination).write_text(text.replace(old, new, 1))
PY
}

expect_pass 'canonical boundary' "$host_source" "$compose_source"

mutate "$host_source" "$fixture_dir/ip-cert" 'origin.jnu-oss-hub.com/fullchain.pem' '54.116.116.174/fullchain.pem'
expect_fail 'rejects legacy IP certificate' "$fixture_dir/ip-cert" "$compose_source"

mutate "$host_source" "$fixture_dir/host-rate" 'server_tokens off;' 'server_tokens off; limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;'
expect_fail 'rejects host-side rate limit' "$fixture_dir/host-rate" "$compose_source"

mutate "$host_source" "$fixture_dir/drop-vercel" 'proxy_set_header X-Vercel-Forwarded-For $http_x_vercel_forwarded_for;' 'proxy_set_header X-Vercel-Forwarded-For "";'
expect_fail 'requires host forwarding Vercel identity to Compose' "$fixture_dir/drop-vercel" "$compose_source"

mutate "$host_source" "$fixture_dir/commented-auth" 'auth_basic_user_file /etc/nginx/oss-hub-origin.htpasswd;' '# auth_basic_user_file /etc/nginx/oss-hub-origin.htpasswd;'
expect_fail 'commented origin auth does not satisfy contract' "$fixture_dir/commented-auth" "$compose_source"

mutate "$host_source" "$fixture_dir/quoted-fake-auth" 'auth_basic_user_file /etc/nginx/oss-hub-origin.htpasswd;' 'add_header X-Fake "first-line
auth_basic_user_file /etc/nginx/oss-hub-origin.htpasswd;
last-line" always;'
expect_fail 'quoted fake auth does not satisfy contract' "$fixture_dir/quoted-fake-auth" "$compose_source"

mutate "$host_source" "$fixture_dir/oauth-post" 'limit_except GET { deny all; }' 'limit_except GET POST { deny all; }'
expect_fail 'rejects OAuth POST at host' "$fixture_dir/oauth-post" "$compose_source"

mutate "$host_source" "$fixture_dir/generic-put" 'limit_except GET HEAD POST PATCH DELETE { deny all; }' 'limit_except GET HEAD POST PUT PATCH DELETE { deny all; }'
expect_fail 'rejects generic PUT at host' "$fixture_dir/generic-put" "$compose_source"

mutate "$host_source" "$fixture_dir/public-jenkins" 'location / {' 'location = /job/oss-hub-release-cd/build {'
expect_fail 'rejects public Jenkins route' "$fixture_dir/public-jenkins" "$compose_source"

mutate "$compose_source" "$fixture_dir/peer-key" '$vercel_client_key zone=api:10m' '$binary_remote_addr zone=api:10m'
expect_fail 'rejects proxy-peer Compose rate key' "$host_source" "$fixture_dir/peer-key"

mutate "$compose_source" "$fixture_dir/missing-client-reject" 'if ($vercel_client_key = "") { return 403; }' 'if ($vercel_client_key = "blocked") { return 403; }'
expect_fail 'Compose rejects missing Vercel client guard' "$host_source" "$fixture_dir/missing-client-reject"

mutate "$compose_source" "$fixture_dir/leak-vercel" 'proxy_set_header X-Vercel-Forwarded-For "";' 'proxy_set_header X-Vercel-Forwarded-For $http_x_vercel_forwarded_for;'
expect_fail 'Compose strips identity before backend' "$host_source" "$fixture_dir/leak-vercel"

mutate "$compose_source" "$fixture_dir/generic-api" 'location /api/v1/ {' 'location /api/ {'
expect_fail 'Compose generic ingress is only API v1' "$host_source" "$fixture_dir/generic-api"

mutate "$compose_source" "$fixture_dir/generic-options" 'limit_except GET HEAD POST PATCH DELETE { deny all; }' 'limit_except GET HEAD POST PATCH DELETE OPTIONS { deny all; }'
expect_fail 'rejects generic OPTIONS at Compose' "$host_source" "$fixture_dir/generic-options"

mutate "$compose_source" "$fixture_dir/wildcard-host" 'server_name jnu-oss-hub.com localhost 127.0.0.1 [::1];' 'server_name _;'
expect_fail 'rejects Compose wildcard host' "$host_source" "$fixture_dir/wildcard-host"

printf '%s host nginx contract tests passed; %s failed\n' "$passed" "$failed"
(( failed == 0 ))
