import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { SECTION_FACETS } from './section-facets';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

describe('program section facets', () => {
  it('미종료 전체 집계와 종료 상태 집계를 별도로 표시한다', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      all: 9,
      recruiting: 2,
      in_progress: 1,
      upcoming: 3,
      ended: 3,
    });
    const signal = new AbortController().signal;
    const data = await SECTION_FACETS.programs?.load?.(signal);
    expect(apiClient).toHaveBeenCalledWith('programs/status-counts');
    expect(
      SECTION_FACETS.programs
        ?.items(data)
        .map(({ href, count }) => ({ href, count })),
    ).toEqual([
      { href: '/programs', count: 6 },
      { href: '/programs?status=recruiting', count: 2 },
      { href: '/programs?status=in_progress', count: 1 },
      { href: '/programs?status=upcoming', count: 3 },
      { href: '/programs?status=ended', count: 3 },
    ]);
  });
});
