// 넓은 화면 두 기둥의 **세로 독립**과 **폭 산술**을 지킨다(#522).
//
// 세로: 예전에는 무대가 두 기둥을 합친 덩어리를 가운데 맞춰, 전문을 열어 오른쪽이
// 길어지면 왼쪽 제목·버튼이 2560에서 209px 밀려 올라갔다. 읽던 자리가 사라지고
// 누르려던 버튼이 이동한다.
//
// 폭: 상한 셋(문서 글 48rem · 전문 기둥 808 · 두 기둥 합 1576)이 서로 다른 파일에
// 흩어져 있고 하나만 움직이면 조용히 어긋난다 — 문서보다 좁은 틀은 글을 자르고,
// 틀보다 좁은 행은 전문을 눌러 버린다. 세 값을 여기서 한 식으로 묶는다.
//
// 실측(1440×900)은 PR 본문에 남긴다: 왼쪽 기둥 y 이동량 0 · 전문 틀 576×660.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const flow = readFileSync(
  path.resolve(__dirname, './components/consent-flow.tsx'),
  'utf-8',
);
const view = readFileSync(
  path.resolve(__dirname, './components/consent-view.tsx'),
  'utf-8',
);
const documentStyle = readFileSync(
  path.resolve(__dirname, '../../../public/policies/policy-document.css'),
  'utf-8',
);

/** `className="…"`에 담긴 클래스 목록만 뽑는다 — 주석의 낱말은 세지 않는다. */
function classLists(source: string): string[][] {
  return [...source.matchAll(/className="([^"]*)"/g)].map((match) =>
    match[1]!.split(/\s+/),
  );
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

  // 행이 남은 높이를 통째로 받고 왼쪽이 그 안에서 스스로 가운데 정렬해야, 오른쪽이
  // 길어져도 왼쪽이 제자리에 남는다. 정렬을 위(무대)에 맡기면 둘이 다시 묶인다.
  it('행이 높이를 받고 왼쪽 기둥이 스스로 가운데 정렬한다', () => {
    expect(row).toContain('min-[1280px]:flex-1');
    expect(column).toContain('min-[1280px]:justify-center');
  });

  // `items-start`면 오른쪽 기둥이 자기 내용만큼 서고, 그 높이가 행 높이가 된다.
  it('오른쪽 기둥은 행 높이를 만들지 않고 받기만 한다', () => {
    expect(row?.some((token) => token.includes('items-start'))).toBe(false);
    expect(inline).toContain('min-h-0');
    expect(view).toContain('className="min-h-0 flex-1"');
    // 정해진 높이(`min-h-[…dvh]`)를 다시 주면 그만큼 행이 길어져 왼쪽이 밀린다.
    expect(/min-h-\[\d+dvh\]/.test(inline?.join(' ') ?? '')).toBe(false);
  });
});

describe('넓은 화면 폭 산술', () => {
  /** 문서가 글에 주는 최대 폭 — 넓은 틀에서만 열리는 값이다. */
  const documentTextPx =
    Number(
      /@media \(min-width: \d+px\) \{\s*main \{\s*max-width: ([\d.]+)rem/.exec(
        documentStyle,
      )?.[1],
    ) * REM_PX;
  /** 문서가 스스로 두는 좌우 여백(`padding: … 1.25rem`) 합. */
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
  /** 왼쪽 기둥은 `max-w-2xl` 고정이다 — 전문이 열려도 항목이 움직이지 않는 근거. */
  const FORM_COLUMN_PX = 42 * REM_PX;

  // 틀이 문서보다 좁으면 글이 눌리고, 넓으면 그만큼이 문서 안에서 빈 여백으로 남는다.
  // 불투명한 틀이 넓어지는 만큼 뒤의 별밭도 가린다.
  it('전문 기둥은 문서가 실제로 쓰는 폭까지만 넓어진다', () => {
    expect(documentTextPx).toBeGreaterThan(0);
    expect(inlineMaxPx).toBe(documentTextPx + documentPaddingPx);
  });

  it('두 기둥 합의 상한은 왼쪽 + 최대 간격 + 전문이다', () => {
    expect(rowMaxPx).toBe(FORM_COLUMN_PX + gapCeilingPx + inlineMaxPx);
  });

  // 간격이 전환 폭에서 벌어지면 그만큼 전문이 눌린다 — 1280의 여유는 그럴 만큼
  // 넓지 않다(`consent-policy-breakpoint.test.ts`가 48px을 전제로 계산한다).
  it('열 간격의 최소값은 전환 폭에서 쓰던 48px이다', () => {
    expect(gapFloorPx).toBe(48);
    expect(gapCeilingPx).toBeGreaterThan(gapFloorPx);
  });

  // 이 media query가 팝업 갈래(1024에서 틀 766px이 최대)까지 내려오면 768·1024의
  // 실측값이 함께 움직인다.
  it('문서의 넓은 글 폭은 인라인 틀에서만 열린다', () => {
    const threshold = Number(
      /@media \(min-width: (\d+)px\)/.exec(documentStyle)?.[1],
    );

    expect(threshold).toBeGreaterThan(766);
    expect(threshold).toBeLessThanOrEqual(inlineMaxPx);
  });
});
