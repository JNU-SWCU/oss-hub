#!/usr/bin/env python3
import argparse
import collections
import glob
import os
import re
import subprocess
import sys

DOCS = 'guide/src/content/docs'
SITE = 'guide/src/site.ts'
SOURCES = ('apps/frontend/src', 'apps/backend/src', 'packages')
CODE_EXT = ('.ts', '.tsx', '.json', '.html')
RUN = re.compile(r'[가-힣][가-힣0-9A-Za-z ·,.!?~()-]*[가-힣.!?]')


def norm(text):
    return re.sub(r'\s+', '', text)


def is_test(path):
    return '.spec.' in path or '.test.' in path or '__snapshots__' in path or '/e2e/' in path


def is_comment(line):
    return line.strip().startswith(('//', '*', '/*', '{/*'))


def korean_runs(line):
    if is_comment(line):
        return []
    return [r for r in RUN.findall(line) if len(norm(r)) >= 4]


def label_parts(label):
    parts = re.split(r'\{[^}]*\}|(?<![A-Za-z])N(?![A-Za-z])|\d+|…|/|·', label)
    return [norm(p) for p in parts if len(norm(p)) >= 2]


def diff_runs(diff_text):
    removed, added, path = set(), set(), ''
    for line in diff_text.splitlines():
        if line.startswith('+++ b/'):
            path = line[6:]
        elif line.startswith(('---', '+++')) or is_test(path):
            continue
        elif line.startswith('-'):
            removed.update(korean_runs(line[1:]))
        elif line.startswith('+'):
            added.update(korean_runs(line[1:]))
    return removed - added, added - removed


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout


def checked_commit():
    match = re.search(r"checkedCommit\s*=\s*'([0-9a-f]+)'", open(SITE, encoding='utf8').read())
    return match.group(1) if match else None


def source_blob():
    chunks = []
    for root in SOURCES:
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '__snapshots__')]
            for name in files:
                if name.endswith(CODE_EXT) and not is_test(name):
                    with open(os.path.join(folder, name), encoding='utf8', errors='ignore') as handle:
                        chunks.append(handle.read())
    return norm('\n'.join(chunks))


def doc_lines():
    for path in sorted(glob.glob(f'{DOCS}/**/*.mdx', recursive=True)):
        if '.omc' in path:
            continue
        with open(path, encoding='utf8') as handle:
            for number, line in enumerate(handle, 1):
                yield path.split('docs/')[1], number, line


def report_changes(base, blob):
    files = [f for f in git('diff', '--name-only', f'{base}..HEAD', '--', *SOURCES).split('\n') if f and not is_test(f)]
    print(f'## 바뀐 코드 파일 {len(files)}개 ({base[:9]}..HEAD)')
    for path in files:
        print(path)
    if not files:
        return
    removed, added = diff_runs(git('diff', '-U0', f'{base}..HEAD', '--', *SOURCES))
    gone = {norm(r): r for r in removed if norm(r) not in blob}
    pages = collections.defaultdict(list)
    docs_blob = []
    for page, number, line in doc_lines():
        flat = norm(line)
        docs_blob.append(flat)
        for key, run in gone.items():
            if key in flat:
                pages[page].append(f'{number}: {run}')
    print(f'\n## 사라진 문구를 쓰는 쪽 {len(pages)}개')
    for page, hits in sorted(pages.items()):
        print(page)
        for hit in hits:
            print(f'  {hit}')
    joined = ''.join(docs_blob)
    fresh = sorted(r for r in added if norm(r) not in joined)
    print(f'\n## 가이드에 없는 새 문구 {len(fresh)}개')
    for run in fresh:
        print(run)


def report_labels(blob):
    labels = collections.defaultdict(list)
    for page, number, line in doc_lines():
        if line.startswith(('import ', 'title:', 'description:')) or line.lstrip().startswith('#'):
            continue
        for label in re.findall(r'`([^`]+)`', line):
            if re.search(r'[가-힣]', label):
                labels[label].append(f'{page}:{number}')
    missing = {k: v for k, v in labels.items() if not all(p in blob for p in label_parts(k))}
    print(f'\n## 코드에서 그대로 찾지 못한 라벨 {len(missing)}개 / 전체 {len(labels)}개')
    for label, where in sorted(missing.items()):
        print(f'{label} | {", ".join(where[:3])}')


def self_test():
    assert korean_runs("  title: '제출 일정 확인'") == ['제출 일정 확인']
    assert korean_runs('// 주석 문장은 빼기') == []
    assert korean_runs("const a = '짧음'") == []
    assert label_parts('학생 N명') == ['학생']
    assert label_parts('Network 상태') == ['Network상태']
    assert label_parts('{프로그램} 신청이 승인되었습니다') == ['신청이승인되었습니다']
    diff = "+++ b/a.tsx\n-  '옛날 문구입니다'\n+  '새로운 문구입니다'\n-  '그대로 있는 문구'\n+  '그대로 있는 문구'\n+++ b/a.test.tsx\n-  '테스트 문구입니다'\n"
    assert diff_runs(diff) == ({'옛날 문구입니다'}, {'새로운 문구입니다'})
    print('self-test ok')


def main():
    parser = argparse.ArgumentParser(description='가이드와 코드가 어긋난 곳을 찾는다.')
    parser.add_argument('--base', help='기준 커밋. 없으면 site.ts의 checkedCommit')
    parser.add_argument('--labels-only', action='store_true', help='full 범위. 전체 라벨만 대조')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    blob = source_blob()
    if not args.labels_only:
        base = args.base or checked_commit()
        if not base or subprocess.run(['git', 'cat-file', '-e', f'{base}^{{commit}}'], capture_output=True).returncode:
            print(f'기준 커밋을 찾지 못했습니다: {base}. full로 실행하거나 --base를 주세요.', file=sys.stderr)
            return 2
        report_changes(base, blob)
    report_labels(blob)
    return 0


if __name__ == '__main__':
    sys.exit(main())
