import { CollectionCanonicalRepository } from './collection-canonical.repository';
import type { CanonicalLeaseToken } from './collection-canonical.types';
import type { PrismaService } from '../prisma/prisma.service';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const TOKEN: CanonicalLeaseToken = {
  appId: 1n,
  organizationLogin: 'org',
  ownerId: 'worker-a',
  epoch: 4n,
  runId: 'candidate-1',
  expiresAt: new Date('2026-07-25T12:01:00.000Z'),
};

type ExecuteRawMock = jest.Mock<
  Promise<number>,
  [sql: string, ...values: unknown[]]
>;
type QueryRawMock = jest.Mock<
  Promise<unknown>,
  [sql: string, ...values: unknown[]]
>;

interface MockRawClient {
  $queryRawUnsafe: QueryRawMock;
  $executeRawUnsafe: ExecuteRawMock;
  $transaction<T>(
    operation: (transaction: MockRawClient) => Promise<T>,
  ): Promise<T>;
}

const createDb = (): MockRawClient => {
  const db: MockRawClient = {
    $queryRawUnsafe: jest.fn<
      Promise<unknown>,
      [sql: string, ...values: unknown[]]
    >(),
    $executeRawUnsafe: jest.fn<
      Promise<number>,
      [sql: string, ...values: unknown[]]
    >(),
    $transaction: (operation) => operation(db),
  };
  return db;
};

const repositoryFor = (db: MockRawClient): CollectionCanonicalRepository =>
  new CollectionCanonicalRepository(db as unknown as PrismaService);

describe('CollectionCanonicalRepository fencing and publication', () => {
  it('rejects normalized writes by a stale owner before mutating inventory', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(
      repositoryFor(db).writeGeneration(TOKEN, NOW, {
        repositories: [],
        commits: [],
        pullRequests: [],
        releases: [],
        contributors: [],
      }),
    ).rejects.toThrow('lease is stale');

    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('writes candidates in bounded fenced batches with heartbeat opportunities', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValue(1);
    const heartbeat = jest.fn().mockResolvedValue(undefined);
    const repositories = Array.from({ length: 201 }, (_, index) => ({
      githubRepositoryId: BigInt(index + 1),
      fullName: `org/repository-${index + 1}`,
      visibility: 'public' as const,
      archived: false,
      defaultBranch: 'main',
    }));

    await repositoryFor(db).writeGeneration(
      TOKEN,
      () => NOW,
      {
        repositories,
        commits: [],
        pullRequests: [],
        releases: [],
        contributors: [],
      },
      heartbeat,
    );

    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(202);
  });

  it('stops before the next batch on lease loss without publishing', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValue(1);
    const heartbeat = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Canonical collection lease is stale'));

    await expect(
      repositoryFor(db).writeGeneration(
        TOKEN,
        () => NOW,
        {
          repositories: [
            {
              githubRepositoryId: 1n,
              fullName: 'org/repository',
              visibility: 'public',
              archived: false,
              defaultBranch: 'main',
            },
          ],
          commits: [],
          pullRequests: [],
          releases: [],
          contributors: [],
        },
        heartbeat,
      ),
    ).rejects.toThrow('lease is stale');

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.$executeRawUnsafe.mock.calls[0]?.[0]).not.toContain(
      'activeGenerationId',
    );
  });

  it('publishes only after the processing candidate completes', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValue(1);

    await repositoryFor(db).completeAndPublish(TOKEN, NOW);

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    const firstSql = db.$executeRawUnsafe.mock.calls.at(0)?.[0];
    const secondSql = db.$executeRawUnsafe.mock.calls.at(1)?.[0];
    expect(firstSql).toContain(`"status" = 'SUCCEEDED'`);
    expect(firstSql).toContain(`"status" = 'PROCESSING'`);
    expect(secondSql).toContain('"activeGenerationId" = $3');
  });

  it('does not replace the prior active pointer when completion is rejected', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValueOnce(0);

    await expect(
      repositoryFor(db).completeAndPublish(TOKEN, NOW),
    ).rejects.toThrow('not publishable');

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(
      db.$executeRawUnsafe.mock.calls.some(([sql]) =>
        String(sql).includes('activeGenerationId'),
      ),
    ).toBe(false);
  });

  it('finalizes failure without touching the active generation pointer', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValue(1);

    await repositoryFor(db).finalizeFailure(
      TOKEN,
      NOW,
      'INCOMPLETE',
      'PAGE_BUDGET',
    );

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(db.$executeRawUnsafe.mock.calls.at(0)?.[0]).not.toContain(
      'activeGenerationId',
    );
  });
  it('persists permission drift monotonically without replacing the active pointer', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ owned: true }]);
    db.$executeRawUnsafe.mockResolvedValue(1);

    await repositoryFor(db).finalizeFailure(
      TOKEN,
      NOW,
      'INCOMPLETE',
      'COLLECTION_APP_PERMISSION',
      { installationValid: true, permissionsValid: false },
    );

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    const validitySql = String(db.$executeRawUnsafe.mock.calls.at(1)?.[0]);
    expect(validitySql).toContain('"permissionsValid" = $4');
    expect(validitySql).toContain('"permissionsCheckedAt" <= $5');
    expect(validitySql).not.toContain('activeGenerationId');
  });
  it('rejects contributor projection rows for private repositories before writing', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).writeGeneration(TOKEN, NOW, {
        repositories: [
          {
            githubRepositoryId: 10n,
            fullName: 'org/private-repository',
            visibility: 'private',
            archived: false,
            defaultBranch: 'main',
          },
        ],
        commits: [],
        pullRequests: [],
        releases: [],
        contributors: [
          {
            githubRepositoryId: 10n,
            githubUserId: 20n,
            githubLogin: 'contributor',
            commitCount: 1,
            pullRequestCount: 0,
            releaseCount: 0,
            currentYear: 2026,
            currentYearCommitCount: 1,
            currentYearPullRequestCount: 0,
            currentYearReleaseCount: 0,
          },
        ],
      }),
    ).rejects.toThrow('must be public');

    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('CollectionCanonicalRepository — active generation snapshot (todo 8 import source)', () => {
  const KEY = { appId: 1n, organizationLogin: 'org' };

  it('never invents a generation — returns null when nothing has ever published', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ activeGenerationId: null }]);

    const snapshot = await repositoryFor(db).getActiveGenerationSnapshot(KEY);

    expect(snapshot).toBeNull();
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('returns null when the org has no state row at all', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValueOnce([]);

    const snapshot = await repositoryFor(db).getActiveGenerationSnapshot(KEY);

    expect(snapshot).toBeNull();
  });

  it('is defensive against a pointer to a non-SUCCEEDED/unfinished run', async () => {
    const db = createDb();
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ activeGenerationId: 'run-1' }])
      .mockResolvedValueOnce([
        { id: 'run-1', finishedAt: null, status: 'PROCESSING' },
      ]);

    const snapshot = await repositoryFor(db).getActiveGenerationSnapshot(KEY);

    expect(snapshot).toBeNull();
  });

  it('reads the full published generation for conversion into stable-ID facts', async () => {
    const db = createDb();
    const finishedAt = new Date('2026-07-20T00:00:00.000Z');
    const repositories = [
      {
        githubRepositoryId: 10n,
        fullName: 'org/repo',
        visibility: 'public',
        archived: false,
        defaultBranch: 'main',
      },
    ];
    const commits = [
      {
        githubRepositoryId: 10n,
        sha: 'abc',
        committedAt: new Date('2026-01-01T00:00:00.000Z'),
        authorGithubId: 20n,
        authorGithubLogin: 'octocat',
      },
    ];
    const pullRequests = [
      {
        githubRepositoryId: 10n,
        githubPullRequestId: 30n,
        state: 'closed',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        authorGithubId: null,
        authorGithubLogin: null,
      },
    ];
    const releases = [
      {
        githubRepositoryId: 10n,
        githubReleaseId: 40n,
        publishedAt: new Date('2026-01-03T00:00:00.000Z'),
        authorGithubId: null,
        authorGithubLogin: null,
      },
    ];
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ activeGenerationId: 'run-1' }])
      .mockResolvedValueOnce([{ id: 'run-1', finishedAt, status: 'SUCCEEDED' }])
      .mockResolvedValueOnce(repositories)
      .mockResolvedValueOnce(commits)
      .mockResolvedValueOnce(pullRequests)
      .mockResolvedValueOnce(releases);

    const snapshot = await repositoryFor(db).getActiveGenerationSnapshot(KEY);

    expect(snapshot).toEqual({
      runId: 'run-1',
      finishedAt,
      repositories,
      commits,
      pullRequests,
      releases,
    });
  });
});
