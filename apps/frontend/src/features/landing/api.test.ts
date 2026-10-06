import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { loadLandingPrograms, streamLandingGraph } from './api';
import { LandingOverviewResponseError } from './landing-overview';

const ARCHIVE_PAGE = {
  items: [
    {
      projectId: 'repo_public_01',
      programId: 'program_public_01',
      programName: '공개 OSS 기여 프로그램',
      displayName: 'campus-map',
    },
    {
      projectId: 'repo_public_02',
      programId: 'program_public_01',
      programName: '공개 OSS 기여 프로그램',
      displayName: 'campus-bus',
    },
  ],
};

const studentLabels = (graph: {
  readonly nodes: readonly { readonly kind: string; readonly label: string }[];
}): readonly string[] =>
  graph.nodes
    .filter((node) => node.kind === 'student')
    .map((node) => node.label);

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
          trackType: 'EXTRACURRICULAR',
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
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockResolvedValueOnce({
        projectId: 'repo_public_01',
        contributors: [{ githubLogin: 'sample-dev-01' }],
      })
      .mockResolvedValueOnce({
        projectId: 'repo_public_02',
        contributors: [{ githubLogin: 'sample-dev-02' }],
      });

    const { complete } = await streamLandingGraph();
    const { graph, completeness } = await complete;

    expect(apiClient).toHaveBeenNthCalledWith(1, 'projects?pageSize=3');
    expect(apiClient).toHaveBeenNthCalledWith(2, 'projects/repo_public_01');
    expect(graph.source).toBe('public');
    expect(completeness).toBe('complete');
    expect(studentLabels(graph)).toEqual(['@sample-dev-01', '@sample-dev-02']);
  });

  it('draws programs and repositories from the list alone, without waiting on details', async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockReturnValue(new Promise(() => undefined));

    const { base } = await streamLandingGraph();

    expect(base.graph.source).toBe('public');
    expect(
      base.graph.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(
      base.graph.nodes.filter((node) => node.kind === 'program'),
    ).toHaveLength(1);
    expect(studentLabels(base.graph)).toEqual([]);

    expect(base.completeness).toBe('complete');
  });

  it('keeps the rest of the graph but flags it partial when one detail request fails', async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockRejectedValueOnce(new Error('일시적인 통신 오류'))
      .mockResolvedValueOnce({
        projectId: 'repo_public_02',
        contributors: [{ githubLogin: 'sample-dev-02' }],
      });

    const { graph, completeness } = await (await streamLandingGraph()).complete;

    expect(graph.source).toBe('public');
    expect(
      graph.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(studentLabels(graph)).toEqual(['@sample-dev-02']);

    expect(completeness).toBe('partial');
  });

  it('fails the enriched stage closed when a detail response violates the contract', async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockResolvedValueOnce({
        projectId: 'repo_public_01',
        contributors: '기여자 목록이 아니다',
      })
      .mockResolvedValueOnce({
        projectId: 'repo_public_02',
        contributors: [{ githubLogin: 'sample-dev-02' }],
      });

    const { base, complete } = await streamLandingGraph();

    await expect(complete).rejects.toBeInstanceOf(LandingOverviewResponseError);

    expect(base.graph.source).toBe('public');
    expect(studentLabels(base.graph)).toEqual([]);
  });

  it('still fails loudly when the archive list itself cannot be read', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('일시적인 통신 오류'));

    await expect(streamLandingGraph()).rejects.toThrow();
  });
});
