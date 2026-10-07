import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.resolve(__dirname, '../../../app/globals.css'),
  'utf-8',
);
const screenSource = readFileSync(
  path.resolve(__dirname, './profile-affiliation-fields.tsx'),
  'utf-8',
);
const appFrameSource = readFileSync(
  path.resolve(__dirname, '../../../app/_shell/app-frame.tsx'),
  'utf-8',
);

const AA_NORMAL_TEXT = 4.5;

const CANVAS_PALETTE = '--palette-white';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function readPalette(source: string): Map<string, string> {
  const palette = new Map<string, string>();
  const pattern = /(--palette-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of stripComments(source).matchAll(pattern)) {
    palette.set(match[1]!, match[2]!);
  }
  return palette;
}

const palette = readPalette(css);

const INVERTED_SCOPES = ["[data-surface='inverted'] {", ':root {'] as const;

function findDeclaration(selector: string, token: string): string | null {
  const clean = stripComments(css);
  const declaration = new RegExp(`(?<![\\w-])${token}:\\s*([^;]+);`);

  let searchFrom = 0;
  while (searchFrom < clean.length) {
    const blockStart = clean.indexOf(selector, searchFrom);
    if (blockStart === -1) {
      break;
    }
    const blockEnd = clean.indexOf('}', blockStart);
    const match = declaration.exec(
      clean.slice(blockStart, blockEnd === -1 ? undefined : blockEnd),
    );
    if (match) {
      return match[1]!.trim();
    }
    searchFrom = blockEnd === -1 ? clean.length : blockEnd + 1;
  }
  return null;
}

function resolveInvertedHex(token: string, seen: string[] = []): string {
  if (seen.includes(token)) {
    throw new Error(`토큰 참조가 순환합니다: ${[...seen, token].join(' → ')}`);
  }
  const literal = palette.get(token);
  if (literal) {
    return literal;
  }
  for (const selector of INVERTED_SCOPES) {
    const value = findDeclaration(selector, token);
    if (value === null) {
      continue;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      return value;
    }
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference) {
      throw new Error(`${token}의 값 "${value}"을 hex로 풀지 못했습니다`);
    }
    return resolveInvertedHex(reference[1]!, [...seen, token]);
  }
  throw new Error(`반전 스코프에서 ${token} 선언을 찾지 못했습니다`);
}

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const channels = toRgb(hex).map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.03928
      ? ratio / 12.92
      : Math.pow((ratio + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (high! + 0.05) / (low! + 0.05);
}

function tokenOfUtility(utility: string): string {
  return `--${utility.replace(/^(?:bg|text)-/, '')}`;
}

function classNameOf(tag: string): string {
  const grouped = /className=\{cn\(([\s\S]*?)\)\}/.exec(tag);
  if (grouped) {
    const parts = [...grouped[1]!.matchAll(/'([^']+)'/g)].map(
      (part) => part[1]!,
    );
    if (parts.length === 0) {
      throw new Error('<Select>의 className 묶음이 비어 있습니다');
    }
    return parts.join(' ');
  }
  return /className="([^"]+)"/.exec(tag)?.[1] ?? '';
}

function readSelects(): ReadonlyArray<{
  readonly id: string;
  readonly className: string;
}> {
  const selects: { id: string; className: string }[] = [];
  let from = 0;
  for (;;) {
    const start = screenSource.indexOf('<Select', from);
    if (start === -1) break;
    const firstChild = screenSource.indexOf('<option', start);
    const end = firstChild === -1 ? screenSource.length : firstChild;
    const tag = screenSource.slice(start, end);
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    if (!id) {
      throw new Error(
        'profile-affiliation-fields.tsx에 id 없는 <Select>가 있습니다',
      );
    }
    selects.push({ id, className: classNameOf(tag) });
    from = end;
  }
  return selects;
}

const selects = readSelects();

function closedControlToken(selectClassName: string): string {
  const override = /(?:^|\s)text-([\w-]+)/.exec(selectClassName);
  return override ? tokenOfUtility(`text-${override[1]!}`) : '--foreground';
}

function optionHex(
  selectClassName: string,
  element: 'option' | 'optgroup',
): {
  readonly text: string;
  readonly background: string;
} {
  const text = new RegExp(`\\[&_${element}\\]:text-([\\w-]+)`).exec(
    selectClassName,
  );
  const background = new RegExp(`\\[&_${element}\\]:bg-([\\w-]+)`).exec(
    selectClassName,
  );

  return {
    text: resolveInvertedHex(
      text
        ? tokenOfUtility(`text-${text[1]!}`)
        : closedControlToken(selectClassName),
    ),
    background: resolveInvertedHex(
      background ? tokenOfUtility(`bg-${background[1]!}`) : CANVAS_PALETTE,
    ),
  };
}

it('가입 프로필의 선택 상자를 모두 읽는다(학과·소속 유형)', () => {
  expect(selects.map((select) => select.id).sort()).toEqual([
    'profile-affiliation-kind',
    'profile-department',
  ]);
});

describe.each(selects)('$id 열린 목록 대비', ({ className }) => {
  it.each(['option', 'optgroup'] as const)(
    '%s 이 자기 배경 위에서 AA를 만족한다',
    (element) => {
      const { text, background } = optionHex(className, element);

      expect(contrast(text, background)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );

  it.each(['option', 'optgroup'] as const)(
    '%s 이 배경을 스스로 정한다',
    (element) => {
      expect(className).toMatch(new RegExp(`\\[&_${element}\\]:bg-[\\w-]+`));
    },
  );

  it('닫힌 칸의 글자가 우주 바탕에서 AA를 만족한다', () => {
    const groundUtility = /\bbg-(cosmos-[\w-]+)/.exec(appFrameSource)?.[1];
    if (!groundUtility) {
      throw new Error('app-frame.tsx에서 우주 바탕 유틸리티를 찾지 못했습니다');
    }
    const text = resolveInvertedHex(closedControlToken(className));

    expect(
      contrast(text, resolveInvertedHex(`--${groundUtility}`)),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
