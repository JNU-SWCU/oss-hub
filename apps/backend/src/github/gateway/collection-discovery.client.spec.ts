import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientConfig,
  CollectionDiscoveryClientError,
  CollectionDiscoveryTokenProvider,
} from './collection-discovery.client';

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

interface ContributedRepository {
  readonly nameWithOwner: string;
  readonly stargazerCount: number;
  readonly ownerType?: 'Organization' | 'User';
  readonly ownerLogin?: string;
  readonly isPrivate?: boolean;
}

const contributionNode = (repository: ContributedRepository) => ({
  repository: {
    nameWithOwner: repository.nameWithOwner,
    isPrivate: repository.isPrivate ?? false,
    stargazerCount: repository.stargazerCount,
    owner: {
      __typename: repository.ownerType ?? 'Organization',
      login: repository.ownerLogin ?? repository.nameWithOwner.split('/')[0],
    },
  },
});

function activityBody(overrides: {
  totalCommitContributions?: number;
  totalPullRequestContributions?: number;
  totalIssueContributions?: number;
  totalRepositoryContributions?: number;
  stargazerCounts?: number[];
  organizationLogins?: string[];
  commitContributions?: ContributedRepository[];
  pullRequestContributions?: ContributedRepository[];
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
        organizations: {
          nodes: (overrides.organizationLogins ?? []).map((login) => ({
            login,
          })),
        },
        contributionsCollection: {
          totalCommitContributions: overrides.totalCommitContributions ?? 0,
          totalPullRequestContributions:
            overrides.totalPullRequestContributions ?? 0,
          totalIssueContributions: overrides.totalIssueContributions ?? 0,
          totalRepositoryContributions:
            overrides.totalRepositoryContributions ?? 0,
          commitContributionsByRepository: (
            overrides.commitContributions ?? []
          ).map(contributionNode),
          pullRequestContributionsByRepository: (
            overrides.pullRequestContributions ?? []
          ).map(contributionNode),
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

function rawUserBody(parts: {
  organizations?: unknown;
  commitContributionsByRepository?: unknown;
  pullRequestContributionsByRepository?: unknown;
}) {
  return json({
    data: {
      rateLimit: { cost: 1, remaining: 4_999 },
      user: {
        organizations: parts.organizations,
        contributionsCollection: {
          totalCommitContributions: 1,
          totalPullRequestContributions: 1,
          totalIssueContributions: 1,
          totalRepositoryContributions: 1,
          commitContributionsByRepository:
            parts.commitContributionsByRepository,
          pullRequestContributionsByRepository:
            parts.pullRequestContributionsByRepository,
        },
        repositories: {
          totalCount: 0,
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
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
              organizations: { nodes: [] },
              contributionsCollection: {
                totalCommitContributions: 2,
                totalPullRequestContributions: 0,
                totalIssueContributions: 0,
                totalRepositoryContributions: 0,
                commitContributionsByRepository: [],
                pullRequestContributionsByRepository: [],
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

  describe('fetchUserActivityMetrics organization star scope', () => {
    const runMetrics = (fetcher: Fetcher) =>
      new CollectionDiscoveryClient(
        config,
        fakeTokenProvider(),
        fetcher,
      ).fetchUserActivityMetrics(
        'octostudent',
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
      );

    it.each([
      [
        'owned repo stars plus a member-org repo the user committed to',
        {
          stargazerCounts: [10],
          organizationLogins: ['Xia-Ataraxia'],
          commitContributions: [
            { nameWithOwner: 'Xia-Ataraxia/core', stargazerCount: 105 },
          ],
        },
        115,
      ],
      [
        'a member-org repo the user only opened pull requests in',
        {
          organizationLogins: ['Xia-Ataraxia'],
          pullRequestContributions: [
            { nameWithOwner: 'Xia-Ataraxia/web', stargazerCount: 40 },
          ],
        },
        40,
      ],
      [
        'a repo in both contribution lists counted once, matched case-insensitively',
        {
          organizationLogins: ['XIA-ataraxia'],
          commitContributions: [
            { nameWithOwner: 'Xia-Ataraxia/core', stargazerCount: 105 },
          ],
          pullRequestContributions: [
            {
              nameWithOwner: 'xia-ataraxia/Core',
              ownerLogin: 'xia-ataraxia',
              stargazerCount: 105,
            },
          ],
        },
        105,
      ],
      [
        'nothing from non-member orgs, User-owned repos or private member-org repos',
        {
          organizationLogins: ['Xia-Ataraxia'],
          commitContributions: [
            { nameWithOwner: 'openclaw/openclaw', stargazerCount: 20_000 },
            {
              nameWithOwner: 'Xia-Ataraxia/owned-by-user',
              ownerType: 'User' as const,
              stargazerCount: 500,
            },
            {
              nameWithOwner: 'Xia-Ataraxia/secret',
              isPrivate: true,
              stargazerCount: 999,
            },
            { nameWithOwner: 'Xia-Ataraxia/core', stargazerCount: 105 },
          ],
          pullRequestContributions: [
            {
              nameWithOwner: 'google-gemini/gemini-cli',
              stargazerCount: 70_000,
            },
          ],
        },
        105,
      ],
    ])('counts %s', async (_label, body, starCount) => {
      const fetcher = fetchMock().mockResolvedValueOnce(activityBody(body));

      await expect(runMetrics(fetcher)).resolves.toMatchObject({ starCount });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('reads organizations and contributed repos from the first page only while paging owned repos', async () => {
      const fetcher = fetchMock()
        .mockResolvedValueOnce(
          activityBody({
            stargazerCounts: [7],
            organizationLogins: ['Xia-Ataraxia'],
            commitContributions: [
              { nameWithOwner: 'Xia-Ataraxia/core', stargazerCount: 105 },
            ],
            hasNextPage: true,
            endCursor: 'CURSOR_PAGE_2',
          }),
        )
        .mockResolvedValueOnce(
          activityBody({
            stargazerCounts: [3],
            organizationLogins: ['Other-Org'],
            commitContributions: [
              { nameWithOwner: 'Other-Org/ignored', stargazerCount: 1_000 },
            ],
          }),
        );

      await expect(runMetrics(fetcher)).resolves.toMatchObject({
        starCount: 115,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('stops with a typed RESPONSE error when the owned repo pages never end', async () => {
      const fetcher = fetchMock().mockImplementation(() =>
        Promise.resolve(
          activityBody({
            stargazerCounts: [1],
            organizationLogins: ['Xia-Ataraxia'],
            commitContributions: [
              { nameWithOwner: 'Xia-Ataraxia/core', stargazerCount: 105 },
            ],
            hasNextPage: true,
            endCursor: 'CURSOR_NEXT',
          }),
        ),
      );

      await expect(runMetrics(fetcher)).rejects.toMatchObject({
        kind: 'RESPONSE',
      });
      expect(fetcher).toHaveBeenCalledTimes(50);
    });

    it('skips null organization nodes and null contribution entries instead of failing', async () => {
      const fetcher = fetchMock().mockResolvedValueOnce(
        rawUserBody({
          organizations: { nodes: [null, { login: 'Xia-Ataraxia' }] },
          commitContributionsByRepository: [
            null,
            contributionNode({
              nameWithOwner: 'Xia-Ataraxia/core',
              stargazerCount: 105,
            }),
          ],
          pullRequestContributionsByRepository: [null],
        }),
      );

      await expect(runMetrics(fetcher)).resolves.toMatchObject({
        starCount: 105,
      });
    });

    it.each([
      [
        'a missing organizations connection',
        {
          organizations: undefined,
          commitContributionsByRepository: [],
          pullRequestContributionsByRepository: [],
        },
      ],
      [
        'a commit contribution list that is not an array',
        {
          organizations: { nodes: [{ login: 'Xia-Ataraxia' }] },
          commitContributionsByRepository: {},
          pullRequestContributionsByRepository: [],
        },
      ],
      [
        'a contributed repository without an owner',
        {
          organizations: { nodes: [{ login: 'Xia-Ataraxia' }] },
          commitContributionsByRepository: [
            {
              repository: {
                nameWithOwner: 'Xia-Ataraxia/core',
                isPrivate: false,
                stargazerCount: 105,
              },
            },
          ],
          pullRequestContributionsByRepository: [],
        },
      ],
    ])(
      'throws a typed RESPONSE error rather than crashing on %s',
      async (_label, parts) => {
        const fetcher = fetchMock().mockResolvedValue(rawUserBody(parts));

        const error = await runMetrics(fetcher).then(
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
