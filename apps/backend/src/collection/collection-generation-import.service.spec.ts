import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionGenerationImportService } from './collection-generation-import.service';
import type { CanonicalGenerationSnapshot } from './collection-canonical.types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * In-memory Prisma double for `CollectionIncrementalRepository`. Mirrors the
 * exact delegate calls that repository makes (create/upsert/findUnique) and
 * — critically for the "partial transaction does not progress" acceptance
 * criterion — gives `$transaction` real clone/commit/discard semantics: a
 * throw inside the callback discards every write made through that callback.
 */
type Row = Record<string, unknown>;

/** rebuild count/findFirst 호출이 쓰는 `{ field: value }` / `{ field: { gte, lt } }` where만 지원한다. */
function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof Date)
    ) {
      const range = condition as { gte?: Date; lt?: Date };
      const value = row[field] as Date;
      if (range.gte !== undefined && value < range.gte) return false;
      if (range.lt !== undefined && value >= range.lt) return false;
      return true;
    }
    return row[field] === condition;
  });
}
interface Store {
  repositories: Map<string, Row>;
  commitFacts: Map<string, Row>;
  pullRequestFacts: Map<string, Row>;
  releaseFacts: Map<string, Row>;
  yearAggregates: Map<string, Row>;
  contributorYearAggregates: Map<string, Row>;
  streams: Map<string, Row>;
}

interface OrgRepoKey {
  githubOrganizationId: bigint;
  githubRepositoryId: bigint;
}
interface RepositoryUpsertArgs {
  where: { githubOrganizationId_githubRepositoryId: OrgRepoKey };
  create: Row;
  update: Row;
}
interface RepositoryFindUniqueArgs {
  where: { githubOrganizationId_githubRepositoryId: OrgRepoKey };
}
interface CommitFactData {
  repositoryId: string;
  sha: string;
}
interface PullRequestFactData {
  repositoryId: string;
  githubPullRequestId: bigint;
}
interface ReleaseFactData {
  repositoryId: string;
  githubReleaseId: bigint;
}
interface YearAggregateKey {
  repositoryId: string;
  year: number;
}
interface YearAggregateUpsertArgs {
  where: { repositoryId_year: YearAggregateKey };
  create: Row;
  update: Row;
}
interface YearAggregateFindUniqueArgs {
  where: { repositoryId_year: YearAggregateKey };
}
interface ContributorAggregateKey {
  repositoryId: string;
  githubUserId: bigint;
  year: number;
}
interface ContributorAggregateUpsertArgs {
  where: { repositoryId_githubUserId_year: ContributorAggregateKey };
  create: Row;
  update: Row;
}
interface StreamKey {
  repositoryId: string;
  streamType: string;
}
interface StreamUpsertArgs {
  where: { repositoryId_streamType: StreamKey };
  create: Row;
  update: Row;
}
interface StreamFindUniqueArgs {
  where: { repositoryId_streamType: StreamKey };
}

const emptyStore = (): Store => ({
  repositories: new Map(),
  commitFacts: new Map(),
  pullRequestFacts: new Map(),
  releaseFacts: new Map(),
  yearAggregates: new Map(),
  contributorYearAggregates: new Map(),
  streams: new Map(),
});

const cloneStore = (store: Store): Store => ({
  repositories: new Map(store.repositories),
  commitFacts: new Map(store.commitFacts),
  pullRequestFacts: new Map(store.pullRequestFacts),
  releaseFacts: new Map(store.releaseFacts),
  yearAggregates: new Map(store.yearAggregates),
  contributorYearAggregates: new Map(store.contributorYearAggregates),
  streams: new Map(store.streams),
});

const applyUpdate = (existing: Row, update: Row): Row => {
  const row: Row = { ...existing };
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      const currentValue = (row[key] as number | undefined) ?? 0;
      row[key] = currentValue + (value as { increment: number }).increment;
    } else if (value !== undefined) {
      row[key] = value;
    }
  }
  return row;
};

interface FailureControl {
  failReleaseId: bigint | null;
}

function makeFacade(box: { store: Store }, control: FailureControl): unknown {
  return {
    collectionRepository: {
      upsert: ({ where, create, update }: RepositoryUpsertArgs): Row => {
        const k = where.githubOrganizationId_githubRepositoryId;
        const key = `${String(k.githubOrganizationId)}:${String(k.githubRepositoryId)}`;
        const existing = box.store.repositories.get(key);
        const row = existing
          ? applyUpdate(existing, update)
          : { id: `repo-${box.store.repositories.size + 1}`, ...create };
        box.store.repositories.set(key, row);
        return row;
      },
      findUnique: ({ where }: RepositoryFindUniqueArgs): Row | null => {
        const k = where.githubOrganizationId_githubRepositoryId;
        const key = `${String(k.githubOrganizationId)}:${String(k.githubRepositoryId)}`;
        return box.store.repositories.get(key) ?? null;
      },
    },
    collectionCommitFact: {
      createMany: ({
        data,
      }: {
        data: ReadonlyArray<Row & CommitFactData>;
      }): { count: number } => {
        let count = 0;
        for (const item of data) {
          const key = `${item.repositoryId}:${item.sha}`;
          if (box.store.commitFacts.has(key)) continue; // skipDuplicates
          box.store.commitFacts.set(key, {
            id: `commit-${box.store.commitFacts.size + 1}`,
            ...item,
          });
          count += 1;
        }
        return { count };
      },
      count: ({ where }: { where: Row }): number =>
        [...box.store.commitFacts.values()].filter((row) =>
          matchesWhere(row, where),
        ).length,
      findFirst: ({ where }: { where: Row }): Row | null => {
        const rows = [...box.store.commitFacts.values()]
          .filter((row) => matchesWhere(row, where))
          .sort(
            (a, b) =>
              (b.committedAt as Date).getTime() -
              (a.committedAt as Date).getTime(),
          );
        return rows[0] ?? null;
      },
    },
    collectionPullRequestFact: {
      createMany: ({
        data,
      }: {
        data: ReadonlyArray<Row & PullRequestFactData>;
      }): { count: number } => {
        let count = 0;
        for (const item of data) {
          const key = `${item.repositoryId}:${String(item.githubPullRequestId)}`;
          if (box.store.pullRequestFacts.has(key)) continue; // skipDuplicates
          box.store.pullRequestFacts.set(key, {
            id: `pr-${box.store.pullRequestFacts.size + 1}`,
            ...item,
          });
          count += 1;
        }
        return { count };
      },
      count: ({ where }: { where: Row }): number =>
        [...box.store.pullRequestFacts.values()].filter((row) =>
          matchesWhere(row, where),
        ).length,
      findFirst: ({ where }: { where: Row }): Row | null => {
        const rows = [...box.store.pullRequestFacts.values()]
          .filter((row) => matchesWhere(row, where))
          .sort(
            (a, b) =>
              (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          );
        return rows[0] ?? null;
      },
    },
    collectionReleaseFact: {
      createMany: ({
        data,
      }: {
        data: ReadonlyArray<Row & ReleaseFactData>;
      }): { count: number } => {
        if (
          control.failReleaseId !== null &&
          data.some((item) => item.githubReleaseId === control.failReleaseId)
        ) {
          throw new Error('boom');
        }
        let count = 0;
        for (const item of data) {
          const key = `${item.repositoryId}:${String(item.githubReleaseId)}`;
          if (box.store.releaseFacts.has(key)) continue; // skipDuplicates
          box.store.releaseFacts.set(key, {
            id: `release-${box.store.releaseFacts.size + 1}`,
            ...item,
          });
          count += 1;
        }
        return { count };
      },
      count: ({ where }: { where: Row }): number =>
        [...box.store.releaseFacts.values()].filter((row) =>
          matchesWhere(row, where),
        ).length,
      findFirst: ({ where }: { where: Row }): Row | null => {
        const rows = [...box.store.releaseFacts.values()]
          .filter((row) => matchesWhere(row, where))
          .sort(
            (a, b) =>
              (b.publishedAt as Date).getTime() -
              (a.publishedAt as Date).getTime(),
          );
        return rows[0] ?? null;
      },
    },
    collectionRepositoryYearAggregate: {
      upsert: ({ where, create, update }: YearAggregateUpsertArgs): Row => {
        const k = where.repositoryId_year;
        const key = `${k.repositoryId}:${k.year}`;
        const existing = box.store.yearAggregates.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.yearAggregates.set(key, row);
        return row;
      },
      findUnique: ({ where }: YearAggregateFindUniqueArgs): Row | null => {
        const k = where.repositoryId_year;
        const key = `${k.repositoryId}:${k.year}`;
        return box.store.yearAggregates.get(key) ?? null;
      },
    },
    collectionContributorYearAggregate: {
      upsert: ({
        where,
        create,
        update,
      }: ContributorAggregateUpsertArgs): Row => {
        const k = where.repositoryId_githubUserId_year;
        const key = `${k.repositoryId}:${String(k.githubUserId)}:${k.year}`;
        const existing = box.store.contributorYearAggregates.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.contributorYearAggregates.set(key, row);
        return row;
      },
    },
    collectionRepositoryStream: {
      upsert: ({ where, create, update }: StreamUpsertArgs): Row => {
        const k = where.repositoryId_streamType;
        const key = `${k.repositoryId}:${k.streamType}`;
        const existing = box.store.streams.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.streams.set(key, row);
        return row;
      },
      findUnique: ({ where }: StreamFindUniqueArgs): Row | null => {
        const k = where.repositoryId_streamType;
        const key = `${k.repositoryId}:${k.streamType}`;
        return box.store.streams.get(key) ?? null;
      },
    },
    collectionSyncCursor: { upsert: (): Row => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const working = { store: cloneStore(box.store) };
      const result = await fn(makeFacade(working, control));
      box.store = working.store;
      return result;
    },
  };
}

function createFakeDb(): {
  db: PrismaService;
  box: { store: Store };
  control: FailureControl;
} {
  const control: FailureControl = { failReleaseId: null };
  const box = { store: emptyStore() };
  const db = makeFacade(box, control) as PrismaService;
  return { db, box, control };
}

// ---- fixture -------------------------------------------------------------

const FINISHED_AT = new Date('2026-07-20T00:00:00.000Z');

function generationSnapshot(
  order: 'forward' | 'reversed',
): CanonicalGenerationSnapshot {
  const repositories = [
    {
      githubRepositoryId: 100n,
      fullName: 'org/public-repo',
      visibility: 'public',
      archived: false,
      defaultBranch: 'main',
    },
    {
      githubRepositoryId: 200n,
      fullName: 'org/private-repo',
      visibility: 'private',
      archived: false,
      defaultBranch: 'main',
    },
  ];
  const commits = [
    {
      githubRepositoryId: 100n,
      sha: 'sha-alice',
      committedAt: new Date('2026-03-01T00:00:00.000Z'),
      authorGithubId: 1n,
      authorGithubLogin: 'alice',
    },
    {
      githubRepositoryId: 100n,
      sha: 'sha-anonymous',
      committedAt: new Date('2026-03-02T00:00:00.000Z'),
      authorGithubId: null,
      authorGithubLogin: null,
    },
    {
      githubRepositoryId: 200n,
      sha: 'sha-bob',
      committedAt: new Date('2026-03-03T00:00:00.000Z'),
      authorGithubId: 2n,
      authorGithubLogin: 'bob',
    },
  ];
  const pullRequests = [
    {
      githubRepositoryId: 100n,
      githubPullRequestId: 300n,
      state: 'closed',
      createdAt: new Date('2026-03-04T00:00:00.000Z'),
      authorGithubId: 1n,
      authorGithubLogin: 'alice',
    },
  ];
  const releases = [
    {
      githubRepositoryId: 100n,
      githubReleaseId: 400n,
      publishedAt: new Date('2026-03-05T00:00:00.000Z'),
      authorGithubId: null,
      authorGithubLogin: null,
    },
  ];
  if (order === 'forward') {
    return {
      runId: 'run-1',
      finishedAt: FINISHED_AT,
      repositories,
      commits,
      pullRequests,
      releases,
    };
  }
  return {
    runId: 'run-1',
    finishedAt: FINISHED_AT,
    repositories: [...repositories].reverse(),
    commits: [...commits].reverse(),
    pullRequests: [...pullRequests].reverse(),
    releases: [...releases].reverse(),
  };
}

const canonicalRepositoryStub = (
  snapshot: CanonicalGenerationSnapshot | null,
): { getActiveGenerationSnapshot: jest.Mock } => ({
  getActiveGenerationSnapshot: jest.fn().mockResolvedValue(snapshot),
});

describe('CollectionGenerationImportService — public-admin-exposure todo 8', () => {
  it('imports nothing and never invents a generation when none has ever succeeded', async () => {
    const { db } = createFakeDb();
    const service = new CollectionGenerationImportService(
      canonicalRepositoryStub(null),
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    const result = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });

    expect(result).toEqual(
      expect.objectContaining({
        imported: false,
        generationId: null,
        repositoryCount: 0,
      }),
    );
  });

  it('is idempotent — re-running against the same generation yields identical digest and no duplicate rows', async () => {
    const { db, box } = createFakeDb();
    const canonical = canonicalRepositoryStub(generationSnapshot('forward'));
    const service = new CollectionGenerationImportService(
      canonical,
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    const first = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });
    const commitFactCountAfterFirst = box.store.commitFacts.size;
    const second = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });

    expect(first.imported).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.repositoryCount).toBe(2);
    // second pass inserts nothing new — every fact already exists.
    expect(
      second.repositories.every(
        (repo) =>
          repo.commitsInserted === 0 &&
          repo.pullRequestsInserted === 0 &&
          repo.releasesInserted === 0,
      ),
    ).toBe(true);
    expect(box.store.commitFacts.size).toBe(commitFactCountAfterFirst);
    expect(box.store.commitFacts.size).toBe(3);
  });

  it('produces the same digest regardless of the source snapshot row order', async () => {
    const { db: db1 } = createFakeDb();
    const service1 = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('forward')),
      new CollectionIncrementalRepository(db1),
      () => Promise.resolve(999n),
    );
    const { db: db2 } = createFakeDb();
    const service2 = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('reversed')),
      new CollectionIncrementalRepository(db2),
      () => Promise.resolve(999n),
    );

    const key = { appId: 1n, organizationLogin: 'org' };
    const [forward, reversed] = await Promise.all([
      service1.importActiveGeneration(key),
      service2.importActiveGeneration(key),
    ]);

    expect(forward.digest).toBe(reversed.digest);
  });

  it('imports both public and private repositories, preserving null-author commits in repository totals but excluding them from contributor aggregates', async () => {
    const { db, box } = createFakeDb();
    const service = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('forward')),
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    const result = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });

    const publicRepo = result.repositories.find(
      (repo) => repo.githubRepositoryId === '100',
    );
    const privateRepo = result.repositories.find(
      (repo) => repo.githubRepositoryId === '200',
    );
    expect(publicRepo).toBeDefined();
    expect(privateRepo).toBeDefined();

    const publicYearAggregate = box.store.yearAggregates.get(
      `${publicRepo?.repositoryId}:2026`,
    );
    // both commits count toward the repository total, including the null-author one.
    expect(publicYearAggregate?.commitCount).toBe(2);

    const contributorEntries = [
      ...box.store.contributorYearAggregates.values(),
    ].filter((row) => row.repositoryId === publicRepo?.repositoryId);
    // only alice (the non-null author) gets a contributor aggregate row.
    expect(contributorEntries).toHaveLength(1);
    expect(contributorEntries[0]?.githubLogin).toBe('alice');
  });

  it('leaves every imported stream VERIFYING with no invented frontier', async () => {
    const { db, box } = createFakeDb();
    const service = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('forward')),
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    const result = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });

    for (const repo of result.repositories) {
      for (const streamType of ['COMMIT', 'PULL_REQUEST', 'RELEASE']) {
        const stream = box.store.streams.get(
          `${repo.repositoryId}:${streamType}`,
        );
        expect(stream?.status).toBe('VERIFYING');
        expect(stream?.frontierSha ?? null).toBeNull();
        expect(stream?.frontierCreatedAt ?? null).toBeNull();
        expect(stream?.frontierEntityId ?? null).toBeNull();
        expect(stream?.requestFingerprint ?? null).toBeNull();
        expect(stream?.etag ?? null).toBeNull();
      }
    }
  });

  it('never downgrades a stream a later provider traversal already advanced past VERIFYING', async () => {
    const { db, box } = createFakeDb();
    const service = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('forward')),
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    const first = await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });
    const publicRepo = first.repositories.find(
      (repo) => repo.githubRepositoryId === '100',
    );
    const streamKey = `${publicRepo?.repositoryId}:COMMIT`;
    // simulate todo 10's sync orchestration establishing a real safe frontier.
    box.store.streams.set(streamKey, {
      ...box.store.streams.get(streamKey),
      status: 'READY',
      frontierSha: 'real-head-sha',
    });

    await service.importActiveGeneration({
      appId: 1n,
      organizationLogin: 'org',
    });

    const stream = box.store.streams.get(streamKey);
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('real-head-sha');
  });

  it('does not let a mid-repository failure progress — that repository is left fully unimported', async () => {
    const { db, box, control } = createFakeDb();
    control.failReleaseId = 400n;
    const service = new CollectionGenerationImportService(
      canonicalRepositoryStub(generationSnapshot('forward')),
      new CollectionIncrementalRepository(db),
      () => Promise.resolve(999n),
    );

    await expect(
      service.importActiveGeneration({ appId: 1n, organizationLogin: 'org' }),
    ).rejects.toThrow('boom');

    // the public repo's release insert failed inside its own transaction —
    // its repository row and every fact/stream from that same transaction
    // must be rolled back together, not left half-imported.
    expect(box.store.repositories.size).toBe(0);
    expect(box.store.commitFacts.size).toBe(0);
    expect(box.store.pullRequestFacts.size).toBe(0);
    expect(box.store.releaseFacts.size).toBe(0);
    expect(box.store.streams.size).toBe(0);
  });
});
