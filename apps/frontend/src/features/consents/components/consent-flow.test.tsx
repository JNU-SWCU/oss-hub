import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { ConsentFlow } from './consent-flow';

function renderFlow(): string {
  return renderToStaticMarkup(<ConsentFlow />);
}

describe('ConsentFlow', () => {
  it('화면 제목을 h1으로 낸다', () => {
    expect(renderFlow()).toMatch(/<h1[^>]*>개인정보·활동 동의<\/h1>/);
  });

  it('가입 3단계 중 어디인지 배지로 알린다', () => {
    expect(renderFlow()).toContain('STEP 1 / 3');
  });

  it('화면 전체를 덮는 모달로 감싸지 않는다', () => {
    const html = renderFlow();

    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain('role="dialog"');
  });
});
