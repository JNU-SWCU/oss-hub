import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, Me } from './types';

const fetchSession = vi.fn<() => Promise<AuthSession>>();

vi.mock('./api', () => ({
  fetchSession: () => fetchSession(),
}));

const {
  ensureSessionLoaded,
  getSessionSnapshot,
  refreshSession,
  resetSessionStore,
  subscribeSession,
} = await import('./session-store');

const syntheticUser: Me = {
  nickname: 'synthetic-user',
  name: null,
  email: null,
  avatarUrl: null,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
};

function persistedPageTransition(type: 'pagehide' | 'pageshow'): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: true });
  return event;
}

function waitForStatus(
  status: ReturnType<typeof getSessionSnapshot>['status'],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for session status ${status}`));
    }, 1_000);
    const unsubscribe = subscribeSession(() => {
      if (getSessionSnapshot().status !== status) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

beforeEach(() => {
  resetSessionStore();
  fetchSession.mockReset();
});

describe('공유 인증 세션 브라우저 수명주기', () => {
  it('bfcache 복원은 구독자를 유지하고 기존 화면을 보존한 채 세션을 재검증한다', async () => {
    fetchSession.mockResolvedValueOnce({
      isAuthenticated: true,
      user: syntheticUser,
    });
    const authenticated = waitForStatus('authenticated');
    ensureSessionLoaded();
    await authenticated;

    const existingSubscriber = vi.fn();
    subscribeSession(existingSubscriber);
    const beforeRestore = getSessionSnapshot();

    window.dispatchEvent(persistedPageTransition('pagehide'));
    expect(getSessionSnapshot()).toBe(beforeRestore);

    fetchSession.mockResolvedValueOnce({ isAuthenticated: false });
    const anonymous = waitForStatus('anonymous');
    window.dispatchEvent(persistedPageTransition('pageshow'));

    expect(getSessionSnapshot()).toBe(beforeRestore);
    await anonymous;
    expect(existingSubscriber).toHaveBeenCalledOnce();
    expect(getSessionSnapshot()).toEqual({ status: 'anonymous', user: null });

    existingSubscriber.mockClear();
    fetchSession.mockResolvedValueOnce({
      isAuthenticated: true,
      user: syntheticUser,
    });
    const refreshed = waitForStatus('authenticated');
    refreshSession();
    await refreshed;

    expect(existingSubscriber).toHaveBeenCalledTimes(2);
    expect(getSessionSnapshot()).toEqual({
      status: 'authenticated',
      user: syntheticUser,
    });
  });

  it('같은 문서의 클라이언트 탐색은 세션을 loading으로 되돌리지 않는다', async () => {
    fetchSession.mockResolvedValueOnce({
      isAuthenticated: true,
      user: syntheticUser,
    });
    const authenticated = waitForStatus('authenticated');
    ensureSessionLoaded();
    await authenticated;

    const current = getSessionSnapshot();
    const subscriber = vi.fn();
    subscribeSession(subscriber);
    ensureSessionLoaded();

    expect(getSessionSnapshot()).toBe(current);
    expect(fetchSession).toHaveBeenCalledOnce();
    expect(subscriber).not.toHaveBeenCalled();
  });
});
