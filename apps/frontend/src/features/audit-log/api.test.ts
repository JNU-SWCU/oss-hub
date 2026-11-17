import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchAuditLogs } from './api';
import { AuditLogResponseError } from './parser';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

const EMPTY_PARAMS = {
  q: '',
  category: '',
  action: '',
  from: '',
  to: '',
  page: 1,
  limit: 20,
} as const;

describe('fetchAuditLogs', () => {
  it('검색어·분류·액션·기간 필터와 페이지네이션을 API query에 배선한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    await fetchAuditLogs({
      q: '김예시',
      category: 'ACCOUNT',
      action: 'USER_ROLE_CHANGED',
      from: '2026-07-01',
      to: '2026-07-24',
      page: 2,
      limit: 20,
    });

    expect(apiClient).toHaveBeenCalledWith(
      'audit-logs?q=%EA%B9%80%EC%98%88%EC%8B%9C&category=ACCOUNT&action=USER_ROLE_CHANGED&from=2026-07-01&to=2026-07-24&page=2&limit=20',
    );
  });

  it('빈 필터에서도 page·limit을 보내 백엔드 기본값에 의존하지 않는다', async () => {
    vi.mocked(apiClient).mockResolvedValue(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    await fetchAuditLogs(EMPTY_PARAMS);

    expect(apiClient).toHaveBeenCalledWith('audit-logs?page=1&limit=20');
  });

  it('응답을 검증해 파싱된 페이지를 돌려준다', async () => {
    vi.mocked(apiClient).mockResolvedValue(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    const page = await fetchAuditLogs(EMPTY_PARAMS);

    expect(page.total).toBe(5);
    expect(page.items.map((item) => item.category)).toEqual([
      'ACCOUNT',
      'OPERATION',
      'SUBMISSION',
      'SYSTEM',
      'LOGIN',
    ]);
  });

  it('과거의 배열 응답 계약을 조용히 받아들이지 않는다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);

    await expect(fetchAuditLogs(EMPTY_PARAMS)).rejects.toBeInstanceOf(
      AuditLogResponseError,
    );
  });
});
