import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { LoginButtonView } from './login-button';
import type { AuthSession } from '../types';

/**
 * 헤더가 OAuth로 직행하지 않는지 확인할 때 쓰는 경로. auth feature에는 이제 이
 * 상수가 없으므로(있으면 다시 쓰이게 된다) 경로 빌더로 그 자리에서 만든다.
 */
const githubLoginPath = apiPath('auth/github');

const authenticatedSession = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-user',
    name: null,
    email: null,
    avatarUrl: 'https://avatars.example/u/1',
    memberKind: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} satisfies AuthSession;

describe('LoginButtonView', () => {
  it('세션을 조회하는 동안 인증 액션을 렌더하지 않는다', () => {
    // Given
    const onLogout = vi.fn();

    // When
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

    // Then
    expect(html).toBe('');
  });

  // 헤더의 진입 버튼은 랜딩 본문의 주 행동과 같은 곳으로 가야 한다. 헤더만
  // OAuth로 직행하면 헤더를 눌러 들어온 방문자는 안내 없는 막다른 길을 그대로
  // 다시 만난다 — 두 진입점이 서로 다른 말을 하는 셈이다.
  it('익명 세션이면 GitHub이 아니라 가입·로그인 진입(/signup)으로 보낸다', () => {
    // Given
    const session = { isAuthenticated: false } satisfies AuthSession;

    // When
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

    // Then
    expect(html).toContain('회원가입 / 로그인');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain(githubLoginPath);
  });

  // 좁은 nav에서는 짧은 라벨을 쓰되, 스크린리더에는 두 폭 모두에서 같은 전체
  // 라벨이 읽혀야 한다 — 두 span이 동시에 읽히면 이름이 겹쳐 들린다.
  it('좁은 화면용 짧은 라벨을 함께 렌더하고 접근성 이름은 전체 라벨로 고정한다', () => {
    // Given
    const session = { isAuthenticated: false } satisfies AuthSession;

    // When
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

    // Then
    expect(html).toContain('aria-label="회원가입 / 로그인"');
    expect(html).toContain('<span class="sm:hidden">회원가입</span>');
    expect(html).toContain('<span class="hidden sm:inline">회원가입 / 로그인');
  });

  it('인증 세션이면 아바타·닉네임 트리거를 렌더하고 닫힌 메뉴는 숨긴다', () => {
    // When
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

    // Then
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
    // When
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

    // Then
    expect(html).toContain('로그인 계정');
    expect(html).toContain('synthetic-user');
    expect(html).toContain('설정');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('로그아웃');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('Your profile');
    // 한국어 서비스이므로 계정 메뉴에 영어 라벨이 남아 있으면 안 된다.
    expect(html).not.toContain('Signed in as');
    expect(html).not.toContain('Settings');
    expect(html).not.toContain('Sign out');
    // 반전 표면(랜딩 nav) 안에 중첩돼도 계정 메뉴 패널 자체는 밝은 표면으로 되돌아가야 한다.
    expect(html).toContain('data-surface="default"');
    // 설정·로그아웃은 같은 왼쪽 정렬 계약이다. ShellNav 자손 선택자가
    // menuitem을 건드리면 설정만 가운데로 밀리므로, 여기 마크업은 둘 다
    // text-left·w-full을 유지한다(cascade 제외는 shell-nav 테스트가 지킨다).
    expect(html).toMatch(
      /role="menuitem"[^>]*class="(?=[^"]*\bw-full\b)(?=[^"]*\btext-left\b)[^"]*"[^>]*>설정/,
    );
    expect(html).toMatch(
      /role="menuitem"[^>]*class="(?=[^"]*\bw-full\b)(?=[^"]*\btext-left\b)[^"]*"[^>]*>로그아웃/,
    );
  });
});

describe('현재 화면을 다시 가리키는 진입 버튼', () => {
  it('/signup에 서 있으면 가입·로그인 버튼을 내지 않는다', () => {
    // Given — 눌러도 제자리라 사용자는 화면이 멈춘 것으로 읽는다
    const session = { isAuthenticated: false } satisfies AuthSession;

    // When
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

    // Then
    expect(html).toBe('');
  });
});
