// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import type { AuthSession } from '@/features/auth/types';

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn<() => Promise<AuthSession>>(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/features/auth/api', () => ({
  fetchSession: () => mocks.fetchSession(),
  logout: vi.fn(),
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyStaffAccessRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
}));

vi.mock('@/features/programs/program-apply-page', () => ({
  ProgramApplyPage: ({
    sessionUser,
  }: {
    readonly sessionUser: { readonly nickname: string };
  }) => <p>신청 화면: {sessionUser.nickname}</p>,
}));

import { RoleGate } from '../../../_shell/role-gate';
import {
  getSessionSnapshot,
  refreshSession,
  resetSessionStore,
  subscribeSession,
} from '@/features/auth/session-store';
import { ProgramApplyRoute } from './program-apply-route';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function nextSessionSnapshot(
  status: ReturnType<typeof getSessionSnapshot>['status'],
): Promise<ReturnType<typeof getSessionSnapshot>> {
  return new Promise<ReturnType<typeof getSessionSnapshot>>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for session status ${status}`));
      }, 1_000);
      const unsubscribe = subscribeSession(() => {
        const snapshot = getSessionSnapshot();
        if (snapshot.status !== status) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot);
      });
    },
  );
}

function unauthorizedSession(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: '로그인이 필요합니다.',
    status: 401,
    detail: '만료된 세션입니다.',
    instance: apiPath('auth/session'),
    code: 'AUT_003',
  });
}

describe('ProgramApplyRoute 세션 조립', () => {
  let container: HTMLDivElement;
  let root: Root;
  let uncaughtErrors: unknown[];

  beforeEach(() => {
    resetSessionStore();
    mocks.fetchSession.mockReset();
    mocks.replace.mockReset();
    uncaughtErrors = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container, {
      onUncaughtError: (error) => uncaughtErrors.push(error),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('RoleGate와 신청 화면이 한 세션 스냅샷으로 401 전환을 함께 본다', async () => {
    const authenticatedResponse = deferred<AuthSession>();
    mocks.fetchSession.mockReturnValueOnce(authenticatedResponse.promise);
    const transitions: ReturnType<typeof getSessionSnapshot>['status'][] = [];
    const unsubscribe = subscribeSession(() => {
      transitions.push(getSessionSnapshot().status);
    });
    const authenticated = nextSessionSnapshot('authenticated');

    await act(async () => {
      root.render(
        <RoleGate allow={['student']}>
          <ProgramApplyRoute programId="synthetic-program" teamId={null} />
        </RoleGate>,
      );
    });
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('확인 중…');

    authenticatedResponse.resolve({
      isAuthenticated: true,
      user: {
        nickname: 'synthetic-student',
        name: '합성 학생',
        email: null,
        avatarUrl: null,
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
        isProfileComplete: true,
      },
    });
    await act(async () => {
      await authenticated;
    });

    expect(container.textContent).toContain('신청 화면: synthetic-student');
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);

    mocks.fetchSession.mockRejectedValueOnce(unauthorizedSession());
    const anonymous = nextSessionSnapshot('anonymous');
    await act(async () => {
      refreshSession();
      expect(getSessionSnapshot().status).toBe('loading');
      await anonymous;
    });

    expect(mocks.fetchSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('로그인이 필요한 페이지입니다');
    expect(transitions).toEqual(['authenticated', 'loading', 'anonymous']);
    expect(uncaughtErrors).toEqual([]);
    unsubscribe();
  });
});
