import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import * as authApi from './api';
import type { AuthSession, LogoutResult } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  apiPath: vi.fn((path: string) => `test:${path}`),
}));

describe('current-user session API contract', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('현재 세션을 auth/session에서 한 번 조회한다', async () => {
    const session = { isAuthenticated: false } satisfies AuthSession;
    vi.mocked(apiClient).mockResolvedValue(session);

    const result = await authApi.fetchSession();

    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('auth/session');
    expect(result).toEqual(session);
  });

  it('로그아웃은 auth/logout만 호출한다', async () => {
    const result = { isAuthenticated: false } satisfies LogoutResult;
    vi.mocked(apiClient).mockResolvedValue(result);

    await expect(authApi.logout()).resolves.toEqual(result);

    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('auth/logout', { method: 'POST' });
  });

  it('fetchMe current-user helper is not part of the auth API', () => {
    expect(authApi).not.toHaveProperty('fetchMe');
    expect(Object.keys(authApi).sort()).toEqual(['fetchSession', 'logout']);
  });
});
