import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { loadLandingPrograms, streamLandingGraph } from './api';

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
    const graph = await complete;

    expect(apiClient).toHaveBeenNthCalledWith(1, 'projects?pageSize=3');
    expect(apiClient).toHaveBeenNthCalledWith(2, 'projects/repo_public_01');
    expect(graph.source).toBe('public');
    expect(studentLabels(graph)).toEqual(['@sample-dev-01', '@sample-dev-02']);
  });

  it('draws programs and repositories from the list alone, without waiting on details', async () => {
    // Given — 상세 응답을 영원히 붙들어 둔다
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockReturnValue(new Promise(() => undefined));

    // When
    const { base } = await streamLandingGraph();

    // Then — 상세가 하나도 도착하지 않았는데도 공개 그래프가 이미 서 있다
    expect(base.source).toBe('public');
    expect(
      base.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(base.nodes.filter((node) => node.kind === 'program')).toHaveLength(
      1,
    );
    expect(studentLabels(base)).toEqual([]);
  });

  it('keeps the rest of the graph when one detail request fails', async () => {
    // Given
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockRejectedValueOnce(new Error('일시적인 통신 오류'))
      .mockResolvedValueOnce({
        projectId: 'repo_public_02',
        contributors: [{ githubLogin: 'sample-dev-02' }],
      });

    // When
    const graph = await (await streamLandingGraph()).complete;

    // Then — 예시 그래프로 되돌아가지 않고, 실패한 프로젝트의 기여자만 빠진다
    expect(graph.source).toBe('public');
    expect(
      graph.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(studentLabels(graph)).toEqual(['@sample-dev-02']);
  });

  it('still fails loudly when the archive list itself cannot be read', async () => {
    // Given — 목록이 없으면 세울 그래프가 없다. 호출부가 예시 그래프로 되돌리도록 던진다.
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('일시적인 통신 오류'));

    // When / Then
    await expect(streamLandingGraph()).rejects.toThrow();
  });
});
