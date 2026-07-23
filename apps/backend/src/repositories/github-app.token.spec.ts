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
    // Given: 런타임에서만 생성한 RSA key와 App ID가 있다.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    // When: App JWT를 생성하고 공개키로 검증한다.
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

    // Then: iat과 exp가 ADR-006 시간 계약을 지킨다.
    expect(verified.payload.iat).toBe(Math.floor(NOW.getTime() / 1_000) - 60);
    expect(verified.payload.exp).toBe(
      Math.floor(NOW.getTime() / 1_000) + 9 * 60,
    );
  });
});

describe('GithubAppTokenProvider', () => {
  it('동시 요청은 installation 발견과 token 발급 promise를 공유한다', async () => {
    // Given: 유효한 org installation과 한 시간 token 응답이 있다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 101, account: { login: 'synthetic-org' } }),
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

    // When: 두 호출이 동시에 access token을 요청한다.
    const tokens = await Promise.all([
      provider.accessToken(),
      provider.accessToken(),
    ]);

    // Then: 발견·발급은 한 번씩만 호출되고 같은 token을 받는다.
    expect(tokens).toEqual([
      'synthetic-installation-token',
      'synthetic-installation-token',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(jwtFactory).toHaveBeenCalledTimes(2);
  });

  it('만료 5분 전까지 access token을 메모리에서 재사용한다', async () => {
    // Given: 발급된 token이 6분 넘게 남아 있다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 101, account: { login: 'synthetic-org' } }),
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

    // When: 같은 프로세스에서 token을 다시 요청한다.
    const token = await provider.accessToken();

    // Then: 추가 GitHub 호출 없이 cache를 사용한다.
    expect(token).toBe('synthetic-installation-token');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('installation account가 설정 org와 다르면 fail-closed한다', async () => {
    // Given: 다른 org를 가리키는 installation 응답이 있다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher.mockResolvedValue(
      jsonResponse(200, { id: 101, account: { login: 'other-org' } }),
    );
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    // When: access token을 요청한다.
    const token = provider.accessToken();

    // Then: token 발급 전에 최종 오류로 중단한다.
    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.ORGANIZATION_MISMATCH,
        false,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('installation 조회 rate limit는 최소 1분 뒤 재시도한다', async () => {
    // Given: GitHub가 30초 뒤 reset인 rate-limit 403을 반환한다.
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

    // When: access token을 요청한다.
    const token = provider.accessToken();

    // Then: 권한 최종 실패가 아니라 최소 지연을 가진 재시도 오류다.
    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:01:00.000Z'),
      ),
    );
  });

  it('token 발급 429의 Retry-After를 보존한다', async () => {
    // Given: installation은 찾았지만 token 발급이 2분 제한된다.
    const fetcher = jest.fn<
      ReturnType<GithubAppFetcher>,
      Parameters<GithubAppFetcher>
    >();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 101, account: { login: 'synthetic-org' } }),
      )
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '120' }));
    const provider = new GithubAppTokenProvider(
      () => credentials,
      fetcher,
      () => NOW,
      () => Promise.resolve('synthetic-app-jwt'),
    );

    // When: access token을 요청한다.
    const token = provider.accessToken();

    // Then: worker가 서버가 지시한 시각 이후 재시도할 수 있다.
    await expect(token).rejects.toEqual(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:02:00.000Z'),
      ),
    );
  });
});
