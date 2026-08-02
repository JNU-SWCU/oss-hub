import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// 라우터는 화면을 그리는 데 쓰이지 않는다 — 최초 렌더에서 호출만 되므로 빈 것으로 둔다.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { ConsentFlow } from './consent-flow';

// 세션·정책 조회는 effect에서 일어나고 정적 렌더에는 effect가 없다.
// 그래서 여기서 검증하는 것은 어떤 상태에서도 변하지 않는 화면의 뼈대다.
function renderFlow(): string {
  return renderToStaticMarkup(<ConsentFlow />);
}

describe('ConsentFlow', () => {
  // 이번에 고친 결함이다. 제목을 `DialogPrimitive.Title`이 그리던 시절에는 그것이
  // `h2`로 나와 화면에 `h1`이 하나도 없었다 — 스크린 리더 사용자는 이 화면이 무엇을
  // 묻는 자리인지 제목 목록에서 알 수 없었다. 되살아나지 않게 못을 박는다.
  it('화면 제목을 h1으로 낸다', () => {
    expect(renderFlow()).toMatch(/<h1[^>]*>개인정보·활동 동의<\/h1>/);
  });

  it('가입 3단계 중 어디인지 배지로 알린다', () => {
    expect(renderFlow()).toContain('STEP 1 / 3');
  });

  // 닫을 수 없는 모달이었다(`open` 고정 + Escape·바깥 클릭 차단). 돌아갈 화면이 없는
  // 가입 단계는 모달이 될 수 없다. 진행 표시를 덮고, h1을 없애고, 375px에서 주 버튼을
  // 잘라 먹던 원인이 전부 여기였다.
  it('화면 전체를 덮는 모달로 감싸지 않는다', () => {
    const html = renderFlow();

    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain('role="dialog"');
  });
});
