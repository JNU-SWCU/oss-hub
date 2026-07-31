#!/usr/bin/env bash
set -euo pipefail

# Compose nginx 제출 파일 업로드 경로 fail-closed 계약 검사 (G004 D6).
# 실제 nginx 기동 없이 결정론적으로 검증한다:
#   1) nginx location 선택 규칙(= → ^~ → 정규식 선언 순서 → 최장 prefix)을 그대로 모사한다
#   2) 차단해야 하는 경로(exact·descendant·대소문자 변형)가 모두 fail-closed 블록으로 선택된다
#   3) 그 블록은 최상위 무조건 return 403 이고 트리 전체 proxy_pass 가 없다
#   4) sibling 경로(submission-files-export 등)와 무관한 /api/ 는 차단되지 않는다
#   5) /api/ 는 최상위 backend proxy 를 유지하고 차단 return 이 없다
# Nest(Express)는 라우트 대소문자를 구분하지 않으므로 대소문자를 구분하는 = · ^~ 만으로는
# /api/v1/Submission-Files 가 /api/ 프록시로 새어 backend 에 도달한다. 그래서 문자열 대조가 아니라
# 경로 선택 결과로 판정한다 — 차단 형태는 자유이나 우회 가능한 조합은 계약 위반이다.
# 인용·이스케이프·주석·세미콜론 묶음·중첩 블록을 인식하는 제한 nginx 파서로만 판정한다
# (정규식/라인 폴백 없음). 조건부·중첩-only return, 문자열 속 지시어 위장, sibling 과차단
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

# 업로드 차단이 반드시 걸려야 하는 경로. 대소문자 변형은 Express 라우팅이 대소문자를
# 구분하지 않기 때문에 포함한다(nginx 가 흘리면 backend 컨트롤러에 그대로 도달한다).
MUST_BLOCK = (
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


def fail_closed_defect(node: Node) -> str | None:
    if node.children is None:
        return 'is not a block'

    if has_proxy_pass(node):
        return 'still proxies upstream'

    top_returns = [child for child in node.children if child.name == 'return' and child.children is None]
    if not top_returns:
        nested_returns = [
            child for child in walk(node.children)
            if child.name == 'return' and child.children is None
        ]
        if nested_returns:
            return 'has only conditional or nested return; need unconditional top-level return 403'
        return 'has no explicit return 403'

    if len(top_returns) != 1:
        return 'has multiple top-level return directives'

    status = return_status(top_returns[0])
    if status is None:
        return 'has malformed return status'
    if status != '403':
        return f'returns {status}; expected exact 403 fail-closed'
    return None


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

    for path in MUST_BLOCK:
        selected = select_location(locations, path)
        if selected is None:
            fail(f'{path} matches no location; upload block is not effective')
        defect = fail_closed_defect(selected)
        if defect is not None:
            fail(f'{path} selects {describe(selected)} which {defect}')

    for path in MUST_NOT_BLOCK:
        selected = select_location(locations, path)
        if selected is None:
            fail(f'{path} matches no location; unrelated route lost its proxy')
        if blocking_returns(selected, top_level_only=False):
            fail(f'{path} selects {describe(selected)} which over-blocks an unrelated route')

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

    print(
        f'{PREFIX}: ok '
        f'(blocked={len(MUST_BLOCK)} paths incl. case variants, '
        f'unblocked={len(MUST_NOT_BLOCK)} siblings, /api/ intact, location-selection parse)'
    )


if __name__ == '__main__':
    main()
PY
