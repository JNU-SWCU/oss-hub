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
        jsonResponse(200, [{ invitee: { login: 'Synthetic-Student' } }]),
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
