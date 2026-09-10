import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { COLLABORATOR_OUTCOMES, GithubAppClient } from './github-app.client';
import type {
  GithubAppFetcher,
  GithubInstallationTokenProvider,
} from './github-app.token';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const OWNERSHIP_MARKER = `oss-hub:${'a'.repeat(64)}`;

function jsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function tokenProvider(): GithubInstallationTokenProvider & {
  readonly accessToken: jest.Mock<Promise<string>, []>;
  readonly invalidateAccessToken: jest.Mock<void, []>;
} {
  return {
    organization: 'synthetic-org',
    accessToken: jest.fn().mockResolvedValue('synthetic-installation-token'),
    invalidateAccessToken: jest.fn(),
  };
}

describe('GithubAppClient', () => {
  it('조직 private repository를 생성하고 metadata를 파싱한다', async () => {
    // Given: repository 생성 성공 응답이 있다.
    const tokens = tokenProvider();
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(201, {
        id: 987654321,
        name: 'synthetic-repository',
        full_name: 'synthetic-org/synthetic-repository',
        html_url: 'https://github.com/synthetic-org/synthetic-repository',
        visibility: 'private',
        description: OWNERSHIP_MARKER,
      }),
    );
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    // When: 저장소 생성을 요청한다.
    const repository = await client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    // Then: private 고정 요청과 내부 metadata를 반환한다.
    expect(repository).toEqual({
      githubRepositoryId: 987654321n,
      name: 'synthetic-repository',
      url: 'https://github.com/synthetic-org/synthetic-repository',
      nameWithOwner: 'synthetic-org/synthetic-repository',
      visibility: 'PRIVATE',
      description: OWNERSHIP_MARKER,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/orgs/synthetic-org/repos',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'synthetic-repository',
          private: true,
          description: OWNERSHIP_MARKER,
        }),
      }),
    );
  });

  it('metadata 404는 저장소 미존재 정상 분기로 반환한다', async () => {
    // Given: repository 조회 404가 있다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(404, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 저장소를 조회한다.
    const repository = await client.findRepository('synthetic-missing');

    // Then: 오류 대신 null로 분기한다.
    expect(repository).toBeNull();
  });

  it('공개 저장소는 인증 없이 owner/name으로 조회한다', async () => {
    const tokens = tokenProvider();
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(200, {
        id: 42,
        name: 'synthetic-repo',
        full_name: 'synthetic-student/synthetic-repo',
        html_url: 'https://github.com/synthetic-student/synthetic-repo',
        visibility: 'public',
        archived: false,
        default_branch: 'main',
        description: null,
      }),
    );
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    const repository = await client.findPublicRepository(
      'synthetic-student',
      'synthetic-repo',
    );

    expect(repository).toEqual({
      githubRepositoryId: 42n,
      name: 'synthetic-repo',
      nameWithOwner: 'synthetic-student/synthetic-repo',
      url: 'https://github.com/synthetic-student/synthetic-repo',
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/synthetic-student/synthetic-repo',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything() as unknown,
        }) as unknown,
      }),
    );
    expect(tokens.accessToken).not.toHaveBeenCalled();
  });

  it('공개 저장소 404는 null로 분기한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(404, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    await expect(
      client.findPublicRepository('missing-owner', 'missing-repo'),
    ).resolves.toBeNull();
  });

  it('아직 커밋이 없는 공개 저장소의 null 기본 브랜치를 보존한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(200, {
        id: 43,
        name: 'synthetic-empty-repo',
        full_name: 'synthetic-student/synthetic-empty-repo',
        html_url: 'https://github.com/synthetic-student/synthetic-empty-repo',
        visibility: 'public',
        archived: false,
        default_branch: null,
        description: null,
      }),
    );
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    await expect(
      client.findPublicRepository('synthetic-student', 'synthetic-empty-repo'),
    ).resolves.toMatchObject({ defaultBranch: null });
  });

  it('이미 collaborator이면 invitation을 조회하거나 다시 보내지 않는다', async () => {
    // Given: collaborator 확인이 204를 반환한다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: collaborator 보장을 요청한다.
    const result = await client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 성공으로 수렴하고 한 번만 호출한다.
    expect(result).toBe(COLLABORATOR_OUTCOMES.SUCCEEDED);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('같은 login의 열린 invitation이 있으면 재발송하지 않는다', async () => {
    // Given: collaborator는 없고 기존 invitation이 있다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 7, invitee: { login: 'Synthetic-Student' } }]),
      );
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 같은 login의 collaborator 보장을 요청한다.
    const result = await client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: PENDING으로 수렴하고 PUT을 보내지 않는다.
    expect(result).toBe(COLLABORATOR_OUTCOMES.PENDING);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('새 invitation은 push 권한으로 한 번만 보낸다', async () => {
    // Given: collaborator와 기존 invitation이 없다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(201, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: collaborator 보장을 요청한다.
    const result = await client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 발송 성공을 PENDING으로 기록하고 최소 push 권한을 사용한다.
    expect(result).toBe(COLLABORATOR_OUTCOMES.PENDING);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ permission: 'push' }),
    });
  });

  it('401은 token을 폐기하고 한 번만 재발급해 재시도한다', async () => {
    // Given: 첫 token은 401이고 재발급 뒤 metadata 응답이 성공한다.
    const tokens = tokenProvider();
    tokens.accessToken
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('refreshed-token');
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(
      jsonResponse(200, {
        id: 987654321,
        name: 'synthetic-repository',
        full_name: 'synthetic-org/synthetic-repository',
        html_url: 'https://github.com/synthetic-org/synthetic-repository',
        visibility: 'private',
        description: OWNERSHIP_MARKER,
      }),
    );
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    // When: repository metadata를 조회한다.
    await client.findRepository('synthetic-repository');

    // Then: 401 한 번만 재시도하고 cache를 폐기한다.
    expect(tokens.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(tokens.accessToken).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('429는 Retry-After를 가진 재시도 가능 오류로 변환한다', async () => {
    // Given: GitHub가 2분 Retry-After와 429를 반환한다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '120' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 저장소 생성을 요청한다.
    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    // Then: 정규화한 오류만 외부로 전달한다.
    await expect(repository).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:02:00.000Z'),
      ),
    );
  });

  it('짧은 Retry-After도 최소 1분 뒤로 보정한다', async () => {
    // Given: GitHub가 1초 Retry-After와 429를 반환한다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '1' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 저장소 생성을 요청한다.
    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    // Then: 즉시 반복하지 않고 최소 1분 뒤 재시도한다.
    await expect(repository).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:01:00.000Z'),
      ),
    );
  });
});

describe('GithubAppClient.revokeCollaborator', () => {
  const REPOSITORY_PATH =
    'https://api.github.com/repos/synthetic-org/synthetic-repository';

  function invitationPageUrl(page: number): string {
    return `${REPOSITORY_PATH}/invitations?per_page=100&page=${page}`;
  }

  function invitation(invitationId: number, login: string): unknown {
    return {
      id: invitationId,
      invitee: { login },
      // 취소에 쓰지 않는 field는 파서가 버려야 한다.
      email: 'synthetic-private@example.com',
      node_id: 'synthetic-node-id',
    };
  }

  function otherInvitations(count: number): readonly unknown[] {
    return Array.from({ length: count }, (_, index) =>
      invitation(1_000 + index, `synthetic-other-${index}`),
    );
  }

  function noContent(): Response {
    return new Response(null, { status: 204 });
  }

  function repositoryResponse(): Response {
    return jsonResponse(200, {
      id: 987654321,
      name: 'synthetic-repository',
      full_name: 'synthetic-org/synthetic-repository',
      html_url: 'https://github.com/synthetic-org/synthetic-repository',
      visibility: 'private',
      description: OWNERSHIP_MARKER,
    });
  }

  function fetcherMock(): jest.Mock<
    ReturnType<GithubAppFetcher>,
    Parameters<GithubAppFetcher>
  > {
    return jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
  }

  function requestedUrls(
    fetcher: jest.Mock<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >,
  ): readonly string[] {
    return fetcher.mock.calls.map((call) => String(call[0]));
  }

  it('여러 page의 열린 invitation을 대소문자 무관하게 먼저 취소하고 collaborator를 삭제한다', async () => {
    // Given: 두 page에 걸쳐 같은 login의 초대가 다른 표기로 열려 있다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, [
          ...otherInvitations(99),
          invitation(11, 'Synthetic-Student'),
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, [invitation(12, 'SYNTHETIC-STUDENT')]),
      )
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent());
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 접근 권한 회수를 요청한다.
    await client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 초대 취소가 collaborator 삭제보다 먼저 끝난다.
    expect(requestedUrls(fetcher)).toEqual([
      invitationPageUrl(1),
      invitationPageUrl(2),
      `${REPOSITORY_PATH}/invitations/11`,
      `${REPOSITORY_PATH}/invitations/12`,
      `${REPOSITORY_PATH}/collaborators/synthetic-student`,
    ]);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(fetcher.mock.calls[4]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('다른 login의 열린 invitation은 취소하지 않는다', async () => {
    // Given: 다른 사용자의 초대만 열려 있다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, [invitation(21, 'synthetic-other')]),
      )
      .mockResolvedValueOnce(noContent());
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 대상 사용자의 권한을 회수한다.
    await client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 남의 초대는 건드리지 않는다.
    expect(requestedUrls(fetcher)).toEqual([
      invitationPageUrl(1),
      `${REPOSITORY_PATH}/collaborators/synthetic-student`,
    ]);
  });

  it('취소 직전에 수락된 invitation(404)도 collaborator 삭제로 수렴한다', async () => {
    // Given: 목록 조회 뒤 초대가 수락되어 취소가 404가 된다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, [invitation(31, 'synthetic-student')]),
      )
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(noContent());
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    await client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 경쟁 상황에서도 실제 권한 삭제까지 진행한다.
    expect(requestedUrls(fetcher)).toEqual([
      invitationPageUrl(1),
      `${REPOSITORY_PATH}/invitations/31`,
      `${REPOSITORY_PATH}/collaborators/synthetic-student`,
    ]);
  });

  it('collaborator가 이미 없어도 저장소가 접근 가능하면 성공으로 수렴한다', async () => {
    // Given: 삭제가 404지만 저장소 조회는 성공한다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(repositoryResponse());
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 같은 회수를 반복해도 되는지 확인한다.
    await expect(
      client.revokeCollaborator('synthetic-repository', 'synthetic-student'),
    ).resolves.toBeUndefined();

    // Then: 저장소 접근을 확인한 뒤에만 멱등 성공으로 처리한다.
    expect(requestedUrls(fetcher).at(-1)).toBe(REPOSITORY_PATH);
  });

  it('저장소가 사라지거나 접근 불가면 404를 회수 성공으로 기록하지 않는다', async () => {
    // Given: 삭제와 저장소 조회가 모두 404다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 권한 상실을 성공으로 위장하지 않고 실패로 남긴다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );
  });

  it('metadata가 보이더라도 invitation 목록 404는 회수를 진행하지 않는다', async () => {
    // Given: 초대 목록 조회만 404다. 저장소 metadata 자체는 볼 수 있다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(repositoryResponse());
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: metadata 가시성으로 초대 읽기 권한을 대신 증명하지 않고 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestedUrls(fetcher)).toEqual([invitationPageUrl(1)]);
  });

  it('가득 찬 page 뒤의 404는 부분 목록으로 취소를 진행하지 않는다', async () => {
    // Given: 첫 page는 가득 찼고 다음 page 조회가 404다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, [
          ...otherInvitations(99),
          invitation(51, 'synthetic-student'),
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 이미 찾은 초대도 취소하지 않고 오류로 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );
    expect(requestedUrls(fetcher)).toEqual([
      invitationPageUrl(1),
      invitationPageUrl(2),
    ]);
  });

  it('목록 404 뒤에는 collaborator 삭제도 초대 취소도 보내지 않는다', async () => {
    // Given: 목록 조회가 404를 반환한다.
    const fetcher = fetcherMock();
    fetcher.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    await expect(
      client.revokeCollaborator('synthetic-repository', 'synthetic-student'),
    ).rejects.toBeInstanceOf(GithubOperationsError);

    // Then: 쓰기 요청은 한 건도 나가지 않는다.
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method !== undefined),
    ).toEqual([]);
  });

  it('invitation 목록 404면 ensureCollaborator도 초대를 보내지 않는다', async () => {
    // Given: collaborator 확인은 404고 초대 목록 조회도 404다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: collaborator 보장을 요청한다.
    const invitationResult = client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 목록을 못 읽은 상태로 PUT 초대를 보내지 않는다.
    await expect(invitationResult).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method !== undefined),
    ).toEqual([]);
  });

  it('rate limit가 아닌 403은 권한 오류로 전달한다', async () => {
    // Given: collaborator 삭제 권한이 없다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 자동 재시도 없이 최종 권한 오류로 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
        false,
      ),
    );
  });

  it('invitation 취소의 429는 Retry-After를 가진 재시도 가능 오류로 전달한다', async () => {
    // Given: 초대 취소가 rate limit에 걸린다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, [invitation(41, 'synthetic-student')]),
      )
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '120' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: collaborator 삭제 전에 재시도 시각과 함께 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:02:00.000Z'),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('5xx는 재시도 가능한 upstream 오류로 전달한다', async () => {
    // Given: collaborator 삭제가 서버 오류를 반환한다.
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(503, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: worker가 재시도할 수 있는 오류로 전달한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
  });

  it('401은 token을 한 번만 재발급해 회수를 이어간다', async () => {
    // Given: 첫 초대 목록 조회가 401이다.
    const tokens = tokenProvider();
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(noContent());
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    await client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: cache를 한 번만 폐기하고 같은 요청을 재시도한다.
    expect(tokens.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('재발급 뒤에도 401이면 한 번만 재시도하고 인증 오류로 중단한다', async () => {
    // Given: 재발급 전후 모두 인증이 거절된다.
    const tokens = tokenProvider();
    const fetcher = fetcherMock();
    fetcher
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 무한 재시도 없이 인증 오류로 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.AUTHENTICATION,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('계약을 벗어난 invitation payload는 collaborator 삭제 없이 응답 오류로 중단한다', async () => {
    // Given: invitation id가 없는 응답이 온다.
    const fetcher = fetcherMock();
    fetcher.mockResolvedValueOnce(
      jsonResponse(200, [{ invitee: { login: 'synthetic-student' } }]),
    );
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 권한 회수를 요청한다.
    const revocation = client.revokeCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 추측 없이 응답 오류로 중단한다.
    await expect(revocation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
