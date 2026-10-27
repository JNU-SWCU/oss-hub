import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { SECTION_FACETS } from './section-facets';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

describe('archive section facets', () => {
  it('서버 종료 연도를 전체 및 연도 링크로 표시한다', async () => {
    vi.mocked(apiClient).mockResolvedValue({ years: [2027, 2025] });
    const signal = new AbortController().signal;
    const data = await SECTION_FACETS.archive?.load?.(signal);
    expect(apiClient).toHaveBeenCalledWith('programs/ended-years', { signal });
    expect(SECTION_FACETS.archive?.items(data).map(({ href }) => href)).toEqual(
      ['/archive', '/archive?year=2027', '/archive?year=2025'],
    );
  });
});
