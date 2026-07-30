#!/usr/bin/env bash
set -euo pipefail

# Compose nginx 제출 파일 업로드 경로 fail-closed 계약 검사 (G004 D6).
# 실제 nginx 기동 없이 결정론적으로 검증한다:
#   1) exact path location = /api/v1/submission-files 가 유효 구성으로 존재한다
#   2) trailing-slash/subpath location ^~ /api/v1/submission-files/ 가 유효 구성으로 존재한다
#   3) 두 블록 모두 최상위 무조건 return 403 이고 트리 전체 proxy_pass 가 없다
#   4) 무관한 /api/ 경로는 최상위 backend proxy 를 유지하고 차단 return 이 없다
# 인용·이스케이프·주석·세미콜론 묶음·중첩 블록을 인식하는 제한 nginx 파서로만 판정한다
# (정규식/라인 폴백 없음). 조건부·중첩-only return, 문자열 속 지시어 위장, sibling bare prefix
# 는 계약 위반. 위반·파일 부재는 exit 1.

config=${1:-deploy/nginx/nginx.conf}

if [[ ! -f "$config" ]]; then
  printf 'submission-upload-route contract: file not found: %s\n' "$config" >&2
  exit 1
fi

python3 - "$config" <<'PY'
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

PREFIX = 'submission-upload-route contract'


@dataclass
class Node:
    name: str
    args: tuple[str, ...]
    children: list[Node] | None


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


def require_fail_closed(description: str, matches: list[Node]) -> None:
    if len(matches) == 0:
        fail(f'missing effective {description}')
    if len(matches) > 1:
        fail(f'duplicate {description}')

    node = matches[0]
    assert node.children is not None

    if has_proxy_pass(node):
        fail(f'{description} still proxies upstream')

    top_returns = [child for child in node.children if child.name == 'return' and child.children is None]
    if not top_returns:
        # Nested-only / conditional returns do not satisfy fail-closed.
        nested_returns = [
            child for child in walk(node.children)
            if child.name == 'return' and child.children is None
        ]
        if nested_returns:
            fail(f'{description} return is conditional or nested-only; need unconditional top-level return 403')
        fail(f'{description} missing explicit return 403')

    if len(top_returns) != 1:
        fail(f'{description} has multiple top-level return directives')

    status = return_status(top_returns[0])
    if status is None:
        fail(f'{description} malformed return status')
    if status != '403':
        fail(f'{description} returns {status}; expected exact 403 fail-closed')


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

    exact_args = ('=', '/api/v1/submission-files')
    prefix_args = ('^~', '/api/v1/submission-files/')
    bare_prefix_args = ('^~', '/api/v1/submission-files')
    api_args = ('/api/',)

    exact = [node for node in locations if match_location(node, exact_args)]
    prefix = [node for node in locations if match_location(node, prefix_args)]
    bare = [node for node in locations if match_location(node, bare_prefix_args)]
    api = [node for node in locations if match_location(node, api_args)]

    if bare:
        fail('bare prefix ^~ /api/v1/submission-files over-matches sibling paths')

    require_fail_closed('exact submission-files location', exact)
    require_fail_closed('trailing-slash/subpath submission-files location', prefix)

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

    print(
        'submission-upload-route contract: ok '
        '(exact+prefix top-level deny 403, no proxy, /api/ intact, quote-aware parse)'
    )


if __name__ == '__main__':
    main()
PY
