#!/usr/bin/env bash
set -euo pipefail

config=${1:-deploy/host-nginx/oss-hub.conf}

if [[ ! -f "$config" ]]; then
  printf 'host nginx contract: file not found: %s\n' "$config" >&2
  exit 1
fi

require_count() {
  local description=$1
  local pattern=$2
  local expected=${3:-1}
  local count
  count=$({ grep -F -- "$pattern" "$config" || true; } | wc -l | tr -d ' ')
  if ((count != expected)); then
    printf 'host nginx contract: %s (expected=%s, actual=%s)\n' "$description" "$expected" "$count" >&2
    exit 1
  fi
}

require_count 'production EIP server_name' 'server_name 54.116.116.174;' 2
require_count 'public HTTP listener' 'listen 80;'
require_count 'public HTTPS listener' 'listen 443 ssl http2;'
require_count 'short-lived IP fullchain path' 'ssl_certificate /etc/letsencrypt/live/54.116.116.174/fullchain.pem;'
require_count 'short-lived IP private key path' 'ssl_certificate_key /etc/letsencrypt/live/54.116.116.174/privkey.pem;'
require_count 'ACME HTTP-01 webroot' 'root /var/www/certbot;'
require_count 'HTTP to HTTPS redirect' 'return 308 https://$host$request_uri;'
require_count 'loopback Compose upstream' 'server 127.0.0.1:8081;'
require_count 'exact Jenkins trigger location' 'location = /job/oss-hub-release-cd/buildWithParameters {'
require_count 'Jenkins trigger POST allowlist' 'limit_except POST {'
require_count 'Jenkins trigger rate-limit zone' 'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;'
require_count 'Jenkins trigger rate limit' 'limit_req zone=jenkins_trigger burst=5 nodelay;'
require_count 'Jenkins trigger body limit' 'client_max_body_size 8k;'
require_count 'localhost Jenkins upstream' 'proxy_pass http://127.0.0.1:8080;'

log_format=$(awk '
  /log_format oss_hub_safe/ { capture=1 }
  capture { print }
  capture && /;/ { exit }
' "$config")

if [[ -z "$log_format" ]]; then
  echo 'host nginx contract: missing oss_hub_safe log format' >&2
  exit 1
fi

if grep -Eq '\$request([^_a-zA-Z0-9]|$)|\$request_uri([^_a-zA-Z0-9]|$)|\$args([^_a-zA-Z0-9]|$)|\$query_string([^_a-zA-Z0-9]|$)' <<<"$log_format"; then
  echo 'host nginx contract: access log can include query strings' >&2
  exit 1
fi

echo 'host nginx contract: ok (IP TLS, ACME webroot, loopback Compose, POST-only Jenkins trigger)'
