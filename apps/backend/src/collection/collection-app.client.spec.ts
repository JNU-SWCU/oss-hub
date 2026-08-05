import { generateKeyPairSync } from 'node:crypto';
import {
  CollectionAppClient,
  CollectionAppClientError,
} from './collection-app.client';
import {
  CollectionAppConfig,
  CollectionAppConfigError,
  CollectionAppConfigValues,
} from './collection-app.config';
import {
  CollectionAppTokenError,
  CollectionAppTokenProvider,
} from './collection-app.token';
import { requestFingerprintKey } from './collection-app.frontier';

const config: CollectionAppConfigValues = {
  appId: '1',
  orgLogin: 'JNU-SWCU',
  privateKey: 'unused',
  apiBaseUrl: 'https://api.github.test',
  maxPages: 100,
  deadlineMs: 30_000,
};
type Fetcher = jest.Mock<
  Promise<Response>,
  [input: string | URL, init?: RequestInit]
>;
const fetchMock = (): Fetcher =>
  jest.fn<Promise<Response>, [input: string | URL, init?: RequestInit]>();
const tokenProvider = new CollectionAppTokenProvider(config);
jest.spyOn(tokenProvider, 'getToken').mockResolvedValue('test-token');
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });
const repository = {
  id: 42,
  name: 'private-repo',
  full_name: 'JNU-SWCU/private-repo',
  private: true,
  archived: false,
  default_branch: 'main',
  owner: { login: 'JNU-SWCU', email: 'excluded' },
  html_url: 'https://github.test/JNU-SWCU/private-repo',
  updated_at: '2026-01-01T00:00:00Z',
  secret: 'excluded',
};
const commitFixture = (sha: string, date: string) => ({
  sha,
  author: { id: 7, login: 'octocat', email: 'excluded' },
  commit: { committer: { date }, message: 'excluded' },
  html_url: `https://github.test/${sha}`,
});
const prFixture = (id: number, createdAt: string) => ({
  id,
  number: id,
  state: 'open',
  draft: false,
  merged_at: null,
  created_at: createdAt,
  updated_at: createdAt,
  user: null,
  html_url: `https://github.test/pr/${id}`,
});
const releaseFixture = (
  id: number,
  draft: boolean,
  publishedAt: string | null,
) => ({
  id,
  tag_name: `v${id}`,
  name: null,
  draft,
  prerelease: false,
  published_at: publishedAt,
  author: null,
  html_url: `https://github.test/r/${id}`,
});

describe('CollectionAppConfig', () => {
  it('validates required values and lower caps', () => {
    expect(
      CollectionAppConfig.fromEnv({
        GITHUB_COLLECTION_APP_ID: '1',
        GITHUB_APP_ORG: 'JNU-SWCU',
        GITHUB_COLLECTION_APP_PRIVATE_KEY: 'key',
        GITHUB_COLLECTION_APP_MAX_PAGES: '3',
        GITHUB_COLLECTION_APP_DEADLINE_MS: '500',
      }),
    ).toMatchObject({ maxPages: 3, deadlineMs: 500 });
    expect(() => CollectionAppConfig.fromEnv({})).toThrow(
      CollectionAppConfigError,
    );
    expect(() =>
      CollectionAppConfig.fromEnv({
        GITHUB_COLLECTION_APP_ID: '1',
        GITHUB_APP_ORG: 'org',
        GITHUB_COLLECTION_APP_PRIVATE_KEY: 'key',
        GITHUB_COLLECTION_APP_MAX_PAGES: '101',
      }),
    ).toThrow(CollectionAppConfigError);
  });
});

describe('CollectionAppTokenProvider', () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const installation = {
    id: 2,
    app_id: 1,
    repository_selection: 'all',
    account: { id: 101, login: 'JNU-SWCU', type: 'Organization' },
    permissions: { metadata: 'read', contents: 'read', pull_requests: 'read' },
  };
  const access = {
    token: 'installation-token',
    expires_at: '2026-01-01T01:00:00Z',
    repository_selection: 'all',
    permissions: installation.permissions,
  };

  it('validates installation scope and caches until the early refresh window', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const fetcher = fetchMock()
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json(access))
      .mockResolvedValueOnce(
        json({
          ...access,
          token: 'refreshed',
          expires_at: '2026-01-01T02:00:00Z',
        }),
      );
    const provider = new CollectionAppTokenProvider(
      { ...config, privateKey },
      fetcher,
      () => now,
    );
    await expect(provider.getToken()).resolves.toBe('installation-token');
    await expect(provider.getInstallationIdentity()).resolves.toEqual({
      appId: '1',
      installationId: '2',
      organizationId: '101',
    });
    await expect(provider.getToken()).resolves.toBe('installation-token');
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = Date.parse('2026-01-01T00:59:01Z');
    await expect(provider.getToken()).resolves.toBe('refreshed');
    await expect(provider.getInstallationIdentity()).resolves.toEqual({
      appId: '1',
      installationId: '2',
      organizationId: '101',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('signs the App JWT with a GitHub-format PKCS#1 private key', async () => {
    const pkcs1Key = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs1', format: 'pem' })
      .toString();
    const fetcher = fetchMock()
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json(access));
    const provider = new CollectionAppTokenProvider(
      { ...config, privateKey: pkcs1Key },
      fetcher,
      () => Date.parse('2026-01-01T00:00:00Z'),
    );
    await expect(provider.getToken()).resolves.toBe('installation-token');
    const authorization = (
      fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>
    ).Authorization;
    expect(authorization).toMatch(/^Bearer [A-Za-z0-9_-]+\./);
  });

  it('bounds token requests and refreshes only once for concurrent callers', async () => {
    const fetcher = fetchMock();
    let resolveInstallation: ((response: Response) => void) | undefined;
    fetcher
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((resolve) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            resolveInstallation = resolve;
          }),
      )
      .mockResolvedValueOnce(json(access));
    const provider = new CollectionAppTokenProvider(
      { ...config, privateKey },
      fetcher,
      () => Date.parse('2026-01-01T00:00:00Z'),
    );
    const first = provider.getToken();
    const second = provider.getToken();
    while (!resolveInstallation) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveInstallation(json(installation));
    await expect(Promise.all([first, second])).resolves.toEqual([
      'installation-token',
      'installation-token',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts an unbounded installation request at the configured deadline', async () => {
    const fetcher = fetchMock().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const provider = new CollectionAppTokenProvider(
      { ...config, privateKey, deadlineMs: 1 },
      fetcher,
      () => Date.parse('2026-01-01T00:00:00Z'),
    );
    await expect(provider.getToken()).rejects.toMatchObject({
      safeReason: 'UPSTREAM',
    });
  });

  it.each([
    [401, 'AUTH'],
    [403, 'PERMISSIONS'],
  ] as const)(
    'classifies token endpoint status %s as %s',
    async (status, safeReason) => {
      const provider = new CollectionAppTokenProvider(
        { ...config, privateKey },
        fetchMock()
          .mockResolvedValueOnce(json(installation))
          .mockResolvedValueOnce(new Response(null, { status })),
        () => Date.parse('2026-01-01T00:00:00Z'),
      );

      await expect(provider.getToken()).rejects.toMatchObject({ safeReason });
    },
  );

  it('classifies token permission-map drift without caching the token', async () => {
    const provider = new CollectionAppTokenProvider(
      { ...config, privateKey },
      fetchMock()
        .mockResolvedValueOnce(json(installation))
        .mockResolvedValueOnce(
          json({
            ...access,
            permissions: { ...access.permissions, issues: 'read' },
          }),
        ),
      () => Date.parse('2026-01-01T00:00:00Z'),
    );

    await expect(provider.getToken()).rejects.toMatchObject({
      safeReason: 'PERMISSIONS',
    });
  });
  const invalidInstallations: ReadonlyArray<
    readonly [unknown, CollectionAppTokenError['safeReason']]
  > = [
    [
      {
        ...installation,
        account: { ...installation.account, login: 'another-org' },
      },
      'INSTALLATION',
    ],
    [
      { ...installation, account: { ...installation.account, id: 0 } },
      'INSTALLATION',
    ],
    [
      { ...installation, account: { ...installation.account, type: 'User' } },
      'INSTALLATION',
    ],
    [{ ...installation, repository_selection: 'selected' }, 'INSTALLATION'],
    [
      {
        ...installation,
        permissions: { ...installation.permissions, issues: 'read' },
      },
      'PERMISSIONS',
    ],
  ];

  it.each(invalidInstallations)(
    'rejects invalid organization identity, selection, and non-exact permissions',
    async (invalid, safeReason) => {
      const provider = new CollectionAppTokenProvider(
        { ...config, privateKey },
        fetchMock().mockResolvedValue(json(invalid)),
        () => Date.parse('2026-01-01T00:00:00Z'),
      );
      await expect(provider.getToken()).rejects.toMatchObject<
        Partial<CollectionAppTokenError>
      >({ safeReason });
    },
  );
});

describe('CollectionAppClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalizes a private installation repository and excludes raw fields', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({ repositories: [repository] }),
    );
    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).listInstallationRepositories();
    expect(result).toEqual([
      {
        id: '42',
        name: 'private-repo',
        fullName: 'JNU-SWCU/private-repo',
        private: true,
        archived: false,
        defaultBranch: 'main',
        ownerLogin: 'JNU-SWCU',
        htmlUrl: 'https://github.test/JNU-SWCU/private-repo',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect(requestUrl).toEqual(
      expect.stringContaining('/installation/repositories?per_page=100'),
    );
    expect(requestInit?.headers).toBeDefined();
  });

  it('uses metadata, default-branch commit, all-state PR, and release REST endpoints', async () => {
    const responses = [
      repository,
      [
        {
          sha: 'abc',
          author: { id: 7, login: 'octocat', email: 'excluded' },
          commit: {
            committer: { date: '2026-01-01T00:00:00Z' },
            message: 'excluded',
          },
          html_url: 'https://github.test/c',
        },
      ],
      [
        {
          id: 3,
          number: 4,
          state: 'closed',
          draft: false,
          merged_at: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          user: null,
          html_url: 'https://github.test/p',
          diff_url: 'excluded',
        },
      ],
      [
        {
          id: 5,
          tag_name: 'v1',
          name: null,
          draft: false,
          prerelease: false,
          published_at: '2026-01-01T00:00:00Z',
          author: { id: '8', login: 'maintainer', email: 'excluded' },
          html_url: 'https://github.test/r',
        },
        {
          id: 6,
          tag_name: 'v2-rc',
          name: null,
          draft: false,
          prerelease: true,
          published_at: '2026-01-01T00:00:00Z',
          author: null,
          html_url: 'https://github.test/r2',
        },
        {
          id: 7,
          tag_name: 'draft',
          name: null,
          draft: true,
          prerelease: false,
          published_at: null,
          author: null,
          html_url: 'https://github.test/r3',
        },
      ],
    ];
    const fetcher = fetchMock().mockImplementation(() =>
      Promise.resolve(json(responses.shift())),
    );
    const client = new CollectionAppClient(config, tokenProvider, fetcher);
    await client.getRepository('JNU-SWCU', 'private-repo');
    expect(
      await client.listDefaultBranchCommits('JNU-SWCU', 'private-repo', 'main'),
    ).toEqual([
      expect.objectContaining({ authorLogin: 'octocat', authorGithubId: '7' }),
    ]);
    expect(await client.listPullRequests('JNU-SWCU', 'private-repo')).toEqual([
      expect.objectContaining({ authorLogin: null, authorGithubId: null }),
    ]);
    expect(
      await client.listPublishedReleases('JNU-SWCU', 'private-repo'),
    ).toEqual([
      expect.objectContaining({
        tagName: 'v1',
        authorLogin: 'maintainer',
        authorGithubId: '8',
      }),
      expect.objectContaining({
        tagName: 'v2-rc',
        authorLogin: null,
        authorGithubId: null,
      }),
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/commits?sha=main&per_page=100'),
        expect.stringContaining('/pulls?state=all&per_page=100'),
        expect.stringContaining('/releases?per_page=100'),
      ]),
    );
  });

  it('treats only commit 409 as an empty repository', async () => {
    const conflict = json(
      { message: 'Git Repository is empty.' },
      { status: 409 },
    );
    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(conflict),
      ).listDefaultBranchCommits('o', 'r', 'main'),
    ).resolves.toEqual([]);
    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(conflict),
      ).getRepository('o', 'r'),
    ).rejects.toMatchObject({ kind: 'UPSTREAM' });
    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(
          json({ message: 'Another conflict' }, { status: 409 }),
        ),
      ).listDefaultBranchCommits('o', 'r', 'main'),
    ).rejects.toMatchObject({ kind: 'UPSTREAM' });
  });

  it('invalidates a resource token on 401 and retries exactly once', async () => {
    const tokens = new CollectionAppTokenProvider(config);
    const getToken = jest
      .spyOn(tokens, 'getToken')
      .mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('fresh');
    const clear = jest.spyOn(tokens, 'clear');
    const fetcher = fetchMock()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json(repository));
    await expect(
      new CollectionAppClient(config, tokens, fetcher).getRepository('o', 'r'),
    ).resolves.toMatchObject({ id: '42' });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not loop when the resource remains unauthorized', async () => {
    const tokens = new CollectionAppTokenProvider(config);
    const getToken = jest.spyOn(tokens, 'getToken').mockResolvedValue('token');
    const fetcher = fetchMock().mockResolvedValue(
      new Response('', { status: 401 }),
    );
    await expect(
      new CollectionAppClient(config, tokens, fetcher).getRepository('o', 'r'),
    ).rejects.toMatchObject({ kind: 'AUTH' });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('classifies non-rate-limit forbidden responses as permission drift', async () => {
    const client = new CollectionAppClient(
      config,
      tokenProvider,
      fetchMock().mockResolvedValue(new Response('', { status: 403 })),
    );
    await expect(client.getRepository('o', 'r')).rejects.toMatchObject({
      kind: 'PERMISSION',
    });
  });

  it.each([
    [429, {}, 'RATE_LIMITED'],
    [403, { 'x-ratelimit-remaining': '0', 'retry-after': '5' }, 'RATE_LIMITED'],
  ])('returns typed safe rate-limit errors', async (status, headers, kind) => {
    const client = new CollectionAppClient(
      config,
      tokenProvider,
      fetchMock().mockResolvedValue(new Response('', { status, headers })),
    );
    await expect(client.getRepository('o', 'r')).rejects.toMatchObject({
      kind,
    });
  });

  it('rejects cross-origin links, cycles, page overflow, malformed IDs, and deadlines', async () => {
    const crossOrigin = json(
      { repositories: [] },
      { headers: { link: '<https://evil.test/x>; rel="next"' } },
    );
    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(crossOrigin),
      ).listInstallationRepositories(),
    ).rejects.toMatchObject({ kind: 'PAGINATION' });
    const malformed = new CollectionAppClient(
      config,
      tokenProvider,
      fetchMock().mockResolvedValue(json({ ...repository, id: 1.2 })),
    );
    await expect(malformed.getRepository('o', 'r')).rejects.toBeInstanceOf(
      CollectionAppClientError,
    );
    const times = [10, 10, 12];
    const deadline = new CollectionAppClient(
      { ...config, deadlineMs: 1 },
      tokenProvider,
      fetchMock(),
      () => times.shift() ?? 12,
    );
    await expect(deadline.getRepository('o', 'r')).rejects.toMatchObject({
      kind: 'DEADLINE',
    });
  });
});

describe('CollectionAppClient incremental contract', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('probeDefaultBranchHead', () => {
    it('skips a full request on 304 for a matching ETag (no-fetch fast path)', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        new Response(null, { status: 304, headers: { etag: '"abc"' } }),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeDefaultBranchHead('o', 'r', 'main', '"abc"'),
      ).resolves.toMatchObject({ changed: false, etag: '"abc"' });
      const [, requestInit] = fetcher.mock.calls[0] ?? [];
      expect(
        (requestInit?.headers as Record<string, string>)['If-None-Match'],
      ).toBe('"abc"');
    });

    it('accepts a 200 with no ETag header (ETag is a nullable optimization only)', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([commitFixture('head1', '2026-01-01T00:00:00Z')]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeDefaultBranchHead('o', 'r', 'main', null),
      ).resolves.toMatchObject({ changed: true, headSha: 'head1', etag: null });
    });

    it('reports headSha null for an empty repository', async () => {
      const fetcher = fetchMock().mockResolvedValue(json([]));
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeDefaultBranchHead('o', 'r', 'main', null),
      ).resolves.toMatchObject({ changed: true, headSha: null });
    });

    it('retries exactly once after invalidating the token on 401', async () => {
      const tokens = new CollectionAppTokenProvider(config);
      jest
        .spyOn(tokens, 'getToken')
        .mockResolvedValueOnce('stale')
        .mockResolvedValueOnce('fresh');
      const clear = jest.spyOn(tokens, 'clear');
      const fetcher = fetchMock()
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(
          json([commitFixture('head1', '2026-01-01T00:00:00Z')]),
        );
      await expect(
        new CollectionAppClient(config, tokens, fetcher).probeDefaultBranchHead(
          'o',
          'r',
          'main',
          null,
        ),
      ).resolves.toMatchObject({ headSha: 'head1' });
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed probe response', async () => {
      const client = new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(json({ not: 'an array' })),
      );
      await expect(
        client.probeDefaultBranchHead('o', 'r', 'main', null),
      ).rejects.toBeInstanceOf(CollectionAppClientError);
    });
  });

  describe('listCommitsUntilKnownSha', () => {
    it('includes an old-dated commit that only recently became reachable and reports a disconnected full scan when no known SHA intersects', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([
          commitFixture('new1', '2026-01-05T00:00:00Z'),
          commitFixture('old-reachable', '2020-01-01T00:00:00Z'),
        ]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listCommitsUntilKnownSha(
        'o',
        'r',
        'main',
        new Set(['not-present']),
      );
      expect(result.commits.map((c) => c.sha)).toEqual([
        'new1',
        'old-reachable',
      ]);
      expect(result.disconnectedFullScan).toBe(true);
    });

    it('stops at the first known SHA without a disconnected scan and without over-fetching', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([
          commitFixture('new1', '2026-01-05T00:00:00Z'),
          commitFixture('known', '2026-01-01T00:00:00Z'),
          commitFixture('older', '2025-01-01T00:00:00Z'),
        ]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listCommitsUntilKnownSha(
        'o',
        'r',
        'main',
        new Set(['known']),
      );
      expect(result.commits.map((c) => c.sha)).toEqual(['new1']);
      expect(result.disconnectedFullScan).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('dedupes repeated commit SHAs caused by pagination drift', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([
          commitFixture('c1', '2026-01-02T00:00:00Z'),
          commitFixture('c1', '2026-01-02T00:00:00Z'),
          commitFixture('c2', '2026-01-01T00:00:00Z'),
        ]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listCommitsUntilKnownSha(
        'o',
        'r',
        'main',
        new Set(),
      );
      expect(result.commits.map((c) => c.sha)).toEqual(['c1', 'c2']);
    });

    it('throws PAGINATION instead of a false disconnected-scan when the page limit is hit before the list truly ends', async () => {
      const limited = { ...config, maxPages: 1 };
      const fetcher = fetchMock().mockResolvedValue(
        json([commitFixture('c1', '2026-01-01T00:00:00Z')], {
          headers: { link: '<https://api.github.test/next>; rel="next"' },
        }),
      );
      const client = new CollectionAppClient(limited, tokenProvider, fetcher);
      await expect(
        client.listCommitsUntilKnownSha('o', 'r', 'main', new Set()),
      ).rejects.toMatchObject({ kind: 'PAGINATION' });
    });

    it('uses a different fingerprint than the head probe so an ETag is never shared', async () => {
      const probe = await new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(
          json([commitFixture('head1', '2026-01-01T00:00:00Z')]),
        ),
      ).probeDefaultBranchHead('o', 'r', 'main', null);
      const traversal = await new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(
          json([commitFixture('head1', '2026-01-01T00:00:00Z')]),
        ),
      ).listCommitsUntilKnownSha('o', 'r', 'main', new Set());
      expect(requestFingerprintKey(probe.fingerprint)).not.toEqual(
        requestFingerprintKey(traversal.fingerprint),
      );
    });
  });

  describe('listNewPullRequests', () => {
    it('resolves createdAt ties by id and stops once the (createdAt,id) tie frontier is met, across a page boundary', async () => {
      const fetcher = fetchMock()
        .mockResolvedValueOnce(
          json(
            [
              prFixture(9, '2026-01-02T00:00:00Z'),
              prFixture(8, '2026-01-01T00:00:00Z'),
            ],
            { headers: { link: '<https://api.github.test/next>; rel="next"' } },
          ),
        )
        .mockResolvedValueOnce(
          json([
            prFixture(7, '2026-01-01T00:00:00Z'),
            prFixture(6, '2025-01-01T00:00:00Z'),
          ]),
        );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listNewPullRequests('o', 'r', {
        createdAt: '2026-01-01T00:00:00Z',
        id: '7',
      });
      expect(result.pullRequests.map((p) => p.id)).toEqual(['9', '8']);
      expect(result.newFrontier).toEqual({
        createdAt: '2026-01-02T00:00:00Z',
        id: '9',
      });
    });

    it('reads every page when the frontier is null (first-ever backfill)', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([prFixture(1, '2026-01-01T00:00:00Z')]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listNewPullRequests('o', 'r', null);
      expect(result.pullRequests.map((p) => p.id)).toEqual(['1']);
      expect(fetcher.mock.calls[0]?.[0]).toEqual(
        expect.stringContaining('state=all&sort=created&direction=desc'),
      );
    });

    it('dedupes repeated PR ids caused by pagination drift', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([
          prFixture(5, '2026-01-01T00:00:00Z'),
          prFixture(5, '2026-01-01T00:00:00Z'),
        ]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listNewPullRequests('o', 'r', null);
      expect(result.pullRequests.map((p) => p.id)).toEqual(['5']);
    });

    it('classifies rate-limit responses', async () => {
      const client = new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(new Response('', { status: 429 })),
      );
      await expect(
        client.listNewPullRequests('o', 'r', null),
      ).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    });
  });

  describe('release probe and changed listing', () => {
    it('skips the full listing on 304 for a matching ETag', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        new Response(null, { status: 304, headers: { etag: '"r1"' } }),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeLatestRelease('o', 'r', '"r1"'),
      ).resolves.toMatchObject({ changed: false, etag: '"r1"' });
    });

    it('reports a stable probe frontier and accepts a 200 with no ETag', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([releaseFixture(9, false, '2026-01-02T00:00:00Z')]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeLatestRelease('o', 'r', null),
      ).resolves.toMatchObject({
        changed: true,
        etag: null,
        frontier: { probe: '9:false:2026-01-02T00:00:00Z' },
      });
    });

    it('reports a null frontier probe for a repository with no releases', async () => {
      const fetcher = fetchMock().mockResolvedValue(json([]));
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      await expect(
        client.probeLatestRelease('o', 'r', null),
      ).resolves.toMatchObject({ changed: true, frontier: null });
    });

    it('includes a previously-draft release that has since published and dedupes repeated IDs from pagination drift', async () => {
      const fetcher = fetchMock().mockResolvedValue(
        json([
          releaseFixture(5, false, '2026-01-01T00:00:00Z'),
          releaseFixture(5, false, '2026-01-01T00:00:00Z'),
          releaseFixture(9, false, '2026-01-02T00:00:00Z'),
        ]),
      );
      const client = new CollectionAppClient(config, tokenProvider, fetcher);
      const result = await client.listChangedPublishedReleases('o', 'r');
      expect(result.releases.map((r) => r.id)).toEqual(['5', '9']);
    });

    it('uses a different fingerprint for the probe and the full listing so an ETag is never shared', async () => {
      const probe = await new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(
          json([releaseFixture(9, false, '2026-01-02T00:00:00Z')]),
        ),
      ).probeLatestRelease('o', 'r', null);
      const listing = await new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(
          json([releaseFixture(9, false, '2026-01-02T00:00:00Z')]),
        ),
      ).listChangedPublishedReleases('o', 'r');
      expect(requestFingerprintKey(probe.fingerprint)).not.toEqual(
        requestFingerprintKey(listing.fingerprint),
      );
    });
  });
});
describe('CollectionAppClient author-filtered commit history (GraphQL)', () => {
  beforeEach(() => jest.clearAllMocks());

  const graphqlConfig: CollectionAppConfigValues = {
    ...config,
    graphqlUrl: 'https://api.github.test/graphql',
  };
  const historyNode = (
    oid: string,
    user: unknown = { databaseId: 7, login: 'octocat' },
  ) => ({
    oid,
    committedDate: '2026-01-01T00:00:00Z',
    commitUrl: `https://github.test/${oid}`,
    author: { user },
  });
  const historyBody = (
    nodes: unknown[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
      hasNextPage: false,
      endCursor: null,
    },
  ) =>
    json({
      data: {
        repository: { ref: { target: { history: { nodes, pageInfo } } } },
      },
    });
  const sentPayload = (
    fetcher: Fetcher,
    call = 0,
  ): { query: string; variables: Record<string, unknown> } => {
    const body = fetcher.mock.calls[call]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('expected a JSON body');
    return JSON.parse(body) as {
      query: string;
      variables: Record<string, unknown>;
    };
  };

  it('sends the author filter to the configured GraphQL endpoint and maps nodes to CollectionCommit', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      historyBody([historyNode('abc')]),
    );
    const commits = await new CollectionAppClient(
      graphqlConfig,
      tokenProvider,
      fetcher,
    ).listDefaultBranchCommitsByAuthor(
      'JNU-SWCU',
      'oss-hub',
      'main',
      'MDQ6VXNlcjc=',
      '2026-01-01T00:00:00Z',
    );
    expect(commits).toEqual([
      {
        sha: 'abc',
        authorLogin: 'octocat',
        authorGithubId: '7',
        committedAt: '2026-01-01T00:00:00Z',
        htmlUrl: 'https://github.test/abc',
      },
    ]);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toEqual('https://api.github.test/graphql');
    expect(init?.method).toEqual('POST');
    const payload = sentPayload(fetcher);
    // The whole point of this path: the server-side author filter must be
    // on the wire, otherwise this degrades into a full-history scan.
    expect(payload.query).toContain('author: { id: $authorId }');
    expect(payload.variables).toMatchObject({
      owner: 'JNU-SWCU',
      name: 'oss-hub',
      branch: 'main',
      authorId: 'MDQ6VXNlcjc=',
      since: '2026-01-01T00:00:00Z',
      cursor: null,
    });
  });

  it('follows endCursor while hasNextPage is true and dedupes by sha', async () => {
    const fetcher = fetchMock()
      .mockResolvedValueOnce(
        historyBody([historyNode('abc'), historyNode('def')], {
          hasNextPage: true,
          endCursor: 'CURSOR-1',
        }),
      )
      .mockResolvedValueOnce(
        historyBody([historyNode('def'), historyNode('ghi')]),
      );
    const commits = await new CollectionAppClient(
      graphqlConfig,
      tokenProvider,
      fetcher,
    ).listDefaultBranchCommitsByAuthor('o', 'r', 'main', 'NODE');
    expect(commits.map((c) => c.sha)).toEqual(['abc', 'def', 'ghi']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sentPayload(fetcher, 0).variables.cursor).toBeNull();
    expect(sentPayload(fetcher, 1).variables.cursor).toEqual('CURSOR-1');
    expect(sentPayload(fetcher, 1).variables.since).toBeNull();
  });

  it('stops at the configured page cap instead of looping forever', async () => {
    // A single `Response` body can only be consumed once, so build a fresh
    // one per call.
    const fetcher = fetchMock().mockImplementation(() =>
      Promise.resolve(
        historyBody([historyNode('abc')], {
          hasNextPage: true,
          endCursor: 'CURSOR',
        }),
      ),
    );
    await expect(
      new CollectionAppClient(
        { ...graphqlConfig, maxPages: 3 },
        tokenProvider,
        fetcher,
      ).listDefaultBranchCommitsByAuthor('o', 'r', 'main', 'NODE'),
    ).rejects.toMatchObject({ kind: 'PAGINATION' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array when the branch ref does not exist', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({ data: { repository: { ref: null } } }),
    );
    await expect(
      new CollectionAppClient(
        graphqlConfig,
        tokenProvider,
        fetcher,
      ).listDefaultBranchCommitsByAuthor('o', 'r', 'missing', 'NODE'),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps a commit with no linked GitHub account to null author identity', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      historyBody([historyNode('abc', null)]),
    );
    await expect(
      new CollectionAppClient(
        graphqlConfig,
        tokenProvider,
        fetcher,
      ).listDefaultBranchCommitsByAuthor('o', 'r', 'main', 'NODE'),
    ).resolves.toEqual([
      expect.objectContaining({
        sha: 'abc',
        authorLogin: null,
        authorGithubId: null,
      }),
    ]);
  });

  it.each([
    [[{ message: 'Something went wrong' }], 'GRAPHQL_ERROR'],
    [
      [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      'RATE_LIMITED',
    ],
  ])(
    'throws on a 200 response carrying GraphQL errors',
    async (errors, kind) => {
      const fetcher = fetchMock().mockResolvedValue(
        json({ data: null, errors }),
      );
      await expect(
        new CollectionAppClient(
          graphqlConfig,
          tokenProvider,
          fetcher,
        ).listDefaultBranchCommitsByAuthor('o', 'r', 'main', 'NODE'),
      ).rejects.toMatchObject({ kind });
    },
  );

  it('resolves a login to its node ID and reports an unknown login as null', async () => {
    const found = fetchMock().mockResolvedValue(
      json({ data: { user: { id: 'MDQ6VXNlcjc=' } } }),
    );
    await expect(
      new CollectionAppClient(
        graphqlConfig,
        tokenProvider,
        found,
      ).resolveUserNodeId('octocat'),
    ).resolves.toEqual('MDQ6VXNlcjc=');
    expect(sentPayload(found).variables).toEqual({ login: 'octocat' });
    await expect(
      new CollectionAppClient(
        graphqlConfig,
        tokenProvider,
        fetchMock().mockResolvedValue(json({ data: { user: null } })),
      ).resolveUserNodeId('ghost'),
    ).resolves.toBeNull();
  });

  it('defaults the GraphQL endpoint when no override is configured', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({ data: { user: { id: 'NODE' } } }),
    );
    await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).resolveUserNodeId('octocat');
    expect(fetcher.mock.calls[0]?.[0]).toEqual(
      'https://api.github.com/graphql',
    );
  });
});
