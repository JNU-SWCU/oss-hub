import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  isSafePublicProfileUserId,
  loadPublicProfile,
  parsePublicProfile,
} from './public-profile-api';
import { PublicProfileContent } from './components/public-profile-view';

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly problem: Record<string, unknown>) {
      super(String(problem.detail));
    }
  },
  apiClient: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const repository = {
  repositoryId: 'repo_123',
  programId: 'program_123',
  programName: '전남대학교 OSS 프로그램',
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '공개 프로젝트',
  repositoryName: 'oss-public',
  githubUrl: 'https://github.com/JNU-SWCU/oss-public',
  publishedAt: '2026-07-24T01:00:00.000Z',
  detailUrl: '/archive/repo_123',
};

const profileResponse = {
  userId: 'user_123',
  githubNickname: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  repositories: [repository],
};

describe('public profile parser', () => {
  it('accepts the public-profile contract', () => {
    expect(parsePublicProfile(profileResponse)).toMatchObject({
      githubNickname: 'octocat',
      repositories: [{ modeLabel: '팀', repositoryName: 'oss-public' }],
    });
  });

  it.each([
    [
      'unsafe repository path segment',
      { ...repository, repositoryId: '../private' },
    ],
    ['unknown mode', { ...repository, applicationMode: 'PAIR' }],
    ['unknown category', { ...repository, category: 'UNKNOWN' }],
    ['invalid date', { ...repository, publishedAt: 'today' }],
    [
      'noncanonical GitHub URL',
      { ...repository, githubUrl: 'https://github.com/JNU-SWCU/other' },
    ],
    [
      'GitHub trailing slash',
      { ...repository, githubUrl: 'https://github.com/JNU-SWCU/oss-public/' },
    ],
    [
      'GitHub query',
      {
        ...repository,
        githubUrl: 'https://github.com/JNU-SWCU/oss-public?token=SECRET',
      },
    ],
  ])('%s is rejected', (_case, malformedRepository) => {
    expect(() =>
      parsePublicProfile({
        ...profileResponse,
        repositories: [malformedRepository],
      }),
    ).toThrow('공개 프로필 응답 형식이 올바르지 않습니다');
  });
});

describe('public profile API boundary', () => {
  it('uses apiClient for a safe user identifier', async () => {
    vi.mocked(apiClient).mockResolvedValue(profileResponse);

    await expect(loadPublicProfile('user_123')).resolves.toMatchObject({
      userId: 'user_123',
    });
    expect(apiClient).toHaveBeenCalledWith('users/user_123/public-profile');
  });

  it('does not request an unsafe user identifier', async () => {
    expect(isSafePublicProfileUserId('../private')).toBe(false);
    await expect(loadPublicProfile('../private')).rejects.toThrow(
      '공개 프로필을 찾을 수 없습니다',
    );
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('maps PRF_001 to not-found without exposing API detail', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'private profile SECRET',
        instance: '/unexpected',
        code: 'PRF_001',
      }),
    );

    await expect(loadPublicProfile('user_123')).rejects.toThrow(
      '공개 프로필을 찾을 수 없습니다',
    );
  });
});

describe('public profile views', () => {
  const onRetry = vi.fn();

  it('renders ready content, non-evaluative copy, and archive detail links', () => {
    const html = renderToStaticMarkup(
      <PublicProfileContent
        state={{ kind: 'ready', profile: parsePublicProfile(profileResponse) }}
        onRetry={onRetry}
      />,
    );

    expect(html).toContain('octocat');
    expect(html).toContain('전남대학교 OSS 프로그램 · 팀');
    expect(html).toContain('oss-public');
    expect(html).toContain('GitHub PUBLIC');
    expect(html).toContain('활동량 안내: 평가·점수·랭킹이 아닙니다');
    expect(html).toContain('href="/archive/repo_123"');
  });

  it('renders loading and not-found states', () => {
    const loadingHtml = renderToStaticMarkup(
      <PublicProfileContent state={{ kind: 'loading' }} onRetry={onRetry} />,
    );
    const notFoundHtml = renderToStaticMarkup(
      <PublicProfileContent state={{ kind: 'not-found' }} onRetry={onRetry} />,
    );

    expect(loadingHtml).toContain('공개 프로필을 불러오는 중');
    expect(notFoundHtml).toContain(
      '존재하지 않거나 공개 프로젝트가 없는 사용자입니다.',
    );
  });

  it('renders a generic retry error without raw error text', () => {
    const html = renderToStaticMarkup(
      <PublicProfileContent state={{ kind: 'error' }} onRetry={onRetry} />,
    );

    expect(html).toContain('다시 시도');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('private profile');
  });
});
