import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FormErrorSummary } from './form-error-summary';

describe('FormErrorSummary — 오류가 둘 이상일 때만 개수를 알린다', () => {
  it.each([0, 1])('오류 %i개면 아무것도 그리지 않는다', (count) => {
    expect(renderToStaticMarkup(<FormErrorSummary count={count} />)).toBe('');
  });

  it('오류가 둘 이상이면 개수 한 줄을 그리고 서버 실패 상자와 구별되는 slot 을 단다', () => {
    const html = renderToStaticMarkup(<FormErrorSummary count={4} />);
    expect(html).toContain('고칠 칸이 4개 있습니다');
    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).not.toContain('data-slot="alert"');
    // 피드백 표 field 행 — 새로 생긴 오류는 즉시 읽는다.
    expect(html).toContain('role="alert"');
  });

  it('호출부 className 을 root 에 합친다(R-04)', () => {
    const html = renderToStaticMarkup(
      <FormErrorSummary count={2} className="mb-2" />,
    );
    expect(html).toMatch(/data-slot="form-error-summary"[^>]*class="[^"]*mb-2/);
  });
});
