import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { LoginButtonView } from './login-button';
import type { AuthSession } from '../types';

const githubLoginPath = apiPath('auth/github');

const authenticatedSession = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-user',
    name: null,
    email: null,
    avatarUrl: 'https://avatars.example/u/1',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} satisfies AuthSession;

describe('LoginButtonView', () => {
  it('요약된 복합 권한의 이름을 계정 버튼과 열린 메뉴에서 확인할 수 있다', () => {
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={authenticatedSession}
        pathname="/dashboard/personal"
        accountRoles="학생 · 교직원 · 관리자"
        logoutError={null}
        menuOpen
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(html).toContain(
      'aria-label="synthetic-user 계정 메뉴, 학생 · 교직원 · 관리자"',
    );
    expect(html).toMatch(/<p[^>]*>학생 · 교직원 · 관리자<\/p>/);
    expect(html).toContain('href="/settings"');
    expect(html).toContain('로그아웃');
  });

  it('세션을 조회하는 동안 인증 액션을 렌더하지 않는다', () => {
    const onLogout = vi.fn();

    const html = renderToStaticMarkup(
      <LoginButtonView
        session={null}
        pathname="/programs"
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={onLogout}
      />,
    );

    expect(html).toBe('');
  });

  it('익명 세션이면 GitHub이 아니라 가입·로그인 진입(/signup)으로 보낸다', () => {
    const session = { isAuthenticated: false } satisfies AuthSession;

    const html = renderToStaticMarkup(
      <LoginButtonView
        session={session}
        pathname="/programs"
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain('로그인');
    expect(html).toContain('href="/signup?returnTo=%2Fprograms"');
    expect(html).not.toContain(githubLoginPath);
  });

  it('좁은 화면용 짧은 라벨을 함께 렌더하고 접근성 이름은 전체 라벨로 고정한다', () => {
    const session = { isAuthenticated: false } satisfies AuthSession;

    const html = renderToStaticMarkup(
      <LoginButtonView
        session={session}
        pathname="/programs"
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="로그인"');
    expect(html).toContain('<span class="sm:hidden">로그인</span>');
    expect(html).toContain('<span class="hidden sm:inline">로그인');
  });

  it('인증 세션이면 아바타·닉네임 트리거를 렌더하고 닫힌 메뉴는 숨긴다', () => {
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={authenticatedSession}
        pathname="/programs"
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain('synthetic-user 계정 메뉴');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('https://avatars.example/u/1');
    expect(html).toContain('synthetic-user');
    expect(html).not.toContain('로그인 계정');
    expect(html).not.toContain('설정');
    expect(html).not.toContain('로그아웃');
    expect(html).not.toContain('회원가입');
    expect(html).not.toContain('Your profile');
  });

  it('열린 계정 메뉴에 로그인 계정·설정·로그아웃만 노출한다', () => {
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={authenticatedSession}
        pathname="/programs"
        logoutError={null}
        menuOpen={true}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain('로그인 계정');
    expect(html).toContain('synthetic-user');
    expect(html).toContain('설정');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('로그아웃');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('Your profile');

    expect(html).not.toContain('Signed in as');
    expect(html).not.toContain('Settings');
    expect(html).not.toContain('Sign out');

    expect(html).toContain('data-surface="default"');

    const openTagBefore = (label: string) =>
      new RegExp(`<[a-z]+([^>]*)>${label}`).exec(html)?.[1] ?? '';
    for (const label of ['설정', '로그아웃']) {
      const attrs = openTagBefore(label);
      expect(attrs, `${label} 여는 태그를 찾지 못했다`).not.toBe('');
      expect(attrs).toContain('role="menuitem"');
      expect(attrs).toMatch(/class="[^"]*\bw-full\b/);
      expect(attrs).toMatch(/class="[^"]*\btext-left\b/);
    }
  });
});

describe('현재 화면을 다시 가리키는 진입 버튼', () => {
  it('/signup에 서 있으면 가입·로그인 버튼을 내지 않는다', () => {
    const session = { isAuthenticated: false } satisfies AuthSession;

    const html = renderToStaticMarkup(
      <LoginButtonView
        session={session}
        pathname="/signup"
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toBe('');
  });
});
