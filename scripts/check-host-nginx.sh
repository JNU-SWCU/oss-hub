#!/usr/bin/env bash
set -euo pipefail

host_config=${1:-deploy/host-nginx/oss-hub.conf}
compose_config=${2:-deploy/nginx/nginx.conf}

for path in "$host_config" "$compose_config"; do
  [[ -f "$path" ]] || { printf 'host nginx contract: file not found: %s\n' "$path" >&2; exit 1; }
done

python3 - "$host_config" "$compose_config" <<'PY'
from pathlib import Path
import re
import sys

def fail(message):
    raise SystemExit(f'host nginx contract: {message}')

def active_config(source):
    output = []
    quote = None
    escaped = False
    comment = False
    for character in source:
        if comment:
            if character == '\n':
                comment = False
                output.append(character)
            continue
        if escaped:
            output.append(character)
            escaped = False
            continue
        if quote is not None:
            output.append(character)
            if character == '\\':
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in ('"', "'"):
            quote = character
            output.append(character)
        elif character == '#':
            comment = True
        else:
            output.append(character)
    return ''.join(output)

host = active_config(Path(sys.argv[1]).read_text())
compose = active_config(Path(sys.argv[2]).read_text())

def directive_pattern(value):
    return re.compile(r'^[ \t]*' + re.escape(value) + r'[ \t]*$', re.MULTILINE)

def require(text, value, count=1):
    actual = len(directive_pattern(value).findall(text))
    if actual != count:
        fail(f'expected {count} occurrence(s) of {value!r}, found {actual}')

def has(text, value):
    return directive_pattern(value).search(text) is not None

def has_prefix(text, value):
    return re.search(r'^[ \t]*' + re.escape(value) + r'(?:[ \t;]|$)', text, re.MULTILINE) is not None

def section(text, marker):
    matches = list(directive_pattern(marker).finditer(text))
    if len(matches) != 1:
        fail(f'missing or duplicate location: {marker}')
    start = matches[0].start()
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
    'location /api/v1/ {': 'GET HEAD POST PATCH DELETE',
}
for marker, methods in host_paths.items():
    item = section(host, marker)
    if not has(item, f'limit_except {methods} {{ deny all; }}'):
        fail(f'host method guard missing for {marker}')
    for directive in ('proxy_set_header Host jnu-oss-hub.com;', 'proxy_set_header Authorization "";', 'proxy_set_header X-Vercel-Forwarded-For $http_x_vercel_forwarded_for;', 'proxy_set_header X-Origin-Rate-Key "";', 'proxy_set_header X-RateLimit-Limit "";', 'proxy_set_header X-RateLimit-Remaining "";', 'proxy_set_header X-RateLimit-Reset "";', 'proxy_set_header X-Real-IP "";', 'proxy_set_header X-Forwarded-For "";'):
        if not has(item, directive):
            fail(f'host proxy boundary missing {directive}')

host_tls_start = host.find('server {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;\n    server_name origin.jnu-oss-hub.com;')
if host_tls_start < 0:
    fail('missing origin TLS server')
non_api = section(host[host_tls_start:], 'location / {')
if not has(non_api, 'auth_basic off;') or not has(non_api, 'return 404;'):
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
    'location /api/v1/ {': ('GET HEAD POST PATCH DELETE', 'api'),
}
for marker, (methods, zone) in compose_paths.items():
    item = section(compose, marker)
    for directive in (f'if ($vercel_client_key = "") {{ return 403; }}', f'limit_except {methods} {{ deny all; }}', f'limit_req zone={zone}', 'limit_req_status 429;', 'proxy_set_header X-Vercel-Forwarded-For "";', 'proxy_set_header X-Origin-Rate-Key "";', 'proxy_set_header X-RateLimit-Limit "";', 'proxy_set_header X-RateLimit-Remaining "";', 'proxy_set_header X-RateLimit-Reset "";', 'proxy_set_header X-Real-IP "";', 'proxy_set_header X-Forwarded-For "";'):
        present = has_prefix(item, directive) if directive.startswith('limit_req zone=') else has(item, directive)
        if not present:
            fail(f'Compose route {marker} missing {directive}')

if compose.count('server {') != 2 or 'location /api/ {' in compose:
    fail('Compose must have exactly default/canonical servers and only /api/v1 ingress')

# Text checks above keep diagnostics concise. This directive tree is the
# authority: comments and multiline quoted values cannot impersonate active
# security directives or their ancestry.
class Node:
    def __init__(self, name, args, children):
        self.name = name
        self.args = tuple(args)
        self.children = children

def tokenize(text):
    tokens = []
    current = []
    quote = None
    escaped = False
    expect_delimiter = False

    def flush():
        nonlocal current
        if current:
            tokens.append(''.join(current))
            current = []

    for character in text:
        if escaped:
            current.append(character)
            escaped = False
            continue
        if expect_delimiter:
            if character.isspace() or character in '{};()':
                expect_delimiter = False
            else:
                raise ValueError('adjacent quoted tokens without delimiter')
        if quote is not None:
            if character == '\\':
                current.append(character)
                escaped = True
            elif character == quote:
                tokens.append(''.join(current))
                current = []
                quote = None
                expect_delimiter = True
            else:
                current.append(character)
            continue
        if character in ('"', "'"):
            if current:
                raise ValueError('quote adjacent to bare token')
            quote = character
        elif character in '{};':
            flush()
            tokens.append(character)
        elif character.isspace():
            flush()
        else:
            current.append(character)
    if quote is not None or escaped:
        raise ValueError('unterminated quote or escape')
    flush()
    return tokens

def parse(tokens, index=0, nested=False):
    nodes = []
    words = []
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token == ';':
            if not words:
                raise ValueError('empty directive')
            nodes.append(Node(words[0], words[1:], None))
            words = []
        elif token == '{':
            if not words:
                raise ValueError('anonymous block')
            children, index = parse(tokens, index, True)
            nodes.append(Node(words[0], words[1:], children))
            words = []
        elif token == '}':
            if words or not nested:
                raise ValueError('unexpected or unterminated closing brace')
            return nodes, index
        else:
            words.append(token)
    if nested or words:
        raise ValueError('unclosed block or directive')
    return nodes, index

def tree(text):
    try:
        tokens = tokenize(text)
        nodes, consumed = parse(tokens)
    except ValueError as error:
        fail(f'malformed nginx syntax: {error}')
    if consumed != len(tokens):
        fail('unconsumed nginx syntax')
    return nodes

def direct(nodes, name, args=None):
    return [
        node for node in nodes
        if node.name == name and (args is None or node.args == tuple(args))
    ]

def one(nodes, name, args, label):
    matches = direct(nodes, name, args)
    if len(matches) != 1:
        fail(f'effective directive mismatch for {label}')
    return matches[0]

def server_with_name(nodes, names, listen_args=None):
    matches = []
    for server in direct(nodes, 'server'):
        children = server.children or []
        if direct(children, 'server_name', names) and (
            listen_args is None or direct(children, 'listen', listen_args)
        ):
            matches.append(server)
    if len(matches) != 1:
        fail(f'effective server mismatch for {" ".join(names)}')
    return matches[0]

host_tree = tree(host)
compose_tree = tree(compose)
origin_server = server_with_name(
    host_tree,
    ('origin.jnu-oss-hub.com',),
    ('443', 'ssl'),
)
origin_children = origin_server.children or []
one(origin_children, 'auth_basic_user_file', ('/etc/nginx/oss-hub-origin.htpasswd',), 'origin auth file')
one(origin_children, 'listen', ('443', 'ssl'), 'origin TLS listener')

host_effective = {
    ('=', '/api/v1/auth/github'): ('GET',),
    ('=', '/api/v1/auth/github/callback'): ('GET',),
    ('=', '/api/v1/admin/collection/trigger'): ('POST',),
    ('=', '/api/v1/admin/collection/discover-external'): ('POST',),
    ('/api/v1/',): ('GET', 'HEAD', 'POST', 'PATCH', 'DELETE'),
}
for location_args, methods in host_effective.items():
    location = one(origin_children, 'location', location_args, f'host location {location_args}')
    children = location.children or []
    guard = one(children, 'limit_except', methods, f'host methods {location_args}')
    one(guard.children or [], 'deny', ('all',), f'host deny {location_args}')
    one(children, 'proxy_set_header', ('Authorization', ''), f'host credential strip {location_args}')
    one(children, 'proxy_set_header', ('X-Vercel-Forwarded-For', '$http_x_vercel_forwarded_for'), f'host client identity {location_args}')

compose_server = server_with_name(
    compose_tree,
    ('jnu-oss-hub.com', 'localhost', '127.0.0.1', '[::1]'),
)
compose_children = compose_server.children or []
compose_effective = {
    ('=', '/api/v1/auth/github'): (('GET',), 'oauth'),
    ('=', '/api/v1/auth/github/callback'): (('GET',), 'oauth'),
    ('=', '/api/v1/admin/collection/trigger'): (('POST',), 'admin_collection'),
    ('=', '/api/v1/admin/collection/discover-external'): (('POST',), 'admin_collection'),
    ('/api/v1/',): (('GET', 'HEAD', 'POST', 'PATCH', 'DELETE'), 'api'),
}
for location_args, (methods, zone) in compose_effective.items():
    location = one(compose_children, 'location', location_args, f'Compose location {location_args}')
    children = location.children or []
    guard = one(children, 'limit_except', methods, f'Compose methods {location_args}')
    one(guard.children or [], 'deny', ('all',), f'Compose deny {location_args}')
    one(children, 'limit_req', (f'zone={zone}', 'burst=5' if zone == 'oauth' else 'burst=1' if zone == 'admin_collection' else 'burst=30', 'nodelay'), f'Compose rate {location_args}')
    one(children, 'proxy_set_header', ('Authorization', ''), f'Compose credential strip {location_args}')
    one(children, 'proxy_set_header', ('X-Vercel-Forwarded-For', ''), f'Compose client strip {location_args}')

print('host nginx contract: ok')
PY
