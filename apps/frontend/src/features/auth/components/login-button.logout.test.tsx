// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSessionResult } from '../use-session';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '../login-destination';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshSession: vi.fn(),
  useSession: vi.fn(),
  assign: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}));

vi.mock('../api', () => ({
  logout: mocks.logout,
}));

vi.mock('../session-store', () => ({
  refreshSession: mocks.refreshSession,
}));

vi.mock('../use-session', () => ({
  useSession: mocks.useSession,
}));

import { LoginButton } from './login-button';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 로그아웃을 누른 뒤 **어디에 착지하는가**를 본다.
 *
 * 이 배선에는 지금까지 테스트가 하나도 없었다. 뷰 테스트(`login-button.test.tsx`)는
 * `onLogout`을 가짜로 받으므로 착지 경로를 볼 수 없고, 그 사이에 착지 경로가
 * `/?loggedOut=1`(쿼리 표식)에서 `/logout`(전용 화면)으로 바뀌었다. 쿼리 표식은
 * 새로고침·뒤로가기 한 번에 사라져 "다른 계정으로 로그인하려면 GitHub에서도
 * 로그아웃해야 한다"는 안내가 통째로 없어진다 — 그게 #348에서 사용자가 겪은 일이다.
 */
describe('LoginButton 로그아웃 착지', () => {
  const authenticatedState: AuthSessionResult = {
    status: 'authenticated',
    user: {
      nickname: 'synthetic-user',
      name: null,
      email: null,
      avatarUrl: null,
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: true,
    },
    retry: vi.fn(),
  };

  let container: HTMLDivElement;
  let root: Root;

  function clickLogout(): void {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    if (!trigger) throw new Error('계정 메뉴 트리거를 찾지 못했다');
    act(() => trigger.click());

    const items = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    const logoutItem = items.find((item) => item.textContent === '로그아웃');
    if (!logoutItem) throw new Error('로그아웃 항목을 찾지 못했다');
    act(() => logoutItem.click());
  }

  beforeEach(() => {
    sessionStorage.clear();
    mocks.logout.mockReset();
    mocks.refreshSession.mockReset();
    mocks.useSession.mockReset();
    mocks.assign.mockReset();
    mocks.usePathname.mockReset();
    mocks.useSession.mockReturnValue(authenticatedState);
    mocks.usePathname.mockReturnValue('/dashboard');

    // happy-dom의 location은 실제로 이동을 시도하므로 이동 요청만 가로챈다.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: mocks.assign, search: '', pathname: '/dashboard' },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function logoutFrom(pathname: string): Promise<void> {
    mocks.usePathname.mockReturnValue(pathname);
    await act(async () => {
      root.render(<LoginButton />);
    });
    clickLogout();
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each(['/dashboard', '/programs/42', '/consent', '/onboarding/role'])(
    '확정된 로그아웃은 %s에서 홈으로 전체 이동한다',
    async (pathname) => {
      rememberLoginDestination(sessionStorage, '/programs/42/apply');
      mocks.logout.mockResolvedValue({ isAuthenticated: false });
      await logoutFrom(pathname);
      expect(mocks.assign).toHaveBeenCalledExactlyOnceWith('/');
      expect(takeLoginDestination(sessionStorage)).toBeNull();
    },
  );

  it('브라우저 저장소를 읽을 수 없어도 확정된 로그아웃은 홈으로 이동한다', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    mocks.logout.mockResolvedValue({ isAuthenticated: false });
    await logoutFrom('/dashboard');
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('로그아웃이 확정되지 않으면 공유 세션만 다시 읽는다', async () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply');
    mocks.logout.mockResolvedValue({ isAuthenticated: true });

    await logoutFrom('/dashboard');

    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });

  it('로그아웃 요청이 실패하면 이동하지 않고 오류를 남긴다', async () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply');
    // Given — 세션이 아직 살아 있는데 완료 화면을 띄우면 거짓말이 된다.
    mocks.logout.mockRejectedValue(new Error('network'));

    // When
    await act(async () => {
      root.render(<LoginButton />);
    });
    clickLogout();
    await act(async () => {
      await Promise.resolve();
    });

    // Then
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
});
