import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { CollectionGenerationImportService } from './collection-generation-import.service';
import type { CanonicalGenerationSnapshot } from '../collection-canonical.types';
import type { PrismaService } from '../../prisma/prisma.service';

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
  contributions: Map<string, Row>;
  recomputeCalls: number;
  streams: Map<string, Row>;
}

interface RepositoryUpsertArgs {
  where: { githubRepositoryId: bigint };
  create: Row;
  update: Row;
}
interface RepositoryFindUniqueArgs {
  where: { githubRepositoryId: bigint };
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
  contributions: new Map(),
  recomputeCalls: 0,
  streams: new Map(),
});

const cloneStore = (store: Store): Store => ({
  repositories: new Map(store.repositories),
  commitFacts: new Map(store.commitFacts),
  pullRequestFacts: new Map(store.pullRequestFacts),
  releaseFacts: new Map(store.releaseFacts),
  contributions: new Map(store.contributions),
  recomputeCalls: store.recomputeCalls,
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
    githubRepository: {
      upsert: ({ where, create, update }: RepositoryUpsertArgs): Row => {
        const key = String(where.githubRepositoryId);
        const existing = box.store.repositories.get(key);
        const row = existing
          ? applyUpdate(existing, update)
          : { id: `repo-${box.store.repositories.size + 1}`, ...create };
        box.store.repositories.set(key, row);
        return row;
      },
      findUnique: ({ where }: RepositoryFindUniqueArgs): Row | null => {
        const key = String(where.githubRepositoryId);
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
    contribution: {
      deleteMany: ({
        where,
      }: {
        where: {
          repositoryId: string;
          githubId: { in: bigint[] };
          date: { in: Date[] };
        };
      }): { count: number } => {
        let n = 0;
        for (const key of [...box.store.contributions.keys()]) {
          if (key.startsWith(`${where.repositoryId}:`)) {
            box.store.contributions.delete(key);
            n += 1;
          }
        }
        return { count: n };
      },
    },
    // 기본은 "요청된 사람은 모두 가입자". 가입자 필터 자체는
    // collection-incremental.repository.spec.ts 의 전용 describe 가 검증한다.
    user: {
      findMany: ({
        where,
      }: {
        where: { githubId: { in: readonly bigint[] } };
      }) => where.githubId.in.map((githubId) => ({ githubId })),
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
    // 집합 재계산 SQL. 실제 SQL 동작은 통합 스펙이 검증하고,
    // 여기서는 "칸 수와 무관하게 한 번만 돈다"는 계약만 본다.
    $executeRaw: (): number => {
      box.store.recomputeCalls += 1;
      return 1;
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
      authorGithubId: 1n,
      authorGithubLogin: 'alice',
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
    // 작성자를 모르는 커밋은 source와 무관하게 적재 경계에서 빠진다.
    expect(box.store.commitFacts.size).toBe(2);
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

  it('공개·비공개 저장소를 모두 들여오되 귀속 없는 커밋은 사람 축 테이블에 남기지 않는다', async () => {
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

    // 옛 설계는 저장소 총계라는 별도 축이 있어서 author 가 null 인 커밋도
    // "저장소 전체"에는 포함됐다. `Contribution` 에는 그 축이 없다(ADR-010 §4) —
    // 사람 축 하나뿐이고, 귀속을 모르는 기여는 적재하지 않는다(§5).
    // 실제 행 내용은 실 Postgres 통합 스펙이 본다.
    // 여기서는 귀속 있는 활동에 대해서만 재계산이 시작되는지 본다.
    expect(box.store.recomputeCalls).toBeGreaterThan(0);
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
