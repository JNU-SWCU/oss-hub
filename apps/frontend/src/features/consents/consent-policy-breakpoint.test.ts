// 이 테스트가 지키는 불변식 하나: **전문 표시 방식을 고르는 판정 폭과, 두 기둥 행으로
// 바뀌는 CSS 폭이 같은 값이어야 한다.**
//
// 갈라지면 그 사이 구간에서 판정은 `inline`인데 왼쪽 기둥은 여전히 672px로 고정이라
// 오른쪽 전문이 눌린다. 실제로 판정 1024 · CSS `lg:`(1024)로 맞춰 두고도 1024px에서
// 전문이 120px(12자/줄)까지 눌리는 결함이 났고, 1440·768·375만 재던 실측은 그 구간을
// 통째로 비껴갔다. 폭을 옮길 때 한쪽만 옮기는 실수를 여기서 잡는다.
//
// Tailwind는 소스의 클래스 이름을 **문자 그대로** 읽으므로 상수를 끼워 넣을 수 없다.
// 그래서 두 소스를 글자로 읽어 비교한다(`app-sidebar.tsx`의 `min-[900px]:`과 같은 방식).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONSENT_POLICY_INLINE_BREAKPOINT_PX } from './consent-policy-presentation';

const VARIANT = `min-[${CONSENT_POLICY_INLINE_BREAKPOINT_PX}px]:`;

const SOURCES = {
  'consent-flow.tsx': path.resolve(__dirname, './components/consent-flow.tsx'),
  'consent/page.tsx': path.resolve(__dirname, '../../app/consent/page.tsx'),
};

/** 소스에 등장하는 모든 반응형 변형 접두사. 임의 폭(`min-[…px]:`)과 명명 폭 둘 다 본다. */
function responsiveVariants(source: string): string[] {
  const found = source.matchAll(
    /(min-\[\d+px\]:|(?:^|[\s'"`{])(?:sm|md|lg|xl|2xl):)/g,
  );
  return [...new Set([...found].map((match) => match[0].trim()))].sort();
}

describe('전문 인라인 전환 폭', () => {
  it.each(Object.entries(SOURCES))(
    '%s는 판정 폭과 같은 변형 하나만 쓴다',
    (_name, file) => {
      expect(responsiveVariants(readFileSync(file, 'utf-8'))).toEqual([
        VARIANT,
      ]);
    },
  );

  it('두 기둥 행과 본문 폭 해제가 그 폭에서 함께 일어난다', () => {
    const flow = readFileSync(SOURCES['consent-flow.tsx'], 'utf-8');
    const page = readFileSync(SOURCES['consent/page.tsx'], 'utf-8');

    expect(flow).toContain(`${VARIANT}flex-row`);
    expect(page).toContain(`${VARIANT}max-w-none`);
  });

  // 오른쪽 전문에 남는 폭은 `뷰포트 - 864`다(진행 눈금 96 · 본문 오른쪽 여백 48 ·
  // 왼쪽 기둥 672 · 열 간격 48). 그 폭에서 문서가 자기 여백 40을 또 빼고 남는 글의
  // 폭이, 가장 좁은 팝업(375px에서 301px)보다 넓어야 인라인이 팝업보다 나은 선택이 된다.
  it('전환 폭에서 전문 글의 폭이 가장 좁은 팝업보다 넓다', () => {
    const FIXED_CHROME_PX = 96 + 48 + 672 + 48;
    const DOCUMENT_PADDING_PX = 40;
    const NARROWEST_DIALOG_TEXT_PX = 301;

    const textWidth =
      CONSENT_POLICY_INLINE_BREAKPOINT_PX -
      FIXED_CHROME_PX -
      DOCUMENT_PADDING_PX;

    expect(textWidth).toBeGreaterThan(NARROWEST_DIALOG_TEXT_PX);
  });
});
