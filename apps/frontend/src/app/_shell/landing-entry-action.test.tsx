import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { githubLoginPath } from '@/features/auth/login-paths';
import { LandingEntryActionView } from './landing-entry-action';

describe('LandingEntryActionView', () => {
  it('shows the GitHub sign-in button while the session is still loading', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="loading" isProfileComplete={false} />,
    );

    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).toContain('시작하기');
    expect(html).toContain('aria-label="GitHub으로 시작하기"');
    expect(html).not.toContain('세션 확인 중');
    expect(html).not.toContain('animate-spin');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('<button');
  });

  it('sends an anonymous visitor straight to GitHub sign-in', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" isProfileComplete={false} />,
    );

    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).not.toContain('href="/signup"');
    expect(html).toContain('시작하기');
    expect(html).toContain('aria-label="GitHub으로 시작하기"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('min-h-11');
  });

  it('sends an unassigned user to continue signup at /consent', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="unassigned" isProfileComplete={false} />,
    );

    expect(html).toContain('가입 이어하기');
    expect(html).toContain('href="/consent"');
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

  it('sends an assigned user with an empty profile to continue signup at /consent', () => {
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

    expect(html).toContain('가입 이어하기');
    expect(html).toContain('href="/consent"');
    expect(html).not.toContain('내 대시보드');
  });

  it('still offers GitHub sign-in when the session lookup fails', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="error" isProfileComplete={false} />,
    );

    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).toContain('aria-label="GitHub으로 시작하기"');
    expect(html).not.toContain('href="/signup"');
  });

  it('does not pass a failed session lookup off as a logged-out visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="error" isProfileComplete={false} />,
    );

    expect(html).toContain(
      '로그인 상태를 확인하지 못했습니다. 잠시 뒤 새로고침하거나 다시 로그인해 주세요.',
    );
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

    expect(html).toContain('다시 시도');
    expect(html).toContain('aria-label="GitHub으로 다시 시도"');
    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).not.toContain('href="/signup"');
  });
});
