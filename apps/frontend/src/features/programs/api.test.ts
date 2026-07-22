import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { listPrograms } from './api';
import type { ProgramListPage } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('listPrograms', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('sends search, status, and pagination through the public list query', async () => {
    // Given
    const response = {
      items: [],
      page: 2,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    } satisfies ProgramListPage;
    vi.mocked(apiClient).mockResolvedValue(response);

    // When
    const result = await listPrograms({
      page: 2,
      pageSize: 20,
      search: '동명 프로그램',
      status: 'closed',
    });

    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs?page=2&pageSize=20&search=%EB%8F%99%EB%AA%85+%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8&status=closed',
    );
    expect(result).toEqual(response);
  });
});
