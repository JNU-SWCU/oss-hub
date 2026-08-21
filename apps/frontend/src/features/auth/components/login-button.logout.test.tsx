// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSessionResult } from '../use-session';

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

import {
  LOGOUT_COMPLETE_PATH,
  LOGOUT_DEFAULT_RETURN_TO,
  LOGOUT_RETURN_TO_PARAM,
  resolveLogoutReturnTo,
} from '../logout-notice';
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
      role: 'STUDENT',
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

  it('로그아웃이 확정되면 전용 로그아웃 화면으로 전체 이동한다', async () => {
    // Given
    mocks.logout.mockResolvedValue({ isAuthenticated: false });

    // When
    await logoutFrom('/dashboard');

    // Then — 쿼리 표식(`/?loggedOut=1`)이 아니라 자기 주소를 가진 화면이다.
    expect(mocks.assign).toHaveBeenCalledWith(
      expect.stringContaining(LOGOUT_COMPLETE_PATH),
    );
    expect(mocks.assign).not.toHaveBeenCalledWith(
      expect.stringContaining('loggedOut'),
    );
  });

  /**
   * 이 배선이 빠져 있었다. 복귀 주소 계약(`logoutCompletePath(returnTo)`)도, 그 값을
   * 읽어 링크로 내는 화면도 다 있었는데 **호출부가 값을 넘기지 않아** 로그아웃은
   * 언제나 기본 복귀 주소로 착지했다 — 검증기·화면·테스트가 모두 통과하는 죽은 기능.
   * 그래서 "지금 서 있던 경로가 실제로 복귀 주소로 실린다"를 여기서 못으로 박는다.
   */
  it('서 있던 경로를 복귀 주소로 실어 보낸다', async () => {
    // Given
    mocks.logout.mockResolvedValue({ isAuthenticated: false });

    // When — 로그아웃을 누른 자리
    await logoutFrom('/programs/42');

    // Then — 완료 화면이 그 자리를 그대로 되읽는다.
    const assigned = mocks.assign.mock.calls[0]?.[0] as string;
    expect(assigned).toBe(
      `${LOGOUT_COMPLETE_PATH}?${LOGOUT_RETURN_TO_PARAM}=%2Fprograms%2F42`,
    );
    expect(resolveLogoutReturnTo(assigned.split('?')[1])).toBe('/programs/42');
  });

  /**
   * 복귀 주소로 삼으면 안 되는 자리들. 로그아웃 화면 자신은 눌러도 제자리인 링크가
   * 되고, 가입 절차 화면은 방금 세션을 버린 사람을 절차 한가운데 떨어뜨린다. 외부
   * 주소는 애초에 호출부가 만들 수 없는 값이지만, 호출부가 관문을 우회하지 않는다는
   * 사실 자체를 확인한다 — 관문은 `logoutCompletePath` 한 곳뿐이어야 한다.
   */
  it.each([
    ['로그아웃 화면 자신', LOGOUT_COMPLETE_PATH],
    ['가입 입구', '/signup'],
    ['약관 동의', '/consent'],
    ['역할 선택', '/onboarding/role'],
    ['외부 주소', 'https://evil.example'],
  ])(
    '%s에서 로그아웃하면 복귀 주소를 싣지 않는다',
    async (_label, pathname) => {
      // Given
      mocks.logout.mockResolvedValue({ isAuthenticated: false });

      // When
      await logoutFrom(pathname);

      // Then — 파라미터 없는 완료 화면이고, 읽어도 기본 복귀 주소다.
      const assigned = mocks.assign.mock.calls[0]?.[0] as string;
      expect(assigned).toBe(LOGOUT_COMPLETE_PATH);
      expect(resolveLogoutReturnTo(assigned.split('?')[1])).toBe(
        LOGOUT_DEFAULT_RETURN_TO,
      );
    },
  );

  it('로그아웃이 확정되지 않으면 공유 세션만 다시 읽는다', async () => {
    mocks.logout.mockResolvedValue({ isAuthenticated: true });

    await logoutFrom('/dashboard');

    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it('로그아웃 요청이 실패하면 이동하지 않고 오류를 남긴다', async () => {
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
  });
});
