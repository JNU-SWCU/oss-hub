// 학과 선택 목록(`<select>`)의 **열린 목록** 대비를 계산으로 지킨다(QA34).
//
// 여기서 대비가 무너지는 방식은 화면 안 요소와 다르다. 열린 목록은 페이지가 아니라
// 브라우저가 그린다 — 페이지가 정하는 것은 `option`·`optgroup`의 글자색·배경색뿐이고,
// 그 뒤에 깔리는 바탕은 시스템 `Canvas`다. 그런데 이 화면은 가입 무대
// (`app/_shell/signup-stage.tsx`의 `data-surface="inverted"`) 안이라 `color`가
// `--hero-foreground`(흰색)로 상속되고, 규격(`components/ui/select`)은 `bg-transparent`다.
// 그래서 아무 것도 덧대지 않으면 **흰 글자가 흰 Canvas 위에 얹혀 1.00:1**이 되고,
// 마우스가 얹힌 한 줄만 강조색 덕에 읽힌다 — QA34가 본 그 화면이다.
//
// 실측(Chrome 1280×900, `/onboarding/profile`): 고치기 전 `option`의 computed
// `color` rgb(255,255,255) · `background-color` rgba(0,0,0,0) · 같은 문서에서
// `background-color: Canvas`를 심어 잰 값 rgb(255,255,255).
//
// 이 vitest 설정은 `environment: 'node'`라 CSS를 평가하지 않으므로,
// `components/ui/button-contrast.test.ts`와 같은 방식으로 globals.css의 palette와
// 호출부 소스를 읽어 대비를 재현한다. 두 방향을 함께 잰다 — 열린 목록이 읽히는지,
// 그리고 그 대가로 **닫힌 칸**이 어두운 무대에서 무너지지 않았는지.
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

/**
 * 열린 목록 뒤에 깔리는 시스템 바탕.
 *
 * 페이지가 정하지 못하는 값이라 토큰이 없다. 위 주석의 실측대로 이 문서의
 * `Canvas`는 흰색이므로 palette의 흰색을 그 자리에 놓는다 — 리터럴 hex를 새로 적지
 * 않기 위해서다.
 */
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

/** 반전 스코프가 이기고, 덮지 않은 토큰은 `:root`로 떨어진다 — 캐스케이드 순서대로. */
const INVERTED_SCOPES = ["[data-surface='inverted'] {", ':root {'] as const;

/**
 * 셀렉터 블록에서 토큰의 **원본 값 문자열**을 찾는다(hex든 `var(...)`든).
 *
 * 토큰 이름 앞에 경계를 요구한다 — 그러지 않으면 `--foreground`를 찾을 때
 * `--muted-foreground` 선언에도 걸린다.
 */
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

/**
 * 반전 스코프 안에서 토큰이 실제로 갖는 hex.
 *
 * `--foreground`처럼 다른 토큰을 한 번 더 가리키는 값이 있어(반전 스코프의
 * `--foreground: var(--hero-foreground)`) 참조를 끝까지 따라간다.
 */
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

/** `text-popover-foreground` 같은 유틸리티를 CSS 토큰 이름으로 되돌린다. */
function tokenOfUtility(utility: string): string {
  return `--${utility.replace(/^(?:bg|text)-/, '')}`;
}

/** 학과 `<Select>`가 실제로 입는 클래스 목록. */
function readDepartmentSelectClassName(): string {
  const start = screenSource.indexOf('<Select');
  if (start === -1) {
    throw new Error(
      'profile-affiliation-fields.tsx에서 <Select>를 찾지 못했습니다',
    );
  }
  const match = /className="([^"]+)"/.exec(screenSource.slice(start));
  if (!match) {
    throw new Error('학과 <Select>의 className을 찾지 못했습니다');
  }
  return match[1]!;
}

const selectClassName = readDepartmentSelectClassName();

/**
 * 닫힌 칸의 글자색 토큰.
 *
 * 변형(`aria-invalid:` · `dark:` · `[&_option]:` 등)이 붙지 않은 맨 `text-*`만
 * 닫힌 칸의 색이다. 없으면 무대가 상속시키는 `--foreground`로 떨어진다. 목록 항목도
 * 스스로 색을 정하지 않으면 이 값을 그대로 물려받으므로 아래에서 함께 쓴다.
 */
const closedControlToken = (() => {
  const override = /(?:^|\s)text-([\w-]+)/.exec(selectClassName);
  return override ? tokenOfUtility(`text-${override[1]!}`) : '--foreground';
})();

/**
 * 목록 항목이 **실제로 입는** 색 유틸리티.
 *
 * 호출부에 덧댄 것이 없으면 규격·상속으로 떨어진다 — 글자는 닫힌 칸에서 물려받고
 * (덮어쓴 것이 없으면 무대의 `--foreground`, 즉 흰색), 배경은 `bg-transparent`라
 * 시스템 Canvas가 그대로 비친다. 고친 클래스를 지웠을 때 이 테스트가 조용히
 * 통과하지 않도록 그 상태를 그대로 재현한다.
 */
function optionHex(element: 'option' | 'optgroup'): {
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
      text ? tokenOfUtility(`text-${text[1]!}`) : closedControlToken,
    ),
    background: resolveInvertedHex(
      background ? tokenOfUtility(`bg-${background[1]!}`) : CANVAS_PALETTE,
    ),
  };
}

describe('학과 선택 열린 목록 대비', () => {
  it.each(['option', 'optgroup'] as const)(
    '%s 이 자기 배경 위에서 AA를 만족한다',
    (element) => {
      const { text, background } = optionHex(element);

      expect(contrast(text, background)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );

  // 배경을 덧대지 않으면 브라우저가 무엇을 깔든 그것이 바탕이 된다. 항목이 자기
  // 배경을 들고 있어야 시스템 Canvas가 흰색이든 아니든 위 대비가 실제로 보장된다.
  it.each(['option', 'optgroup'] as const)(
    '%s 이 배경을 스스로 정한다',
    (element) => {
      expect(selectClassName).toMatch(
        new RegExp(`\\[&_${element}\\]:bg-[\\w-]+`),
      );
    },
  );

  // 닫힌 칸은 어두운 무대 위에 있다 — 목록을 고치려고 `<Select>` 자체의 글자색을
  // 어둡게 바꾸면 이쪽이 무너진다. 무대의 바탕은 AppFrame이 칠하므로 hex를 여기
  // 적지 않고 그 소스에서 유틸리티를 읽어 온다.
  it('닫힌 칸의 글자가 우주 바탕에서 AA를 만족한다', () => {
    const groundUtility = /\bbg-(cosmos-[\w-]+)/.exec(appFrameSource)?.[1];
    if (!groundUtility) {
      throw new Error('app-frame.tsx에서 우주 바탕 유틸리티를 찾지 못했습니다');
    }
    const text = resolveInvertedHex(closedControlToken);

    expect(
      contrast(text, resolveInvertedHex(`--${groundUtility}`)),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
