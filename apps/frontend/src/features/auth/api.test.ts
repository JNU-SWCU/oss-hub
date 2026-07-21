import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchSession } from './api';
import type { AuthSession } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  apiPath: vi.fn((path: string) => `test:${path}`),
}));

describe('fetchSession', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('현재 세션을 auth/session에서 한 번 조회한다', async () => {
    // Given
    const session = { isAuthenticated: false } satisfies AuthSession;
    vi.mocked(apiClient).mockResolvedValue(session);

    // When
    const result = await fetchSession();

    // Then
    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('auth/session');
    expect(result).toEqual(session);
  });
});
