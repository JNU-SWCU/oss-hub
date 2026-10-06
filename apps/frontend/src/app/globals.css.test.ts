import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS_PATH = path.resolve(__dirname, './globals.css');
const css = readFileSync(CSS_PATH, 'utf-8');

const INVERTED_SELECTOR = "[data-surface='inverted'] {";
const RESET_SELECTOR = "[data-surface='inverted'] [data-surface='default'] {";

interface Declaration {
  property: string;
  value: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBlockBody(source: string, selectorWithBrace: string): string {
  const selectorIndex = source.indexOf(selectorWithBrace);
  if (selectorIndex === -1) {
    throw new Error(
      `globals.css에서 선택자를 찾지 못했다: ${selectorWithBrace}`,
    );
  }
  const braceOpen = selectorIndex + selectorWithBrace.length - 1;
  const braceClose = source.indexOf('}', braceOpen);
  if (braceClose === -1) {
    throw new Error(
      `선택자 블록의 닫는 중괄호를 찾지 못했다: ${selectorWithBrace}`,
    );
  }
  return source.slice(braceOpen + 1, braceClose);
}

function extractDeclarations(blockBody: string): Declaration[] {
  const declarations: Declaration[] = [];
  const pattern = /([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(blockBody)) !== null) {
    declarations.push({ property: match[1], value: match[2].trim() });
  }
  return declarations;
}

function customPropertyNames(declarations: Declaration[]): Set<string> {
  return new Set(
    declarations
      .filter((d) => d.property.startsWith('--'))
      .map((d) => d.property),
  );
}

function declaresForegroundColor(declarations: Declaration[]): boolean {
  return declarations.some(
    (d) =>
      d.property === 'color' &&
      d.value.replace(/\s+/g, '') === 'var(--foreground)',
  );
}

const strippedCss = stripComments(css);
const invertedBody = extractBlockBody(strippedCss, INVERTED_SELECTOR);
const resetBody = extractBlockBody(strippedCss, RESET_SELECTOR);

const invertedDeclarations = extractDeclarations(invertedBody);
const resetDeclarations = extractDeclarations(resetBody);

const invertedNames = customPropertyNames(invertedDeclarations);
const resetNames = customPropertyNames(resetDeclarations);

describe("globals.css의 [data-surface='inverted'] 반전/리셋 불변식", () => {
  const PARSE_SANITY_MIN = 4;

  it('선언 파싱이 살아 있다 (셀렉터·주석 처리 변경으로 조용히 공허해지지 않는다)', () => {
    expect(
      invertedNames.size,
      `반전 블록에서 커스텀 프로퍼티를 ${invertedNames.size}개만 찾았다 — ` +
        '셀렉터 리터럴이나 주석 제거가 깨져 파싱이 공허해졌을 가능성이 높다.',
    ).toBeGreaterThanOrEqual(PARSE_SANITY_MIN);
    expect(
      resetNames.size,
      `리셋 블록에서 커스텀 프로퍼티를 ${resetNames.size}개만 찾았다 — ` +
        '셀렉터 리터럴이나 주석 제거가 깨져 파싱이 공허해졌을 가능성이 높다.',
    ).toBeGreaterThanOrEqual(PARSE_SANITY_MIN);
  });

  it('리셋 블록은 반전 블록과 정확히 같은 커스텀 프로퍼티 집합을 되돌린다', () => {
    const onlyInInverted = [...invertedNames]
      .filter((name) => !resetNames.has(name))
      .sort();
    const onlyInReset = [...resetNames]
      .filter((name) => !invertedNames.has(name))
      .sort();

    expect(
      onlyInInverted,
      `반전(inverted) 블록에만 있고 리셋 블록에는 없는 프로퍼티: ${
        onlyInInverted.join(', ') || '없음'
      }`,
    ).toEqual([]);
    expect(
      onlyInReset,
      `리셋 블록에만 있고 반전(inverted) 블록에는 없는 프로퍼티: ${
        onlyInReset.join(', ') || '없음'
      }`,
    ).toEqual([]);

    expect([...invertedNames].sort()).toEqual([...resetNames].sort());
  });

  it('반전 블록은 카드 표면과 초점 링도 덮는다 — 가입 무대의 Alert', () => {
    expect([...invertedNames]).toEqual(
      expect.arrayContaining(['--card', '--card-foreground', '--ring']),
    );
  });

  it('두 블록 모두 자기 스코프에서 color: var(--foreground)를 선언한다', () => {
    expect(
      declaresForegroundColor(invertedDeclarations),
      "반전 블록([data-surface='inverted'])에 color: var(--foreground) 선언이 없다 — " +
        '조상의 계산된 색을 상속만 하게 되어 자손이 실제로 반전되지 않는다.',
    ).toBe(true);
    expect(
      declaresForegroundColor(resetDeclarations),
      "리셋 블록([data-surface='inverted'] [data-surface='default'])에 " +
        'color: var(--foreground) 선언이 없다 — 패널 안 ghost 버튼·평문이 반전 색을 계속 상속한다.',
    ).toBe(true);
  });

  it('리셋 블록의 커스텀 프로퍼티는 --palette-* primitive만 참조하고 리터럴 hex를 쓰지 않는다', () => {
    const resetCustomProperties = resetDeclarations.filter((d) =>
      d.property.startsWith('--'),
    );

    const notPaletteVar = resetCustomProperties.filter(
      (d) => !/^var\(--palette-[\w-]+\)$/.test(d.value),
    );
    expect(
      notPaletteVar,
      `var(--palette-*) 형태가 아닌 리셋 값: ${
        notPaletteVar.map((d) => `${d.property}: ${d.value}`).join(', ') ||
        '없음'
      }`,
    ).toEqual([]);

    const hexLiterals = resetCustomProperties.filter((d) =>
      /#[0-9a-fA-F]{3,8}\b/.test(d.value),
    );
    expect(
      hexLiterals,
      `리터럴 hex 값을 쓰는 리셋 프로퍼티: ${
        hexLiterals.map((d) => `${d.property}: ${d.value}`).join(', ') || '없음'
      }`,
    ).toEqual([]);
  });
});

describe('globals.css의 --status-* 토큰은 variant마다 서로 다른 색을 쓴다', () => {
  const DARK_SELECTOR = '.dark {';
  const darkIndex = strippedCss.indexOf(DARK_SELECTOR);
  if (darkIndex === -1) {
    throw new Error("globals.css에서 '.dark {' 선택자를 찾지 못했다");
  }

  const lightScope = strippedCss.slice(0, darkIndex);
  const darkScope = strippedCss.slice(darkIndex);

  function extractStatusDeclarations(scope: string, suffix: 'bg' | 'fg') {
    const pattern = new RegExp(
      `(--status-[\\w-]+-${suffix})\\s*:\\s*([^;]+);`,
      'g',
    );
    const found: Declaration[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(scope)) !== null) {
      found.push({ property: match[1], value: match[2].trim() });
    }
    return found;
  }

  function expectAllDistinct(declarations: Declaration[], scopeLabel: string) {
    const seen = new Map<string, string[]>();
    for (const { property, value } of declarations) {
      const owners = seen.get(value) ?? [];
      owners.push(property);
      seen.set(value, owners);
    }
    const collisions = [...seen.entries()].filter(
      ([, owners]) => owners.length > 1,
    );
    expect(
      collisions,
      `${scopeLabel}에서 같은 값을 공유하는 --status-* 프로퍼티: ${
        collisions
          .map(([value, owners]) => `${owners.join(' = ')} (${value})`)
          .join('; ') || '없음'
      }`,
    ).toEqual([]);
  }

  it('라이트(:root) 블록: --status-*-bg 값이 variant마다 모두 다르다', () => {
    const bgDeclarations = extractStatusDeclarations(lightScope, 'bg');
    expect(bgDeclarations.length).toBeGreaterThanOrEqual(5);
    expectAllDistinct(bgDeclarations, '라이트(:root) --status-*-bg');
  });

  it('라이트(:root) 블록: --status-*-fg 값이 variant마다 모두 다르다', () => {
    const fgDeclarations = extractStatusDeclarations(lightScope, 'fg');
    expect(fgDeclarations.length).toBeGreaterThanOrEqual(5);
    expectAllDistinct(fgDeclarations, '라이트(:root) --status-*-fg');
  });

  it('.dark 블록: --status-*-bg 값이 variant마다 모두 다르다', () => {
    const bgDeclarations = extractStatusDeclarations(darkScope, 'bg');
    expect(bgDeclarations.length).toBeGreaterThanOrEqual(5);
    expectAllDistinct(bgDeclarations, '.dark --status-*-bg');
  });

  it('.dark 블록: --status-*-fg 값이 variant마다 모두 다르다', () => {
    const fgDeclarations = extractStatusDeclarations(darkScope, 'fg');
    expect(fgDeclarations.length).toBeGreaterThanOrEqual(5);
    expectAllDistinct(fgDeclarations, '.dark --status-*-fg');
  });
});

describe('globals.css의 시안 v2 치수 토큰', () => {
  const DIMENSION_DARK_SELECTOR = '.dark {';
  const dimensionDarkIndex = strippedCss.indexOf(DIMENSION_DARK_SELECTOR);
  const lightScope = strippedCss.slice(0, dimensionDarkIndex);
  const darkScope = strippedCss.slice(dimensionDarkIndex);

  function declarationIn(scope: string, property: string): string | null {
    const match = new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;]+);`).exec(
      scope,
    );
    return match ? match[1].trim() : null;
  }

  function declarationValue(property: string): string | null {
    return declarationIn(strippedCss, property);
  }

  it('여백 척도는 8의 배수 한 벌(4·8·12·16·24·32·48·64·96)이다', () => {
    const expected = [
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
      '48px',
      '64px',
      '96px',
    ];
    expect(
      expected.map((_, index) => declarationValue(`--space-${index + 1}`)),
    ).toEqual(expected);
  });

  it('크기 계단은 여섯 단계다 — 페이지 40 / 섹션 24 / 본문 16 / 보조 13 / 배지 12 / 표 14', () => {
    expect(declarationValue('--step-page')).toBe('40px');
    expect(declarationValue('--step-section')).toBe('24px');
    expect(declarationValue('--step-body')).toBe('16px');
    expect(declarationValue('--step-small')).toBe('13px');

    expect(declarationValue('--step-badge')).toBe('0.75rem');
    expect(declarationValue('--step-table')).toBe('0.875rem');
  });

  it('조작 높이는 44px 하나, 배지만 26px 예외다', () => {
    expect(declarationValue('--measure-44')).toBe('44px');
    expect(declarationValue('--control-height')).toBe('var(--measure-44)');
    expect(declarationValue('--tag-height')).toBe('var(--measure-26)');
    expect(declarationValue('--measure-26')).toBe('26px');
  });

  it('카드는 안쪽 여백 24 · 모서리 12, 사이드바는 248/72다', () => {
    expect(declarationValue('--card-padding')).toBe('var(--space-5)');
    expect(declarationValue('--card-radius')).toBe('var(--space-3)');
    expect(declarationValue('--control-radius')).toBe('var(--space-2)');
    expect(declarationValue('--sidebar-open-width')).toBe('var(--measure-248)');
    expect(declarationValue('--sidebar-collapsed-width')).toBe(
      'var(--measure-72)',
    );
    expect(declarationValue('--measure-248')).toBe('248px');
    expect(declarationValue('--measure-72')).toBe('72px');
  });

  it('치수 semantic 토큰은 primitive(--space-*/--measure-*)만 참조한다', () => {
    const semanticNames = [
      '--control-height',
      '--tag-height',
      '--row-height',
      '--tile-height',
      '--card-padding',
      '--card-radius',
      '--control-radius',
      '--topbar-height',
      '--sidebar-open-width',
      '--sidebar-collapsed-width',
    ];
    const offenders = semanticNames
      .map((name) => ({ name, value: declarationValue(name) }))
      .filter(
        ({ value }) =>
          value === null || !/^var\(--(space|measure)-[\w-]+\)$/.test(value),
      );

    expect(
      offenders,
      `primitive 램프를 참조하지 않는 치수 semantic 토큰: ${
        offenders.map((o) => `${o.name}: ${o.value}`).join(', ') || '없음'
      }`,
    ).toEqual([]);
  });

  it('component 계층(@theme inline)이 치수 토큰을 유틸리티로 노출한다', () => {
    const themeBlock = extractBlockBody(strippedCss, '@theme inline {');
    for (const mapping of [
      '--spacing-control: var(--control-height)',
      '--spacing-topbar: var(--topbar-height)',
      '--spacing-sidebar-open: var(--sidebar-open-width)',
      '--spacing-sidebar-collapsed: var(--sidebar-collapsed-width)',
      '--spacing-card: var(--card-padding)',
      '--text-page: var(--step-page)',
      '--text-small: var(--step-small)',
      '--text-badge: var(--step-badge)',

      '--text-badge--line-height: calc(16 / 12)',
      '--text-table: var(--step-table)',
      '--text-table--line-height: calc(20 / 14)',
      '--radius-card: var(--card-radius)',
      '--radius-control: var(--control-radius)',
    ]) {
      expect(themeBlock, `누락된 매핑: ${mapping}`).toContain(mapping);
    }
  });

  it('사이드바 현재 위치 토큰은 라이트·다크 모두 팔레트 primitive를 참조한다', () => {
    for (const scope of [lightScope, darkScope]) {
      for (const name of [
        '--sidebar-current',
        '--sidebar-current-foreground',
        '--sidebar-current-marker',
      ]) {
        expect(declarationIn(scope, name), `${name} 선언이 없다`).toMatch(
          /^var\(--palette-[\w-]+\)$/,
        );
      }
    }
  });
});
