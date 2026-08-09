import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { GithubAppClient } from './github-app.client';
import type {
  GithubAppFetcher,
  GithubInstallationTokenProvider,
} from './github-app.token';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const OWNERSHIP_MARKER = `oss-hub:${'a'.repeat(64)}`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
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

describe('GithubAppClient error policy', () => {
  it('GitHub 5xx는 재시도 가능한 upstream 오류로 변환한다', async () => {
    // Given: GitHub가 일시적인 서버 오류를 반환한다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(503, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 저장소 생성을 요청한다.
    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    // Then: worker가 재시도할 수 있는 정규화 오류를 반환한다.
    await expect(repository).rejects.toEqual(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
  });

  it('rate limit가 아닌 403은 재시도하지 않는 권한 오류로 변환한다', async () => {
    // Given: Operations App에 권한이 부족하다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: 저장소 생성을 요청한다.
    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    // Then: 설정 수정 전 자동 재시도를 막는 최종 오류를 반환한다.
    await expect(repository).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
        false,
      ),
    );
  });

  it('재발급 뒤에도 401이면 한 번만 재시도하고 중단한다', async () => {
    // Given: token 재발급 전후 모두 인증이 거절된다.
    const tokens = tokenProvider();
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    // When: 저장소를 조회한다.
    const repository = client.findRepository('synthetic-repository');

    // Then: 무한 인증 재시도 없이 최종 인증 오류로 중단한다.
    await expect(repository).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.AUTHENTICATION,
        false,
      ),
    );
    expect(tokens.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invitation 한도 422는 하루 뒤 재시도하는 오류로 변환한다', async () => {
    // Given: collaborator와 열린 invitation이 없지만 초대 한도에 도달했다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(422, { message: 'Invitation limit reached' }),
      );
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    // When: collaborator 초대를 보장한다.
    const invitation = client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    // Then: 즉시 반복하지 않고 한도 회복 뒤 재시도하도록 예약한다.
    await expect(invitation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVITATION_LIMIT,
        true,
        new Date('2026-07-23T00:00:00.000Z'),
      ),
    );
  });
});
