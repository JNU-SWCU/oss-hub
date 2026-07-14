import {
  RateLimitedError,
  UpstreamError,
  UpstreamResponseError,
} from './github-api.error';
import { Fetcher, GithubApiClient } from './github-api.client';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function jsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('GithubApiClient', () => {
  const credentials = {
    clientId: 'synthetic-client-id',
    clientSecret: 'synthetic-client-secret',
  };

  it('Retry-After 초를 최우선으로 사용해 rate limit 해제 시각을 계산한다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher.mockResolvedValue(
      jsonResponse(429, {}, {
        'retry-after': '120',
        'x-ratelimit-reset': '1893456000',
      }),
    );
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const promise = client.getUser('synthetic-login');

    await expect(promise).rejects.toEqual(
      new RateLimitedError(new Date('2026-01-01T00:02:00.000Z')),
    );
  });

  it('Retry-After가 없으면 x-ratelimit-reset epoch 초를 사용한다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher.mockResolvedValue(
      jsonResponse(403, {}, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1767225720',
      }),
    );
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const promise = client.getUser('synthetic-login');

    await expect(promise).rejects.toMatchObject({
      retryNotBeforeAt: new Date('2026-01-01T00:02:00.000Z'),
    });
  });

  it('rate limit 헤더에 시각이 없으면 현재 시각에서 60초 뒤를 사용한다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher.mockResolvedValue(
      jsonResponse(403, {}, { 'x-ratelimit-remaining': '0' }),
    );
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const promise = client.getUser('synthetic-login');

    await expect(promise).rejects.toMatchObject({
      retryNotBeforeAt: new Date('2026-01-01T00:01:00.000Z'),
    });
  });

  it('Link next를 따라 repository 전 페이지를 수집하고 고정 헤더를 보낸다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          [{ id: 101, name: 'synthetic-repo-1' }],
          {
            link: '<https://api.github.com/users/synthetic-login/repos?per_page=100&page=2>; rel="next"',
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 102, name: 'synthetic-repo-2' }]),
      );
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const observations = await client.getRepos('synthetic-login');

    expect(observations.map(({ sourceId }) => sourceId)).toEqual(['101', '102']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/users/synthetic-login/repos?per_page=100&page=2',
    );
    const firstRequest = fetcher.mock.calls[0]?.[1];
    expect(firstRequest).toMatchObject({
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${Buffer.from(
          'synthetic-client-id:synthetic-client-secret',
        ).toString('base64')}`,
        'User-Agent': 'oss-hub-backend',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    expect(firstRequest?.signal).toBeInstanceOf(AbortSignal);
  });

  it('일반 비-2xx 응답은 본문 없이 상태 코드만 UpstreamError에 담는다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher.mockResolvedValue(jsonResponse(502, { detail: 'synthetic-detail' }));
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const promise = client.getUser('synthetic-login');

    await expect(promise).rejects.toEqual(new UpstreamError(502));
  });

  it('필수 id가 없는 GitHub 응답은 형식 오류로 거부한다', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>();
    fetcher.mockResolvedValue(
      jsonResponse(200, [{ name: 'synthetic-repo-without-id' }]),
    );
    const client = new GithubApiClient(() => credentials, fetcher, () => NOW);

    const promise = client.getRepos('synthetic-login');

    await expect(promise).rejects.toBeInstanceOf(UpstreamResponseError);
  });
});
