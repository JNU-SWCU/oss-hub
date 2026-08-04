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
