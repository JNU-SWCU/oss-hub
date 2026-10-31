import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientConfig,
  CollectionDiscoveryTokenProvider,
} from './collection-discovery.client';
import { CollectionDiscoveryClientError } from './collection-discovery.error';
import { ProviderRequestQueue } from './provider-request-queue.policy';

describe('collection-provider-queue.client', () => {
  const jsonResponse = (headers: Record<string, string> = {}): Response =>
    new Response('{}', { status: 200, headers });

  function fakeClock(): {
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  } {
    let cursor = 1_000_000;
    return {
      now: () => cursor,
      sleep: (ms: number) => {
        cursor += ms;
        return Promise.resolve();
      },
    };
  }

  describe('ProviderRequestQueue', () => {
    it('paces dispatches at least 250ms apart', async () => {
      const clock = fakeClock();
      const queue = new ProviderRequestQueue(clock.now, clock.sleep);
      const dispatchTimes: number[] = [];
      const fetcher = (): Promise<Response> => {
        dispatchTimes.push(clock.now());
        return Promise.resolve(jsonResponse());
      };
      const wrapped = queue.wrapFetcher(fetcher);

      await wrapped('https://api.github.com/a');
      await wrapped('https://api.github.com/b');
      await wrapped('https://api.github.com/c');

      expect(dispatchTimes).toHaveLength(3);
      const [first, second, third] = dispatchTimes as [number, number, number];
      expect(second - first).toBeGreaterThanOrEqual(250);
      expect(third - second).toBeGreaterThanOrEqual(250);
    });

    it('does not pace the very first dispatch', async () => {
      const clock = fakeClock();
      const queue = new ProviderRequestQueue(clock.now, clock.sleep);
      const wrapped = queue.wrapFetcher(() => Promise.resolve(jsonResponse()));
      const start = clock.now();
      await wrapped('https://api.github.com/a');
      expect(clock.now()).toBe(start);
    });

    it('keeps FIFO pacing across a failed dispatch', async () => {
      const clock = fakeClock();
      const queue = new ProviderRequestQueue(clock.now, clock.sleep);
      const dispatchTimes: number[] = [];
      let call = 0;
      const fetcher = (): Promise<Response> => {
        dispatchTimes.push(clock.now());
        call += 1;
        if (call === 2) return Promise.reject(new Error('upstream failure'));
        return Promise.resolve(jsonResponse());
      };
      const wrapped = queue.wrapFetcher(fetcher);

      const firstRequest = wrapped('https://api.github.com/a');
      const secondRequest = wrapped('https://api.github.com/b');
      const thirdRequest = wrapped('https://api.github.com/c');

      await firstRequest;
      await expect(secondRequest).rejects.toThrow('upstream failure');
      await thirdRequest;

      expect(dispatchTimes).toHaveLength(3);
      const [first, second, third] = dispatchTimes as [number, number, number];
      expect(second - first).toBeGreaterThanOrEqual(250);

      expect(third - second).toBeGreaterThanOrEqual(250);
    });

    it('observes rate-limit headers without reporting shouldStop before any response', () => {
      const queue = new ProviderRequestQueue();
      expect(queue.shouldStop()).toBe(false);
    });

    it('reports shouldStop once remaining drops to the dynamic floor (max(100, 20% of limit))', async () => {
      const queue = new ProviderRequestQueue(
        () => 0,
        () => Promise.resolve(),
      );
      const wrapped = queue.wrapFetcher(() =>
        Promise.resolve(
          jsonResponse({
            'x-ratelimit-remaining': '250',
            'x-ratelimit-limit': '5000',
          }),
        ),
      );
      await wrapped('https://api.github.com/a');

      expect(queue.shouldStop()).toBe(true);
    });

    it('uses the 100-request floor when 20% of the limit is smaller', async () => {
      const queue = new ProviderRequestQueue(
        () => 0,
        () => Promise.resolve(),
      );
      const wrapped = queue.wrapFetcher(() =>
        Promise.resolve(
          jsonResponse({
            'x-ratelimit-remaining': '150',
            'x-ratelimit-limit': '300',
          }),
        ),
      );
      await wrapped('https://api.github.com/a');

      expect(queue.shouldStop()).toBe(false);
    });

    it('does not consume the response body while observing headers', async () => {
      const queue = new ProviderRequestQueue();
      const wrapped = queue.wrapFetcher(() =>
        Promise.resolve(
          jsonResponse({
            'x-ratelimit-remaining': '4000',
            'x-ratelimit-limit': '5000',
          }),
        ),
      );
      const response = await wrapped('https://api.github.com/a');
      await expect(response.json()).resolves.toEqual({});
    });
  });
});

const config: CollectionDiscoveryClientConfig = {
  apiUrl: 'https://api.github.test/graphql',
  deadlineMs: 5_000,
};

type Fetcher = jest.Mock<
  Promise<Response>,
  [input: string | URL, init?: RequestInit]
>;
const fetchMock = (): Fetcher =>
  jest.fn<Promise<Response>, [input: string | URL, init?: RequestInit]>();
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function fakeTokenProvider(
  token = 'test-discovery-token',
): CollectionDiscoveryTokenProvider & { clear: jest.Mock } {
  return {
    getToken: jest.fn().mockResolvedValue(token),
    clear: jest.fn(),
  };
}

function activityBody(overrides: {
  totalCommitContributions?: number;
  totalPullRequestContributions?: number;
  totalIssueContributions?: number;
  totalRepositoryContributions?: number;
  stargazerCounts?: number[];
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
  rateLimitCost?: number;
}) {
  const stargazerCounts = overrides.stargazerCounts ?? [];
  return json({
    data: {
      rateLimit: {
        cost: overrides.rateLimitCost ?? 1,
        remaining: 4_999,
      },
      user: {
        contributionsCollection: {
          totalCommitContributions: overrides.totalCommitContributions ?? 0,
          totalPullRequestContributions:
            overrides.totalPullRequestContributions ?? 0,
          totalIssueContributions: overrides.totalIssueContributions ?? 0,
          totalRepositoryContributions:
            overrides.totalRepositoryContributions ?? 0,
        },
        repositories: {
          totalCount: overrides.totalCount ?? stargazerCounts.length,
          nodes: stargazerCounts.map((stargazerCount) => ({ stargazerCount })),
          pageInfo: {
            hasNextPage: overrides.hasNextPage ?? false,
            endCursor: overrides.endCursor ?? null,
          },
        },
      },
    },
  });
}

function sentVariables(fetcher: Fetcher, call: number) {
  const init = fetcher.mock.calls[call]?.[1];
  const sent = JSON.parse(init?.body as string) as {
    variables: Record<string, unknown>;
  };
  return sent.variables;
}

describe('CollectionDiscoveryClient', () => {
  it('throws a typed error on a top-level GraphQL errors array instead of returning zero counts', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      json({
        data: null,
        errors: [{ message: 'Could not resolve to a User' }],
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await expect(
      client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({
      kind: 'GRAPHQL_ERROR',
    });
  });

  it('throws RATE_LIMITED when a top-level GraphQL error reports that type', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      json({
        data: null,
        errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await expect(
      client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
  });

  it('applies the token-provider auth header to the request', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(activityBody({}));
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider('injected-fake-token'),
      fetcher,
    );

    await client.fetchUserActivityMetrics(
      'octostudent',
      '2026-01-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );

    const init = fetcher.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer injected-fake-token');
  });

  it('clears the token and retries once on a 401, then fails auth on a second 401', async () => {
    const fetcher = fetchMock()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const tokens = fakeTokenProvider();
    const client = new CollectionDiscoveryClient(config, tokens, fetcher);

    await expect(
      client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ kind: 'AUTH' });
    expect(tokens.clear).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  describe('fetchUserActivityMetrics', () => {
    it('parses the five person-axis counters from a single page', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        activityBody({
          totalCommitContributions: 6939,
          totalPullRequestContributions: 1369,
          totalIssueContributions: 816,
          totalRepositoryContributions: 32,
          stargazerCounts: [10, 4, 0],
        }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      const result = await client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
      );

      expect(result).toEqual({
        commitCount: 6939,
        pullRequestCount: 1369,
        issueCount: 816,
        repositoryCount: 32,
        starCount: 14,
      });
    });

    it('sums stars across pages while hasNextPage and does not double-count the contribution counters', async () => {
      const fetcher = fetchMock()
        .mockResolvedValueOnce(
          activityBody({
            totalCommitContributions: 100,
            totalPullRequestContributions: 20,
            totalIssueContributions: 5,
            totalRepositoryContributions: 3,
            stargazerCounts: [7, 3],
            hasNextPage: true,
            endCursor: 'CURSOR_PAGE_2',
          }),
        )
        .mockResolvedValueOnce(
          activityBody({
            totalCommitContributions: 100,
            totalPullRequestContributions: 20,
            totalIssueContributions: 5,
            totalRepositoryContributions: 3,
            stargazerCounts: [11, 1],
          }),
        );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      const result = await client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
      );

      expect(result).toEqual({
        commitCount: 100,
        pullRequestCount: 20,
        issueCount: 5,
        repositoryCount: 3,
        starCount: 22,
      });
      const firstVariables = sentVariables(fetcher, 0);
      const secondVariables = sentVariables(fetcher, 1);
      expect(firstVariables.after).toBeNull();
      expect(secondVariables).toMatchObject({
        login: 'octostudent',
        after: 'CURSOR_PAGE_2',
      });
    });

    it('surfaces the upstream one-year window rejection as GRAPHQL_ERROR', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        json({
          data: null,
          errors: [
            {
              type: 'VALIDATION',
              message:
                'The `from` and `to` must be within one year of each other',
            },
          ],
        }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      await expect(
        client.fetchUserActivityMetrics(
          'octostudent',
          '2024-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        ),
      ).rejects.toMatchObject({ kind: 'GRAPHQL_ERROR' });
    });

    it('throws RATE_LIMITED with retryAfterSeconds on a 429 HTTP response', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '45' },
        }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      await expect(
        client.fetchUserActivityMetrics(
          'octostudent',
          '2026-01-01T00:00:00Z',
          '2026-12-31T23:59:59Z',
        ),
      ).rejects.toMatchObject({
        kind: 'RATE_LIMITED',
        retryAfterSeconds: 45,
      });
    });

    it('throws USER_NOT_FOUND when the login does not resolve to a user', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        json({ data: { rateLimit: { cost: 1, remaining: 4999 }, user: null } }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      await expect(
        client.fetchUserActivityMetrics(
          'ghost',
          '2026-01-01T00:00:00Z',
          '2026-12-31T23:59:59Z',
        ),
      ).rejects.toMatchObject({ kind: 'USER_NOT_FOUND' });
    });

    it.each([
      [
        'a null contributionsCollection',
        {
          contributionsCollection: null,
          repositories: {
            totalCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      [
        'a missing counter field',
        {
          contributionsCollection: {
            totalCommitContributions: 1,
            totalPullRequestContributions: 1,
            totalIssueContributions: 1,
          },
          repositories: {
            totalCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      [
        'a null counter value',
        {
          contributionsCollection: {
            totalCommitContributions: null,
            totalPullRequestContributions: 1,
            totalIssueContributions: 1,
            totalRepositoryContributions: 1,
          },
          repositories: {
            totalCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      [
        'a missing repositories connection',
        {
          contributionsCollection: {
            totalCommitContributions: 1,
            totalPullRequestContributions: 1,
            totalIssueContributions: 1,
            totalRepositoryContributions: 1,
          },
        },
      ],
      [
        'a null stargazerCount',
        {
          contributionsCollection: {
            totalCommitContributions: 1,
            totalPullRequestContributions: 1,
            totalIssueContributions: 1,
            totalRepositoryContributions: 1,
          },
          repositories: {
            totalCount: 1,
            nodes: [{ stargazerCount: null }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      [
        'hasNextPage true with a null cursor',
        {
          contributionsCollection: {
            totalCommitContributions: 1,
            totalPullRequestContributions: 1,
            totalIssueContributions: 1,
            totalRepositoryContributions: 1,
          },
          repositories: {
            totalCount: 1,
            nodes: [{ stargazerCount: 1 }],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      ],
    ])(
      'throws a typed RESPONSE error rather than crashing on %s',
      async (_label, user) => {
        const fetcher = fetchMock().mockResolvedValue(
          json({ data: { rateLimit: { cost: 1, remaining: 4999 }, user } }),
        );
        const client = new CollectionDiscoveryClient(
          config,
          fakeTokenProvider(),
          fetcher,
        );

        const error = await client
          .fetchUserActivityMetrics(
            'octostudent',
            '2026-01-01T00:00:00Z',
            '2026-12-31T23:59:59Z',
          )
          .then(
            (value) => {
              throw new Error(
                `expected a typed rejection, resolved with ${JSON.stringify(value)}`,
              );
            },
            (thrown: unknown) => thrown,
          );

        expect(error).toBeInstanceOf(CollectionDiscoveryClientError);
        expect(error).toMatchObject({ kind: 'RESPONSE' });
      },
    );

    it('skips null repository nodes instead of failing the whole page', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        json({
          data: {
            rateLimit: { cost: 1, remaining: 4999 },
            user: {
              contributionsCollection: {
                totalCommitContributions: 2,
                totalPullRequestContributions: 0,
                totalIssueContributions: 0,
                totalRepositoryContributions: 0,
              },
              repositories: {
                totalCount: 2,
                nodes: [null, { stargazerCount: 9 }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      );

      const result = await client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
      );

      expect(result.starCount).toBe(9);
    });

    it('never puts the token anywhere except the Authorization header', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        new Response(null, { status: 500 }),
      );
      const client = new CollectionDiscoveryClient(
        config,
        fakeTokenProvider('injected-fake-token'),
        fetcher,
      );

      const error = await client
        .fetchUserActivityMetrics(
          'octostudent',
          '2026-01-01T00:00:00Z',
          '2026-12-31T23:59:59Z',
        )
        .then(
          () => {
            throw new Error('expected the 500 response to reject');
          },
          (thrown: unknown) => thrown as CollectionDiscoveryClientError,
        );

      expect(error).toBeInstanceOf(CollectionDiscoveryClientError);
      expect(error.message).not.toContain('injected-fake-token');
      expect(JSON.stringify(error)).not.toContain('injected-fake-token');
      const init = fetcher.mock.calls[0]?.[1];
      expect(init?.body as string).not.toContain('injected-fake-token');
    });
  });

  it('throws RESPONSE on a malformed body shape instead of silently defaulting', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      json({ data: { user: { contributionsCollection: null } } }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await expect(
      client.fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toBeInstanceOf(CollectionDiscoveryClientError);
  });
});
