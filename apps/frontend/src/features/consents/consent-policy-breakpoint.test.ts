import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONSENT_POLICY_INLINE_BREAKPOINT_PX } from './consent-policy-presentation';

const VARIANT = `min-[${CONSENT_POLICY_INLINE_BREAKPOINT_PX}px]:`;

const SOURCES = {
  'consent-flow.tsx': path.resolve(__dirname, './components/consent-flow.tsx'),
  'consent/page.tsx': path.resolve(__dirname, '../../app/consent/page.tsx'),
};

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
