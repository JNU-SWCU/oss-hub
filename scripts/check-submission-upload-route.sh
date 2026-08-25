#!/usr/bin/env bash
set -euo pipefail

# Compose nginx 제출 파일 경로가 backend로 프록시되는 계약 검사.
# 실제 nginx 기동 없이 결정론적으로 검증한다:
#   1) nginx location 선택 규칙(= → ^~ → 정규식 선언 순서 → 최장 prefix)을 그대로 모사한다
#   2) 제출 파일 경로(exact·descendant·대소문자 변형)가 모두 /api/ backend proxy로 선택된다
#   3) 해당 경로를 가로채는 4xx/5xx return location이 남아 있지 않다
#   4) sibling 경로(submission-files-export 등)와 무관한 /api/ 는 차단되지 않는다
#   5) /api/ 는 최상위 backend proxy 를 유지하고 차단 return 이 없다
# Nest(Express)는 라우트 대소문자를 구분하지 않는다. 차단 location을 제거하면 대소문자
# 변형도 /api/ 하나로 수렴하므로, 이전의 case-insensitive regex deny는 더 이상 필요 없다.
# 인용·이스케이프·주석·세미콜론 묶음·중첩 블록을 인식하는 제한 nginx 파서로만 판정한다
# (정규식/라인 폴백 없음). 조건부·중첩 return, 문자열 속 지시어 위장, sibling 과차단
# 은 계약 위반. 위반·파일 부재는 exit 1.

config=${1:-deploy/nginx/nginx.conf}

if [[ ! -f "$config" ]]; then
  printf 'submission-upload-route contract: file not found: %s\n' "$config" >&2
  exit 1
fi

python3 - "$config" <<'PY'
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import sys

PREFIX = 'submission-upload-route contract'

# backend proxy에 반드시 도달해야 하는 제출 파일 경로. 대소문자 변형은 Express 라우팅이
# 구분하지 않기 때문에 포함한다.
MUST_PROXY = (
    '/api/v1/submission-files',
    '/api/v1/Submission-Files',
    '/api/v1/SUBMISSION-FILES',
    '/api/v1/sUbMiSsIoN-fIlEs',
    '/api/v1/submission-files/',
    '/api/v1/submission-files/1',
    '/api/v1/Submission-Files/1',
)

# 차단이 번져서는 안 되는 경로. sibling 과차단과 무관 API 마비를 잡는다.
MUST_NOT_BLOCK = (
    '/api/v1/submission-files-export',
    '/api/v1/submission-filesXYZ',
    '/api/v1/submissions',
    '/api/v1/health',
)


@dataclass
class Node:
    name: str
    args: tuple[str, ...]
    children: list[Node] | None


MIN_UPLOAD_BODY_BYTES = 5 * 1024 * 1024


def _at_least_bytes(value: str, minimum: int) -> bool:
    """nginx size 문법(숫자 + 선택 k/m/g)을 바이트로 환산해 하한과 비교한다."""
    text = value.strip().lower()
    unit = 1
    if text.endswith('k'):
        unit, text = 1024, text[:-1]
    elif text.endswith('m'):
        unit, text = 1024 * 1024, text[:-1]
    elif text.endswith('g'):
        unit, text = 1024 * 1024 * 1024, text[:-1]
    if not text.isdigit():
        return False
    return int(text) * unit >= minimum


def fail(message: str) -> None:
    raise SystemExit(f'{PREFIX}: {message}')


def tokenize(text: str) -> list[str]:
    """Quote/escape/comment-aware nginx lexer. Quote state spans lines."""
    tokens: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    expect_delimiter = False
    i = 0
    length = len(text)

    def flush_bare() -> None:
        nonlocal current
        if current:
            tokens.append(''.join(current))
            current = []

    while i < length:
        ch = text[i]

        if escaped:
            current.append(ch)
            escaped = False
            i += 1
            continue

        if expect_delimiter:
            if ch.isspace() or ch in '{};#':
                expect_delimiter = False
            else:
                raise ValueError('adjacent quoted tokens without delimiter')

        if quote is not None:
            if ch == '\\':
                current.append(ch)
                escaped = True
            elif ch == quote:
                tokens.append(''.join(current))
                current = []
                quote = None
                expect_delimiter = True
            else:
                current.append(ch)
            i += 1
            continue

        if ch == '#':
            flush_bare()
            while i < length and text[i] != '\n':
                i += 1
            continue

        if ch in {"'", '"'}:
            if current:
                raise ValueError('quote adjacent to bare token')
            quote = ch
            i += 1
            continue

        if ch in '{};':
            flush_bare()
            tokens.append(ch)
            i += 1
            continue

        if ch.isspace():
            flush_bare()
            i += 1
            continue

        current.append(ch)
        i += 1

    if quote is not None or escaped:
        raise ValueError('unterminated quote or escape')
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


def location_nodes(tree: list[Node]) -> list[Node]:
    return [node for node in walk(tree) if node.name == 'location']


def match_location(node: Node, args: tuple[str, ...]) -> bool:
    return node.children is not None and node.args == args


def return_status(node: Node) -> str | None:
    if node.name != 'return' or node.children is not None or not node.args:
        return None
    status = node.args[0]
    if len(status) == 3 and status.isdigit():
        return status
    return None


def has_proxy_pass(node: Node) -> bool:
    for child in walk([node] if node.children is None else node.children):
        if child.name == 'proxy_pass' and child.children is None:
            return True
    return False


def top_level_proxy_backend(node: Node) -> bool:
    if node.children is None:
        return False
    for child in node.children:
        if (
            child.name == 'proxy_pass'
            and child.children is None
            and child.args == ('http://backend:4000',)
        ):
            return True
    return False


def blocking_returns(node: Node, *, top_level_only: bool) -> list[str]:
    statuses: list[str] = []
    if node.children is None:
        return statuses
    scope = node.children if top_level_only else walk(node.children)
    for child in scope:
        status = return_status(child)
        if status is not None and status[0] in '45':
            statuses.append(status)
    return statuses


def describe(node: Node) -> str:
    return 'location ' + ' '.join(node.args)


def select_location(locations: list[Node], path: str) -> Node | None:
    """nginx location 선택 규칙 모사: = → 최장 ^~ → 선언 순서 정규식 → 최장 prefix."""
    exact: Node | None = None
    best_prefix: Node | None = None
    best_length = -1
    regexes: list[Node] = []

    for node in locations:
        if node.children is None:
            continue
        args = node.args
        if len(args) == 2 and args[0] == '=':
            if args[1] == path:
                exact = node
        elif len(args) == 2 and args[0] == '^~':
            if path.startswith(args[1]) and len(args[1]) > best_length:
                best_prefix, best_length = node, len(args[1])
        elif len(args) == 2 and args[0] in {'~', '~*'}:
            regexes.append(node)
        elif len(args) == 1:
            if path.startswith(args[0]) and len(args[0]) > best_length:
                best_prefix, best_length = node, len(args[0])
        else:
            fail(f'unsupported location form: {describe(node)}')

    if exact is not None:
        return exact
    if best_prefix is not None and best_prefix.args[0] == '^~':
        return best_prefix
    for node in regexes:
        flags = re.IGNORECASE if node.args[0] == '~*' else 0
        try:
            if re.search(node.args[1], path, flags) is not None:
                return node
        except re.error as error:
            fail(f'malformed location regex {node.args[1]}: {error}')
    return best_prefix


def require_unique_locations(locations: list[Node]) -> None:
    seen: set[tuple[str, ...]] = set()
    for node in locations:
        if node.children is None:
            continue
        if node.args in seen:
            fail(f'duplicate {describe(node)}')
        seen.add(node.args)


def main() -> None:
    source = Path(sys.argv[1]).read_text()
    try:
        tokens = tokenize(source)
        tree, consumed = parse(tokens)
    except ValueError as error:
        fail(f'malformed nginx syntax: {error}')
    if consumed != len(tokens):
        fail('unconsumed nginx syntax')

    locations = location_nodes(tree)
    require_unique_locations(locations)

    api_args = ('/api/',)
    api = [node for node in locations if match_location(node, api_args)]

    if len(api) == 0:
        fail('missing effective location /api/ block')
    if len(api) > 1:
        fail('duplicate location /api/ block')

    api_node = api[0]
    if not top_level_proxy_backend(api_node):
        fail('location /api/ must keep backend proxy_pass')

    blocked = blocking_returns(api_node, top_level_only=False)
    if blocked:
        fail('location /api/ over-blocks unrelated routes')

    for path in MUST_PROXY:
        selected = select_location(locations, path)
        if selected is None:
            fail(f'{path} matches no location; backend proxy is unavailable')
        if selected is not api_node:
            fail(f'{path} selects {describe(selected)} instead of location /api/')
        if blocking_returns(selected, top_level_only=False):
            fail(f'{path} selects {describe(selected)} which blocks backend access')

    # 업로드 본문 한도. nginx 기본값 1m 이면 backend 가 허용하는 5MB 제출이 413 으로
    # 죽는다 — 차단 return 이 없어도 실질적으로 업로드가 막히므로 계약으로 고정한다.
    body_size = next(
        (
            child.args[0]
            for child in (api_node.children or [])
            if child.name == 'client_max_body_size'
            and child.children is None
            and child.args
        ),
        None,
    )
    if not body_size:
        fail(
            'location /api/ has no client_max_body_size; '
            'nginx defaults to 1m and rejects submissions larger than 1MB with 413'
        )
    if not _at_least_bytes(body_size, MIN_UPLOAD_BODY_BYTES):
        fail(
            f'location /api/ client_max_body_size {body_size} is below the backend '
            f'file limit; must allow at least {MIN_UPLOAD_BODY_BYTES} bytes'
        )

    for path in MUST_NOT_BLOCK:
        selected = select_location(locations, path)
        if selected is None:
            fail(f'{path} matches no location; unrelated route lost its proxy')
        if blocking_returns(selected, top_level_only=False):
            fail(f'{path} selects {describe(selected)} which over-blocks an unrelated route')

    # Increment A: compose nginx mirrors non-TLS headers and banner hiding.
    # Upload-route checks above stay fail-fast so existing fixtures fail for
    # the original reason.
    edge_errors: list[str] = []

    def edge(message: str) -> None:
        edge_errors.append(message)

    token_dirs = [node for node in walk(tree) if node.name == 'server_tokens']
    if any(node.args == ('on',) for node in token_dirs):
        edge('server_tokens on is forbidden')
    if not any(node.args == ('off',) for node in token_dirs):
        edge('server_tokens off is required')

    required_headers = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': (
            'accelerometer=(), camera=(), geolocation=(), gyroscope=(), '
            'magnetometer=(), microphone=(), payment=(), usb=()'
        ),
    }
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

    servers = [node for node in walk(tree) if node.name == 'server' and node.children is not None]
    if not servers:
        edge('missing server block')
    for server in servers:
        children = server.children or []
        if not any(
            child.name == 'proxy_hide_header'
            and child.children is None
            and child.args == ('X-Powered-By',)
            for child in children
        ):
            edge('server must hide upstream X-Powered-By')

        def header_values(name: str) -> list[tuple[str, ...]]:
            return [
                child.args[1:]
                for child in children
                if child.name == 'add_header'
                and child.children is None
                and child.args
                and child.args[0] == name
            ]

        for name, value in required_headers.items():
            if not any(args == (value, 'always') for args in header_values(name)):
                edge(f'server missing add_header {name} "{value}" always')

        csp_ok = False
        for args in header_values('Content-Security-Policy'):
            if len(args) != 2 or args[1] != 'always':
                continue
            if parse_csp(args[0]) == required_csp:
                csp_ok = True
                break
        if not csp_ok:
            edge(
                "server missing Content-Security-Policy "
                "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' always"
            )

    if edge_errors:
        fail('compose edge policy: ' + '; '.join(edge_errors))

    print(
        f'{PREFIX}: ok '
        f'(proxied={len(MUST_PROXY)} paths incl. case variants, '
        f'unblocked={len(MUST_NOT_BLOCK)} siblings, /api/ intact, upload body >= 5MB, '
        f'location-selection parse, compose edge policy)'
    )


if __name__ == '__main__':
    main()
PY
