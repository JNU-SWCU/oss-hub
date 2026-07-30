import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginButtonView } from './login-button';
import { githubLoginPath } from '../api';
import type { AuthSession } from '../types';

const authenticatedSession = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-user',
    name: null,
    email: null,
    avatarUrl: 'https://avatars.example/u/1',
    role: 'STUDENT',
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
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={onLogout}
      />,
    );

    // Then
    expect(html).toBe('');
  });

  it('익명 세션이면 GitHub 로그인 링크를 렌더한다', () => {
    // Given
    const session = { isAuthenticated: false } satisfies AuthSession;

    // When
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={session}
        logoutError={null}
        menuOpen={false}
        onMenuOpenChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('GitHub으로 로그인');
    expect(html).toContain(`href="${githubLoginPath}"`);
  });

  it('인증 세션이면 아바타·닉네임 트리거를 렌더하고 닫힌 메뉴는 숨긴다', () => {
    // When
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={authenticatedSession}
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
    expect(html).not.toContain('GitHub으로 로그인');
    expect(html).not.toContain('Your profile');
  });

  it('열린 계정 메뉴에 로그인 계정·설정·로그아웃만 노출한다', () => {
    // When
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={authenticatedSession}
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
  });
});
