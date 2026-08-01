import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchAuditLogs } from './api';
import type { AuditLogPage } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

const EMPTY_PAGE: AuditLogPage = { items: [], total: 0, page: 1, limit: 20 };

describe('fetchAuditLogs', () => {
  it('행위자·액션·기간 필터와 페이지네이션을 API query에 배선한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(EMPTY_PAGE);

    await fetchAuditLogs({
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-01',
      to: '2026-07-24',
      page: 2,
      limit: 20,
    });

    expect(apiClient).toHaveBeenCalledWith(
      'audit-logs?actor=synthetic-admin&action=STAFF_ROLE_REQUEST_APPROVED&from=2026-07-01&to=2026-07-24&page=2&limit=20',
    );
  });

  it('빈 필터에서도 page·limit을 보내 백엔드 기본값에 의존하지 않는다', async () => {
    vi.mocked(apiClient).mockResolvedValue(EMPTY_PAGE);

    await fetchAuditLogs({
      actor: '',
      action: '',
      from: '',
      to: '',
      page: 1,
      limit: 20,
    });

    expect(apiClient).toHaveBeenCalledWith('audit-logs?page=1&limit=20');
  });

  it('백엔드의 페이지 응답을 그대로 돌려준다', async () => {
    const page: AuditLogPage = {
      items: [
        {
          id: 'audit-1',
          actor: 'synthetic-admin',
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-1',
          target: 'synthetic-target',
          occurredAt: '2026-07-24T03:00:00.000Z',
        },
      ],
      total: 21,
      page: 1,
      limit: 20,
    };
    vi.mocked(apiClient).mockResolvedValue(page);

    await expect(
      fetchAuditLogs({
        actor: '',
        action: '',
        from: '',
        to: '',
        page: 1,
        limit: 20,
      }),
    ).resolves.toEqual(page);
  });
});
