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
          trackType: 'EXTRACURRICULAR',
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
        trackType: 'EXTRACURRICULAR',
        applicationEndAt: '2026-08-14T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(page)).not.toContain('privateMemo');
  });

  it('rejects leftover category keys in program list responses', () => {
    expect(() =>
      parseLandingProgramPage({
        items: [
          {
            id: 'program_public_01',
            name: '공개 OSS 기여 프로그램',
            organizer: 'JNU-SWCU',
            category: 'OSS_CONTEST',
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 3,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });

  it('accepts seed-style program ids that use colons', () => {
    const page = parseLandingProgramPage({
      items: [
        {
          id: 'seed:intake:program-seven-templates:BASIC',
          name: 'seed-program-basic',
          organizer: 'seed-organizer',
          trackType: 'EXTRACURRICULAR',
          applicationEndAt: '2026-08-24T06:25:11.317Z',
        },
      ],
      page: 1,
      pageSize: 3,
      totalItems: 1,
      totalPages: 1,
    });

    expect(page[0]?.id).toBe('seed:intake:program-seven-templates:BASIC');
  });

  it('builds a typed graph only from public archive projections', () => {
    const archive = parseLandingArchivePage({
      items: [
        {
          projectId: 'repo_public_01',
          programId: 'program_public_01',
          programName: '공개 OSS 기여 프로그램',
          displayName: 'campus-map',
        },
      ],
      pageSize: 3,
      nextPageId: null,
    });
    const detail = parseLandingArchiveDetail({
      projectId: 'repo_public_01',
      contributors: [{ githubLogin: 'sample-dev-01' }],
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
          href: 'https://github.com/sample-dev-01',
        }),
      ]),
    );
    expect(graph.edges).toHaveLength(2);
  });

  // 예전에는 응답이 준 detailUrl 을 그대로 썼기 때문에 바깥 주소가 섞여 들어올
  // 수 있었다. 이제 상세 경로를 id 에서 직접 만들므로, 막아야 할 것은 링크가
  // 아니라 id 자체다.
  it('rejects archive ids that could escape the public app routes', () => {
    expect(() =>
      parseLandingArchivePage({
        items: [
          {
            projectId: '../../evil',
            programId: 'program_public_01',
            programName: '공개 OSS 기여 프로그램',
            displayName: 'campus-map',
          },
        ],
        pageSize: 3,
        nextPageId: null,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });
});
