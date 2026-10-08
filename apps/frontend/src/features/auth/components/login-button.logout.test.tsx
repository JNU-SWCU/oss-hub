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
      return Promise.resolve();
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

    mocks.logout.mockRejectedValue(new Error('network'));

    await act(async () => {
      root.render(<LoginButton />);
      return Promise.resolve();
    });
    clickLogout();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
});
