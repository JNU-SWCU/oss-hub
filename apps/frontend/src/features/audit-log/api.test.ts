import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchAuditLogs } from './api';
import { AuditLogResponseError } from './parser';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';
import type { AuditLogPage } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 20 };

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

  it('실제 백엔드 응답 모양({ items, total, page, limit })을 검증해 파싱된 페이지를 돌려준다', async () => {
    vi.mocked(apiClient).mockResolvedValue(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    const page: AuditLogPage = await fetchAuditLogs({
      actor: '',
      action: '',
      from: '',
      to: '',
      page: 1,
      limit: 20,
    });

    expect(page.total).toBe(21);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toEqual({
      id: 'audit-access-approved',
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-synthetic-1',
      target: 'synthetic-target-login',
      occurredAt: '2026-07-24T03:00:00.000Z',
    });
  });

  it('과거의 배열 응답 계약(비페이지 모양)을 다시 조용히 받아들이지 않는다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);

    await expect(
      fetchAuditLogs({
        actor: '',
        action: '',
        from: '',
        to: '',
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(AuditLogResponseError);
  });
});
