#!/usr/bin/env bash
set -euo pipefail

host_config=${1:-deploy/host-nginx/oss-hub.conf}
compose_config=${2:-deploy/nginx/nginx.conf}

for path in "$host_config" "$compose_config"; do
  [[ -f "$path" ]] || { printf 'host nginx contract: file not found: %s\n' "$path" >&2; exit 1; }
done

python3 - "$host_config" "$compose_config" <<'PY'
from pathlib import Path
import sys

host = Path(sys.argv[1]).read_text()
compose = Path(sys.argv[2]).read_text()

def fail(message):
    raise SystemExit(f'host nginx contract: {message}')

def require(text, value, count=1):
    actual = text.count(value)
    if actual != count:
        fail(f'expected {count} occurrence(s) of {value!r}, found {actual}')

def section(text, marker):
    start = text.find(marker)
    if start < 0 or text.find(marker, start + len(marker)) >= 0:
        fail(f'missing or duplicate location: {marker}')
    opening = text.find('{', start)
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == '{': depth += 1
        elif text[index] == '}':
            depth -= 1
            if depth == 0: return text[start:index + 1]
    fail(f'unclosed location: {marker}')

for forbidden in ('54.116.116.174', 'jenkins_trigger', '/job/', '127.0.0.1:8080', '$remote_user', 'limit_req_zone', 'limit_req zone=', '$vercel_client_key'):
    if forbidden in host:
        fail(f'host contains forbidden legacy or rate-limit directive: {forbidden}')

require(host, 'server_name origin.jnu-oss-hub.com;', 2)
require(host, 'ssl_certificate /etc/letsencrypt/live/origin.jnu-oss-hub.com/fullchain.pem;')
require(host, 'ssl_certificate_key /etc/letsencrypt/live/origin.jnu-oss-hub.com/privkey.pem;')
require(host, 'listen 80 default_server;')
require(host, 'listen 443 ssl default_server;')
require(host, 'ssl_reject_handshake on;')
require(host, 'auth_basic_user_file /etc/nginx/oss-hub-origin.htpasswd;')
require(host, 'return 308 https://origin.jnu-oss-hub.com$request_uri;')

host_paths = {
    'location = /api/v1/auth/github {': 'GET',
    'location = /api/v1/auth/github/callback {': 'GET',
    'location = /api/v1/admin/collection/trigger {': 'POST',
    'location = /api/v1/admin/collection/discover-external {': 'POST',
    'location /api/v1/ {': 'GET HEAD POST PUT PATCH DELETE OPTIONS',
}
for marker, methods in host_paths.items():
    item = section(host, marker)
    if f'limit_except {methods} {{ deny all; }}' not in item:
        fail(f'host method guard missing for {marker}')
    for directive in ('proxy_set_header Host jnu-oss-hub.com;', 'proxy_set_header Authorization "";', 'proxy_set_header X-Vercel-Forwarded-For $http_x_vercel_forwarded_for;', 'proxy_set_header X-Origin-Rate-Key "";', 'proxy_set_header X-RateLimit-Limit "";', 'proxy_set_header X-RateLimit-Remaining "";', 'proxy_set_header X-RateLimit-Reset "";', 'proxy_set_header X-Real-IP "";', 'proxy_set_header X-Forwarded-For "";'):
        if directive not in item:
            fail(f'host proxy boundary missing {directive}')

host_tls_start = host.find('server {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;\n    server_name origin.jnu-oss-hub.com;')
if host_tls_start < 0:
    fail('missing origin TLS server')
non_api = section(host[host_tls_start:], 'location / {')
if 'auth_basic off;' not in non_api or 'return 404;' not in non_api:
    fail('host non-API route must be unauthenticated 404')

require(compose, 'listen 80 default_server;')
require(compose, 'server_name _;')
require(compose, 'server_name jnu-oss-hub.com localhost 127.0.0.1 [::1];')
require(compose, 'limit_req_zone $vercel_client_key zone=api:10m rate=10r/s;')
require(compose, 'limit_req_zone $vercel_client_key zone=oauth:10m rate=10r/m;')
require(compose, 'limit_req_zone $vercel_client_key zone=admin_collection:10m rate=2r/m;')

compose_paths = {
    'location = /api/v1/auth/github {': ('GET', 'oauth'),
    'location = /api/v1/auth/github/callback {': ('GET', 'oauth'),
    'location = /api/v1/admin/collection/trigger {': ('POST', 'admin_collection'),
    'location = /api/v1/admin/collection/discover-external {': ('POST', 'admin_collection'),
    'location /api/v1/ {': ('GET HEAD POST PUT PATCH DELETE OPTIONS', 'api'),
}
for marker, (methods, zone) in compose_paths.items():
    item = section(compose, marker)
    for directive in (f'if ($vercel_client_key = "") {{ return 403; }}', f'limit_except {methods} {{ deny all; }}', f'limit_req zone={zone}', 'limit_req_status 429;', 'proxy_set_header X-Vercel-Forwarded-For "";', 'proxy_set_header X-Origin-Rate-Key "";', 'proxy_set_header X-RateLimit-Limit "";', 'proxy_set_header X-RateLimit-Remaining "";', 'proxy_set_header X-RateLimit-Reset "";', 'proxy_set_header X-Real-IP "";', 'proxy_set_header X-Forwarded-For "";'):
        if directive not in item:
            fail(f'Compose route {marker} missing {directive}')

if compose.count('server {') != 2 or 'location /api/ {' in compose:
    fail('Compose must have exactly default/canonical servers and only /api/v1 ingress')
print('host nginx contract: ok')
PY
