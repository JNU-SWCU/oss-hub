import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import { loadProjectDetail, parseProjectDetail } from './api';
import { ProjectDetailContent } from './components/project-detail-view';

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly problem: Record<string, unknown>) {
      super(String(problem.detail));
    }
  },
  apiClient: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const item = {
  projectId: 'repo_123',
  programId: 'program_123',
  programName: '전남대학교 OSS 프로그램',
  trackType: 'EXTRACURRICULAR',
  applicationMode: 'TEAM',
  displayName: '공개 프로젝트',
  repositoryName: 'oss-public',
  githubUrl: 'https://github.com/JNU-SWCU/oss-public',
  publishedAt: '2026-07-24T01:00:00.000Z',
};

const detailResponse = {
  ...item,
  metrics: {
    commitCount: 42,
    pullRequestCount: 7,
    releaseCount: 3,
  },
  contributors: [
    {
      githubLogin: 'octocat',
      commitCount: 40,
      pullRequestCount: 5,
      releaseCount: 1,
    },
  ],
};

describe('public project parsers', () => {
  it('accepts the frozen detail contract', () => {
    expect(parseProjectDetail(detailResponse)).toMatchObject({
      repositoryName: 'oss-public',
      metrics: { commitCount: 42, pullRequestCount: 7, releaseCount: 3 },
      contributors: [
        {
          githubLogin: 'octocat',
          githubProfileUrl: 'https://github.com/octocat',
        },
      ],
    });
  });

  it.each([
    ['unsafe project id segment', { ...item, projectId: '../private' }],
    ['unknown mode', { ...item, applicationMode: 'PAIR' }],
    ['unknown track type', { ...item, trackType: 'UNKNOWN' }],
    ['leftover category key', { ...item, category: 'OSS_CONTEST' }],
    ['invalid date', { ...item, publishedAt: 'today' }],
    [
      'noncanonical date',
      { ...item, publishedAt: '2026-07-24T10:00:00+09:00' },
    ],
    [
      'wrong GitHub organization',
      { ...item, githubUrl: 'https://github.com/other/oss-public' },
    ],
    [
      'GitHub authority injection',
      {
        ...item,
        githubUrl: 'https://github.com/JNU-SWCU@evil.example/oss-public',
      },
    ],
    [
      'GitHub repository subpath',
      { ...item, githubUrl: 'https://github.com/JNU-SWCU/oss-public/issues' },
    ],
    [
      'GitHub query',
      {
        ...item,
        githubUrl: 'https://github.com/JNU-SWCU/oss-public?token=SECRET',
      },
    ],
    [
      'GitHub trailing slash',
      { ...item, githubUrl: 'https://github.com/JNU-SWCU/oss-public/' },
    ],
    ['unknown key', { ...item, ownerEmail: 'leak@example.com' }],
  ])('%s is rejected from the detail contract', (_case, malformed) => {
    expect(() =>
      parseProjectDetail({
        ...malformed,
        metrics: detailResponse.metrics,
        contributors: detailResponse.contributors,
      }),
    ).toThrow('공개 프로젝트 응답 형식이 올바르지 않습니다');
  });

  it.each([
    ['unknown key on detail', { ...detailResponse, internalNote: 'leak' }],
    [
      'unsafe github login',
      {
        ...detailResponse,
        contributors: [
          { ...detailResponse.contributors[0], githubLogin: '-bad' },
        ],
      },
    ],
    [
      'unknown contributor key',
      {
        ...detailResponse,
        contributors: [
          { ...detailResponse.contributors[0], realName: '홍길동' },
        ],
      },
    ],
  ])('%s is rejected from the detail contract', (_case, malformed) => {
    expect(() => parseProjectDetail(malformed)).toThrow(
      '공개 프로젝트 응답 형식이 올바르지 않습니다',
    );
  });
});

describe('public project API boundary', () => {
  it('maps the canonical not-found problem code without exposing its detail', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'private repository SECRET',
        instance: '/unexpected',
        code: 'PPJ_001',
      }),
    );

    await expect(loadProjectDetail('repo_123')).rejects.toThrow(
      '공개 프로젝트를 찾을 수 없습니다',
    );
    expect(apiClient).toHaveBeenCalledWith('projects/repo_123');
  });
});

describe('public project views', () => {
  const callbacks = {
    onRetry: vi.fn(),
  };

  it('renders detail activity copy, contributors, and the not-found state', () => {
    const detailHtml = renderToStaticMarkup(
      <ProjectDetailContent
        state={{
          kind: 'ready',
          project: parseProjectDetail(detailResponse),
        }}
        onRetry={callbacks.onRetry}
      />,
    );
    const notFoundHtml = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'not-found' }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailHtml).toContain('GitHub 저장소 열기');
    expect(detailHtml).toContain(
      'href="https://github.com/JNU-SWCU/oss-public"',
    );
    expect(detailHtml).toContain('누적 활동');
    expect(detailHtml).toContain('@octocat');
    expect(detailHtml).toContain('href="https://github.com/octocat"');
    expect(detailHtml).toContain('누적 활동 안내: 평가·점수·랭킹이 아닙니다');
    expect(notFoundHtml).toContain('목록으로 돌아가기');
  });

  it('renders the zero-contributor state without a raw null/undefined leak', () => {
    const html = renderToStaticMarkup(
      <ProjectDetailContent
        state={{
          kind: 'ready',
          project: parseProjectDetail({ ...detailResponse, contributors: [] }),
        }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('등록된 기여자가 없습니다');
  });
});

describe('F4 gap — screen-level exposure outcomes (outcome-1/2/4/5/8)', () => {
  const callbacks = {
    onRetry: vi.fn(),
  };

  const forbiddenFields = [
    'studentId',
    'department',
    'accountStatus',
    '"role"',
    'realName',
    '@example.com',
  ];

  it('outcome-1: 발행 전(platform PRIVATE) 프로젝트 상세는 not-found로 렌더된다', () => {
    const detailHtml = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'not-found' }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailHtml).toContain('공개 프로젝트를 찾을 수 없습니다');
    expect(detailHtml).not.toContain('synthetic-outcome1');
  });

  it('outcome-2: 발행 후 최신 관측(PUBLIC/PRESENT)이 확인된 프로젝트는 상세에서 기여자 2명을 커밋/PR/릴리스 수치까지 정확히 분리해 렌더한다', () => {
    const outcome2Detail = {
      ...item,
      projectId: 'synthetic-outcome2-project',
      repositoryName: 'synthetic-outcome2-repo',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-outcome2-repo',
      metrics: { commitCount: 8, pullRequestCount: 3, releaseCount: 1 },
      contributors: [
        {
          githubLogin: 'synthetic-outcome2-owner-login',
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
        {
          githubLogin: 'synthetic-outcome2-other-login',
          commitCount: 3,
          pullRequestCount: 1,
          releaseCount: 0,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'ready', project: parseProjectDetail(outcome2Detail) }}
        onRetry={callbacks.onRetry}
      />,
    );

    expect(html).toContain('@synthetic-outcome2-owner-login');
    expect(html).toContain('@synthetic-outcome2-other-login');
    expect(html).toContain('Commit 5 · PR 2 · Release 1');
    expect(html).toContain('Commit 3 · PR 1 · Release 0');
    expect(html).toContain('<strong class="text-2xl">8</strong>');
    expect(html).toContain('<strong class="text-2xl">3</strong>');
    expect(html).toContain('<strong class="text-2xl">1</strong>');
    for (const forbidden of forbiddenFields) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('outcome-4: 발행 이전 관측(stale)이라도 프로젝트 상세는 그대로 노출한다(stale-allow) — ranking 배제는 ranking-view.test.tsx가 짝을 맞춘다', () => {
    const outcome4Detail = {
      ...item,
      projectId: 'synthetic-outcome4-project',
      repositoryName: 'synthetic-outcome4-repo',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-outcome4-repo',
      metrics: { commitCount: 8, pullRequestCount: 3, releaseCount: 1 },
      contributors: [
        {
          githubLogin: 'synthetic-outcome4-applicant-login',
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
        {
          githubLogin: 'synthetic-outcome4-other-login',
          commitCount: 3,
          pullRequestCount: 1,
          releaseCount: 0,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'ready', project: parseProjectDetail(outcome4Detail) }}
        onRetry={callbacks.onRetry}
      />,
    );

    expect(html).toContain('@synthetic-outcome4-applicant-login');
    expect(html).toContain('@synthetic-outcome4-other-login');
  });

  it('outcome-5: 발행 후 비공개 관측(회수)이 반영되면 상세는 not-found로 바뀐다', () => {
    const detailAfterRevocationHtml = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'not-found' }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailAfterRevocationHtml).not.toContain(
      'synthetic 회수 예정 프로젝트',
    );
    expect(detailAfterRevocationHtml).toContain('목록으로 돌아가기');
  });

  it('outcome-8: 4중 게이트 통과 후 발행되면 상세에 즉시 노출된다(관리 화면 감사 항목은 audit-log-view.test.tsx가 REPOSITORY_PUBLISHED로 별도 고정)', () => {
    const outcome8Item = {
      ...item,
      projectId: 'synthetic-outcome8-project',
      displayName: 'synthetic 방금 발행된 프로젝트',
      repositoryName: 'synthetic-outcome8-repo',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-outcome8-repo',
    };
    const outcome8Detail = {
      ...outcome8Item,
      metrics: { commitCount: 8, pullRequestCount: 3, releaseCount: 1 },
      contributors: [
        {
          githubLogin: 'synthetic-outcome8-owner-login',
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
        {
          githubLogin: 'synthetic-outcome8-other-login',
          commitCount: 3,
          pullRequestCount: 1,
          releaseCount: 0,
        },
      ],
    };

    const detailHtml = renderToStaticMarkup(
      <ProjectDetailContent
        state={{ kind: 'ready', project: parseProjectDetail(outcome8Detail) }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailHtml).toContain('@synthetic-outcome8-owner-login');
    expect(detailHtml).toContain('@synthetic-outcome8-other-login');
    for (const forbidden of forbiddenFields) {
      expect(detailHtml).not.toContain(forbidden);
    }
  });
});
