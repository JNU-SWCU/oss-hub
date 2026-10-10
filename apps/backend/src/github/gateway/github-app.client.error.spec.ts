import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../domain/github-app.error';
import { GithubAppClient } from './github-app.client';
import type {
  GithubAppFetcher,
  GithubInstallationTokenProvider,
} from '../domain/github-app.types';

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
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(503, {}));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    await expect(repository).rejects.toEqual(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
  });

  it('rate limit가 아닌 403은 재시도하지 않는 권한 오류로 변환한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }));
    const client = new GithubAppClient(tokenProvider(), fetcher, () => NOW);

    const repository = client.createRepository(
      'synthetic-repository',
      OWNERSHIP_MARKER,
    );

    await expect(repository).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
        false,
      ),
    );
  });

  it('재발급 뒤에도 401이면 한 번만 재시도하고 중단한다', async () => {
    const tokens = tokenProvider();
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    const client = new GithubAppClient(tokens, fetcher, () => NOW);

    const repository = client.findRepository('synthetic-repository');

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

    const invitation = client.ensureCollaborator(
      'synthetic-repository',
      'synthetic-student',
    );

    await expect(invitation).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVITATION_LIMIT,
        true,
        new Date('2026-07-23T00:00:00.000Z'),
      ),
    );
  });
});
