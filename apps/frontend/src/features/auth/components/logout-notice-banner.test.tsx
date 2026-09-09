import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GITHUB_LOGOUT_URL, LOGOUT_NOTICE_MESSAGE } from '../logout-notice';
import { LogoutNoticeBanner } from './logout-notice-banner';

describe('LogoutNoticeBanner', () => {
  it('이전 로그아웃 안내 링크에서도 완료 사실을 표시한다', () => {
    // When
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    // Then
    expect(html).toContain(LOGOUT_NOTICE_MESSAGE);
  });

  it('로그인 화면의 계정 도움말로 안내한다', () => {
    // When
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    // Then
    expect(html).toContain('href="/signup#account-help"');
    expect(html).not.toContain(GITHUB_LOGOUT_URL);
    expect(html).not.toContain('target="_blank"');
  });
});
