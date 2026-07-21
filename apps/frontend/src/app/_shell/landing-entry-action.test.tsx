import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { githubLoginPath } from '@/features/landing/api';
import { LandingEntryActionView } from './landing-entry-action';

describe('LandingEntryActionView', () => {
  it('shows only a loading status while the session is loading', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="loading" role={null} />,
    );

    expect(html).toContain('세션 확인 중');
    expect(html).not.toContain(githubLoginPath);
  });

  it('offers GitHub login to an anonymous visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" role={null} />,
    );

    expect(html).toContain('GitHub으로 로그인');
    expect(html).toContain(githubLoginPath);
  });

  it('offers consent continuation to an unassigned user', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="unassigned" role={null} />,
    );

    expect(html).toContain('가입 계속하기');
    expect(html).toContain('href="/consent"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('offers the role home to an assigned user', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="assigned" role="STUDENT" />,
    );

    expect(html).toContain('내 대시보드');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('makes authentication recovery explicit for an anonymous visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" role={null} hasAuthError />,
    );

    expect(html).toContain('GitHub 로그인 다시 시도');
    expect(html).toContain(githubLoginPath);
  });
});
