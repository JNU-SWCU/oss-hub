// destructive Button의 **소비자 표면 대비**를 계산으로 지킨다.
//
// 이 vitest 설정은 `environment: 'node'`라 CSS를 평가하지 않으므로, 토큰 값만
// 검사하면 실제 렌더 결과를 놓친다. 그리고 이 variant는 배경을 텍스트와 같은
// 토큰의 반투명 tint로 만들기 때문에(`bg-destructive/10`,
// `hover:bg-destructive/20`), 배경이 텍스트 색조로 물들어 **토큰 자체의 대비가
// 충분해도 합성 결과가 AA에 미달할 수 있다.** 실제로 그런 결함이 리뷰의 브라우저
// 프로브에서 발견됐다(라이트 hover 4.27:1, 다크 카드 hover 3.28:1).
//
// 그래서 globals.css의 palette와 button.tsx의 불투명도를 읽어 alpha 합성을
// 재현하고 base·hover를 라이트·다크 양쪽에서 검증한다.
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

/** `--palette-*: #hex;` 전체를 이름 → hex 맵으로 읽는다. */
function readPalette(source: string): Map<string, string> {
  const palette = new Map<string, string>();
  const pattern = /(--palette-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of stripComments(source).matchAll(pattern)) {
    palette.set(match[1], match[2]);
  }
  return palette;
}

/**
 * 지정한 셀렉터 블록에서 semantic 토큰이 참조하는 palette 이름을 찾는다.
 *
 * `:root {`는 primitive palette 블록과 semantic 블록 두 곳에 등장하므로, 첫 블록만
 * 보면 안 된다 — 해당 토큰을 실제로 선언한 블록까지 이어서 찾는다.
 */
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

/** button.tsx의 destructive variant에서 `prefix/NN` 형태의 불투명도를 읽는다. */
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

/** CSS alpha 합성은 sRGB 공간에서 일어난다 — 채널별 선형 보간이다. */
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
  // 라이트에서 이 버튼이 놓이는 표면 — 페이지 배경(흰색)과 muted 표면.
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
  // 다크에서는 카드(gray-800)가 페이지 배경(gray-900)보다 밝아 카드 쪽이 불리하다.
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
    // 같은 단계를 쓰면 배경이 텍스트 색조로 물들어 대비가 상한에 갇힌다.
    for (const selector of [':root {', '.dark {']) {
      const tint = readTokenReference(css, selector, '--destructive');
      const text = readTokenReference(css, selector, '--destructive-on-tint');
      expect(text).not.toBe(tint);
    }
  });

  it('variant가 텍스트에 on-tint 토큰을 쓴다', () => {
    const variant = /destructive:\s*'([^']+)'/.exec(buttonSource)?.[1] ?? '';

    expect(variant).toContain('text-destructive-on-tint');
    // `text-destructive`가 남아 있으면 tint와 같은 토큰으로 되돌아간 것이다.
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
