import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { MyRepositoriesView } from './components/my-repositories-view';
import { loadMyRepositories } from './loader';
import { parseMyRepositoriesResponse } from './parser';
import type {
  MyRepositoriesResponse,
  MyRepositoryResponseItem,
  RepositoryConnectionMode,
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
  connectionMode = 'NEW',
  provisionStatus,
  invitationStatus = null,
  visibility = 'PRIVATE',
  lastErrorCode = null,
  hasRepository = provisionStatus === 'SUCCEEDED',
}: {
  readonly id: string;
  readonly mode?: 'PERSONAL' | 'TEAM';
  readonly connectionMode?: RepositoryConnectionMode;
  readonly provisionStatus: RepositoryProvisionStatus;
  readonly invitationStatus?: RepositoryInvitationStatus;
  readonly visibility?: RepositoryVisibility;
  readonly lastErrorCode?: string | null;
  readonly hasRepository?: boolean;
}): MyRepositoryResponseItem {
  const owner = connectionMode === 'NEW' ? 'JNU-SWCU' : 'synthetic-student';
  return {
    repositoryId: hasRepository ? `repository-${id}` : null,
    applicationId: `application-${id}`,
    applicationMode: mode,
    connectionMode,
    programName: mode === 'PERSONAL' ? '침스톤 프로그램' : 'OSS 경진대회',
    displayName: mode === 'PERSONAL' ? '개인 프로젝트' : '오픈소스팀',
    repositoryName: hasRepository ? `oss-${id}` : null,
    githubUrl: hasRepository ? `https://github.com/${owner}/oss-${id}` : null,
    provisionStatus,
    invitationStatus,
    visibility: hasRepository ? visibility : null,
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

  it('권한 동기화가 실패해도 지속된 저장소를 그대로 보여준다', () => {
    const repositories = parseMyRepositoriesResponse({
      items: [
        responseItem({
          id: 'revoking',
          provisionStatus: 'FAILED_RETRYABLE',
          invitationStatus: 'REVOKE_FAILED_RETRYABLE',
          hasRepository: true,
        }),
      ],
    });

    expect(repositories.items[0]).toMatchObject({
      repositoryName: 'oss-revoking',
      githubUrl: 'https://github.com/JNU-SWCU/oss-revoking',
      provisionLabel: '권한 동기화 재시도 중',
      invitationLabel: '권한 회수 재시도 중',
      canOpenGithub: false,
    });
  });

  it.each([
    ['PENDING', '권한 동기화 중'],
    ['PROCESSING', '권한 동기화 중'],
    ['FAILED_FINAL', '권한 동기화 확인 필요'],
  ] as const)(
    '이미 존재하는 저장소의 %s를 생성이 아닌 "%s"로 말한다',
    (provisionStatus, label) => {
      const repositories = parseMyRepositoriesResponse({
        items: [
          responseItem({
            id: 'syncing',
            provisionStatus,
            invitationStatus: 'SUCCEEDED',
            hasRepository: true,
          }),
        ],
      });

      expect(repositories.items[0]?.provisionLabel).toBe(label);
    },
  );

  it('저장소가 아직 없는 job은 생성 단계 문구를 유지한다', () => {
    const repositories = parseMyRepositoriesResponse({
      items: [
        responseItem({ id: 'creating', provisionStatus: 'FAILED_FINAL' }),
      ],
    });

    expect(repositories.items[0]?.provisionLabel).toBe('담당자 확인 필요');
  });

  it.each([
    ['REVOKE_REQUIRED', '권한 회수 중'],
    ['REVOKED', '권한 회수 완료'],
    ['REVOKE_FAILED_RETRYABLE', '권한 회수 재시도 중'],
    ['REVOKE_FAILED_FINAL', '권한 회수 확인 필요'],
  ] as const)(
    '%s 상태는 "%s"로 표시하고 GitHub 링크를 열지 않는다',
    (invitationStatus, label) => {
      const repositories = parseMyRepositoriesResponse({
        items: [
          responseItem({
            id: 'revoked',
            provisionStatus: 'SUCCEEDED',
            invitationStatus,
          }),
        ],
      });

      expect(repositories.items[0]).toMatchObject({
        invitationLabel: label,
        canOpenGithub: false,
      });
    },
  );

  it.each([
    ['PENDING', true],
    ['SUCCEEDED', true],
    ['FAILED_RETRYABLE', false],
    ['FAILED_FINAL', false],
    [null, false],
  ] as const)(
    'NEW 저장소는 초대가 %s일 때 canOpenGithub=%s다',
    (invitationStatus, expected) => {
      const repositories = parseMyRepositoriesResponse({
        items: [
          responseItem({
            id: 'grant',
            provisionStatus: 'SUCCEEDED',
            invitationStatus,
          }),
        ],
      });

      expect(repositories.items[0]?.canOpenGithub).toBe(expected);
    },
  );

  it('OWN 저장소는 초대 없이도 외부 URL로 열 수 있다', () => {
    const repositories = parseMyRepositoriesResponse({
      items: [
        responseItem({
          id: 'own',
          connectionMode: 'OWN',
          provisionStatus: 'SUCCEEDED',
          visibility: 'PUBLIC',
        }),
      ],
    });

    expect(repositories.items[0]).toMatchObject({
      githubUrl: 'https://github.com/synthetic-student/oss-own',
      invitationLabel: null,
      canOpenGithub: true,
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
      'unknown invitation status',
      { ...response.items[0], invitationStatus: 'REVOKE_PENDING' },
    ],
    [
      'unknown connection mode',
      { ...response.items[0], connectionMode: 'MANAGED' },
    ],
    ['missing connection mode', { ...response.items[0], connectionMode: null }],
    [
      'partial repository identity during reconciliation',
      {
        ...responseItem({
          id: 'partial',
          provisionStatus: 'FAILED_RETRYABLE',
          hasRepository: true,
        }),
        visibility: null,
      },
    ],
    [
      'OWN repository URL claimed under the managed organization contract',
      {
        ...responseItem({
          id: 'own-mismatch',
          connectionMode: 'OWN',
          provisionStatus: 'SUCCEEDED',
        }),
        githubUrl: 'https://github.com/synthetic-student/other-repository',
      },
    ],
    [
      'NEW repository URL outside the managed organization',
      {
        ...responseItem({ id: '1', provisionStatus: 'SUCCEEDED' }),
        githubUrl: 'https://github.com/synthetic-student/oss-1',
      },
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
