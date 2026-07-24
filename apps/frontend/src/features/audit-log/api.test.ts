import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchAuditLogs } from './api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('fetchAuditLogs', () => {
  it('행위자·액션·기간 필터를 API query에 배선한다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);

    await fetchAuditLogs({
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-01',
      to: '2026-07-24',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'audit-logs?actor=synthetic-admin&action=STAFF_ROLE_REQUEST_APPROVED&from=2026-07-01&to=2026-07-24',
    );
  });

  it('빈 필터는 query string 없이 조회한다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);

    await fetchAuditLogs({ actor: '', action: '', from: '', to: '' });

    expect(apiClient).toHaveBeenCalledWith('audit-logs');
  });
});
