#!/usr/bin/env bash
set -euo pipefail

config=${1:-deploy/host-nginx/oss-hub.conf}

if [[ ! -f "$config" ]]; then
  printf 'host nginx contract: file not found: %s\n' "$config" >&2
  exit 1
fi

active_config=$(mktemp "${TMPDIR:-/tmp}/host-nginx-active.XXXXXX")
trap 'rm -f "$active_config"' EXIT

# Strip comments only outside quotes. Quote state spans physical lines so a
# multiline quoted value may legally contain '#'. All subsequent textual checks
# inspect active nginx syntax rather than documentation markers.
python3 - "$config" "$active_config" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()

def strip_comments(text: str) -> str:
    result: list[str] = []
    quote: str | None = None
    escape = False
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if escape:
            result.append(ch)
            escape = False
            i += 1
            continue
        if quote is not None:
            result.append(ch)
            if ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in {"'", '"'}:
            quote = ch
            result.append(ch)
            i += 1
            continue
        if ch == '#':
            while i < length and text[i] != '\n':
                i += 1
            continue
        result.append(ch)
        i += 1
    if quote is not None or escape:
        raise SystemExit('host nginx contract: malformed nginx syntax: unterminated quote or escape in comment strip')
    return ''.join(result)

Path(sys.argv[2]).write_text(strip_comments(source))
PY

count_fixed() {
  local pattern=$1
  { grep -F -- "$pattern" "$active_config" || true; } | wc -l | tr -d ' '
}

require_count() {
  local description=$1
  local pattern=$2
  local expected=${3:-1}
  local actual
  actual=$(count_fixed "$pattern")
  if ((actual != expected)); then
    printf 'host nginx contract: %s (expected=%s, actual=%s)\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

require_count 'production EIP server_name' 'server_name 54.116.116.174;' 2
require_count 'public HTTP listener' 'listen 80;'
require_count 'public HTTPS listener' 'listen 443 ssl;'
require_count 'public HTTPS IPv6 listener' 'listen [::]:443 ssl;'
require_count 'short-lived IP fullchain path' 'ssl_certificate /etc/letsencrypt/live/54.116.116.174/fullchain.pem;'
require_count 'short-lived IP private key path' 'ssl_certificate_key /etc/letsencrypt/live/54.116.116.174/privkey.pem;'
require_count 'ACME HTTP-01 webroot' 'root /var/www/certbot;'
require_count 'HTTP to HTTPS redirect' 'return 308 https://$host$request_uri;'
require_count 'loopback Compose upstream' 'server 127.0.0.1:8081;'
require_count 'Jenkins trigger rate-limit zone' 'limit_req_zone $binary_remote_addr zone=jenkins_trigger:10m rate=5r/m;'

# Parse into an effective directive tree. Exact allowlisting rejects comments,
# duplicates, extra access directives, wrong nesting, wildcard locations,
# protection drift, non-HTTPS ancestry, and Jenkins upstream leakage.
python3 - "$active_config" <<'PY'
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import sys

@dataclass
class Node:
    name: str
    args: tuple[str, ...]
    children: list['Node'] | None

def tokenize(text: str) -> list[str]:
    """Nginx-like lexer: quote state spans lines; a closing quote requires a delimiter."""
    tokens: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    expect_delimiter = False

    def flush_bare() -> None:
        nonlocal current
        if current:
            tokens.append(''.join(current))
            current = []

    for char in text:
        if escaped:
            current.append(char)
            escaped = False
            continue

        if expect_delimiter:
            if char.isspace() or char in '{};':
                expect_delimiter = False
            else:
                raise ValueError('adjacent quoted tokens without delimiter')

        if quote is not None:
            if char == '\\':
                current.append(char)
                escaped = True
            elif char == quote:
                tokens.append(''.join(current))
                current = []
                quote = None
                expect_delimiter = True
            else:
                current.append(char)
            continue

        if char in {"'", '"'}:
            if current:
                raise ValueError('quote adjacent to bare token')
            quote = char
        elif char in '{};':
            flush_bare()
            tokens.append(char)
        elif char.isspace():
            flush_bare()
        else:
            current.append(char)

    if quote is not None or escaped:
        raise ValueError('unterminated quote or escape')
    if expect_delimiter:
        # EOF counts as a delimiter after a closing quote.
        pass
    flush_bare()
    return tokens

def parse(tokens: list[str], index: int = 0, nested: bool = False) -> tuple[list[Node], int]:
    nodes: list[Node] = []
    words: list[str] = []
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token == ';':
            if not words:
                raise ValueError('empty directive')
            nodes.append(Node(words[0], tuple(words[1:]), None))
            words = []
        elif token == '{':
            if not words:
                raise ValueError('anonymous block')
            children, index = parse(tokens, index, True)
            nodes.append(Node(words[0], tuple(words[1:]), children))
            words = []
        elif token == '}':
            if words:
                raise ValueError('unterminated directive before closing brace')
            if not nested:
                raise ValueError('unexpected closing brace')
            return nodes, index
        else:
            words.append(token)
    if nested:
        raise ValueError('unclosed block')
    if words:
        raise ValueError('directive missing semicolon')
    return nodes, index

def walk(nodes: list[Node]):
    for node in nodes:
        yield node
        if node.children is not None:
            yield from walk(node.children)

def walk_with_ancestors(nodes: list[Node], ancestors: tuple[Node, ...] = ()):
    for node in nodes:
        yield node, ancestors
        if node.children is not None:
            yield from walk_with_ancestors(node.children, ancestors + (node,))

def fail(message: str) -> None:
    raise SystemExit(f'host nginx contract: {message}')

def is_public_tls_443_server(node: Node) -> bool:
    if node.name != 'server' or node.children is None:
        return False
    for child in node.children:
        if child.name != 'listen':
            continue
        # listen 443 ssl;  /  listen [::]:443 ssl;
        if not child.args:
            continue
        addr = child.args[0]
        if addr in {'443', '[::]:443'} and 'ssl' in child.args[1:]:
            return True
    return False

def refers_to_jenkins_upstream(node: Node) -> bool:
    # Production Jenkins loopback listener. Any reference outside the exact
    # public HTTPS trigger location is a public routing leak.
    return any('127.0.0.1:8080' in arg for arg in node.args)

try:
    tokens = tokenize(Path(sys.argv[1]).read_text())
    tree, consumed = parse(tokens)
except ValueError as error:
    fail(f'malformed nginx syntax: {error}')
if consumed != len(tokens):
    fail('unconsumed nginx syntax')

new = ('=', '/job/oss-hub-release-cd/build')
allowed_location_args = {new}

tls_servers = [node for node in walk(tree) if is_public_tls_443_server(node)]
if len(tls_servers) != 1:
    fail(f'public TLS 443 server count={len(tls_servers)}, expected=1')
tls_server = tls_servers[0]
if tls_server.children is None:
    fail('public TLS 443 server must be a block')

direct_job_locations = [
    child for child in tls_server.children
    if child.name == 'location' and child.args in allowed_location_args
]
new_matches = [node for node in direct_job_locations if node.args == new]
if len(new_matches) != 1:
    fail(f'exact Jenkins trigger location as direct TLS child count={len(new_matches)}, expected=1')

job_locations = [
    node for node in walk(tree)
    if node.name == 'location' and any('/job/' in arg for arg in node.args)
]
if len(job_locations) != 1:
    fail('only the exact parameterless Jenkins job location is allowed')
allowed_nodes = new_matches
allowed_ids = {id(node) for node in allowed_nodes}
if {id(node) for node in job_locations} != allowed_ids:
    fail('Jenkins trigger location must be a direct child of the unique public TLS 443 server')

if any(node.name == 'include' for node in walk(tree)):
    fail('unexpanded include directives are not allowed in the canonical host config')
if any(node.name == 'error_page' and '403' in node.args for node in walk(tree)):
    fail('error_page must not remap the Jenkins 403 denial')

for node, ancestors in walk_with_ancestors(tree):
    if not refers_to_jenkins_upstream(node):
        continue
    if any(id(ancestor) in allowed_ids for ancestor in ancestors):
        continue
    fail('Jenkins upstream reference outside the exact public HTTPS trigger location')

expected_directives = Counter({
    ('client_max_body_size', ('8k',)): 1,
    ('limit_req', ('zone=jenkins_trigger', 'burst=5', 'nodelay')): 1,
    ('limit_req_status', ('429',)): 1,
    ('proxy_pass', ('http://127.0.0.1:8080',)): 1,
    ('proxy_http_version', ('1.1',)): 1,
    ('proxy_set_header', ('Host', '$host')): 1,
    ('proxy_set_header', ('X-Real-IP', '$remote_addr')): 1,
    ('proxy_set_header', ('X-Forwarded-For', '$proxy_add_x_forwarded_for')): 1,
    ('proxy_set_header', ('X-Forwarded-Proto', '$scheme')): 1,
})
for node in allowed_nodes:
    if node.children is None:
        fail('Jenkins location must be a block')
    limit_blocks = [child for child in node.children if child.name == 'limit_except']
    if len(limit_blocks) != 1 or limit_blocks[0].args != ('POST',):
        fail(f'{node.args[-1]} must contain exactly one limit_except POST block')
    limit_children = limit_blocks[0].children
    if limit_children is None or len(limit_children) != 1:
        fail(f'{node.args[-1]} limit_except POST must contain only deny all')
    deny = limit_children[0]
    if deny.name != 'deny' or deny.args != ('all',) or deny.children is not None:
        fail(f'{node.args[-1]} limit_except POST must contain active deny all')
    flat = Counter(
        (child.name, child.args)
        for child in node.children
        if child.name != 'limit_except' and child.children is None
    )
    if any(child.children is not None for child in node.children if child.name != 'limit_except'):
        fail(f'{node.args[-1]} contains an unexpected nested block')
    if flat != expected_directives:
        missing = expected_directives - flat
        extra = flat - expected_directives
        fail(f'{node.args[-1]} protection directives differ (missing={dict(missing)}, extra={dict(extra)})')

# Increment A public edge policy. Existing Jenkins allowlists stay fail-fast
# above so mutated Jenkins fixtures still fail for the original reason.
edge_errors: list[str] = []

def edge(message: str) -> None:
    edge_errors.append(message)

def directive_size_bytes(value: str) -> int:
    text = value.strip().lower()
    unit = 1
    if text.endswith('k'):
        unit, text = 1024, text[:-1]
    elif text.endswith('m'):
        unit, text = 1024 * 1024, text[:-1]
    elif text.endswith('g'):
        unit, text = 1024 * 1024 * 1024, text[:-1]
    if not text.isdigit():
        return 0
    return int(text) * unit

token_dirs = [node for node in walk(tree) if node.name == 'server_tokens']
if any(node.args == ('on',) for node in token_dirs):
    edge('server_tokens on is forbidden')
if not any(node.args == ('off',) for node in token_dirs):
    edge('server_tokens off is required')

required_zones = {
    ('$binary_remote_addr', 'zone=api:10m', 'rate=10r/s'),
    ('$binary_remote_addr', 'zone=oauth:10m', 'rate=10r/m'),
    ('$binary_remote_addr', 'zone=admin_collection:10m', 'rate=2r/m'),
}
present_zones = {
    node.args
    for node in walk(tree)
    if node.name == 'limit_req_zone' and node.children is None
}
for zone in sorted(required_zones):
    if zone not in present_zones:
        edge(f'missing limit_req_zone {" ".join(zone)}')

tls_children = tls_server.children or []
if not any(
    child.name == 'proxy_hide_header'
    and child.children is None
    and child.args == ('X-Powered-By',)
    for child in tls_children
):
    edge('TLS server must hide upstream X-Powered-By')

def header_values(name: str) -> list[tuple[str, ...]]:
    return [
        child.args[1:]
        for child in tls_children
        if child.name == 'add_header' and child.children is None and child.args and child.args[0] == name
    ]

def require_header(name: str, value: str) -> None:
    if not any(args == (value, 'always') for args in header_values(name)):
        edge(f'TLS server missing add_header {name} "{value}" always')

require_header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
require_header('X-Content-Type-Options', 'nosniff')
require_header('X-Frame-Options', 'DENY')
require_header('Referrer-Policy', 'strict-origin-when-cross-origin')
require_header(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
)

required_csp = {
    'base-uri': "'self'",
    'object-src': "'none'",
    'frame-ancestors': "'none'",
    'form-action': "'self'",
}

def parse_csp(value: str) -> dict[str, str] | None:
    parsed: dict[str, str] = {}
    for part in value.split(';'):
        part = part.strip()
        if not part:
            continue
        name, _, rest = part.partition(' ')
        if not name or name in parsed:
            return None
        parsed[name] = rest.strip()
    return parsed

csp_ok = False
for args in header_values('Content-Security-Policy'):
    if len(args) != 2 or args[1] != 'always':
        continue
    if parse_csp(args[0]) == required_csp:
        csp_ok = True
        break
if not csp_ok:
    edge(
        "TLS server missing Content-Security-Policy "
        "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' always"
    )

def tls_location(args: tuple[str, ...]) -> Node | None:
    matches = [
        child for child in tls_children
        if child.name == 'location' and child.args == args and child.children is not None
    ]
    if len(matches) != 1:
        return None
    return matches[0]

def has_limit(node: Node, zone: str, burst: str) -> bool:
    wanted = {f'zone={zone}', f'burst={burst}', 'nodelay'}
    return any(
        child.name == 'limit_req' and child.children is None and wanted.issubset(set(child.args))
        for child in (node.children or [])
    )

def has_status_429(node: Node) -> bool:
    return any(
        child.name == 'limit_req_status' and child.children is None and child.args == ('429',)
        for child in (node.children or [])
    )

def proxies_compose(node: Node) -> bool:
    allowed = {'http://oss_hub_compose', 'http://127.0.0.1:8081'}
    return any(
        child.name == 'proxy_pass' and child.children is None and child.args and child.args[0] in allowed
        for child in (node.children or [])
    )

def has_upload_body(node: Node) -> bool:
    return any(
        child.name == 'client_max_body_size'
        and child.children is None
        and child.args
        and directive_size_bytes(child.args[0]) >= 5 * 1024 * 1024
        for child in (node.children or [])
    )

limited_locations = (
    (('/api/',), 'api', '30', True, 'general /api/'),
    (('=', '/api/v1/auth/github'), 'oauth', '5', False, 'OAuth start'),
    (('=', '/api/v1/auth/github/callback'), 'oauth', '5', False, 'OAuth callback'),
    (('=', '/api/v1/admin/collection/trigger'), 'admin_collection', '1', False, 'admin collection trigger'),
    (('=', '/api/v1/admin/collection/discover-external'), 'admin_collection', '1', False, 'admin collection discovery'),
)
for args, zone, burst, need_body, label in limited_locations:
    node = tls_location(args)
    if node is None:
        edge(f'TLS server missing active {label} location {" ".join(args)}')
        continue
    if not has_limit(node, zone, burst):
        edge(f'{label} location must apply limit_req zone={zone} burst={burst} nodelay')
    if not has_status_429(node):
        edge(f'{label} location must set limit_req_status 429')
    if not proxies_compose(node):
        edge(f'{label} location must proxy_pass the Compose upstream')
    if need_body and not has_upload_body(node):
        edge(f'{label} location must keep client_max_body_size >= 5MB')

# The OAuth callback URL carries `code`+`state`. Because a location `add_header`
# discards every inherited server-level header, the callback location must
# re-declare Referrer-Policy with the stricter `no-referrer` (the server-level
# default is `strict-origin-when-cross-origin`, which would leak the full
# callback URL as Referer on same-origin navigations). Mirrors deploy/nginx/nginx.conf.
def location_has_header(node: Node, name: str, value: str) -> bool:
    return any(
        child.name == 'add_header'
        and child.children is None
        and child.args == (name, value, 'always')
        for child in (node.children or [])
    )

callback_node = tls_location(('=', '/api/v1/auth/github/callback'))
if callback_node is None:
    edge('TLS server missing OAuth callback location for Referrer-Policy check')
elif not location_has_header(callback_node, 'Referrer-Policy', 'no-referrer'):
    edge('OAuth callback location must set add_header Referrer-Policy "no-referrer" always')

if edge_errors:
    fail('public edge policy: ' + '; '.join(edge_errors))
PY

log_format=$(awk '
  /log_format oss_hub_safe/ { capture=1 }
  capture { print }
  capture && /;/ { exit }
' "$active_config")
if [[ -z "$log_format" ]]; then
  echo 'host nginx contract: missing oss_hub_safe log format' >&2
  exit 1
fi
if grep -Eq '\$request([^_a-zA-Z0-9]|$)|\$request_uri([^_a-zA-Z0-9]|$)|\$args([^_a-zA-Z0-9]|$)|\$query_string([^_a-zA-Z0-9]|$)' <<<"$log_format"; then
  echo 'host nginx contract: access log must not include request target or query string' >&2
  exit 1
fi

# 제출 파일 업로드가 지나는 앱 경로(location /api/)의 본문 한도. nginx 기본값 1m 이면
# backend 가 허용하는 5MB 제출이 Compose nginx 에 닿기도 전에 413 으로 죽는다.
# checkpoint B 뒤 public catch-all(location /)은 proxy 없이 canonical origin 으로만 보낸다.
if ! python3 - "$active_config" <<'PYEOF'
import re, sys

MIN_BYTES = 5 * 1024 * 1024
text = open(sys.argv[1], encoding='utf-8').read()


def to_bytes(value: str) -> int:
    v = value.strip().lower()
    unit = 1
    if v.endswith('k'):
        unit, v = 1024, v[:-1]
    elif v.endswith('m'):
        unit, v = 1024 * 1024, v[:-1]
    elif v.endswith('g'):
        unit, v = 1024 * 1024 * 1024, v[:-1]
    return int(v) * unit if v.isdigit() else 0


def block_of(match) -> str:
    depth, i = 1, match.end()
    while i < len(text) and depth:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    return text[match.end():i]


# 업로드가 실제로 지나는 proxy 경로는 /api/ 다.
best = None
for m in re.finditer(r'location\s+/api/\s*\{', text):
    block = block_of(m)
    if 'proxy_pass' not in block:
        continue
    found = re.search(r'client_max_body_size\s+([0-9]+[kKmMgG]?)\s*;', block)
    if not found:
        print(
            'host nginx contract: location /api/ has no client_max_body_size; '
            'nginx defaults to 1m and rejects submissions larger than 1MB with 413',
            file=sys.stderr,
        )
        raise SystemExit(1)
    best = found.group(1)

if best is None:
    print('host nginx contract: no proxying location /api/ found', file=sys.stderr)
    raise SystemExit(1)
if to_bytes(best) < MIN_BYTES:
    print(
        f'host nginx contract: location /api/ client_max_body_size {best} '
        'is below the backend 5MB file limit',
        file=sys.stderr,
    )
    raise SystemExit(1)

# checkpoint B: TLS server 의 public catch-all 은 proxy 를 가질 수 없고
# canonical origin 308(GET/HEAD) + 404 로만 닫혀야 한다.
catch_all_ok = False
for m in re.finditer(r'location\s+/\s*\{', text):
    block = block_of(m)
    if 'proxy_pass' in block:
        print(
            'host nginx contract: public catch-all still proxies; '
            'checkpoint B requires an API-only public ingress',
            file=sys.stderr,
        )
        raise SystemExit(1)
    if 'return 308 https://jnu-oss-hub.com$request_uri' in block and 'return 404' in block:
        catch_all_ok = True

if not catch_all_ok:
    print(
        'host nginx contract: fail-closed canonical catch-all is missing',
        file=sys.stderr,
    )
    raise SystemExit(1)
PYEOF
then
  exit 1
fi

echo 'host nginx contract: ok (IP TLS, ACME webroot, loopback Compose, exact parameterless POST-only Jenkins trigger, upload body >= 5MB, API-only public edge)'
