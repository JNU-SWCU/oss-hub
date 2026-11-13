import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CollectionAppClient,
  type CollectionContributionKind,
} from './collection-app.client';
import {
  CollectionAppConfig,
  CollectionAppConfigError,
  CollectionAppConfigValues,
} from './collection-app.config';
import { CollectionAppTokenClient } from './collection-app-token.client';
import { CollectionAppTokenError } from './collection-app-token.error';
import { CollectionAppClientError } from './collection-app.error';

const config: CollectionAppConfigValues = {
  appId: '1',
  orgLogin: 'JNU-SWCU',
  privateKey: 'unused',
  apiBaseUrl: 'https://api.github.test',
  maxPages: 100,
  deadlineMs: 30_000,
  graphqlUrl: 'https://api.github.test/graphql',
};

type Fetcher = jest.Mock<
  Promise<Response>,
  [input: string | URL, init?: RequestInit]
>;
const fetchMock = (): Fetcher =>
  jest.fn<Promise<Response>, [input: string | URL, init?: RequestInit]>();
const tokenProvider = new CollectionAppTokenClient(config);
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
  it('validates required values and uses fixed collection limits', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collection-config-'));
    const privateKeyFile = join(workspace, 'collection.pem');
    writeFileSync(
      privateKeyFile,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    );
    try {
      expect(
        CollectionAppConfig.fromEnv({
          GITHUB_COLLECTION_APP_ID: '1',
          GITHUB_APP_ORG: 'JNU-SWCU',
          GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE: privateKeyFile,
        }),
      ).toMatchObject({
        apiBaseUrl: 'https://api.github.com',
        maxPages: 100,
        deadlineMs: 30_000,
      });
      expect(() => CollectionAppConfig.fromEnv({})).toThrow(
        CollectionAppConfigError,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('CollectionAppTokenClient', () => {
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
    const provider = new CollectionAppTokenClient(
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
    const provider = new CollectionAppTokenClient(
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
    const provider = new CollectionAppTokenClient(
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
    const provider = new CollectionAppTokenClient(
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
      const provider = new CollectionAppTokenClient(
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
    const provider = new CollectionAppTokenClient(
      { ...config, privateKey },
      fetchMock()
        .mockResolvedValueOnce(json(installation))
        .mockResolvedValueOnce(
          json({
            ...access,
            permissions: { ...access.permissions, issues: 'write' },
          }),
        ),
      () => Date.parse('2026-01-01T00:00:00Z'),
    );

    await expect(provider.getToken()).rejects.toMatchObject({
      safeReason: 'PERMISSIONS',
    });
  });

  it('accepts the optional Issues read permission so granting it does not halt collection', async () => {
    const withIssues = { ...installation.permissions, issues: 'read' };
    const provider = new CollectionAppTokenClient(
      { ...config, privateKey },
      fetchMock()
        .mockResolvedValueOnce(
          json({ ...installation, permissions: withIssues }),
        )
        .mockResolvedValueOnce(json({ ...access, permissions: withIssues })),
      () => Date.parse('2026-01-01T00:00:00Z'),
    );

    await expect(provider.getToken()).resolves.toBe('installation-token');
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
        permissions: { ...installation.permissions, issues: 'write' },
      },
      'PERMISSIONS',
    ],
    [
      {
        ...installation,
        permissions: { ...installation.permissions, administration: 'read' },
      },
      'PERMISSIONS',
    ],
    [
      {
        ...installation,
        permissions: { metadata: 'read', contents: 'read', issues: 'read' },
      },
      'PERMISSIONS',
    ],
  ];

  it.each(invalidInstallations)(
    'rejects invalid organization identity, selection, and permissions outside the allowlist',
    async (invalid, safeReason) => {
      const provider = new CollectionAppTokenClient(
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

type GraphqlPayload = {
  query: string;
  variables: Record<string, unknown>;
};
const payloadOf = (fetcher: Fetcher, call = 0): GraphqlPayload =>
  JSON.parse(fetcher.mock.calls[call]?.[1]?.body as string) as GraphqlPayload;
const page = (nodes: unknown[], endCursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});
const probeNode = (index: number, overrides: Record<string, unknown> = {}) => ({
  databaseId: 1000 + index,
  nameWithOwner: `JNU-SWCU/repo-${index}`,
  isArchived: false,
  isPrivate: true,
  defaultBranchRef: { name: 'main' },
  pushedAt: '2026-11-14T00:00:00Z',
  issues: { nodes: [{ updatedAt: '2026-11-13T00:00:00Z' }] },
  pullRequests: { nodes: [] },
  releases: {
    nodes: [
      {
        createdAt: '2026-11-12T00:00:00Z',
        publishedAt: '2026-11-12T01:00:00Z',
      },
    ],
  },
  ...overrides,
});
const contributionsBody = (
  repository: Record<string, unknown>,
  rateLimit = { cost: 1, remaining: 4999 },
) => json({ data: { rateLimit, repository } });
const emptyRepository = (overrides: Record<string, unknown> = {}) => ({
  ref: { target: { history: page([]) } },
  pullRequests: page([]),
  issues: page([]),
  releases: page([]),
  ...overrides,
});

describe('CollectionAppClient REST metadata', () => {
  beforeEach(() => jest.clearAllMocks());

  it('id로 저장소 metadata를 읽고 원본 필드는 버린다', async () => {
    const fetcher = fetchMock().mockResolvedValue(json(repository));
    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).getRepositoryById(42n);

    expect(result).toEqual({
      id: '42',
      fullName: 'JNU-SWCU/private-repo',
      private: true,
      archived: false,
      defaultBranch: 'main',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.github.test/repositories/42',
    );
  });

  it('커밋이 없는 저장소의 null 기본 브랜치를 보존한다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({ ...repository, default_branch: null }),
    );

    await expect(
      new CollectionAppClient(config, tokenProvider, fetcher).getRepositoryById(
        42n,
      ),
    ).resolves.toMatchObject({ defaultBranch: null });
  });

  it.each([
    [404, {}, 'NOT_FOUND'],
    [403, {}, 'PERMISSION'],
    [429, {}, 'RATE_LIMITED'],
    [403, { 'x-ratelimit-remaining': '0' }, 'RATE_LIMITED'],
    [500, {}, 'UPSTREAM'],
  ])('HTTP %s 응답을 안전한 오류로 분류한다', async (status, headers, kind) => {
    const client = new CollectionAppClient(
      config,
      tokenProvider,
      fetchMock().mockResolvedValue(new Response('', { status, headers })),
    );

    await expect(client.getRepositoryById(42n)).rejects.toMatchObject({
      kind,
    });
  });

  it('401이면 토큰을 비우고 정확히 한 번만 다시 시도한다', async () => {
    const tokens = new CollectionAppTokenClient(config);
    const getToken = jest
      .spyOn(tokens, 'getToken')
      .mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('fresh');
    const clear = jest.spyOn(tokens, 'clear');
    const fetcher = fetchMock()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json(repository));

    await expect(
      new CollectionAppClient(config, tokens, fetcher).getRepositoryById(42n),
    ).resolves.toMatchObject({ id: '42' });
    expect(clear).toHaveBeenCalledWith('stale');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('계속 401이면 반복하지 않고 AUTH로 끝난다', async () => {
    const tokens = new CollectionAppTokenClient(config);
    jest.spyOn(tokens, 'getToken').mockResolvedValue('token');
    const fetcher = fetchMock().mockResolvedValue(
      new Response('', { status: 401 }),
    );

    await expect(
      new CollectionAppClient(config, tokens, fetcher).getRepositoryById(42n),
    ).rejects.toMatchObject({ kind: 'AUTH' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('잘못된 id와 마감 시간 초과를 거부한다', async () => {
    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetchMock().mockResolvedValue(json({ ...repository, id: 1.2 })),
      ).getRepositoryById(42n),
    ).rejects.toBeInstanceOf(CollectionAppClientError);
    const times = [10, 10, 12];
    await expect(
      new CollectionAppClient(
        { ...config, deadlineMs: 1 },
        tokenProvider,
        fetchMock(),
        () => times.shift() ?? 12,
      ).getRepositoryById(42n),
    ).rejects.toMatchObject({ kind: 'DEADLINE' });
  });
});

describe('CollectionAppClient probeRepositories', () => {
  beforeEach(() => jest.clearAllMocks());

  it('대상이 없으면 요청하지 않는다', async () => {
    const fetcher = fetchMock();

    await expect(
      new CollectionAppClient(config, tokenProvider, fetcher).probeRepositories(
        [],
      ),
    ).resolves.toEqual({ repositories: [], rateLimit: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('저장소마다 alias를 붙여 한 번의 GraphQL 요청으로 활동 시각을 읽는다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({
        data: {
          rateLimit: { cost: 1, remaining: 4990 },
          r0: probeNode(0),
          r1: probeNode(1, {
            defaultBranchRef: null,
            pushedAt: null,
            issues: { nodes: [] },
            releases: {
              nodes: [{ createdAt: '2026-11-10T00:00:00Z', publishedAt: null }],
            },
          }),
        },
      }),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).probeRepositories([
      { owner: 'JNU-SWCU', name: 'repo-0' },
      { owner: 'JNU-SWCU', name: 'repo-1' },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(config.graphqlUrl);
    const payload = payloadOf(fetcher);
    expect(payload.variables).toEqual({
      o0: 'JNU-SWCU',
      n0: 'repo-0',
      o1: 'JNU-SWCU',
      n1: 'repo-1',
    });
    expect(payload.query).toContain('r0: repository(owner: $o0, name: $n0)');
    expect(payload.query).toContain('r1: repository(owner: $o1, name: $n1)');
    expect(result.rateLimit).toEqual({ cost: 1, remaining: 4990 });
    expect(result.repositories).toEqual([
      {
        githubRepositoryId: '1000',
        nameWithOwner: 'JNU-SWCU/repo-0',
        defaultBranch: 'main',
        archived: false,
        private: true,
        activityAt: [
          new Date('2026-11-14T00:00:00Z'),
          new Date('2026-11-13T00:00:00Z'),
          new Date('2026-11-12T00:00:00Z'),
          new Date('2026-11-12T01:00:00Z'),
        ],
      },
      expect.objectContaining({
        githubRepositoryId: '1001',
        defaultBranch: null,
        activityAt: [new Date('2026-11-10T00:00:00Z')],
      }),
    ]);
  });

  it('alias 하나가 NOT_FOUND여도 그 alias만 null이고 나머지 99개는 그대로 읽는다', async () => {
    const data: Record<string, unknown> = {
      rateLimit: { cost: 1, remaining: 4000 },
    };
    for (let index = 0; index < 100; index += 1) {
      data[`r${index}`] = index === 37 ? null : probeNode(index);
    }
    const fetcher = fetchMock().mockResolvedValue(
      json({
        data,
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['r37'],
            message: 'Could not resolve to a Repository',
          },
        ],
      }),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).probeRepositories(
      Array.from({ length: 100 }, (_, index) => ({
        owner: 'JNU-SWCU',
        name: `repo-${index}`,
      })),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.repositories).toHaveLength(100);
    expect(result.repositories[37]).toBeNull();
    expect(result.repositories.filter((item) => item !== null)).toHaveLength(
      99,
    );
    expect(result.repositories[38]).toMatchObject({
      githubRepositoryId: '1038',
    });
  });

  it('alias에 오류가 있으면 데이터가 남아 있어도 그 alias 전체를 오류로 본다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({
        data: { rateLimit: null, r0: probeNode(0), r1: probeNode(1) },
        errors: [{ type: 'FORBIDDEN', path: ['r1', 'issues'] }],
      }),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).probeRepositories([
      { owner: 'JNU-SWCU', name: 'repo-0' },
      { owner: 'JNU-SWCU', name: 'repo-1' },
    ]);

    expect(result.repositories[0]).not.toBeNull();
    expect(result.repositories[1]).toBeNull();
  });

  it('RATE_LIMITED GraphQL 오류는 실행 전체 실패로 올린다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({
        data: { r0: null },
        errors: [{ type: 'RATE_LIMITED', path: ['r0'] }],
      }),
    );

    await expect(
      new CollectionAppClient(config, tokenProvider, fetcher).probeRepositories(
        [{ owner: 'JNU-SWCU', name: 'repo-0' }],
      ),
    ).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
  });

  it('alias에 속하지 않는 오류는 GRAPHQL_ERROR로 실패한다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({ errors: [{ message: 'Something went wrong' }] }),
    );

    await expect(
      new CollectionAppClient(config, tokenProvider, fetcher).probeRepositories(
        [{ owner: 'JNU-SWCU', name: 'repo-0' }],
      ),
    ).rejects.toMatchObject({ kind: 'GRAPHQL_ERROR' });
  });
});

describe('CollectionAppClient collectRepositoryContributions', () => {
  beforeEach(() => jest.clearAllMocks());

  const since = new Date('2026-11-01T00:00:00Z');

  it('100건 이하이면 저장소당 한 번의 요청으로 네 종류를 모두 읽는다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      contributionsBody(
        emptyRepository({
          ref: {
            target: {
              history: page([
                {
                  oid: 'abc',
                  committedDate: '2026-11-05T00:00:00Z',
                  author: { user: { databaseId: 7 } },
                },
                {
                  oid: 'def',
                  committedDate: '2026-11-04T00:00:00Z',
                  author: { user: null },
                },
              ]),
            },
          },
          pullRequests: page([
            {
              fullDatabaseId: '300',
              createdAt: '2026-11-03T00:00:00Z',
              author: { databaseId: 8 },
            },
            {
              fullDatabaseId: '299',
              createdAt: '2026-10-31T23:59:59Z',
              author: { databaseId: 8 },
            },
          ]),
          issues: page([
            {
              fullDatabaseId: '400',
              createdAt: '2026-11-02T00:00:00Z',
              author: null,
            },
          ]),
          releases: page([
            {
              databaseId: 500,
              createdAt: '2026-11-06T00:00:00Z',
              publishedAt: '2026-11-07T00:00:00Z',
              isDraft: false,
              author: { databaseId: 9 },
            },
            {
              databaseId: 501,
              createdAt: '2026-11-06T00:00:00Z',
              publishedAt: null,
              isDraft: true,
              author: null,
            },
          ]),
        }),
        { cost: 1, remaining: 4321 },
      ),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = payloadOf(fetcher);
    expect(payload.variables).toMatchObject({
      owner: 'JNU-SWCU',
      name: 'repo',
      branch: 'main',
      since: '2026-11-01T00:00:00.000Z',
      issueSince: '2026-11-01T00:00:00.000Z',
      withCommits: true,
      withPullRequests: true,
      withIssues: true,
      withReleases: true,
    });
    expect(payload.query).not.toMatch(/history\([^)]*author:/);
    expect(result).toEqual({
      contributions: {
        commit: [
          {
            githubKey: 'abc',
            authorGithubId: '7',
            occurredAt: new Date('2026-11-05T00:00:00Z'),
          },
          {
            githubKey: 'def',
            authorGithubId: null,
            occurredAt: new Date('2026-11-04T00:00:00Z'),
          },
        ],
        pull_request: [
          {
            githubKey: '300',
            authorGithubId: '8',
            occurredAt: new Date('2026-11-03T00:00:00Z'),
          },
        ],
        issue: [
          {
            githubKey: '400',
            authorGithubId: null,
            occurredAt: new Date('2026-11-02T00:00:00Z'),
          },
        ],
        release: [
          {
            githubKey: '500',
            authorGithubId: '9',
            occurredAt: new Date('2026-11-07T00:00:00Z'),
          },
        ],
      },
      requests: 1,
      pointsUsed: 1,
      rateLimit: { cost: 1, remaining: 4321 },
    });
  });

  it('기본 브랜치가 없으면 커밋은 요청하지 않는다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      contributionsBody(emptyRepository({ ref: undefined })),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).collectRepositoryContributions('JNU-SWCU', 'repo', null, since);

    expect(payloadOf(fetcher).variables).toMatchObject({
      withCommits: false,
      withPullRequests: true,
    });
    expect(result.contributions.commit).toEqual([]);
  });

  it('100건을 넘는 종류만 cursor로 이어 읽고 중복 key는 한 번만 남긴다', async () => {
    const pr = (id: string) => ({
      fullDatabaseId: id,
      createdAt: '2026-11-03T00:00:00Z',
      author: null,
    });
    const fetcher = fetchMock()
      .mockResolvedValueOnce(
        contributionsBody(
          emptyRepository({ pullRequests: page([pr('3'), pr('2')], 'c1') }),
        ),
      )
      .mockResolvedValueOnce(
        contributionsBody({ pullRequests: page([pr('2'), pr('1')]) }),
      );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(payloadOf(fetcher, 1).variables).toMatchObject({
      withCommits: false,
      withPullRequests: true,
      withIssues: false,
      withReleases: false,
      pullRequestCursor: 'c1',
    });
    expect(
      result.contributions.pull_request.map((item) => item.githubKey),
    ).toEqual(['3', '2', '1']);
    expect(result.requests).toBe(2);
    expect(result.pointsUsed).toBe(2);
  });

  it('since보다 오래된 항목을 만나면 다음 페이지를 읽지 않는다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      contributionsBody(
        emptyRepository({
          issues: page(
            [
              {
                fullDatabaseId: '9',
                createdAt: '2026-10-01T00:00:00Z',
                author: null,
              },
            ],
            'more',
          ),
        }),
      ),
    );

    const result = await new CollectionAppClient(
      config,
      tokenProvider,
      fetcher,
    ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.contributions.issue).toEqual([]);
  });

  it('페이지 상한에 닿으면 잘린 결과 대신 PAGINATION으로 실패한다', async () => {
    const fetcher = fetchMock().mockImplementation(() =>
      Promise.resolve(
        contributionsBody(
          emptyRepository({
            ref: {
              target: {
                history: page(
                  [
                    {
                      oid: `sha-${fetcher.mock.calls.length}`,
                      committedDate: '2026-11-05T00:00:00Z',
                      author: null,
                    },
                  ],
                  'next',
                ),
              },
            },
          }),
        ),
      ),
    );

    await expect(
      new CollectionAppClient(
        { ...config, maxPages: 3 },
        tokenProvider,
        fetcher,
      ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since),
    ).rejects.toMatchObject({ kind: 'PAGINATION' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('마감 시간은 페이지마다 따로 재서 여러 페이지를 끝까지 읽는다', async () => {
    let now = 0;
    const fetcher = fetchMock().mockImplementation(() => {
      now += 20;
      return Promise.resolve(
        contributionsBody(
          emptyRepository({
            issues: page([], fetcher.mock.calls.length < 4 ? 'next' : null),
          }),
        ),
      );
    });

    await new CollectionAppClient(
      { ...config, deadlineMs: 30 },
      tokenProvider,
      fetcher,
      () => now,
    ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('한 페이지가 마감 시간을 넘기면 DEADLINE으로 실패한다', async () => {
    let now = 0;
    const fetcher = fetchMock().mockImplementation(() => {
      if (fetcher.mock.calls.length > 1) {
        now += 40;
        return Promise.reject(new Error('aborted'));
      }
      now += 20;
      return Promise.resolve(
        contributionsBody(emptyRepository({ issues: page([], 'next') })),
      );
    });

    await expect(
      new CollectionAppClient(
        { ...config, deadlineMs: 30 },
        tokenProvider,
        fetcher,
        () => now,
      ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since),
    ).rejects.toMatchObject({ kind: 'DEADLINE' });
  });

  it.each<[CollectionContributionKind, Record<string, unknown>]>([
    ['pull_request', { pullRequests: { nodes: 'bad', pageInfo: {} } }],
    ['release', { releases: page([{ databaseId: 1.5, isDraft: false }]) }],
  ])('%s 응답 모양이 다르면 RESPONSE로 실패한다', async (_kind, override) => {
    const fetcher = fetchMock().mockResolvedValue(
      contributionsBody(emptyRepository(override)),
    );

    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetcher,
      ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since),
    ).rejects.toBeInstanceOf(CollectionAppClientError);
  });

  it('strict 요청에서는 GraphQL 오류를 데이터로 넘기지 않는다', async () => {
    const fetcher = fetchMock().mockResolvedValue(
      json({
        data: { repository: null },
        errors: [{ type: 'NOT_FOUND', path: ['repository'] }],
      }),
    );

    await expect(
      new CollectionAppClient(
        config,
        tokenProvider,
        fetcher,
      ).collectRepositoryContributions('JNU-SWCU', 'repo', 'main', since),
    ).rejects.toMatchObject({ kind: 'GRAPHQL_ERROR' });
  });
});
