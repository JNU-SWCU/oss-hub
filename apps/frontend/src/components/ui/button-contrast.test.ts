// Button의 **소비자 표면 대비**를 계산으로 지킨다 — destructive variant(아래 앞
// 절반)와 가입 무대의 반전 표면(뒤 절반).
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

// ---------------------------------------------------------------------------
// 가입 무대(`data-surface="inverted"`) 위 Button 대비.
//
// 여기서 대비가 무너지는 방식은 destructive와 다르다. 반전 스코프는 `--primary`를
// **덮지 않으므로**, 그 안의 `variant="link"`는 :root의 남색(#003399)을 그대로
// 입은 채 우주 바탕(#00133a) 위에 놓인다 — 1.68:1이다(QA43).
//
// 그런데 같은 `--primary`가 바로 옆 주 버튼에서는 **흰 바탕 글자색**이라
// (`signupPrimaryClassName = 'bg-cosmos-copy text-primary …'`) 토큰을 밝게 바꾸면
// 이쪽이 무너진다. 그래서 처방은 호출부 한 곳이고, 이 테스트는 두 방향을 함께
// 잰다 — 링크가 바탕에서 읽히는지, 그리고 그 대가로 주 버튼이 무너지지 않았는지.
// ---------------------------------------------------------------------------

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

/** 반전 스코프가 이기고, 덮지 않은 토큰은 :root로 떨어진다 — 캐스케이드 순서대로. */
const INVERTED_SCOPES = ["[data-surface='inverted'] {", ':root {'] as const;

/** 셀렉터 블록에서 토큰의 **원본 값 문자열**을 찾는다(hex든 `var(...)`든). */
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

/**
 * 반전 스코프 안에서 토큰이 실제로 갖는 hex.
 *
 * `--cosmos-void`처럼 ramp 사이에 없어 리터럴로 적힌 값과 palette를 가리키는 값을
 * 모두 받는다. 스코프 목록을 순서대로 훑으므로, 반전 스코프에 `--primary`가
 * 새로 추가되면 이 함수가 그 값을 집어 아래 주 버튼 단언이 곧바로 깨진다.
 */
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

/** `text-primary` · `bg-cosmos-copy` 같은 유틸리티를 CSS 토큰 이름으로 되돌린다. */
function tokenOfUtility(utility: string): string {
  return `--${utility.replace(/^(?:bg|text)-/, '')}`;
}

/**
 * 「GitHub 계정 만들기」 Button이 **실제로 입는** 글자 색 유틸리티.
 *
 * 호출부에 `text-*` 덮어쓰기가 없으면 variant 기본값(`link`의 `text-primary`)으로
 * 떨어진다 — 고친 클래스를 지웠을 때 이 테스트가 조용히 통과하지 않도록,
 * 되돌아갈 그 색을 그대로 재현한다.
 */
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
  // 무대의 바탕은 AppFrame이 칠한다. 여기 hex를 적어 두면 그쪽이 바뀔 때
  // 테스트만 옛 색으로 통과하므로, 그 소스에서 유틸리티를 읽어 온다.
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

    // variant 기본값은 `hover:underline`이라 hover 전에는 밑줄이 없다.
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
