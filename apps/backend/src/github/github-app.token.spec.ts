import { generateKeyPairSync } from 'node:crypto';
import { jwtVerify } from 'jose';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import {
  createGithubAppJwt,
  GithubAppCredentials,
  GithubAppFetcher,
  GithubAppTokenProvider,
} from './github-app.token';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const credentials: GithubAppCredentials = {
  organization: 'synthetic-org',
  appId: '12345',
  privateKey: 'runtime-test-key',
};

function jsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('createGithubAppJwt', () => {
  it('60초 clock skew와 10분 이내 만료를 가진 RS256 JWT를 만든다', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const token = await createGithubAppJwt(
      {
        ...credentials,
        privateKey: privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
      },
      NOW,
    );
    const verified = await jwtVerify(token, publicKey, {
      issuer: credentials.appId,
      algorithms: ['RS256'],
      currentDate: NOW,
    });

    expect(verified.payload.iat).toBe(Math.floor(NOW.getTime() / 1_000) - 60);
    expect(verified.payload.exp).toBe(
      Math.floor(NOW.getTime() / 1_000) + 9 * 60,
    );
  });
});

describe('GithubAppTokenProvider', () => {
  it('동시 요청은 installation 발견과 token 발급 promise를 공유한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 101,
          app_id: 12345,
          account: { login: 'synthetic-org' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: 'synthetic-installation-token',
          expires_at: '2026-07-22T01:00:00.000Z',
        }),
      );
    const jwtFactory = jest.fn().mockResolvedValue('synthetic-app-jwt');
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      jwtFactory,
    );

    const tokens = await Promise.all([
      provider.accessToken(),
      provider.accessToken(),
    ]);

    expect(tokens).toEqual([
      'synthetic-installation-token',
      'synthetic-installation-token',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(jwtFactory).toHaveBeenCalledTimes(2);
  });

  it('만료 5분 전까지 access token을 메모리에서 재사용한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 101,
          app_id: 12345,
          account: { login: 'synthetic-org' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: 'synthetic-installation-token',
          expires_at: '2026-07-22T00:06:00.001Z',
        }),
      );
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );
    await provider.accessToken();

    const token = await provider.accessToken();

    expect(token).toBe('synthetic-installation-token');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('installation account가 설정 org와 다르면 fail-closed한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(200, {
        id: 101,
        app_id: 12345,
        account: { login: 'other-org' },
      }),
    );
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    const token = provider.accessToken();

    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.ORGANIZATION_MISMATCH,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('installation app_id가 설정값과 다르면 token 발급 전에 fail-closed한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(200, {
        id: 101,
        app_id: 54321,
        account: { login: 'synthetic-org' },
      }),
    );
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    await expect(provider.accessToken()).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.APP_ID_MISMATCH,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('installation 조회 rate limit는 최소 1분 뒤 재시도한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(
        403,
        { message: 'API rate limit exceeded' },
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(NOW.getTime() / 1_000 + 30),
        },
      ),
    );
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    const token = provider.accessToken();

    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:01:00.000Z'),
      ),
    );
  });

  it('token 발급 429의 Retry-After를 보존한다', async () => {
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 101,
          app_id: 12345,
          account: { login: 'synthetic-org' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '120' }));
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    const token = provider.accessToken();

    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:02:00.000Z'),
      ),
    );
  });
});
