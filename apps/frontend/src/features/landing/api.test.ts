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
    const { graph, completeness } = await complete;

    expect(apiClient).toHaveBeenNthCalledWith(1, 'projects?pageSize=3');
    expect(apiClient).toHaveBeenNthCalledWith(2, 'projects/repo_public_01');
    expect(graph.source).toBe('public');
    expect(completeness).toBe('complete');
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
    expect(base.graph.source).toBe('public');
    expect(
      base.graph.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(
      base.graph.nodes.filter((node) => node.kind === 'program'),
    ).toHaveLength(1);
    expect(studentLabels(base.graph)).toEqual([]);
    // 아직 아무것도 실패하지 않았다 — 기여자는 0이라 화면이 `—`로 내보낸다
    expect(base.completeness).toBe('complete');
  });

  it('keeps the rest of the graph but flags it partial when one detail request fails', async () => {
    // Given — 상세 하나가 전송 단계에서 실패한다
    vi.mocked(apiClient)
      .mockResolvedValueOnce(ARCHIVE_PAGE)
      .mockRejectedValueOnce(new Error('일시적인 통신 오류'))
      .mockResolvedValueOnce({
        projectId: 'repo_public_02',
        contributors: [{ githubLogin: 'sample-dev-02' }],
      });

    // When
    const { graph, completeness } = await (await streamLandingGraph()).complete;

    // Then — 예시 그래프로 되돌아가지 않고, 실패한 프로젝트의 기여자만 빠진다
    expect(graph.source).toBe('public');
    expect(
      graph.nodes.filter((node) => node.kind === 'repository'),
    ).toHaveLength(2);
    expect(studentLabels(graph)).toEqual(['@sample-dev-02']);
    // 줄어든 기여자 수를 정확한 수처럼 내보이지 않도록 표를 남긴다
    expect(completeness).toBe('partial');
  });

  it('fails the enriched stage closed when a detail response violates the contract', async () => {
    // Given — 응답은 도착했지만 contributors 가 계약과 다르다
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

    // When
    const { base, complete } = await streamLandingGraph();

    /*
     * Then — 계약 위반은 전송 실패처럼 조용히 넘기지 않는다. 넘기면 기여자 1명짜리
     * 그래프가 `공개 아카이브 기준`이라는 정확한 수치로 화면에 걸린다.
     */
    await expect(complete).rejects.toBeInstanceOf(LandingOverviewResponseError);
    // 1단계 그래프는 그대로 남고, 기여자는 0이라 화면이 `—`로 내보낸다
    expect(base.graph.source).toBe('public');
    expect(studentLabels(base.graph)).toEqual([]);
  });

  it('still fails loudly when the archive list itself cannot be read', async () => {
    // Given — 목록이 없으면 세울 그래프가 없다. 호출부가 예시 그래프로 되돌리도록 던진다.
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('일시적인 통신 오류'));

    // When / Then
    await expect(streamLandingGraph()).rejects.toThrow();
  });
});
