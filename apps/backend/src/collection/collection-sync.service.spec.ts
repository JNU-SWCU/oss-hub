import { Logger } from '@nestjs/common';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
  DEFAULT_STREAM_ERROR_CODE,
} from './collection-sync.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CollectionAppClientError } from './collection-app.client';
import type {
  CollectionAppClient,
  CollectionCommit,
  CollectionRepository as ProviderRepository,
  CommitHeadProbeResult,
  CommitTraversalResult,
  PullRequestIncrementalResult,
  ReleaseListingResult,
  ReleaseProbeResult,
} from './collection-app.client';
import type { CollectionAppTokenProvider } from './collection-app.token';
import type { RequestFingerprint } from './collection-app.frontier';
import { ProviderRequestQueue } from './collection-provider-queue';

/**
 * In-memory Prisma double for `CollectionIncrementalRepository`, extending
 * the same clone/commit/discard `$transaction` pattern used by
 * `collection-generation-import.service.spec.ts` with the todo 10 additions
 * (sync cursor, inventory presence, and the raw-SQL `CollectionSyncLease`
 * table). Running the sync service against the *real* repository class (not
 * a jest.fn() stub of it) is what lets these tests actually verify the
 * fenced-transaction/atomicity acceptance criteria instead of just asserting
 * which methods were called.
 */
type Row = Record<string, unknown>;

/**
 * rebuild count/findFirst 호출이 쓰는 `{ field: value }` / `{ field: { gte, lt } }`에 더해,
 * GR-6 `markAbsentRepositories`/`listPresentRepositories`가 쓰는 `{ field: { notIn } }`도
 * 지원한다.
 */
function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof Date)
    ) {
      if ('notIn' in condition) {
        const notIn = (condition as { notIn: readonly unknown[] }).notIn;
        return !notIn.includes(row[field]);
      }
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
  cursors: Map<string, Row>;
  leases: Map<string, Row>;
  /** `Repository`(#449) — 수집 저장소를 소유한 신청 산출물. key는 githubRepositoryId. */
  owningRepositories: Map<string, Row>;
  /** `TeamMember` + join된 `User` — key는 임의의 행 id. */
  teamMembers: Map<string, Row>;
}

const emptyStore = (): Store => ({
  repositories: new Map(),
  commitFacts: new Map(),
  pullRequestFacts: new Map(),
  releaseFacts: new Map(),
  yearAggregates: new Map(),
  contributorYearAggregates: new Map(),
  streams: new Map(),
  cursors: new Map(),
  leases: new Map(),
  owningRepositories: new Map(),
  teamMembers: new Map(),
});

const cloneStore = (store: Store): Store => ({
  repositories: new Map(store.repositories),
  commitFacts: new Map(store.commitFacts),
  pullRequestFacts: new Map(store.pullRequestFacts),
  releaseFacts: new Map(store.releaseFacts),
  yearAggregates: new Map(store.yearAggregates),
  contributorYearAggregates: new Map(store.contributorYearAggregates),
  streams: new Map(store.streams),
  cursors: new Map(store.cursors),
  leases: new Map(store.leases),
  owningRepositories: new Map(store.owningRepositories),
  teamMembers: new Map(store.teamMembers),
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
  failCommitShas: Set<string>;
}

const repoKey = (repoId: bigint): string => String(repoId);
const cursorKey = (appId: bigint, scope: string): string =>
  `${String(appId)}:${scope}`;

function makeFacade(box: { store: Store }, control: FailureControl): unknown {
  return {
    // author-scoped 커밋 수집이 팀을 찾는 경로(`Repository` → `teamId` → `TeamMember` →
    // `User`). 시드하지 않은 저장소는 소유 행이 없어 `null`이 되고, 그래서 기존 테스트는
    // 전부 종전 REST 경로 그대로 돈다.
    repository: {
      findUnique: ({
        where,
      }: {
        where: { githubRepositoryId: bigint };
      }): Row | null =>
        box.store.owningRepositories.get(repoKey(where.githubRepositoryId)) ??
        null,
    },
    teamMember: {
      findMany: ({ where }: { where: { teamId: string } }): Row[] =>
        [...box.store.teamMembers.values()].filter(
          (row) => row.teamId === where.teamId,
        ),
    },
    githubRepository: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { githubRepositoryId: bigint };
        create: Row;
        update: Row;
      }): Row => {
        const key = repoKey(where.githubRepositoryId);
        const existing = box.store.repositories.get(key);
        const row = existing
          ? applyUpdate(existing, update)
          : { id: `repo-${box.store.repositories.size + 1}`, ...create };
        box.store.repositories.set(key, row);
        return row;
      },
      findUnique: ({
        where,
      }: {
        where: { githubRepositoryId: bigint };
      }): Row | null =>
        box.store.repositories.get(repoKey(where.githubRepositoryId)) ?? null,
      // GR-6: production callers (`markAbsentRepositories`/
      // `listPresentRepositories`) now include `source: 'ORG_PROVISIONED'`
      // in their `where` — matching generically via `matchesWhere` (rather
      // than hand-picking fields) is what lets this fake actually enforce
      // that filter instead of silently ignoring it.
      updateMany: ({
        where,
        data,
      }: {
        where: Row;
        data: Row;
      }): { count: number } => {
        let count = 0;
        for (const [key, row] of box.store.repositories) {
          if (matchesWhere(row, where)) {
            box.store.repositories.set(key, { ...row, ...data });
            count += 1;
          }
        }
        return { count };
      },
      findMany: ({ where }: { where: Row }): Row[] =>
        [...box.store.repositories.values()].filter((row) =>
          matchesWhere(row, where),
        ),
    },
    collectionCommitFact: {
      createMany: ({
        data,
      }: {
        data: ReadonlyArray<Row & { repositoryId: string; sha: string }>;
      }): { count: number } => {
        const failing = data.find((item) =>
          control.failCommitShas.has(item.sha),
        );
        if (failing) {
          throw new Error(`synthetic commit fact failure: ${failing.sha}`);
        }
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
        data: ReadonlyArray<
          Row & { repositoryId: string; githubPullRequestId: bigint }
        >;
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
        data: ReadonlyArray<
          Row & { repositoryId: string; githubReleaseId: bigint }
        >;
      }): { count: number } => {
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
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { repositoryId_year: { repositoryId: string; year: number } };
        create: Row;
        update: Row;
      }): Row => {
        const k = where.repositoryId_year;
        const key = `${k.repositoryId}:${k.year}`;
        const existing = box.store.yearAggregates.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.yearAggregates.set(key, row);
        return row;
      },
      findUnique: ({
        where,
      }: {
        where: { repositoryId_year: { repositoryId: string; year: number } };
      }): Row | null => {
        const k = where.repositoryId_year;
        return (
          box.store.yearAggregates.get(`${k.repositoryId}:${k.year}`) ?? null
        );
      },
    },
    collectionContributorYearAggregate: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: {
          repositoryId_githubUserId_year: {
            repositoryId: string;
            githubUserId: bigint;
            year: number;
          };
        };
        create: Row;
        update: Row;
      }): Row => {
        const k = where.repositoryId_githubUserId_year;
        const key = `${k.repositoryId}:${String(k.githubUserId)}:${k.year}`;
        const existing = box.store.contributorYearAggregates.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.contributorYearAggregates.set(key, row);
        return row;
      },
    },
    collectionRepositoryStream: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: {
          repositoryId_streamType: { repositoryId: string; streamType: string };
        };
        create: Row;
        update: Row;
      }): Row => {
        const k = where.repositoryId_streamType;
        const key = `${k.repositoryId}:${k.streamType}`;
        const existing = box.store.streams.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.streams.set(key, row);
        return row;
      },
      findUnique: ({
        where,
      }: {
        where: {
          repositoryId_streamType: { repositoryId: string; streamType: string };
        };
      }): Row | null => {
        const k = where.repositoryId_streamType;
        return (
          box.store.streams.get(`${k.repositoryId}:${k.streamType}`) ?? null
        );
      },
      // #546 — 오류 해제 전용 부분 갱신. 행이 없으면 0건이고, `lastErrorCode: { not: null }`
      // 가드 때문에 실제로 표시가 남아 있을 때만 쓴다(없는 행을 새로 만들지 않는다).
      updateMany: ({
        where,
        data,
      }: {
        where: Row & { repositoryId: string; streamType: string };
        data: Row;
      }): { count: number } => {
        const key = `${where.repositoryId}:${where.streamType}`;
        const existing = box.store.streams.get(key);
        if (!existing) return { count: 0 };
        const guard = where.lastErrorCode;
        if (
          guard !== undefined &&
          typeof guard === 'object' &&
          guard !== null &&
          'not' in guard &&
          (existing.lastErrorCode ?? null) === null
        ) {
          return { count: 0 };
        }
        box.store.streams.set(key, applyUpdate(existing, data));
        return { count: 1 };
      },
    },
    collectionSyncCursor: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { appId_scope: { appId: bigint; scope: string } };
        create: Row;
        update: Row;
      }): Row => {
        const k = where.appId_scope;
        const key = cursorKey(k.appId, k.scope);
        const existing = box.store.cursors.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.cursors.set(key, row);
        return row;
      },
      findUnique: ({
        where,
      }: {
        where: { appId_scope: { appId: bigint; scope: string } };
      }): Row | null => {
        const k = where.appId_scope;
        return box.store.cursors.get(cursorKey(k.appId, k.scope)) ?? null;
      },
    },
    // The lease table only exists via raw SQL in production; this fake
    // dispatches on a stable substring of each literal statement rather than
    // actually parsing SQL — sufficient since both call sites live in this
    // repo and are exercised verbatim by collection-incremental.repository.spec.ts.
    $queryRawUnsafe: <T>(sql: string, ...args: unknown[]): Promise<T> => {
      const key = cursorKey(args[0] as bigint, args[1] as string);
      if (sql.includes('INSERT INTO "CollectionSyncLease"')) {
        const [, , ownerId, expiresAt, runId, now] = args as [
          bigint,
          string,
          string,
          Date,
          string,
          Date,
        ];
        const existing = box.store.leases.get(key);
        if (existing && (existing.expiresAt as Date) > now) {
          return Promise.resolve([] as unknown as T);
        }
        const epoch = existing ? (existing.epoch as bigint) + 1n : 1n;
        const row = {
          appId: args[0],
          scope: args[1],
          ownerId,
          epoch,
          runId,
          expiresAt,
        };
        box.store.leases.set(key, row);
        return Promise.resolve([row] as unknown as T);
      }
      if (sql.includes('SELECT true')) {
        const [, , ownerId, epoch, runId, now] = args as [
          bigint,
          string,
          string,
          bigint,
          string,
          Date,
        ];
        const existing = box.store.leases.get(key);
        const owned =
          !!existing &&
          existing.ownerId === ownerId &&
          existing.epoch === epoch &&
          existing.runId === runId &&
          (existing.expiresAt as Date) > now;
        return Promise.resolve(
          (owned ? [{ owned: true }] : []) as unknown as T,
        );
      }
      throw new Error(`unexpected $queryRawUnsafe: ${sql}`);
    },
    $executeRawUnsafe: (sql: string, ...args: unknown[]): Promise<number> => {
      const key = cursorKey(args[0] as bigint, args[1] as string);
      const existing = box.store.leases.get(key);
      if (sql.includes('"expiresAt" > $5')) {
        // heartbeat: appId, scope, ownerId, epoch, now, expiresAt, runId
        const [, , ownerId, epoch, now, expiresAt, runId] = args as [
          bigint,
          string,
          string,
          bigint,
          Date,
          Date,
          string,
        ];
        const matches =
          !!existing &&
          existing.ownerId === ownerId &&
          existing.epoch === epoch &&
          existing.runId === runId &&
          (existing.expiresAt as Date) > now;
        if (!matches) return Promise.resolve(0);
        box.store.leases.set(key, { ...existing, expiresAt });
        return Promise.resolve(1);
      }
      // release: appId, scope, ownerId, epoch, runId, now
      const [, , ownerId, epoch, runId, now] = args as [
        bigint,
        string,
        string,
        bigint,
        string,
        Date,
      ];
      const matches =
        !!existing &&
        existing.ownerId === ownerId &&
        existing.epoch === epoch &&
        existing.runId === runId;
      if (matches) box.store.leases.set(key, { ...existing, expiresAt: now });
      return Promise.resolve(matches ? 1 : 0);
    },
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
  const control: FailureControl = { failCommitShas: new Set() };
  const box = { store: emptyStore() };
  const db = makeFacade(box, control) as PrismaService;
  return { db, box, control };
}

// ---- provider client fixture ---------------------------------------------

const fingerprint = (endpoint: string): RequestFingerprint => ({
  endpoint,
  ref: null,
  query: 'per_page=100',
  order: null,
  pageSize: 100,
  accept: 'application/vnd.github+json',
  apiVersion: '2022-11-28',
});

const providerRepository = (
  overrides: Partial<ProviderRepository> = {},
): ProviderRepository => ({
  id: '100',
  name: 'repo',
  fullName: 'synthetic-org/repo',
  private: false,
  archived: false,
  defaultBranch: 'main',
  ownerLogin: 'synthetic-org',
  htmlUrl: 'https://example.invalid/synthetic-org/repo',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const commit = (
  overrides: Partial<CollectionCommit> = {},
): CollectionCommit => ({
  sha: 'sha-1',
  authorLogin: 'alice',
  authorGithubId: '1',
  committedAt: '2026-08-01T00:00:00.000Z',
  htmlUrl: 'https://example.invalid/commit',
  ...overrides,
});

interface ClientMock {
  listInstallationRepositories: jest.Mock<Promise<ProviderRepository[]>, []>;
  probeDefaultBranchHead: jest.Mock<
    Promise<CommitHeadProbeResult>,
    [string, string, string, string | null]
  >;
  listCommitsUntilKnownSha: jest.Mock<
    Promise<CommitTraversalResult>,
    [string, string, string, ReadonlySet<string>]
  >;
  listNewPullRequests: jest.Mock<
    Promise<PullRequestIncrementalResult>,
    unknown[]
  >;
  probeLatestRelease: jest.Mock<Promise<ReleaseProbeResult>, unknown[]>;
  listChangedPublishedReleases: jest.Mock<
    Promise<ReleaseListingResult>,
    unknown[]
  >;
  resolveUserNodeId: jest.Mock<Promise<string | null>, [string]>;
  listDefaultBranchCommitsByAuthor: jest.Mock<
    Promise<CollectionCommit[]>,
    [string, string, string, string, (string | undefined)?]
  >;
  countDefaultBranchCommits: jest.Mock<
    Promise<number | null>,
    [string, string, string]
  >;
}

function createClient(repositories: ProviderRepository[]): ClientMock {
  return {
    listInstallationRepositories: jest
      .fn<Promise<ProviderRepository[]>, []>()
      .mockResolvedValue(repositories),
    probeDefaultBranchHead: jest.fn<
      Promise<CommitHeadProbeResult>,
      [string, string, string, string | null]
    >(),
    listCommitsUntilKnownSha: jest
      .fn<
        Promise<CommitTraversalResult>,
        [string, string, string, ReadonlySet<string>]
      >()
      .mockResolvedValue({
        commits: [],
        disconnectedFullScan: true,
        fingerprint: fingerprint('/repos/o/r/commits'),
      } satisfies CommitTraversalResult),
    listNewPullRequests: jest
      .fn<Promise<PullRequestIncrementalResult>, unknown[]>()
      .mockResolvedValue({
        pullRequests: [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      } satisfies PullRequestIncrementalResult),
    probeLatestRelease: jest
      .fn<Promise<ReleaseProbeResult>, unknown[]>()
      .mockResolvedValue({
        changed: false,
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'etag-release',
      } satisfies ReleaseProbeResult),
    listChangedPublishedReleases: jest
      .fn<Promise<ReleaseListingResult>, unknown[]>()
      .mockResolvedValue({
        releases: [],
        fingerprint: fingerprint('/repos/o/r/releases'),
      } satisfies ReleaseListingResult),
    // author-scoped 기본값: 모든 login이 `node:<login>`으로 해석되고 커밋은 없다.
    resolveUserNodeId: jest
      .fn<Promise<string | null>, [string]>()
      .mockImplementation((login) => Promise.resolve(`node:${login}`)),
    listDefaultBranchCommitsByAuthor: jest
      .fn<
        Promise<CollectionCommit[]>,
        [string, string, string, string, (string | undefined)?]
      >()
      .mockResolvedValue([]),
    countDefaultBranchCommits: jest
      .fn<Promise<number | null>, [string, string, string]>()
      .mockResolvedValue(null),
  };
}

const runtimeFor = (client: ClientMock): CollectionSyncRuntime => ({
  appId: '1',
  organizationLogin: 'synthetic-org',
  tokens: {} as CollectionAppTokenProvider,
  client: client as unknown as CollectionAppClient,
  queue: new ProviderRequestQueue(),
});

const GITHUB_ORG_ID = 900n;

function createService(
  db: PrismaService,
  client: ClientMock,
  overrides: { now?: () => Date; createRunId?: () => string } = {},
): CollectionSyncService {
  return new CollectionSyncService(
    new CollectionIncrementalRepository(db),
    () => runtimeFor(client),
    () => Promise.resolve(GITHUB_ORG_ID),
    overrides.now ?? (() => new Date('2026-08-01T00:00:00.000Z')),
    overrides.createRunId ?? (() => 'run-1'),
  );
}

// E1 — same shape as `createService`, but also wires an
// `externalRuntimeFactory` (ctor arg 6) so `runExternal()` tests can run
// against a real `CollectionSyncService`. The org `runtimeFactory` is left
// pointed at the same client double — `runExternal()` never calls it, so
// which client backs it is irrelevant to these tests.
function createServiceWithExternal(
  db: PrismaService,
  externalClient: ClientMock,
  overrides: { now?: () => Date; createRunId?: () => string } = {},
): CollectionSyncService {
  return new CollectionSyncService(
    new CollectionIncrementalRepository(db),
    () => runtimeFor(externalClient),
    () => Promise.resolve(GITHUB_ORG_ID),
    overrides.now ?? (() => new Date('2026-08-01T00:00:00.000Z')),
    overrides.createRunId ?? (() => 'run-1'),
    () => runtimeFor(externalClient),
  );
}

// Silence every stream's default-branch/PR/release calls to a stable no-op
// baseline so tests that only care about one stream don't need to restate
// the other two.
function quietStreams(client: ClientMock): void {
  client.probeDefaultBranchHead.mockResolvedValue({
    changed: false,
    fingerprint: fingerprint('/repos/o/r/commits'),
    etag: 'etag-commit',
  });
}

describe('CollectionSyncService — inventory complete vs partial (DEC-46)', () => {
  it('a complete inventory observation marks a repository ABSENT (revoking exposure) even if a later stream fails', async () => {
    const { db, box } = createFakeDb();
    const repoA = providerRepository({
      id: '100',
      fullName: 'synthetic-org/a',
    });
    const client = createClient([repoA]);
    quietStreams(client);
    // The repo's own stream sync throws mid-run.
    client.listCommitsUntilKnownSha.mockRejectedValue(new Error('boom'));
    client.probeDefaultBranchHead.mockResolvedValue({
      changed: true,
      headSha: null,
      fingerprint: fingerprint('/repos/o/r/commits'),
      etag: null,
    });

    // Seed a previously-PRESENT repo that this run's complete inventory no
    // longer lists — it must be marked ABSENT by the independent inventory
    // transaction regardless of what happens afterward in the repo loop.
    box.store.repositories.set(repoKey(777n), {
      id: 'repo-missing',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: 777n,
      nameWithOwner: 'synthetic-org/missing',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PRIVATE',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const service = createService(db, client);
    const result = await service.run('owner-1');

    expect(result.inventoryComplete).toBe(true);
    const missing = box.store.repositories.get(repoKey(777n));
    expect(missing?.presence).toBe('ABSENT');
    // the stream failure must not roll back the already-committed inventory
    // transaction — it only stops that repository's own progress this run.
    const seen = box.store.repositories.get(repoKey(100n));
    expect(seen?.presence).toBe('PRESENT');
  });

  it('a partial inventory (provider listing failure) never marks anything ABSENT and falls back to previously-known PRESENT repos', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(777n), {
      id: 'repo-existing',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: 777n,
      nameWithOwner: 'synthetic-org/existing',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PRIVATE',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const client = createClient([]);
    client.listInstallationRepositories.mockRejectedValue(
      new Error('rate limited'),
    );
    quietStreams(client);

    const service = createService(db, client);
    const result = await service.run('owner-1');

    expect(result.inventoryComplete).toBe(false);
    // stale pre-publication observation is untouched — no revocation happened.
    const existing = box.store.repositories.get(repoKey(777n));
    expect(existing?.presence).toBe('PRESENT');
    // the fallback list still let the run attempt that repo's stream sync —
    // this repo has no stream row yet, so it takes the full-backfill path.
    expect(client.listCommitsUntilKnownSha).toHaveBeenCalled();
  });
});

describe('CollectionSyncService — GR-6 external 저장소는 org sweep에서 살아남는다', () => {
  it('service.run()의 완전한 org inventory 관찰이 EXTERNAL_PUBLIC 저장소를 ABSENT로 바꾸지 않는다', async () => {
    const { db, box } = createFakeDb();
    // Seed an EXTERNAL_PUBLIC repo carrying the SAME org id the org sweep
    // observes below — this proves the `source` filter (GR-6), not an
    // incidental org-id/null mismatch, is what keeps it PRESENT even though
    // the installation listing never mentions it.
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/external-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const repoA = providerRepository({
      id: '100',
      fullName: 'synthetic-org/a',
    });
    const client = createClient([repoA]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    const result = await service.run('owner-1');

    expect(result.inventoryComplete).toBe(true);
    const external = box.store.repositories.get(repoKey(555n));
    expect(external?.presence).toBe('PRESENT');
  });
});

describe('CollectionSyncService — E1 external sweep (runExternal)', () => {
  it('listExternalRepositories()가 돌려준 EXTERNAL_PUBLIC 저장소를 처리해 commit fact를 적재하고 aggregate를 재계산한다', async () => {
    const { db, box } = createFakeDb();
    // Seed exactly the row shape GR-6's test seeds — `runExternal()` never
    // discovers repositories itself, it only reads rows already persisted
    // with `source: 'EXTERNAL_PUBLIC'`/`presence: 'PRESENT'`.
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/external-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const client = createClient([]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'external-head-sha' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createServiceWithExternal(db, client);
    const result = await service.runExternal('owner-1');

    // Then: discovery came from the DB read, never the provider's
    // installation listing (that's the org sweep's discovery path only).
    expect(result.status).toBe('COMPLETED');
    expect(client.listInstallationRepositories).not.toHaveBeenCalled();

    // The commit stream synced and got promoted to READY, same stage
    // pipeline as the org sweep.
    const stream = box.store.streams.get('repo-external:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('external-head-sha');

    // Commit facts were recorded for the external repository.
    expect(box.store.commitFacts.size).toBe(1);
    const fact = [...box.store.commitFacts.values()][0];
    expect(fact?.sha).toBe('external-head-sha');
    expect(fact?.repositoryId).toBe('repo-external');

    // Recording facts rebuilds the repository/contributor year aggregates.
    expect(box.store.yearAggregates.size).toBeGreaterThan(0);
    expect(box.store.contributorYearAggregates.size).toBeGreaterThan(0);
  });

  it('externalRuntimeFactory가 배선되지 않으면 명시적으로 실패한다', async () => {
    const { db } = createFakeDb();
    const client = createClient([]);
    const service = createService(db, client);

    await expect(service.runExternal('owner-1')).rejects.toThrow(
      /external runtime not configured/,
    );
  });
});

describe('CollectionSyncService — new/VERIFYING repository backfill', () => {
  it('performs a full backfill and promotes a brand-new repository stream to READY', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'head-sha' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    await service.run('owner-1');

    const repoRow = [...box.store.repositories.values()][0];
    const repoId = repoRow?.id as string;
    const stream = box.store.streams.get(`${repoId}:COMMIT`);
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('head-sha');
    // a brand-new repository has no existing frontier — the probe path must
    // never be consulted, only the full traversal.
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();
  });

  it('treats a backfill-created VERIFYING stream with a null frontier the same as no stream at all', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    const client = createClient([repository]);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'head-sha' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    // Seed exactly what todo 8's backfill leaves behind: VERIFYING + null frontier.
    box.store.repositories.set(repoKey(BigInt(repository.id)), {
      id: 'repo-1',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: BigInt(repository.id),
      nameWithOwner: repository.fullName,
      defaultBranch: repository.defaultBranch,
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      lastCompleteInventoryObservedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    box.store.streams.set('repo-1:COMMIT', {
      repositoryId: 'repo-1',
      streamType: 'COMMIT',
      status: 'VERIFYING',
      frontierSha: null,
      frontierCreatedAt: null,
      frontierEntityId: null,
      requestFingerprint: null,
      etag: null,
      lastRunAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
    });

    const service = createService(db, client);
    await service.run('owner-1');

    const stream = box.store.streams.get('repo-1:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('head-sha');
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();
  });
});

describe('CollectionSyncService — READY repository conditional polling', () => {
  it('makes no full-history call when the READY repo is unchanged', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    const client = createClient([repository]);
    box.store.repositories.set(repoKey(BigInt(repository.id)), {
      id: 'repo-1',
      githubOrganizationId: GITHUB_ORG_ID,
      githubRepositoryId: BigInt(repository.id),
      nameWithOwner: repository.fullName,
      defaultBranch: repository.defaultBranch,
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      lastCompleteInventoryObservedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    box.store.streams.set('repo-1:COMMIT', {
      repositoryId: 'repo-1',
      streamType: 'COMMIT',
      status: 'READY',
      frontierSha: 'known-head',
      frontierCreatedAt: null,
      frontierEntityId: null,
      requestFingerprint: 'fp',
      etag: 'etag-known',
      lastRunAt: new Date('2026-07-01T00:00:00.000Z'),
      lastErrorAt: null,
      lastErrorCode: null,
    });
    client.probeDefaultBranchHead.mockResolvedValue({
      changed: false,
      fingerprint: fingerprint('/repos/o/r/commits'),
      etag: 'etag-known',
    });
    client.probeLatestRelease.mockResolvedValue({
      changed: false,
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release',
    });

    const service = createService(db, client);
    await service.run('owner-1');

    expect(client.listCommitsUntilKnownSha).not.toHaveBeenCalled();
    expect(client.listChangedPublishedReleases).not.toHaveBeenCalled();
    const stream = box.store.streams.get('repo-1:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('known-head');
  });
});

describe('CollectionSyncService — fenced transactions and lease safety', () => {
  it('advances the checkpoint only after its facts commit — a mid-stream failure leaves the frontier untouched and does not advance the durable cursor past that repo', async () => {
    const { db, box, control } = createFakeDb();
    const client = createClient([providerRepository()]);
    control.failCommitShas.add('sha-1');
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'sha-1' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    const result = await service.run('owner-1');

    // The repository-level failure is caught and logged, not propagated —
    // the run itself still completes, but this repository made no progress:
    // its cycle did not complete and the durable cursor was not advanced
    // past it, so the very next run retries it rather than skipping it.
    expect(result.status).toBe('COMPLETED');
    expect(result.cycleCompleted).toBe(false);
    expect(result.processedRepositoryCount).toBe(0);
    // #546 이후 실패한 stream에는 오류 표시 행이 생긴다 — 다만 frontier/status는
    // 여전히 전진하지 않는다(오류 표시만 담긴 PENDING 행).
    const failedStream = [...box.store.streams.values()][0];
    expect(box.store.streams.size).toBe(1);
    expect(failedStream?.status).toBe('PENDING');
    expect(failedStream?.frontierSha ?? null).toBeNull();
    expect(failedStream?.lastErrorCode).toBe(DEFAULT_STREAM_ERROR_CODE);
    expect(box.store.commitFacts.size).toBe(0);
    expect(box.store.cursors.size).toBe(1);
    const cursor = [...box.store.cursors.values()][0];
    expect(cursor?.lastGithubRepositoryId).toBeNull();
  });

  it('does not write anything once the lease has gone stale', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    const client = createClient([repository]);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'sha-1' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    // Simulate a concurrent worker stealing the lease between acquisition and
    // the first fenced write: seed an already-expired lease so acquisition
    // still succeeds, then forcibly bump its epoch to simulate a steal
    // happening immediately afterward.
    const service = createService(db, client);
    const originalRepository = new CollectionIncrementalRepository(db);
    const originalAcquire =
      originalRepository.acquireSyncLease.bind(originalRepository);
    jest
      .spyOn(CollectionIncrementalRepository.prototype, 'acquireSyncLease')
      .mockImplementationOnce(async (input) => {
        const token = await originalAcquire(input);
        if (token) {
          // Steal it right after acquisition succeeds but before any fenced
          // write runs, by directly mutating the fake lease store.
          box.store.leases.set(cursorKey(input.appId, input.scope), {
            ...box.store.leases.get(cursorKey(input.appId, input.scope)),
            ownerId: 'someone-else',
            epoch: token.epoch + 1n,
          });
        }
        return token;
      });

    const result = await service.run('owner-1');

    expect(result.status).toBe('FAILED');
    expect(box.store.repositories.size).toBe(0);
    expect(box.store.streams.size).toBe(0);
    jest.restoreAllMocks();
  });

  it('does not start a second run while a lease is already held', async () => {
    const { db } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    const [first, second] = await Promise.all([
      service.run('owner-1'),
      service.run('owner-2'),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['COMPLETED', 'SKIPPED_LEASE_HELD']);
  });
});

describe('CollectionSyncService — no automatic publish', () => {
  it('never touches any canonical generation/publish surface', async () => {
    const { db } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    // The fake facade above deliberately implements no canonical run/
    // generation/lease-publish delegate at all — if the service ever called
    // one, this test would throw "is not a function" rather than pass.
    const service = createService(db, client);
    const result = await service.run('owner-1');
    expect(result.status).toBe('COMPLETED');
  });
});

describe('CollectionSyncService — durable cursor draining a mixed fixture across budget-limited runs', () => {
  it('drains a 100-repository fixture fairly across multiple runs via the durable continuation cursor, never restarting at repo 1', async () => {
    const { db } = createFakeDb();
    const repositories = Array.from({ length: 100 }, (_, i) =>
      providerRepository({
        id: String(1000 + i),
        fullName: `synthetic-org/repo-${i}`,
      }),
    );

    const processedOrder: string[] = [];
    let stopAfter = 10;
    let processedThisRun = 0;

    function budgetedClient(): ClientMock {
      const client = createClient(repositories);
      client.probeDefaultBranchHead.mockImplementation(() =>
        Promise.resolve({
          changed: false,
          fingerprint: fingerprint('/repos/o/r/commits'),
          etag: 'etag',
        }),
      );
      client.listCommitsUntilKnownSha.mockImplementation((_owner, repoName) => {
        processedOrder.push(repoName);
        processedThisRun += 1;
        return Promise.resolve({
          commits: [],
          disconnectedFullScan: true,
          fingerprint: fingerprint('/repos/o/r/commits'),
        });
      });
      return client;
    }

    // Every repo starts unseen (no stream row) so each triggers a "backfill"
    // traversal through listCommitsUntilKnownSha — that call is what the
    // budget fake below counts to decide when to stop this run.
    let currentClient = budgetedClient();
    const queue = new ProviderRequestQueue();
    const originalShouldStop = queue.shouldStop.bind(queue);
    jest.spyOn(queue, 'shouldStop').mockImplementation(() => {
      if (processedThisRun >= stopAfter) return true;
      return originalShouldStop();
    });

    const service = new CollectionSyncService(
      new CollectionIncrementalRepository(db),
      () => ({
        appId: '1',
        organizationLogin: 'synthetic-org',
        tokens: {} as CollectionAppTokenProvider,
        client: currentClient as unknown as CollectionAppClient,
        queue,
      }),
      () => Promise.resolve(GITHUB_ORG_ID),
      () => new Date('2026-08-01T00:00:00.000Z'),
      () => `run-${processedOrder.length}`,
    );

    let runs = 0;
    let lastResult = await service.run('owner-1');
    runs += 1;
    while (!lastResult.cycleCompleted && runs < 30) {
      processedThisRun = 0;
      currentClient = budgetedClient();
      lastResult = await service.run('owner-1');
      runs += 1;
    }

    expect(lastResult.cycleCompleted).toBe(true);
    expect(processedOrder).toHaveLength(100);
    // never restarted at repo 1 mid-drain — every repo processed exactly once.
    expect(new Set(processedOrder).size).toBe(100);
    expect(runs).toBeGreaterThan(1);
    stopAfter = Number.MAX_SAFE_INTEGER;
  });
});

// #546 — 트리거가 돌려준 runId로 실제 실행을 조회할 수 있어야 하고, repo 단위 실패는
// stream에 오류 코드로 남아 system-status가 FAILED를 판정할 근거가 되어야 한다.
describe('CollectionSyncService — #546 트리거 결과 추적', () => {
  const streamOf = (box: { store: Store }, streamType: string): Row => {
    const repoId = [...box.store.repositories.values()][0]?.id as string;
    return box.store.streams.get(`${repoId}:${streamType}`) ?? {};
  };

  it('호출자가 넘긴 runId를 그대로 결과와 lease에 쓴다', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    const service = createService(db, client, {
      createRunId: () => 'internal-run-id',
    });

    const result = await service.run('admin:owner-1', 'trigger-run-id');

    expect(result.runId).toBe('trigger-run-id');
    const lease = [...box.store.leases.values()][0];
    expect(lease?.runId).toBe('trigger-run-id');
  });

  it('runId를 넘기지 않으면 예전처럼 서비스가 만든 runId를 쓴다', async () => {
    const { db } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    const service = createService(db, client, {
      createRunId: () => 'internal-run-id',
    });

    await expect(service.run('owner-1')).resolves.toMatchObject({
      runId: 'internal-run-id',
    });
  });

  it('repo 단위 stream 실패를 lastErrorCode로 기록한다(stream 행이 아직 없어도)', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockRejectedValue(
      new CollectionAppClientError('UPSTREAM'),
    );

    const service = createService(db, client);
    await service.run('owner-1');

    const stream = streamOf(box, 'COMMIT');
    expect(stream.lastErrorCode).toBe('PROVIDER_UPSTREAM');
    expect(stream.lastErrorAt).toBeInstanceOf(Date);
    // frontier/status는 실패로 되돌리지 않는다 — 다음 run이 전체 이력을 다시 훑지 않도록.
    expect(stream.status).toBe('PENDING');
  });

  it('provider 오류 종류를 모르면 고정 코드만 남기고 원문 메시지는 담지 않는다', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockRejectedValue(
      new Error('token ghs_must_not_leak leaked in message'),
    );

    const service = createService(db, client);
    await service.run('owner-1');

    const stream = streamOf(box, 'COMMIT');
    expect(stream.lastErrorCode).toBe(DEFAULT_STREAM_ERROR_CODE);
    expect(JSON.stringify(stream)).not.toContain('ghs_must_not_leak');
  });

  it('다음 run이 성공하면 남아 있던 오류 표시를 지운다(변경 없는 READY stream 포함)', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    client.listCommitsUntilKnownSha.mockRejectedValueOnce(
      new CollectionAppClientError('UPSTREAM'),
    );
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'head-sha' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBe('PROVIDER_UPSTREAM');

    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBeNull();
    expect(streamOf(box, 'COMMIT').lastErrorAt).toBeNull();

    // 이미 READY이고 변경이 없는 3번째 run(조기 반환 경로)에서도 표시는 지워진 채 남는다.
    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBeNull();
  });

  it('run budget 소진(deadline)은 오류로 기록하지 않는다', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);
    // release stream만 deadline을 넘기게 한다 — probe는 통과시키고, 그 사이 시계를
    // run budget 너머로 밀어 다음 provider 호출이 RunDeadlineError로 끊기게 만든다.
    let clock = new Date('2026-08-01T00:00:00.000Z').getTime();
    client.probeLatestRelease.mockImplementation(() => {
      clock += 46 * 60_000;
      return Promise.resolve({
        changed: true,
        frontier: null,
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'etag-release',
      });
    });

    const service = createService(db, client, { now: () => new Date(clock) });
    const result = await service.run('owner-1');

    expect(result.stoppedForBudget).toBe(true);
    expect(streamOf(box, 'RELEASE').lastErrorCode ?? null).toBeNull();
    expect(client.listChangedPublishedReleases).not.toHaveBeenCalled();
  });
});
// 팀원 단위 author-scoped 커밋 수집 — 지표 모델의 원자 단위는 "멤버 활동"이므로 팀이 있는
// 저장소는 저장소 전량 페이징을 쓰지 않는다. 팀을 특정할 수 없는 저장소만 기존 REST 경로다.
describe('CollectionSyncService — 팀원 단위 author-scoped 커밋 수집', () => {
  interface SeedMember {
    githubId: bigint;
    nickname: string;
  }

  const seedOwningRepository = (
    box: { store: Store },
    githubRepositoryId: bigint,
    teamId: string | null,
    members: readonly SeedMember[] = [],
  ): void => {
    box.store.owningRepositories.set(repoKey(githubRepositoryId), {
      githubRepositoryId,
      teamId,
    });
    members.forEach((member, index) => {
      const id = `${String(githubRepositoryId)}:${index}`;
      box.store.teamMembers.set(id, {
        id,
        teamId,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        user: { githubId: member.githubId, nickname: member.nickname },
      });
    });
  };

  const authoredCommit = (sha: string, login: string, githubId: string) =>
    commit({ sha, authorLogin: login, authorGithubId: githubId });

  it('팀원 2명 각각에게 author-scoped 호출을 하고 결과를 합쳐 적재한다(저장소 전량 페이징 없음)', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
      { githubId: 22n, nickname: 'bob' },
    ]);
    const client = createClient([repository]);
    client.listDefaultBranchCommitsByAuthor.mockImplementation(
      (_owner, _repo, _branch, authorNodeId) =>
        Promise.resolve(
          authorNodeId === 'node:alice'
            ? [authoredCommit('sha-alice', 'alice', '11')]
            : [authoredCommit('sha-bob', 'bob', '22')],
        ),
    );

    const service = createService(db, client);
    await service.run('owner-1');

    expect(client.resolveUserNodeId.mock.calls.map(([login]) => login)).toEqual(
      ['alice', 'bob'],
    );
    expect(
      client.listDefaultBranchCommitsByAuthor.mock.calls.map(
        ([owner, name, branch, nodeId]) => [owner, name, branch, nodeId],
      ),
    ).toEqual([
      ['synthetic-org', 'repo', 'main', 'node:alice'],
      ['synthetic-org', 'repo', 'main', 'node:bob'],
    ]);
    // 저장소 전체를 훑는 REST 경로는 한 번도 쓰이지 않는다.
    expect(client.listCommitsUntilKnownSha).not.toHaveBeenCalled();
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();

    const facts = [...box.store.commitFacts.values()];
    expect(facts.map((fact) => fact.sha).sort()).toEqual([
      'sha-alice',
      'sha-bob',
    ]);
    // frontier는 READY로 승격하되 head SHA/ETag는 남기지 않는다 — 팀원의 최신 커밋은
    // 브랜치 head가 아니므로, 나중에 REST 경로로 떨어질 때 known SHA로 쓰이면 안 된다.
    const stream = box.store.streams.get('repo-1:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBeNull();
    expect(stream?.etag).toBeNull();
  });

  it('팀이 없는 저장소는 기존 저장소 전량 REST 경로로 떨어진다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    // 소유 `Repository` 행은 있지만 teamId가 null인 경우 — 팀을 특정할 수 없다.
    seedOwningRepository(box, BigInt(repository.id), null);
    const client = createClient([repository]);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'head-sha' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    const service = createService(db, client);
    await service.run('owner-1');

    expect(client.listCommitsUntilKnownSha).toHaveBeenCalled();
    expect(client.listDefaultBranchCommitsByAuthor).not.toHaveBeenCalled();
    expect(client.resolveUserNodeId).not.toHaveBeenCalled();
    const stream = box.store.streams.get('repo-1:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('head-sha');
  });

  it('나중에 합류한 팀원의 과거 이력이 다음 run에 그대로 들어온다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listDefaultBranchCommitsByAuthor.mockImplementation(
      (_owner, _repo, _branch, authorNodeId) =>
        Promise.resolve(
          authorNodeId === 'node:alice'
            ? [authoredCommit('sha-alice', 'alice', '11')]
            : [
                // 합류 전에 남긴 오래된 커밋까지 전부 — `since`를 쓰지 않으므로
                // 별도 백필 코드 없이 첫 run에서 통째로 들어온다.
                authoredCommit('sha-carol-old', 'carol', '33'),
                authoredCommit('sha-carol-new', 'carol', '33'),
              ],
        ),
    );

    const service = createService(db, client);
    await service.run('owner-1');
    expect([...box.store.commitFacts.values()]).toHaveLength(1);

    // carol이 팀에 합류한다.
    box.store.teamMembers.set('later', {
      id: 'later',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 5, 1)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    await service.run('owner-1');

    expect(
      [...box.store.commitFacts.values()].map((fact) => fact.sha).sort(),
    ).toEqual(['sha-alice', 'sha-carol-new', 'sha-carol-old']);
    // 이미 있던 alice 커밋은 재수집돼도 중복 삽입되지 않는다.
    expect(box.store.commitFacts.size).toBe(3);
  });

  it('node id를 못 찾은 팀원만 건너뛰고 나머지 팀원 수집은 계속한다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'ghost' },
      { githubId: 22n, nickname: 'bob' },
    ]);
    const client = createClient([repository]);
    client.resolveUserNodeId.mockImplementation((login) =>
      Promise.resolve(login === 'ghost' ? null : `node:${login}`),
    );
    client.listDefaultBranchCommitsByAuthor.mockResolvedValue([
      authoredCommit('sha-bob', 'bob', '22'),
    ]);

    const service = createService(db, client);
    const result = await service.run('owner-1');

    expect(result.status).toBe('COMPLETED');
    expect(client.listDefaultBranchCommitsByAuthor).toHaveBeenCalledTimes(1);
    expect(client.listDefaultBranchCommitsByAuthor.mock.calls[0]?.[3]).toEqual(
      'node:bob',
    );
    expect([...box.store.commitFacts.values()].map((f) => f.sha)).toEqual([
      'sha-bob',
    ]);
    // 계정 하나를 못 찾은 것은 stream 실패가 아니다.
    expect(
      box.store.streams.get('repo-1:COMMIT')?.lastErrorCode ?? null,
    ).toBeNull();
  });

  it('외부 기여자를 `전체 − 팀원합` 수치로만 관측하고 개인 식별자는 남기지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listDefaultBranchCommitsByAuthor.mockResolvedValue([
      authoredCommit('sha-a', 'alice', '11'),
      authoredCommit('sha-b', 'alice', '11'),
    ]);
    client.countDefaultBranchCommits.mockResolvedValue(7);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const service = createService(db, client);
    await service.run('owner-1');

    expect(client.countDefaultBranchCommits).toHaveBeenCalledWith(
      'synthetic-org',
      'repo',
      'main',
    );
    const observed = logged.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find(
        (payload) =>
          payload?.event === 'collection.sync.external_contribution_observed',
      );
    expect(observed).toMatchObject({
      totalCommitCount: 7,
      teamCommitCount: 2,
      externalCommitCount: 5,
    });
    // 수치만 남는다 — 외부 기여자의 login/githubId는 어디에도 없다.
    expect(Object.keys(observed ?? {})).not.toContain('authorLogin');
    // 저장 위치가 정해지지 않았으므로 fact로도 남기지 않는다.
    expect([...box.store.commitFacts.values()]).toHaveLength(2);
    logged.mockRestore();
  });

  it('브랜치가 없거나(전체 null) 팀원합보다 전체가 작으면 외부 수치를 계산하지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listDefaultBranchCommitsByAuthor.mockResolvedValue([
      authoredCommit('sha-a', 'alice', '11'),
      authoredCommit('sha-b', 'alice', '11'),
    ]);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const externalEvents = (): unknown[] =>
      logged.mock.calls.filter(
        ([payload]) =>
          (payload as Record<string, unknown> | undefined)?.event ===
          'collection.sync.external_contribution_observed',
      );

    // 전체 = null(브랜치 없음)
    client.countDefaultBranchCommits.mockResolvedValue(null);
    await createService(db, client).run('owner-1');
    expect(externalEvents()).toHaveLength(0);

    // 전체(1) < 팀원합(2) — 음수를 남기거나 0으로 뭉개지 않고 건너뛴다.
    client.countDefaultBranchCommits.mockResolvedValue(1);
    await createService(db, client).run('owner-1');
    expect(externalEvents()).toHaveLength(0);
    expect(box.store.commitFacts.size).toBe(2);
    logged.mockRestore();
  });
});
