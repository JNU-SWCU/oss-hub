import { describe, expect, it } from 'vitest';
import { buildPublicLandingGraph } from './landing-graph';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramPage,
} from './landing-overview';

describe('landing public overview boundary', () => {
  it('parses recruiting programs without private fields', () => {
    const page = parseLandingProgramPage({
      items: [
        {
          id: 'program_public_01',
          name: '공개 OSS 기여 프로그램',
          organizer: 'JNU-SWCU',
          category: 'OSS_CONTEST',
          applicationStartAt: '2026-07-01T00:00:00.000Z',
          applicationEndAt: '2026-08-14T00:00:00.000Z',
          description: '공개 모집 정보',
          privateMemo: 'must-not-leak',
        },
      ],
      page: 1,
      pageSize: 3,
      totalItems: 1,
      totalPages: 1,
    });

    expect(page).toEqual([
      {
        id: 'program_public_01',
        name: '공개 OSS 기여 프로그램',
        organizer: 'JNU-SWCU',
        category: 'OSS_CONTEST',
        applicationEndAt: '2026-08-14T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(page)).not.toContain('privateMemo');
  });

  it('builds a typed graph only from public archive projections', () => {
    const archive = parseLandingArchivePage({
      items: [
        {
          repositoryId: 'repo_public_01',
          programId: 'program_public_01',
          programName: '공개 OSS 기여 프로그램',
          displayName: 'campus-map',
          detailUrl: '/archive/repo_public_01',
        },
      ],
      page: 1,
      pageSize: 3,
      total: 1,
    });
    const detail = parseLandingArchiveDetail({
      repositoryId: 'repo_public_01',
      contributors: [
        {
          userId: 'user_public_01',
          githubNickname: 'sample-dev-01',
        },
      ],
    });

    const graph = buildPublicLandingGraph(archive, [detail]);

    expect(graph.source).toBe('public');
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'program',
          label: '공개 OSS 기여 프로그램',
          href: '/programs/program_public_01',
        }),
        expect.objectContaining({
          kind: 'repository',
          label: 'campus-map',
          href: '/archive/repo_public_01',
        }),
        expect.objectContaining({
          kind: 'student',
          label: '@sample-dev-01',
          href: '/profile/user_public_01',
        }),
      ]),
    );
    expect(graph.edges).toHaveLength(2);
  });

  it('rejects archive links outside the public app routes', () => {
    expect(() =>
      parseLandingArchivePage({
        items: [
          {
            repositoryId: 'repo_public_01',
            programId: 'program_public_01',
            programName: '공개 OSS 기여 프로그램',
            displayName: 'campus-map',
            detailUrl: 'https://example.com/private',
          },
        ],
        page: 1,
        pageSize: 3,
        total: 1,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });
});
