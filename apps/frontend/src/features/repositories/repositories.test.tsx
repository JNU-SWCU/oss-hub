import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
    repositoryId: `repository-${id}`,
    applicationId: `application-${id}`,
    applicationMode: mode,
    programName: mode === 'PERSONAL' ? '캡스톤 프로그램' : 'OSS 경진대회',
    displayName: mode === 'PERSONAL' ? '개인 프로젝트' : '오픈소스팀',
    repositoryName: `oss-${id}`,
    githubUrl: succeeded ? `https://github.com/JNU-SWCU/oss-${id}` : null,
    provisionStatus,
    invitationStatus,
    visibility,
    lastErrorCode,
    updatedAt: '2026-07-24T10:00:00+09:00',
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
        invitationStatus: 'FAILED_RETRYABLE',
        lastErrorCode: 'PROVISION_TIMEOUT',
      }),
      responseItem({
        id: 'final-failure',
        mode: 'TEAM',
        provisionStatus: 'FAILED_FINAL',
        invitationStatus: 'FAILED_FINAL',
        lastErrorCode: 'PROVISION_FAILED',
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
    // Given / When
    const repositories = parseMyRepositoriesResponse(response);

    // Then
    expect(repositories.items[0]).toMatchObject({
      modeLabel: '개인',
      provisionLabel: '생성 완료',
      invitationLabel: '초대 수락 대기',
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
      'premature GitHub URL',
      {
        ...response.items[0],
        provisionStatus: 'PROCESSING',
      },
    ],
    [
      'missing successful GitHub URL',
      { ...response.items[0], githubUrl: null },
    ],
    ['invalid date', { ...response.items[0], updatedAt: 'today' }],
  ])('%s 응답을 거부한다', (_case, malformedItem) => {
    // Given / When / Then
    expect(() =>
      parseMyRepositoriesResponse({ items: [malformedItem] }),
    ).toThrow('내 저장소 응답 형식이 올바르지 않습니다');
  });

  it('lastErrorCode를 문자열 계약으로만 파싱하고 화면 모델과 HTML에서는 제외한다', () => {
    // Given
    const secret = 'private key: SECRET';
    const responseWithServerText = {
      items: [{ ...response.items[0], lastErrorCode: secret }],
    };

    // When
    const repositories = parseMyRepositoriesResponse(responseWithServerText);
    const viewHtml = renderToStaticMarkup(
      <MyRepositoriesView
        state={{ kind: 'ready', repositories }}
        onRetry={vi.fn()}
      />,
    );

    // Then
    expect(Object.hasOwn(repositories.items[0], 'lastErrorCode')).toBe(false);
    expect(viewHtml).not.toContain(secret);
  });
});

describe('my repositories loader boundary', () => {
  it('실제 API 계약 전에는 fixture나 합성 payload 없이 실패로 닫힌다', async () => {
    // Given / When / Then
    await expect(loadMyRepositories()).rejects.toThrow(
      '내 저장소를 불러오지 못했습니다',
    );
  });
});

describe('my repositories test fixtures and view', () => {
  it('빈 응답 fixture를 화면 모델로 변환한다', () => {
    // Given / When
    const empty = parseMyRepositoriesResponse({ items: [] });

    // Then
    expect(empty.items).toEqual([]);
  });

  it('성공·로딩·빈 상태·오류 상태를 렌더링한다', () => {
    // Given
    const repositories = parseMyRepositoriesResponse(readyResponse());

    // When
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

    // Then
    expect(readyHtml).toContain('내 저장소');
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
    expect(readyHtml).not.toContain(
      'href="https://github.com/JNU-SWCU/oss-team-processing"',
    );
    expect(readyHtml).not.toContain('private key');
    expect(loadingHtml).toContain('내 저장소를 불러오는 중');
    expect(emptyHtml).toContain('표시할 저장소가 없습니다');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('다시 시도');
  });
});
