#!/usr/bin/env node

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

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

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

export function declarations(body) {
  const found = [];
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found.push({ name: match[1], value: match[2].trim() });
  }
  return found;
}

const PRIMITIVE_PREFIXES = ['palette', 'space', 'step', 'measure'];
const GROUPED_PREFIXES = ['sidebar', 'hero', 'cosmos', 'chart'];

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
