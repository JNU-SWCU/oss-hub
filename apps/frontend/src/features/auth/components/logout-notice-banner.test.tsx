import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_LOGOUT_URL,
  LOGOUT_COMPLETE_PATH,
  LOGOUT_NOTICE_MESSAGE,
} from '../logout-notice';
import { LogoutNoticeBanner } from './logout-notice-banner';

describe('LogoutNoticeBanner', () => {
  it('로그아웃 사실과 계정 전환 조건을 함께 말한다', () => {
    // When
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    // Then
    expect(html).toContain(LOGOUT_NOTICE_MESSAGE);
  });

  /**
   * 예전에는 이 자리에서 곧장 `github.com/logout`으로 내보냈고, GitHub은 로그아웃
   * 뒤 우리에게 돌려보내 주지 않으므로 사용자는 남의 사이트에 남겨졌다. 안내는
   * 돌아올 길이 마련된 화면으로만 보낸다.
   */
  it('GitHub으로 곧장 내보내지 않고 왕복을 설계한 화면으로 보낸다', () => {
    // When
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    // Then
    expect(html).toContain(`href="${LOGOUT_COMPLETE_PATH}"`);
    expect(html).not.toContain(GITHUB_LOGOUT_URL);
    expect(html).not.toContain('target="_blank"');
  });
});
