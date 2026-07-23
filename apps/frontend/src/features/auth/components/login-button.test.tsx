import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginButtonView } from './login-button';
import { githubLoginPath } from '../api';
import type { AuthSession } from '../types';

describe('LoginButtonView', () => {
  it('세션을 조회하는 동안 인증 액션을 렌더하지 않는다', () => {
    // Given
    const onLogout = vi.fn();

    // When
    const html = renderToStaticMarkup(
      <LoginButtonView session={null} logoutError={null} onLogout={onLogout} />,
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
        onLogout={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('GitHub으로 로그인');
    expect(html).toContain(`href="${githubLoginPath}"`);
  });

  it('인증 세션이면 모바일에서 짧은 로그아웃 라벨을 사용하고 계정명은 접근 가능하게 유지한다', () => {
    // Given
    const session = {
      isAuthenticated: true,
      user: {
        login: 'synthetic-user',
        name: null,
        avatarUrl: null,
        role: 'STUDENT',
      },
    } satisfies AuthSession;

    // When
    const html = renderToStaticMarkup(
      <LoginButtonView
        session={session}
        logoutError={null}
        onLogout={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('synthetic-user · ');
    expect(html).toContain('hidden md:inline');
    expect(html).toContain('synthetic-user 계정에서 로그아웃');
    expect(html).toContain('로그아웃');
    expect(html).not.toContain('GitHub으로 로그인');
  });
});
