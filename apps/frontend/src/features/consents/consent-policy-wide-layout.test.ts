import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const flow = readFileSync(
  path.resolve(__dirname, './components/consent-flow.tsx'),
  'utf-8',
);
const view = readFileSync(
  path.resolve(__dirname, './components/consent-policy-document.tsx'),
  'utf-8',
);
const documentStyle = readFileSync(
  path.resolve(__dirname, '../../../public/policies/policy-document.css'),
  'utf-8',
);

function classLists(source: string): string[][] {
  return [
    ...[...source.matchAll(/className="([^"]*)"/g)].map((match) =>
      match[1]!.split(/\s+/),
    ),
    ...[...source.matchAll(/'([^']*)'/g)].map((match) =>
      match[1]!.split(/\s+/),
    ),
  ];
}

const REM_PX = 16;

describe('넓은 화면 두 기둥의 세로 독립', () => {
  const row = classLists(flow).find((tokens) =>
    tokens.includes('min-[1280px]:flex-row'),
  );
  const column = classLists(flow).find((tokens) =>
    tokens.includes('flex-none'),
  );
  const inline = classLists(view).find((tokens) =>
    tokens.includes('focus:outline-none'),
  );

  it('행이 높이를 받고 왼쪽 기둥이 스스로 가운데 정렬한다', () => {
    expect(row).toContain('min-[1280px]:flex-1');
    expect(column).toContain('min-[1280px]:justify-center');
  });

  it('오른쪽 기둥은 행 높이를 만들지 않고 받기만 한다', () => {
    expect(row?.some((token) => token.includes('items-start'))).toBe(false);
    expect(inline).toContain('min-h-0');
    expect(view).toContain('className="min-h-0 flex-1"');

    expect(/min-h-\[\d+dvh\]/.test(inline?.join(' ') ?? '')).toBe(false);
  });
});

describe('넓은 화면 폭 산술', () => {
  const documentTextPx =
    Number(
      /@media \(min-width: \d+px\) \{\s*main \{\s*max-width: ([\d.]+)rem/.exec(
        documentStyle,
      )?.[1],
    ) * REM_PX;

  const documentPaddingPx =
    Number(/padding: [\d.]+rem ([\d.]+)rem/.exec(documentStyle)?.[1]) *
    REM_PX *
    2;
  const inlineMaxPx = Number(
    /max-w-\[(\d+)px\]/.exec(
      classLists(view)
        .find((tokens) => tokens.includes('focus:outline-none'))
        ?.join(' ') ?? '',
    )?.[1],
  );
  const rowMaxPx = Number(/min-\[1280px\]:max-w-\[(\d+)px\]/.exec(flow)?.[1]);
  const gap = /gap-\[clamp\(([\d.]+)rem,[^,]+,([\d.]+)rem\)\]/.exec(flow);
  const gapFloorPx = Number(gap?.[1]) * REM_PX;
  const gapCeilingPx = Number(gap?.[2]) * REM_PX;

  const FORM_COLUMN_PX = 42 * REM_PX;

  it('전문 기둥은 문서가 실제로 쓰는 폭까지만 넓어진다', () => {
    expect(documentTextPx).toBeGreaterThan(0);
    expect(inlineMaxPx).toBe(documentTextPx + documentPaddingPx);
  });

  it('두 기둥 합의 상한은 왼쪽 + 최대 간격 + 전문이다', () => {
    expect(rowMaxPx).toBe(FORM_COLUMN_PX + gapCeilingPx + inlineMaxPx);
  });

  it('열 간격의 최소값은 전환 폭에서 쓰던 48px이다', () => {
    expect(gapFloorPx).toBe(48);
    expect(gapCeilingPx).toBeGreaterThan(gapFloorPx);
  });

  it('문서의 넓은 글 폭은 인라인 틀에서만 열린다', () => {
    const threshold = Number(
      /@media \(min-width: (\d+)px\)/.exec(documentStyle)?.[1],
    );

    expect(threshold).toBeGreaterThan(766);
    expect(threshold).toBeLessThanOrEqual(inlineMaxPx);
  });
});
