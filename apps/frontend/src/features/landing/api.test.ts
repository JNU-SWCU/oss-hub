import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { loadLandingGraph, loadLandingPrograms } from './api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  apiPath: (path: string) => `/api/v1/${path}`,
}));

describe('landing public API adapter', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('loads only recruiting programs through the shared API client', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      items: [
        {
          id: 'program_public_01',
          name: '공개 OSS 기여 프로그램',
          organizer: 'JNU-SWCU',
          category: 'OSS_CONTEST',
          applicationEndAt: '2026-08-14T00:00:00.000Z',
        },
      ],
    });

    const programs = await loadLandingPrograms();

    expect(apiClient).toHaveBeenCalledWith(
      'programs?page=1&pageSize=3&search=&status=recruiting',
    );
    expect(programs).toHaveLength(1);
  });

  it('hydrates graph contributors from public archive detail projections', async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce({
        items: [
          {
            projectId: 'repo_public_01',
            programId: 'program_public_01',
            programName: '공개 OSS 기여 프로그램',
            displayName: 'campus-map',
          },
        ],
      })
      .mockResolvedValueOnce({
        projectId: 'repo_public_01',
        contributors: [{ githubLogin: 'sample-dev-01' }],
      });

    const graph = await loadLandingGraph();

    expect(apiClient).toHaveBeenNthCalledWith(1, 'projects?pageSize=3');
    expect(apiClient).toHaveBeenNthCalledWith(2, 'projects/repo_public_01');
    expect(graph.source).toBe('public');
  });
});
