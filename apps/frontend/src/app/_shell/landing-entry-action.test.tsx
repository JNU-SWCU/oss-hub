import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { githubLoginPath } from '@/features/landing/api';
import { LandingEntryActionView } from './landing-entry-action';

describe('LandingEntryActionView', () => {
  it('shows only a loading status while the session is loading', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="loading"
        role={null}
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('세션 확인 중');
    expect(html).not.toContain(githubLoginPath);
  });

  // GitHub으로 바로 던지면 무슨 일이 일어나는지 말할 자리가 없고, GitHub 계정이
  // 없는 방문자는 그대로 막힌다. 그래서 `/signup`을 한 번 거친다.
  it('sends an anonymous visitor to the signup entry instead of GitHub', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="anonymous"
        role={null}
        isProfileComplete={false}
      />,
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
      <LandingEntryActionView
        status="unassigned"
        role={null}
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('offers the role home to an assigned user', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        role="STUDENT"
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
        role="STAFF"
        isProfileComplete
      />,
    );

    expect(html).toContain('운영 대시보드');
    expect(html).toContain('href="/dashboard"');
  });

  it('offers the operations dashboard to an assigned administrator', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        role="ADMIN"
        isProfileComplete
      />,
    );

    expect(html).toContain('운영 대시보드');
    expect(html).toContain('href="/dashboard"');
  });

  // 학생은 역할을 고르는 즉시 배정되므로, 프로필 단계에서 창을 닫은 사람은 역할만
  // 가진 채 랜딩에 돌아온다. 그에게 "내 대시보드"를 내밀면 가입이 끝난 것으로 읽히고,
  // 눌러도 게이트가 프로필로 되돌린다.
  it('sends an assigned user with an empty profile back to the signup entry', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="assigned"
        role="STUDENT"
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('내 대시보드');
  });

  // 실패해도 첫 화면에 진입로가 남아야 한다. 목적지는 비로그인과 **같은**
  // `/signup`이다 — 진입점이 둘이어도 목적지가 갈라지면 안 된다.
  it('still offers a way forward when the session lookup fails', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="error"
        role={null}
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('does not pass a failed session lookup off as a logged-out visitor', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="error"
        role={null}
        isProfileComplete={false}
      />,
    );

    expect(html).toContain('로그인 정보를 확인하지 못했습니다');
    expect(html).toContain('로그아웃된 것은 아닙니다');
  });

  it('keeps the failure note readable on the dark landing surfaces', () => {
    const html = renderToStaticMarkup(
      <LandingEntryActionView
        status="error"
        role={null}
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
        role={null}
        isProfileComplete={false}
        hasAuthError
      />,
    );

    expect(html).toContain('로그인 다시 시도');
    expect(html).toContain('href="/signup"');
  });
});
