import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  loadPublicArchive,
  loadPublicArchiveDetail,
  parsePublicArchiveDetail,
  parsePublicArchiveList,
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
  repositoryId: 'repo_123',
  programId: 'program_123',
  programName: '전남대학교 OSS 프로그램',
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '공개 프로젝트',
  githubUrl: 'https://github.com/JNU-SWCU/oss-public',
  publishedAt: '2026-07-24T01:00:00.000Z',
  detailUrl: '/archive/repo_123',
};

const listResponse = {
  items: [item],
  page: 2,
  pageSize: 12,
  total: 25,
};

const detailResponse = {
  ...(({ detailUrl: _, ...detail }) => detail)(item),
  repositoryName: 'oss-public',
  approvedSubmissionCount: 3,
  contributors: [
    {
      userId: 'user_123',
      githubNickname: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    },
  ],
};

describe('public archive parsers', () => {
  it('accepts the frozen list and detail contracts', () => {
    expect(parsePublicArchiveList(listResponse)).toMatchObject({
      page: 2,
      total: 25,
      items: [{ modeLabel: '팀' }],
    });
    expect(parsePublicArchiveDetail(detailResponse)).toMatchObject({
      repositoryName: 'oss-public',
      approvedSubmissionCount: 3,
      contributors: [{ githubNickname: 'octocat' }],
    });
  });

  it.each([
    ['unsafe repository path segment', { ...item, repositoryId: '../private' }],
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
    [
      'GitHub identity mismatch in detail',
      { ...detailResponse, githubUrl: 'https://github.com/JNU-SWCU/other' },
    ],
  ])('%s is rejected', (_case, malformed) => {
    const response =
      'repositoryName' in malformed
        ? malformed
        : { ...listResponse, items: [malformed] };
    expect(() =>
      'repositoryName' in response
        ? parsePublicArchiveDetail(response)
        : parsePublicArchiveList(response),
    ).toThrow('공개 아카이브 응답 형식이 올바르지 않습니다');
  });
});

describe('public archive API boundary', () => {
  it('uses apiClient with list filters and pagination', async () => {
    vi.mocked(apiClient).mockResolvedValue(listResponse);

    await expect(
      loadPublicArchive({
        page: 2,
        pageSize: 12,
        q: ' OSS ',
        applicationMode: 'TEAM',
      }),
    ).resolves.toMatchObject({ page: 2 });
    expect(apiClient).toHaveBeenCalledWith(
      'repositories/public?page=2&pageSize=12&q=OSS&applicationMode=TEAM',
    );
  });

  it('maps the public not-found problem code without exposing its detail', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'private repository SECRET',
        instance: '/unexpected',
        code: 'SHW_001',
      }),
    );

    await expect(loadPublicArchiveDetail('repo_123')).rejects.toThrow(
      '공개 프로젝트를 찾을 수 없습니다',
    );
    expect(apiClient).toHaveBeenCalledWith('repositories/repo_123/public');
  });
});

describe('public archive views', () => {
  const callbacks = {
    onSearch: vi.fn(),
    onPage: vi.fn(),
    onRetry: vi.fn(),
  };

  it('renders results and pagination', () => {
    const html = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', archive: parsePublicArchiveList(listResponse) }}
        q=""
        onSearch={callbacks.onSearch}
        onPage={callbacks.onPage}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('공개 프로젝트');
    expect(html).toContain('GitHub PUBLIC');
    expect(html).toContain('2 / 3');
    expect(html).toContain('href="/archive/repo_123"');
  });

  it('renders ordinary and search-empty states', () => {
    const empty = { items: [], page: 1, pageSize: 12, total: 0 };
    const emptyHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', archive: empty }}
        q=""
        onSearch={callbacks.onSearch}
        onPage={callbacks.onPage}
        onRetry={callbacks.onRetry}
      />,
    );
    const searchEmptyHtml = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'ready', archive: empty }}
        q="없는 검색"
        onSearch={callbacks.onSearch}
        onPage={callbacks.onPage}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(emptyHtml).toContain('공개된 프로젝트 없음');
    expect(searchEmptyHtml).toContain('검색 결과 없음');
    expect(searchEmptyHtml).toContain('필터 초기화');
  });

  it('renders detail activity copy, contributors, and the not-found state', () => {
    const detailHtml = renderToStaticMarkup(
      <ArchiveDetailContent
        state={{
          kind: 'ready',
          archive: parsePublicArchiveDetail(detailResponse),
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
    expect(detailHtml).toContain('승인된 마일스톤 제출');
    expect(detailHtml).toContain('octocat');
    expect(detailHtml).toContain('활동량 안내: 평가·점수·랭킹이 아닙니다');
    expect(notFoundHtml).toContain('목록으로 돌아가기');
  });

  it('never renders raw load error text', () => {
    const html = renderToStaticMarkup(
      <ArchiveListContent
        state={{ kind: 'error' }}
        q=""
        onSearch={callbacks.onSearch}
        onPage={callbacks.onPage}
        onRetry={callbacks.onRetry}
      />,
    );
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('SECRET');
  });
});
