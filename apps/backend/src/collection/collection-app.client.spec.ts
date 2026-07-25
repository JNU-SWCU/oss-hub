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
