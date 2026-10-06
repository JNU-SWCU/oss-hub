import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { githubLoginPath } from '@/features/landing/api';
import { LandingEntryActionView } from './landing-entry-action';

describe('LandingEntryActionView', () => {
  it('shows only a loading status while the session is loading', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="loading" isProfileComplete={false} />,
    );

    expect(html).toContain('세션 확인 중');
    expect(html).not.toContain(githubLoginPath);
  });

  it('sends an anonymous visitor to the signup entry instead of GitHub', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" isProfileComplete={false} />,
    );

    expect(html).toContain('로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
    expect(html).toContain('min-h-11');
  });

  it('sends an unassigned user to the same signup entry', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="unassigned" isProfileComplete={false} />,
    );

    expect(html).toContain('로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('offers the role home to an assigned user', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        access={{
          memberKind: 'STUDENT',
          hasStaffAccess: false,
          hasAdminAccess: false,
        }}
        isProfileComplete
      />,
    );

    expect(html).toContain('내 대시보드');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('offers the staff dashboard to assigned staff', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        access={{
          memberKind: 'STAFF',
          hasStaffAccess: true,
          hasAdminAccess: false,
        }}
        isProfileComplete
      />,
    );

    expect(html).toContain('운영 대시보드');
    expect(html).toContain('href="/dashboard"');
  });

  it('offers admin-only compatibility users the admin entry', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        access={{
          memberKind: null,
          hasStaffAccess: false,
          hasAdminAccess: true,
        }}
        isProfileComplete
      />,
    );

    expect(html).toContain('사용자 목록');
    expect(html).toContain('href="/dashboard/users"');
  });

  it('sends an assigned user with an empty profile back to the signup entry', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        access={{
          memberKind: 'STUDENT',
          hasStaffAccess: false,
          hasAdminAccess: false,
        }}
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('내 대시보드');
  });

  it('still offers a way forward when the session lookup fails', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="error" isProfileComplete={false} />,
    );

    expect(html).toContain('로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('does not pass a failed session lookup off as a logged-out visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="error" isProfileComplete={false} />,
    );

    expect(html).toContain('로그인 정보를 확인하지 못했습니다');
    expect(html).toContain('로그아웃된 것은 아닙니다');
  });

  it('keeps the failure note readable on the dark landing surfaces', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="error"
        isProfileComplete={false}
        inverted
      />,
    );

    expect(html).toContain('text-hero-muted');
    expect(html).not.toContain('text-muted-foreground');
  });

  it('makes authentication recovery explicit for an anonymous visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="anonymous"
        isProfileComplete={false}
        hasAuthError
      />,
    );

    expect(html).toContain('로그인 다시 시도');
    expect(html).toContain('href="/signup"');
  });
});
