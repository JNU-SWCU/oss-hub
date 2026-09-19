#!/usr/bin/env node
/**
 * globals.css → docs/design-tokens/tokens.json (Figma Tokens Studio 단일 파일).
 *
 * 토큰의 원본은 `apps/frontend/src/app/globals.css` 하나다(design.md R-36). 이 스크립트는
 * 그 파일을 읽어 Figma가 읽는 형식으로 옮겨 적을 뿐, 값을 만들지 않는다.
 *
 *   pnpm --filter frontend tokens:export   # 생성
 *   pnpm --filter frontend tokens:check    # 저장된 파일이 원본과 같은지 검사(다르면 1)
 *
 * 내보내는 것: primitive(팔레트·치수·글자 크기 계단), semantic 라이트(`:root`)·다크(`.dark`).
 * 내보내지 않는 것: `@theme inline`(Tailwind 유틸리티 이름 매핑, 코드 전용), `@media`,
 * `[data-surface]` 반전 표면 스코프(화면 한 곳의 재정의). 계산값(`color-mix`·`rgb(var…)`·
 * `calc`)은 Figma가 풀 수 없어 CSS 문자열 그대로 두고 `description`에 수동 지정임을 적는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CSS_PATH = resolve(here, '../src/app/globals.css');
export const OUT_PATH = resolve(
  here,
  '../../../docs/design-tokens/tokens.json',
);

const MANUAL_NOTE = 'CSS 계산값 — Figma에서 손으로 지정한다';

/** 주석을 지운다. 값 안에 `/*`가 올 일은 없다. */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 최상위 블록만 읽는다: `selector { body }`. 중첩 블록(`@media … { :root {…} }`)은
 * 통째로 하나의 최상위 블록이 되고, 그 selector가 `@`로 시작하므로 아래에서 걸러진다.
 */
export function topLevelBlocks(css) {
  const blocks = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    const head = css.slice(cursor, open);
    const selector = head.slice(head.lastIndexOf(';') + 1).trim();
    let depth = 1;
    let index = open + 1;
    while (index < css.length && depth > 0) {
      const char = css[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      index += 1;
    }
    blocks.push({ selector, body: css.slice(open + 1, index - 1) });
    cursor = index;
  }
  return blocks;
}

/** 블록 본문의 `--name: value;` 선언을 순서대로 돌려준다. */
export function declarations(body) {
  const found = [];
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found.push({ name: match[1], value: match[2].trim() });
  }
  return found;
}

const PRIMITIVE_PREFIXES = ['palette', 'space', 'step', 'measure'];
const GROUPED_PREFIXES = ['sidebar', 'hero', 'cosmos', 'chart'];

/** CSS 변수 이름 → 토큰 경로. `palette-navy-600` → `palette.navy.600`. */
export function tokenPath(name) {
  const [head, ...rest] = name.split('-');
  if (head === 'step') return ['fontSize', ...rest].join('.');
  if (head === 'palette' || head === 'space' || head === 'measure') {
    return [head, ...rest].join('.');
  }
  if (head === 'status') return name.split('-').join('.');
  if (GROUPED_PREFIXES.includes(head) && rest.length > 0) {
    return `${head}.${rest.join('-')}`;
  }
  return name;
}

export function tokenType(name) {
  const [head] = name.split('-');
  if (head === 'palette') return 'color';
  if (head === 'space') return 'spacing';
  if (head === 'measure') return 'sizing';
  if (head === 'step') return 'fontSizes';
  if (name.endsWith('-duration')) return 'other';
  if (name === 'radius' || name.endsWith('-radius')) return 'borderRadius';
  if (name.endsWith('-height') || name.endsWith('-width')) return 'sizing';
  if (name.endsWith('-padding')) return 'spacing';
  if (name.endsWith('-rgb')) return 'other';
  return 'color';
}

/** `var(--x)` 하나뿐인 값은 alias, 그 밖의 var()·함수가 섞인 값은 계산값이다. */
export function tokenValue(value) {
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  if (alias) return { value: `{${tokenPath(alias[1])}}` };
  if (/var\(|calc\(|color-mix\(|rgb\(/.test(value)) {
    return { value, description: MANUAL_NOTE };
  }
  return { value };
}

function setToken(set, path, token) {
  const parts = path.split('.');
  let node = set;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part];
  }
  node[parts.at(-1)] = token;
}

export function buildTokens(css) {
  const primitive = {};
  const dimension = {};
  const light = {};
  const dark = {};
  for (const { selector, body } of topLevelBlocks(stripComments(css))) {
    if (selector !== ':root' && selector !== '.dark') continue;
    for (const { name, value } of declarations(body)) {
      const token = { ...tokenValue(value), type: tokenType(name) };
      const head = name.split('-')[0];
      if (selector === '.dark') setToken(dark, tokenPath(name), token);
      else if (head === 'palette') setToken(primitive, tokenPath(name), token);
      else if (PRIMITIVE_PREFIXES.includes(head))
        setToken(dimension, tokenPath(name), token);
      else setToken(light, tokenPath(name), token);
    }
  }
  return {
    primitive,
    dimension,
    light,
    dark,
    $themes: [
      {
        id: 'light',
        name: 'Light',
        selectedTokenSets: {
          primitive: 'source',
          dimension: 'source',
          light: 'enabled',
        },
      },
      {
        id: 'dark',
        name: 'Dark',
        selectedTokenSets: {
          primitive: 'source',
          dimension: 'source',
          dark: 'enabled',
        },
      },
    ],
    $metadata: { tokenSetOrder: ['primitive', 'dimension', 'light', 'dark'] },
  };
}

export function renderTokens(css) {
  return `${JSON.stringify(buildTokens(css), null, 2)}\n`;
}

function main(argv) {
  const rendered = renderTokens(readFileSync(CSS_PATH, 'utf8'));
  if (argv.includes('--check')) {
    const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
    if (current !== rendered) {
      console.error(
        'design tokens: docs/design-tokens/tokens.json이 globals.css와 다르다. `pnpm --filter frontend tokens:export`를 실행한다.',
      );
      process.exit(1);
    }
    console.log('design tokens: 최신');
    return;
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, rendered);
  console.log(`design tokens: ${OUT_PATH} 작성`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
