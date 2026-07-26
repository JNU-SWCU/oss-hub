import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { MyRepositoriesView } from './components/my-repositories-view';
import { loadMyRepositories } from './loader';
import { parseMyRepositoriesResponse } from './parser';
import type {
  MyRepositoriesResponse,
  MyRepositoryResponseItem,
  RepositoryInvitationStatus,
  RepositoryProvisionStatus,
  RepositoryVisibility,
} from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
});

function responseItem({
  id,
  mode = 'PERSONAL',
  provisionStatus,
  invitationStatus = null,
  visibility = 'PRIVATE',
  lastErrorCode = null,
}: {
  readonly id: string;
  readonly mode?: 'PERSONAL' | 'TEAM';
  readonly provisionStatus: RepositoryProvisionStatus;
  readonly invitationStatus?: RepositoryInvitationStatus;
  readonly visibility?: RepositoryVisibility;
  readonly lastErrorCode?: string | null;
}): MyRepositoryResponseItem {
  const succeeded = provisionStatus === 'SUCCEEDED';
  return {
    repositoryId: succeeded ? `repository-${id}` : null,
    applicationId: `application-${id}`,
    applicationMode: mode,
    programName: mode === 'PERSONAL' ? '캡스톤 프로그램' : 'OSS 경진대회',
    displayName: mode === 'PERSONAL' ? '개인 프로젝트' : '오픈소스팀',
    repositoryName: succeeded ? `oss-${id}` : null,
    githubUrl: succeeded ? `https://github.com/JNU-SWCU/oss-${id}` : null,
    provisionStatus,
    invitationStatus,
    visibility: succeeded ? visibility : null,
    lastErrorCode,
    updatedAt: '2026-07-24T01:00:00.000Z',
  };
}

function readyResponse(): MyRepositoriesResponse {
  return {
    items: [
      responseItem({
        id: 'personal-ready',
        provisionStatus: 'SUCCEEDED',
        invitationStatus: 'PENDING',
      }),
      responseItem({
        id: 'team-processing',
        mode: 'TEAM',
        provisionStatus: 'PROCESSING',
      }),
      responseItem({
        id: 'pending',
        provisionStatus: 'PENDING',
      }),
      responseItem({
        id: 'retrying',
        provisionStatus: 'FAILED_RETRYABLE',
        lastErrorCode: 'PROVISION_TIMEOUT',
      }),
      responseItem({
        id: 'final-failure',
        mode: 'TEAM',
        provisionStatus: 'FAILED_FINAL',
        lastErrorCode: 'PROVISION_FAILED',
      }),
      responseItem({
        id: 'invite-retrying',
        provisionStatus: 'SUCCEEDED',
        invitationStatus: 'FAILED_RETRYABLE',
      }),
      responseItem({
        id: 'invite-final',
        mode: 'TEAM',
        provisionStatus: 'SUCCEEDED',
        invitationStatus: 'FAILED_FINAL',
      }),
      responseItem({
        id: 'public',
        provisionStatus: 'SUCCEEDED',
        invitationStatus: 'SUCCEEDED',
        visibility: 'PUBLIC',
      }),
    ],
  };
}

const response = {
  items: [
    responseItem({
      id: '1',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
    }),
  ],
} satisfies MyRepositoriesResponse;

describe('my repositories response parser', () => {
  it('확정된 #122 응답을 안전한 화면 모델로 변환한다', () => {
    const repositories = parseMyRepositoriesResponse(response);

    expect(repositories.items[0]).toMatchObject({
      modeLabel: '개인',
      provisionLabel: '생성 완료',
      invitationLabel: '초대 수락 대기',
      canOpenGithub: true,
    });
  });

  it('생성 전 응답의 저장소 필드를 null로 유지한다', () => {
    const repositories = parseMyRepositoriesResponse({
      items: [
        responseItem({
          id: 'processing',
          provisionStatus: 'PROCESSING',
        }),
      ],
    });

    expect(repositories.items[0]).toMatchObject({
      repositoryId: null,
      repositoryName: null,
      githubUrl: null,
      visibility: null,
      canOpenGithub: false,
    });
  });

  it.each([
    ['unknown status', { ...response.items[0], provisionStatus: 'UNKNOWN' }],
    [
      'unsafe GitHub URL',
      { ...response.items[0], githubUrl: 'https://example.com/private' },
    ],
    [
      'GitHub URL with an unsafe authority',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU@evil.example/private',
      },
    ],
    [
      'GitHub repository subpath',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/oss-1/issues',
      },
    ],
    [
      'GitHub repository query',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/oss-1?token=SECRET',
      },
    ],
    [
      'GitHub repository identity mismatch',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/another-repository',
      },
    ],
    [
      'GitHub non-default port',
      {
        ...response.items[0],
        githubUrl: 'https://github.com:444/JNU-SWCU/oss-1',
      },
    ],
    [
      'GitHub trailing slash',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/oss-1/',
      },
    ],
    [
      'GitHub doubled slash',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU//oss-1',
      },
    ],
    [
      'GitHub explicit default port',
      {
        ...response.items[0],
        githubUrl: 'https://github.com:443/JNU-SWCU/oss-1',
      },
    ],
    [
      'GitHub dot-segment normalization',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/other/../oss-1',
      },
    ],
    [
      'GitHub empty query delimiter',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/oss-1?',
      },
    ],
    [
      'GitHub empty fragment delimiter',
      {
        ...response.items[0],
        githubUrl: 'https://github.com/JNU-SWCU/oss-1#',
      },
    ],
    [
      'pre-success invitation',
      {
        ...responseItem({ id: 'pending-invite', provisionStatus: 'PENDING' }),
        invitationStatus: 'PENDING',
      },
    ],
    [
      'premature repository data',
      { ...response.items[0], provisionStatus: 'PROCESSING' },
    ],
    [
      'missing successful repository data',
      { ...response.items[0], repositoryName: null },
    ],
    ['invalid date', { ...response.items[0], updatedAt: 'today' }],
    [
      'non-canonical date',
      { ...response.items[0], updatedAt: '2026-07-24T10:00:00+09:00' },
    ],
    [
      'rolled-over date',
      { ...response.items[0], updatedAt: '2026-02-30T00:00:00.000Z' },
    ],
  ])('%s 응답을 거부한다', (_case, malformedItem) => {
    expect(() =>
      parseMyRepositoriesResponse({ items: [malformedItem] }),
    ).toThrow('내 저장소 응답 형식이 올바르지 않습니다');
  });

  it('lastErrorCode를 문자열 계약으로만 파싱하고 화면 모델과 HTML에서는 제외한다', () => {
    const secret = 'private key: SECRET';
    const repositories = parseMyRepositoriesResponse({
      items: [{ ...response.items[0], lastErrorCode: secret }],
    });
    const viewHtml = renderToStaticMarkup(
      <MyRepositoriesView
        state={{ kind: 'ready', repositories }}
        onRetry={vi.fn()}
      />,
    );

    expect(Object.hasOwn(repositories.items[0], 'lastErrorCode')).toBe(false);
    expect(viewHtml).not.toContain(secret);
  });
});

describe('my repositories loader boundary', () => {
  it('API 응답을 엄격한 화면 모델로 로드한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(response);

    await expect(loadMyRepositories()).resolves.toMatchObject({
      items: [expect.objectContaining({ applicationId: 'application-1' })],
    });
    expect(apiClient).toHaveBeenCalledWith('repositories/me');
  });

  it.each([
    ['transport failure', new Error('raw backend error: SECRET')],
    [
      'invalid response',
      {
        items: [
          {
            ...response.items[0],
            repositoryName: 'SECRET',
            githubUrl: null,
          },
        ],
      },
    ],
  ])('%s를 일반적인 로드 오류로 감춘다', async (_case, failure) => {
    if (failure instanceof Error) {
      vi.mocked(apiClient).mockRejectedValue(failure);
    } else {
      vi.mocked(apiClient).mockResolvedValue(failure);
    }

    const error = await loadMyRepositories().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('내 저장소를 불러오지 못했습니다');
    expect((error as Error).message).not.toContain('SECRET');
    expect(apiClient).toHaveBeenCalledTimes(1);
  });
});

describe('my repositories test fixtures and view', () => {
  it('빈 응답 fixture를 화면 모델로 변환한다', () => {
    expect(parseMyRepositoriesResponse({ items: [] }).items).toEqual([]);
  });

  it('성공·생성 전·로딩·빈 상태·오류 상태를 렌더링한다', () => {
    const repositories = parseMyRepositoriesResponse(readyResponse());
    const readyHtml = renderToStaticMarkup(
      <MyRepositoriesView
        state={{ kind: 'ready', repositories }}
        onRetry={vi.fn()}
      />,
    );
    const loadingHtml = renderToStaticMarkup(
      <MyRepositoriesView state={{ kind: 'loading' }} onRetry={vi.fn()} />,
    );
    const emptyHtml = renderToStaticMarkup(
      <MyRepositoriesView
        state={{ kind: 'ready', repositories: { items: [] } }}
        onRetry={vi.fn()}
      />,
    );
    const errorHtml = renderToStaticMarkup(
      <MyRepositoriesView state={{ kind: 'error' }} onRetry={vi.fn()} />,
    );

    expect(readyHtml).toContain('내 저장소');
    expect(readyHtml).toContain('생성 전');
    expect(readyHtml).toContain('저장소 생성 중');
    expect(readyHtml).toContain('생성 완료');
    expect(readyHtml).toContain('자동 재시도 중');
    expect(readyHtml).toContain('담당자 확인 필요');
    expect(readyHtml).toContain('초대 수락 대기');
    expect(readyHtml).toContain('초대 완료');
    expect(readyHtml).toContain('초대 자동 재시도 중');
    expect(readyHtml).toContain('초대 확인 필요');
    expect(readyHtml).toContain(
      'href="https://github.com/JNU-SWCU/oss-personal-ready"',
    );
    expect(readyHtml).not.toContain('oss-team-processing');
    expect(readyHtml).not.toContain('private key');
    expect(loadingHtml).toContain('내 저장소를 불러오는 중');
    expect(emptyHtml).toContain('표시할 저장소가 없습니다');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('다시 시도');
  });
});
