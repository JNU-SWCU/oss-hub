import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import type { AuthSession, Me } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  apiPath: vi.fn((path: string) => `test:${path}`),
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

function nextSnapshot(
  status: ReturnType<typeof getSessionSnapshot>['status'],
): Promise<ReturnType<typeof getSessionSnapshot>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for auth session status ${status}`));
    }, 1_000);
    const unsubscribe = subscribeSession(() => {
      const state = getSessionSnapshot();
      if (state.status !== status) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(state);
    });
  });
}

describe('login/logout/refresh current-session seam', () => {
  beforeEach(() => {
    resetSessionStore();
    vi.mocked(apiClient).mockReset();
  });

  it('current-session load uses only auth/session', async () => {
    // Given
    const session = {
      isAuthenticated: true,
      user: syntheticUser,
    } satisfies AuthSession;
    vi.mocked(apiClient).mockResolvedValue(session);

    // When
    const published = nextSnapshot('authenticated');
    ensureSessionLoaded();
    await published;

    // Then
    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('auth/session');
    expect(getSessionSnapshot()).toEqual({
      status: 'authenticated',
      user: syntheticUser,
    });
  });

  it('refresh uses only auth/session', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue({ isAuthenticated: false });
    const anonymous = nextSnapshot('anonymous');
    ensureSessionLoaded();
    await anonymous;

    // When
    const refreshed = nextSnapshot('anonymous');
    refreshSession();
    await refreshed;

    // Then
    expect(apiClient).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient).mock.calls).toEqual([
      ['auth/session'],
      ['auth/session'],
    ]);
  });
});
