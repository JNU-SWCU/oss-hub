import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SWITCH_LINK_ID,
  LOGOUT_NOTICE_MESSAGE,
} from '../logout-notice';
import { LogoutNoticeBanner } from './logout-notice-banner';

describe('LogoutNoticeBanner', () => {
  it('이전 로그아웃 안내 링크에서도 완료 사실을 표시한다', () => {
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    expect(html).toContain(LOGOUT_NOTICE_MESSAGE);
  });

  it('같은 화면의 다른 계정으로 로그인 링크로 안내한다', () => {
    const html = renderToStaticMarkup(<LogoutNoticeBanner />);

    expect(html).toContain(`href="#${ACCOUNT_SWITCH_LINK_ID}"`);
    expect(html).not.toContain('/signup');
    expect(html).not.toContain('target="_blank"');
  });
});
