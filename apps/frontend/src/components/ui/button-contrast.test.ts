import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.resolve(__dirname, '../../app/globals.css'),
  'utf-8',
);
const buttonSource = readFileSync(
  path.resolve(__dirname, './button.tsx'),
  'utf-8',
);

const AA_NORMAL_TEXT = 4.5;
const WCAG_NON_TEXT = 3;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function readPalette(source: string): Map<string, string> {
  const palette = new Map<string, string>();
  const pattern = /(--palette-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of stripComments(source).matchAll(pattern)) {
    palette.set(match[1], match[2]);
  }
  return palette;
}

function readTokenReference(
  source: string,
  selector: string,
  token: string,
): string {
  const clean = stripComments(source);
  const declaration = new RegExp(`${token}:\\s*var\\((--palette-[\\w-]+)\\)`);

  let searchFrom = 0;
  while (searchFrom < clean.length) {
    const blockStart = clean.indexOf(selector, searchFrom);
    if (blockStart === -1) {
      break;
    }
    const blockEnd = clean.indexOf('}', blockStart);
    const match = declaration.exec(clean.slice(blockStart, blockEnd));
    if (match) {
      return match[1];
    }
    searchFrom = blockEnd === -1 ? clean.length : blockEnd + 1;
  }
  throw new Error(`${selector} 블록에서 ${token} 선언을 찾지 못했습니다`);
}

function readOpacity(prefix: string): number {
  const match = new RegExp(`${prefix}/(\\d+)`).exec(buttonSource);
  if (!match) {
    throw new Error(`button.tsx에서 ${prefix}/NN 을 찾지 못했습니다`);
  }
  return Number(match[1]) / 100;
}

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function composite(foreground: string, background: string, alpha: number) {
  const fg = toRgb(foreground);
  const bg = toRgb(background);
  return `#${fg
    .map((channel, index) =>
      Math.round(alpha * channel + (1 - alpha) * bg[index])
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function relativeLuminance(hex: string): number {
  const channels = toRgb(hex).map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.03928
      ? ratio / 12.92
      : Math.pow((ratio + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (high + 0.05) / (low + 0.05);
}

const palette = readPalette(css);

function hexOf(selector: string, token: string): string {
  const reference = readTokenReference(css, selector, token);
  const hex = palette.get(reference);
  if (!hex) {
    throw new Error(`palette에 ${reference}가 없습니다`);
  }
  return hex;
}

interface Surface {
  readonly label: string;
  readonly selector: string;
  readonly parent: string;
  readonly baseOpacity: number;
  readonly hoverOpacity: number;
}

const LIGHT_BASE = readOpacity('bg-destructive');
const LIGHT_HOVER = readOpacity('hover:bg-destructive');
const DARK_BASE = readOpacity('dark:bg-destructive');
const DARK_HOVER = readOpacity('dark:hover:bg-destructive');

const SURFACES: Surface[] = [
  {
    label: '라이트 · 페이지 배경',
    selector: ':root {',
    parent: '--palette-white',
    baseOpacity: LIGHT_BASE,
    hoverOpacity: LIGHT_HOVER,
  },
  {
    label: '라이트 · muted 표면',
    selector: ':root {',
    parent: '--palette-gray-50',
    baseOpacity: LIGHT_BASE,
    hoverOpacity: LIGHT_HOVER,
  },

  {
    label: '다크 · 카드 표면',
    selector: '.dark {',
    parent: '--palette-gray-800',
    baseOpacity: DARK_BASE,
    hoverOpacity: DARK_HOVER,
  },
  {
    label: '다크 · 페이지 배경',
    selector: '.dark {',
    parent: '--palette-gray-900',
    baseOpacity: DARK_BASE,
    hoverOpacity: DARK_HOVER,
  },
];

describe('destructive Button 소비자 표면 대비', () => {
  it('배경 tint와 텍스트가 서로 다른 palette 단계를 참조한다', () => {
    for (const selector of [':root {', '.dark {']) {
      const tint = readTokenReference(css, selector, '--destructive');
      const text = readTokenReference(css, selector, '--destructive-on-tint');
      expect(text).not.toBe(tint);
    }
  });

  it('variant가 텍스트에 on-tint 토큰을 쓴다', () => {
    const variant = /destructive:\s*'([^']+)'/.exec(buttonSource)?.[1] ?? '';

    expect(variant).toContain('text-destructive-on-tint');

    expect(variant).not.toMatch(/text-destructive(?!-on-tint)/);
  });

  it.each(SURFACES)(
    '$label 에서 base·hover 모두 AA를 만족한다',
    ({ selector, parent, baseOpacity, hoverOpacity }) => {
      const tint = hexOf(selector, '--destructive');
      const text = hexOf(selector, '--destructive-on-tint');
      const parentHex = palette.get(parent);
      if (!parentHex) {
        throw new Error(`palette에 ${parent}가 없습니다`);
      }

      const base = contrast(text, composite(tint, parentHex, baseOpacity));
      const hover = contrast(text, composite(tint, parentHex, hoverOpacity));

      expect(base).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(hover).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );
});

describe('destructive Button focus indicator', () => {
  it.each(SURFACES)(
    '$label shared ring border meets WCAG non-text contrast',
    ({ selector, parent }) => {
      const ring = hexOf(selector, '--ring');
      const parentHex = palette.get(parent);
      if (!parentHex) {
        throw new Error(`palette에 ${parent}가 없습니다`);
      }

      expect(contrast(ring, parentHex)).toBeGreaterThanOrEqual(WCAG_NON_TEXT);
    },
  );

  it('inherits shared focus classes without destructive overrides', () => {
    const variant = /destructive:\s*'([^']+)'/.exec(buttonSource)?.[1] ?? '';

    expect(buttonSource).toContain('focus-visible:border-ring');
    expect(buttonSource).toContain('focus-visible:ring-ring/50');
    expect(variant).not.toMatch(
      /\b(?:dark:)?focus-visible:(?:border|ring)-[^\s']+/,
    );
  });
});

const signupEntrySource = readFileSync(
  path.resolve(__dirname, '../../app/signup/signup-entry-screen.tsx'),
  'utf-8',
);
const signupTypographySource = readFileSync(
  path.resolve(__dirname, '../signup-typography.tsx'),
  'utf-8',
);
const appFrameSource = readFileSync(
  path.resolve(__dirname, '../../app/_shell/app-frame.tsx'),
  'utf-8',
);

const INVERTED_SCOPES = ["[data-surface='inverted'] {", ':root {'] as const;

function findDeclaration(selector: string, token: string): string | null {
  const clean = stripComments(css);
  const declaration = new RegExp(`${token}:\\s*([^;]+);`);

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
      return match[1].trim();
    }
    searchFrom = blockEnd === -1 ? clean.length : blockEnd + 1;
  }
  return null;
}

function resolveInvertedHex(token: string): string {
  for (const selector of INVERTED_SCOPES) {
    const value = findDeclaration(selector, token);
    if (value === null) {
      continue;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      return value;
    }
    const reference = /^var\((--palette-[\w-]+)\)$/.exec(value);
    const hex = reference ? palette.get(reference[1]) : undefined;
    if (!hex) {
      throw new Error(`${token}의 값 "${value}"을 hex로 풀지 못했습니다`);
    }
    return hex;
  }
  throw new Error(`반전 스코프에서 ${token} 선언을 찾지 못했습니다`);
}

function tokenOfUtility(utility: string): string {
  return `--${utility.replace(/^(?:bg|text)-/, '')}`;
}

function readSignupExternalLinkTextUtility(): string {
  const opening = /<Button\b[^>]*variant="link"[^>]*>/.exec(signupEntrySource);
  if (!opening) {
    throw new Error(
      'signup-entry-screen.tsx에서 variant="link" Button을 찾지 못했습니다',
    );
  }
  const override = /\btext-([\w-]+)/.exec(opening[0]);
  if (override) {
    return `text-${override[1]}`;
  }

  const linkVariant = /\blink:\s*'([^']+)'/.exec(buttonSource)?.[1] ?? '';
  const fallback = /\btext-([\w-]+)/.exec(linkVariant);
  if (!fallback) {
    throw new Error('button.tsx의 link variant에서 글자 색을 찾지 못했습니다');
  }
  return `text-${fallback[1]}`;
}

describe('가입 무대 반전 표면 Button 대비', () => {
  const groundUtility = /\bbg-(cosmos-[\w-]+)/.exec(appFrameSource)?.[1];
  if (!groundUtility) {
    throw new Error('app-frame.tsx에서 우주 바탕 유틸리티를 찾지 못했습니다');
  }
  const ground = resolveInvertedHex(`--${groundUtility}`);

  it('「GitHub 계정 만들기」 링크가 우주 바탕에서 AA를 만족한다', () => {
    const text = resolveInvertedHex(
      tokenOfUtility(readSignupExternalLinkTextUtility()),
    );

    expect(contrast(text, ground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('링크임을 색만으로 알리지 않는다', () => {
    const opening = /<Button\b[^>]*variant="link"[^>]*>/.exec(
      signupEntrySource,
    )?.[0];

    expect(opening).toMatch(/\bunderline\b/);
  });

  it('주 버튼이 흰 바탕에서 AA를 만족한다 — 토큰을 밝게 바꾸면 여기서 깨진다', () => {
    const primaryClasses =
      /signupPrimaryClassName\s*=\s*'([^']+)'/.exec(
        signupTypographySource,
      )?.[1] ?? '';
    const background = /\bbg-([\w-]+?)(?:\/\d+)?(?:\s|$)/.exec(
      primaryClasses,
    )?.[1];
    const text = /\btext-([\w-]+)/.exec(primaryClasses)?.[1];
    if (!background || !text) {
      throw new Error(
        `signupPrimaryClassName("${primaryClasses}")에서 배경·글자 색을 찾지 못했습니다`,
      );
    }

    const ratio = contrast(
      resolveInvertedHex(`--${text}`),
      resolveInvertedHex(`--${background}`),
    );

    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
