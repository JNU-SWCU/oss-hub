import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientConfig,
  CollectionDiscoveryClientError,
  CollectionDiscoveryTokenProvider,
} from './collection-discovery.client';

const config: CollectionDiscoveryClientConfig = {
  apiUrl: 'https://api.github.test/graphql',
  maxRepositories: 42,
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

function repositoryNode(overrides: Record<string, unknown> = {}) {
  return {
    databaseId: 1,
    nameWithOwner: 'JNU-SWCU/example',
    isPrivate: false,
    isArchived: false,
    defaultBranchRef: { name: 'main' },
    owner: { login: 'JNU-SWCU' },
    ...overrides,
  };
}

function contributionsBody(overrides: {
  restrictedContributionsCount?: number;
  commitContributionsByRepository?: unknown[];
  pullRequestReviewContributionsByRepository?: unknown[];
}) {
  return json({
    data: {
      user: {
        contributionsCollection: {
          restrictedContributionsCount:
            overrides.restrictedContributionsCount ?? 0,
          commitContributionsByRepository: (
            overrides.commitContributionsByRepository ?? []
          ).map((repository) => ({ repository })),
          pullRequestReviewContributionsByRepository: (
            overrides.pullRequestReviewContributionsByRepository ?? []
          ).map((repository) => ({ repository })),
        },
      },
    },
  });
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
  it('maps the happy-path shape and reports the restricted count', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      contributionsBody({
        restrictedContributionsCount: 7,
        commitContributionsByRepository: [
          repositoryNode({
            databaseId: 1,
            nameWithOwner: 'JNU-SWCU/example',
          }),
        ],
        pullRequestReviewContributionsByRepository: [
          repositoryNode({
            databaseId: 2,
            nameWithOwner: 'JNU-SWCU/reviewed-only',
            isArchived: true,
            defaultBranchRef: null,
          }),
        ],
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    const result = await client.discoverContributedRepositories(
      'octostudent',
      '2026-01-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );

    expect(result.restrictedContributionsCount).toBe(7);
    expect(result.repositories).toEqual([
      {
        databaseId: '1',
        nameWithOwner: 'JNU-SWCU/example',
        ownerLogin: 'JNU-SWCU',
        defaultBranch: 'main',
        archived: false,
      },
      {
        databaseId: '2',
        nameWithOwner: 'JNU-SWCU/reviewed-only',
        ownerLogin: 'JNU-SWCU',
        defaultBranch: null,
        archived: true,
      },
    ]);
  });

  it('dedupes a repository that appears in both breakdown fields', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      contributionsBody({
        commitContributionsByRepository: [
          repositoryNode({ databaseId: 5, nameWithOwner: 'JNU-SWCU/both' }),
        ],
        pullRequestReviewContributionsByRepository: [
          repositoryNode({ databaseId: 5, nameWithOwner: 'JNU-SWCU/both' }),
        ],
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    const result = await client.discoverContributedRepositories(
      'octostudent',
      '2026-01-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );

    expect(result.repositories).toHaveLength(1);
  });

  it('filters out repositories the API defensively still marks private', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      contributionsBody({
        commitContributionsByRepository: [
          repositoryNode({ databaseId: 9, isPrivate: true }),
        ],
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    const result = await client.discoverContributedRepositories(
      'octostudent',
      '2026-01-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );

    expect(result.repositories).toEqual([]);
  });

  it('throws a typed error on a top-level GraphQL errors array instead of returning an empty list', async () => {
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
      client.discoverContributedRepositories(
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
      client.discoverContributedRepositories(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
  });

  it('throws USER_NOT_FOUND rather than an empty list when the user is null with no errors', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      json({ data: { user: null } }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await expect(
      client.discoverContributedRepositories(
        'ghost',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ kind: 'USER_NOT_FOUND' });
  });

  it('sends maxRepositories in the GraphQL variables', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(contributionsBody({}));
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await client.discoverContributedRepositories(
      'octostudent',
      '2026-01-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const init = fetcher.mock.calls[0]?.[1];
    const sent = JSON.parse(init?.body as string) as {
      variables: Record<string, unknown>;
    };
    expect(sent.variables).toMatchObject({
      login: 'octostudent',
      max: 42,
    });
  });

  it('applies the token-provider auth header to the request', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(contributionsBody({}));
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider('injected-fake-token'),
      fetcher,
    );

    await client.discoverContributedRepositories(
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
      client.discoverContributedRepositories(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ kind: 'AUTH' });
    expect(tokens.clear).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('throws RATE_LIMITED with retryAfterSeconds on a 429 HTTP response', async () => {
    const fetcher = fetchMock().mockResolvedValueOnce(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    );
    const client = new CollectionDiscoveryClient(
      config,
      fakeTokenProvider(),
      fetcher,
    );

    await expect(
      client.discoverContributedRepositories(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    });
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
      // GitHub rejects a `contributionsCollection` span wider than one year
      // with a hard VALIDATION error (HTTP 200 + top-level `errors`).
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
      client.discoverContributedRepositories(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toBeInstanceOf(CollectionDiscoveryClientError);
  });
});
