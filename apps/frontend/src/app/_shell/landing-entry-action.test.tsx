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

  // GitHub으로 바로 던지면 무슨 일이 일어나는지 말할 자리가 없고, GitHub 계정이
  // 없는 방문자는 그대로 막힌다. 그래서 `/signup`을 한 번 거친다.
  it('sends an anonymous visitor to the signup entry instead of GitHub', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" role={null} />,
    );

    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
    expect(html).toContain('min-h-11');
  });

  // 온보딩을 끝내지 못한 사용자에게도 같은 버튼 하나를 준다 — 별도의 "이어서"
  // 행동을 두지 않고, 재개 지점 판단은 `/signup`이 맡는다.
  it('sends an unassigned user to the same signup entry', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="unassigned" role={null} />,
    );

    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
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

  it('offers the staff dashboard to assigned staff', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="assigned" role="STAFF" />,
    );

    expect(html).toContain('운영 대시보드');
    expect(html).toContain('href="/staff/dashboard"');
  });

  it('offers staff approval to an assigned administrator', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="assigned" role="ADMIN" />,
    );

    expect(html).toContain('관리 콘솔');
    expect(html).toContain('href="/admin/access"');
  });

  it('makes authentication recovery explicit for an anonymous visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView status="anonymous" role={null} hasAuthError />,
    );

    expect(html).toContain('로그인 다시 시도');
    expect(html).toContain('href="/signup"');
  });
});
