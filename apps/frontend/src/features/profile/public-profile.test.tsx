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

const observedProject = {
  projectId: 'project_123',
  programId: 'program_123',
  programName: '전남대학교 OSS 프로그램',
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '공개 프로젝트',
  repositoryName: 'oss-public',
  githubUrl: 'https://github.com/JNU-SWCU/oss-public',
  publishedAt: '2026-07-24T01:00:00.000Z',
  observed: true,
  hasCollectedData: true,
  dataAsOf: '2026-07-30T00:00:00.000Z',
  metrics: { commitCount: 5, pullRequestCount: 2, releaseCount: 1 },
};

const observedZeroProject = {
  ...observedProject,
  projectId: 'project_zero',
  displayName: '관측됐지만 기여 없는 프로젝트',
  metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
};

const unobservedProject = {
  ...observedProject,
  projectId: 'project_unobserved',
  displayName: '아직 관측되지 않은 프로젝트',
  observed: false,
  hasCollectedData: false,
  dataAsOf: null,
  metrics: null,
};

// #893 — presence는 provisioning 시점부터 PRESENT라 observed:true지만, 첫 inventory sweep
// 전이라 hasCollectedData:false다. metrics는 observedZeroProject와 똑같이 0/0/0이라, 이
// 필드가 없으면 "관측된 0"과 구분되지 않는다.
const preSweepProject = {
  ...observedProject,
  projectId: 'project_pre_sweep',
  displayName: '첫 수집 전 저장소',
  hasCollectedData: false,
  metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
};

const profileResponse = {
  userId: 'user_123',
  githubNickname: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  projects: [observedProject],
  observedTotals: { commitCount: 5, pullRequestCount: 2, releaseCount: 1 },
};

describe('public profile parser', () => {
  it('accepts the public-profile contract', () => {
    expect(parsePublicProfile(profileResponse)).toMatchObject({
      githubNickname: 'octocat',
      projects: [
        {
          modeLabel: '팀',
          repositoryName: 'oss-public',
          detailUrl: '/archive/project_123',
          observed: true,
        },
      ],
      observedTotals: { commitCount: 5, pullRequestCount: 2, releaseCount: 1 },
    });
  });

  it('accepts an unobserved project (observed:false, dataAsOf/metrics:null)', () => {
    expect(
      parsePublicProfile({
        ...profileResponse,
        projects: [unobservedProject],
      }),
    ).toMatchObject({
      projects: [{ observed: false, dataAsOf: null, metrics: null }],
    });
  });

  it('accepts an observed-but-zero project distinct from unobserved', () => {
    const parsed = parsePublicProfile({
      ...profileResponse,
      projects: [observedZeroProject],
    });
    expect(parsed.projects[0]?.observed).toBe(true);
    expect(parsed.projects[0]?.hasCollectedData).toBe(true);
    expect(parsed.projects[0]?.metrics).toEqual({
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    });
  });

  it('accepts a pre-sweep project (observed:true, hasCollectedData:false, #893) distinct from observed-and-collected', () => {
    const parsed = parsePublicProfile({
      ...profileResponse,
      projects: [preSweepProject],
    });
    expect(parsed.projects[0]?.observed).toBe(true);
    expect(parsed.projects[0]?.hasCollectedData).toBe(false);
    expect(parsed.projects[0]?.metrics).toEqual({
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    });
  });

  it.each([
    [
      'unsafe project path segment',
      { ...observedProject, projectId: '../private' },
    ],
    ['unknown mode', { ...observedProject, applicationMode: 'PAIR' }],
    ['unknown category', { ...observedProject, category: 'UNKNOWN' }],
    ['invalid date', { ...observedProject, publishedAt: 'today' }],
    [
      'noncanonical GitHub URL',
      { ...observedProject, githubUrl: 'https://github.com/JNU-SWCU/other' },
    ],
    [
      'GitHub trailing slash',
      {
        ...observedProject,
        githubUrl: 'https://github.com/JNU-SWCU/oss-public/',
      },
    ],
    [
      'GitHub query',
      {
        ...observedProject,
        githubUrl: 'https://github.com/JNU-SWCU/oss-public?token=SECRET',
      },
    ],
    [
      'observed:true with dataAsOf:null',
      { ...observedProject, dataAsOf: null },
    ],
    ['observed:true with metrics:null', { ...observedProject, metrics: null }],
    [
      'observed:false with dataAsOf set',
      { ...unobservedProject, dataAsOf: '2026-07-30T00:00:00.000Z' },
    ],
    [
      'observed:false with metrics set',
      {
        ...unobservedProject,
        metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
      },
    ],
    [
      'hasCollectedData:true with observed:false (#893 invariant)',
      { ...unobservedProject, hasCollectedData: true },
    ],
    [
      'negative metrics',
      {
        ...observedProject,
        metrics: { commitCount: -1, pullRequestCount: 0, releaseCount: 0 },
      },
    ],
  ])('%s is rejected', (_case, malformedProject) => {
    expect(() =>
      parsePublicProfile({
        ...profileResponse,
        projects: [malformedProject],
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
    // 세션 보호 경로(`users/me/profile`)와 겹치지 않는 공개 경로를 호출한다(#551).
    expect(apiClient).toHaveBeenCalledWith('users/user_123/public-profile');
  });

  it('does not request an unsafe user identifier', async () => {
    expect(isSafePublicProfileUserId('../private')).toBe(false);
    await expect(loadPublicProfile('../private')).rejects.toThrow(
      '공개 프로필을 찾을 수 없습니다',
    );
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('maps PPJ_002 to not-found without exposing API detail', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'private profile SECRET',
        instance: '/unexpected',
        code: 'PPJ_002',
      }),
    );

    await expect(loadPublicProfile('user_123')).rejects.toThrow(
      '공개 프로필을 찾을 수 없습니다',
    );
  });
});

describe('public profile views', () => {
  const onRetry = vi.fn();

  it('renders ready content, non-evaluative copy, metrics, and archive detail links', () => {
    const html = renderToStaticMarkup(
      <PublicProfileContent
        state={{ kind: 'ready', profile: parsePublicProfile(profileResponse) }}
        onRetry={onRetry}
      />,
    );

    expect(html).toContain('octocat');
    expect(html).toContain('전남대학교 OSS 프로그램 · 팀');
    expect(html).toContain('oss-public');
    expect(html).toContain('관측됨');
    expect(html).toContain('활동량 안내: 평가·점수·랭킹이 아닙니다');
    expect(html).toContain('href="/archive/project_123"');
  });

  it('renders unobserved and observed-zero states distinctly', () => {
    const html = renderToStaticMarkup(
      <PublicProfileContent
        state={{
          kind: 'ready',
          profile: parsePublicProfile({
            ...profileResponse,
            projects: [observedZeroProject, unobservedProject],
          }),
        }}
        onRetry={onRetry}
      />,
    );

    expect(html).toContain('관측됨 · 기여 없음');
    expect(html).toContain('아직 관측되지 않음');
  });

  it('renders a pre-sweep repository (#893) with a neutral badge distinct from the green observed-zero badge', () => {
    const preSweepHtml = renderToStaticMarkup(
      <PublicProfileContent
        state={{
          kind: 'ready',
          profile: parsePublicProfile({
            ...profileResponse,
            projects: [preSweepProject],
          }),
        }}
        onRetry={onRetry}
      />,
    );

    // 서버가 아직 첫 sweep을 마치지 않은 저장소를 "관측됨"류 초록 배지로 보여주면 라이브
    // 데모 중 발급된 저장소가 검증된 것처럼 오인될 수 있다 — 중립 배지·문구를 명시적으로
    // 요구한다.
    expect(preSweepHtml).toContain('수집 대기');
    expect(preSweepHtml).not.toContain('관측됨');
    expect(preSweepHtml).toMatch(/data-variant="pending"[^>]*>\s*수집 대기/);
    expect(preSweepHtml).not.toContain('data-variant="approved"');

    const observedZeroHtml = renderToStaticMarkup(
      <PublicProfileContent
        state={{
          kind: 'ready',
          profile: parsePublicProfile({
            ...profileResponse,
            projects: [observedZeroProject],
          }),
        }}
        onRetry={onRetry}
      />,
    );

    // 대조군 — 실제로 관측이 끝난 0-기여 저장소는 계속 초록(approved) 배지를 유지해야 한다.
    expect(observedZeroHtml).toMatch(
      /data-variant="approved"[^>]*>\s*관측됨 · 기여 없음/,
    );
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
    expect(notFoundHtml).toContain('href="/archive"');
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
