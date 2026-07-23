import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchAdminUsers, updateAdminUserRole } from './api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('관리자 사용자 API', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('이름·닉네임 검색과 역할 필터를 목록 query에 배선한다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);

    await fetchAdminUsers({ query: '한글 사용자', role: 'STAFF' });

    expect(apiClient).toHaveBeenCalledWith(
      'users?query=%ED%95%9C%EA%B8%80+%EC%82%AC%EC%9A%A9%EC%9E%90&role=STAFF',
    );
  });

  it('역할 변경은 대상 ID를 인코딩하고 PATCH body를 보낸다', async () => {
    vi.mocked(apiClient).mockResolvedValue({});

    await updateAdminUserRole('synthetic:user', 'ADMIN');

    expect(apiClient).toHaveBeenCalledWith('users/synthetic%3Auser/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"role":"ADMIN"}',
    });
  });
});
