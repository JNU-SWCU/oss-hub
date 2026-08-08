import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AccountDeactivatedPage from './page';

describe('AccountDeactivatedPage', () => {
  it('states the completed outcome and the only recovery path', () => {
    const html = renderToStaticMarkup(<AccountDeactivatedPage />);

    expect(html).toContain('계정이 비활성화되었습니다');
    expect(html).toContain('로그아웃되었습니다');
    expect(html).toContain('관리자에게 재활성화를 요청');
    expect(html).not.toContain('GitHub에서 로그아웃');
  });
});
