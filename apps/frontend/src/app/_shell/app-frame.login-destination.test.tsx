// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import type { SessionRoleResult } from './use-session-role';

const mocks = vi.hoisted(() => ({
  pathname: vi.fn(),
  session: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: mocks.pathname }));
vi.mock('./use-session-role', () => ({ useSessionRole: mocks.session }));
vi.mock('./shell-nav', () => ({ ShellNav: () => null }));
vi.mock('./product-shell', () => ({
  SidebarDrawerProvider: ({ children }: { readonly children: ReactNode }) =>
    children,
  ProductShell: ({ children }: { readonly children: ReactNode }) => children,
}));

import { AppFrame } from './app-frame';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const readySession: SessionRoleResult = {
  status: 'assigned',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
  selectedRole: null,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  retry: () => undefined,
};

describe('AppFrame 로그인 목적지 복귀', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    sessionStorage.clear();
    mocks.replace.mockReset();
    mocks.pathname.mockReturnValue('/');
    mocks.session.mockReturnValue(readySession);
    vi.spyOn(window.location, 'replace').mockImplementation(mocks.replace);
    rememberLoginDestination(sessionStorage, '/programs/42/apply');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  function render() {
    act(() =>
      root.render(
        <AppFrame>
          <p>본문</p>
        </AppFrame>,
      ),
    );
  }

  it.each(['/', '/dashboard'])(
    '완료 착지점 %s에서 한 번만 원래 화면으로 보낸다',
    (path) => {
      mocks.pathname.mockReturnValue(path);
      render();
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        '/programs/42/apply',
      );
      expect(takeLoginDestination(sessionStorage)).toBeNull();
    },
  );
  it.each([
    '/consent',
    '/onboarding/profile',
    '/onboarding/role',
    '/onboarding/pending',
    '/signup',
    '/account-deactivated',
    '/programs/42',
  ])('%s에서는 현재 절차를 가로채지 않는다', (path) => {
    mocks.pathname.mockReturnValue(path);
    render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it.each(['loading', 'error', 'anonymous', 'unassigned'] as const)(
    '%s 상태에서는 목적지를 보존한다',
    (status) => {
      mocks.session.mockReturnValue({ ...readySession, status });
      render();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
    },
  );
  it('프로필을 마치기 전에는 목적지를 소비하지 않는다', () => {
    mocks.session.mockReturnValue({
      ...readySession,
      isProfileComplete: false,
    });
    render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it('OAuth 실패 착지에서는 기존 세션이 있어도 원래 목적지로 이동하지 않는다', () => {
    vi.spyOn(window.location, 'search', 'get').mockReturnValue('?authError=1');
    render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it('sessionStorage getter를 거부한 브라우저에서도 셸을 렌더한다', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    expect(render).not.toThrow();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('본문');
  });
});
