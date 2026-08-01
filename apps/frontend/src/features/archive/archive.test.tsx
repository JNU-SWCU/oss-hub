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
