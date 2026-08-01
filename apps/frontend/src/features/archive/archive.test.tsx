import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  loadArchiveDetail,
  loadArchivePage,
  parseArchiveDetail,
  parseArchivePage,
} from './api';
import { ArchiveDetailContent } from './components/archive-detail-view';
import { ArchiveListContent } from './components/archive-list-view';

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
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '공개 프로젝트',
  repositoryName: 'oss-public',
  githubUrl: 'https://github.com/JNU-SWCU/oss-public',
  publishedAt: '2026-07-24T01:00:00.000Z',
};

const pageResponse = {
  items: [item],
  pageSize: 12,
  nextPageId: 'cursor-2',
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

describe('public archive parsers', () => {
  it('accepts the frozen page and detail contracts', () => {
    expect(parseArchivePage(pageResponse)).toMatchObject({
      pageSize: 12,
      nextPageId: 'cursor-2',
      items: [{ modeLabel: '팀', categoryLabel: 'OSS 경진대회' }],
    });
    expect(parseArchiveDetail(detailResponse)).toMatchObject({
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
    ['unknown category', { ...item, category: 'UNKNOWN' }],
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
  ])('%s is rejected from the list contract', (_case, malformed) => {
    expect(() =>
      parseArchivePage({ ...pageResponse, items: [malformed] }),
    ).toThrow('공개 아카이브 응답 형식이 올바르지 않습니다');
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
    expect(() => parseArchiveDetail(malformed)).toThrow(
      '공개 아카이브 응답 형식이 올바르지 않습니다',
    );
  });
});

describe('public archive API boundary', () => {
  it('uses apiClient with keyset cursor pagination', async () => {
    vi.mocked(apiClient).mockResolvedValue(pageResponse);

    await expect(
      loadArchivePage({ pageId: 'cursor-1', pageSize: 12 }),
    ).resolves.toMatchObject({ nextPageId: 'cursor-2' });
    expect(apiClient).toHaveBeenCalledWith(
      'projects?pageSize=12&pageId=cursor-1',
    );
  });

  it('omits pageId on the first page', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      ...pageResponse,
      nextPageId: null,
    });

    await loadArchivePage({ pageId: null, pageSize: 12 });
    expect(apiClient).toHaveBeenCalledWith('projects?pageSize=12');
  });

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

    await expect(loadArchiveDetail('repo_123')).rejects.toThrow(
      '공개 프로젝트를 찾을 수 없습니다',
    );
    expect(apiClient).toHaveBeenCalledWith('projects/repo_123');
  });
});

describe('public archive views', () => {
  const callbacks = {
    onCategoryChange: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onRetry: vi.fn(),
  };

  it('renders results and pagination controls', () => {
    const html = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', page: parseArchivePage(pageResponse) }}
        hasPrevious={true}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('공개 프로젝트');
    expect(html).toContain('GitHub PUBLIC');
    expect(html).toContain('href="/archive/repo_123"');
  });

  it('renders ordinary and filter-empty states', () => {
    const emptyPage = { items: [], pageSize: 12, nextPageId: null };
    const emptyHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', page: emptyPage }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    const filterEmptyHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', page: parseArchivePage(pageResponse) }}
        category="CAPSTONE"
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(emptyHtml).toContain('공개된 프로젝트 없음');
    expect(filterEmptyHtml).toContain('검색 결과 없음');
    expect(filterEmptyHtml).toContain('필터 초기화');
  });

  it('renders detail activity copy, contributors, and the not-found state', () => {
    const detailHtml = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{
          kind: 'ready',
          archive: parseArchiveDetail(detailResponse),
        }}
        onRetry={callbacks.onRetry}
      />,
    );
    const notFoundHtml = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{ kind: 'not-found' }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailHtml).toContain('GitHub 열기');
    expect(detailHtml).toContain('누적 활동');
    expect(detailHtml).toContain('@octocat');
    expect(detailHtml).toContain('href="https://github.com/octocat"');
    expect(detailHtml).toContain('누적 활동 안내: 평가·점수·랭킹이 아닙니다');
    expect(notFoundHtml).toContain('목록으로 돌아가기');
  });

  it('renders the zero-contributor state without a raw null/undefined leak', () => {
    const html = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{
          kind: 'ready',
          archive: parseArchiveDetail({ ...detailResponse, contributors: [] }),
        }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('등록된 기여자가 없습니다');
  });

  it('never renders raw load error text', () => {
    const html = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'error' }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('SECRET');
  });
});

// F4 QA 감사 갭: outcome-1·2·4·5·8은 지금까지 backend 통합 테스트
// (`public-exposure-matrix.integration.spec.ts`)에서만 증명됐다. 아래는 그 outcome들의
// "사용자가 실제로 보는 화면" 절반을 frontend 레벨에서 고정한다. ranking 쪽 절반(outcome-2
// 기여자 분리, outcome-4 stale 랭킹 제외, outcome-5 회수 시 사라짐)은
// `ranking/components/ranking-view.test.tsx`가 동일한 synthetic 식별자로 짝을 맞춘다.
describe('F4 gap — screen-level exposure outcomes (outcome-1/2/4/5/8)', () => {
  const callbacks = {
    onCategoryChange: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
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

  it('outcome-1: 발행 전(platform PRIVATE) 프로젝트는 목록 응답에 없고, 상세 조회는 not-found로 렌더된다', () => {
    const otherItem = {
      ...item,
      projectId: 'synthetic-exposure-sibling-project',
      repositoryName: 'synthetic-exposure-sibling-repo',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-exposure-sibling-repo',
    };
    const listHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{
          kind: 'ready',
          page: parseArchivePage({
            items: [otherItem],
            pageSize: 12,
            nextPageId: null,
          }),
        }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(listHtml).not.toContain('synthetic-outcome1');

    const detailHtml = renderToStaticMarkup(
      <ArchiveDetailContent
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
      <ArchiveDetailContent
        state={{ kind: 'ready', archive: parseArchiveDetail(outcome2Detail) }}
        onRetry={callbacks.onRetry}
      />,
    );

    expect(html).toContain('@synthetic-outcome2-owner-login');
    expect(html).toContain('@synthetic-outcome2-other-login');
    expect(html).toContain('커밋 5 · PR 2 · 릴리스 1');
    expect(html).toContain('커밋 3 · PR 1 · 릴리스 0');
    expect(html).toContain('<strong class="text-2xl">8</strong>');
    expect(html).toContain('<strong class="text-2xl">3</strong>');
    expect(html).toContain('<strong class="text-2xl">1</strong>');
    for (const forbidden of forbiddenFields) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('outcome-4: 발행 이전 관측(stale)이라도 아카이브 상세는 그대로 노출한다(stale-allow) — ranking 배제는 ranking-view.test.tsx가 짝을 맞춘다', () => {
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
      <ArchiveDetailContent
        state={{ kind: 'ready', archive: parseArchiveDetail(outcome4Detail) }}
        onRetry={callbacks.onRetry}
      />,
    );

    expect(html).toContain('@synthetic-outcome4-applicant-login');
    expect(html).toContain('@synthetic-outcome4-other-login');
  });

  it('outcome-5: 발행 후 비공개 관측(회수)이 반영되면 목록에서 사라지고 상세는 not-found로 바뀐다', () => {
    const outcome5Item = {
      ...item,
      projectId: 'synthetic-outcome5-project',
      displayName: 'synthetic 회수 예정 프로젝트',
      repositoryName: 'synthetic-outcome5-repo',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-outcome5-repo',
    };

    const beforeRevocationHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{
          kind: 'ready',
          page: parseArchivePage({
            items: [outcome5Item],
            pageSize: 12,
            nextPageId: null,
          }),
        }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(beforeRevocationHtml).toContain('synthetic 회수 예정 프로젝트');

    const afterRevocationHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{
          kind: 'ready',
          page: parseArchivePage({
            items: [],
            pageSize: 12,
            nextPageId: null,
          }),
        }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(afterRevocationHtml).not.toContain('synthetic 회수 예정 프로젝트');
    expect(afterRevocationHtml).toContain('공개된 프로젝트 없음');

    const detailAfterRevocationHtml = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{ kind: 'not-found' }}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(detailAfterRevocationHtml).not.toContain(
      'synthetic 회수 예정 프로젝트',
    );
    expect(detailAfterRevocationHtml).toContain('목록으로 돌아가기');
  });

  it('outcome-8: 4중 게이트 통과 후 발행되면 목록과 상세에 즉시 노출된다(관리 화면 감사 항목은 audit-log-view.test.tsx가 REPOSITORY_PUBLISHED로 별도 고정)', () => {
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

    const listHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{
          kind: 'ready',
          page: parseArchivePage({
            items: [outcome8Item],
            pageSize: 12,
            nextPageId: null,
          }),
        }}
        hasPrevious={false}
        onCategoryChange={callbacks.onCategoryChange}
        onNext={callbacks.onNext}
        onPrevious={callbacks.onPrevious}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(listHtml).toContain('synthetic 방금 발행된 프로젝트');
    expect(listHtml).toContain('href="/archive/synthetic-outcome8-project"');

    const detailHtml = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{ kind: 'ready', archive: parseArchiveDetail(outcome8Detail) }}
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
