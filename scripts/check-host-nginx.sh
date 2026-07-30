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

echo 'host nginx contract: ok (IP TLS, ACME webroot, loopback Compose, exact parameterless POST-only Jenkins trigger)'
