import { Logger } from '@nestjs/common';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
  DEFAULT_STREAM_ERROR_CODE,
} from './collection-sync.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CollectionAppClientError } from '../collection-app.client';
import type {
  CollectionAppClient,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
  CollectionRepository as ProviderRepository,
  CommitHeadProbeResult,
  CommitTraversalResult,
  PullRequestIncrementalResult,
  ReleaseListingResult,
  ReleaseProbeResult,
} from '../collection-app.client';
import type { CollectionAppTokenProvider } from '../collection-app.token';
import type { RequestFingerprint } from '../collection-app.frontier';
import { ProviderRequestQueue } from '../collection-provider-queue';

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
  contributions: Map<string, Row>;
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
  contributions: new Map(),
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
  contributions: new Map(store.contributions),
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
    contribution: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: {
          repositoryId_githubId_date: {
            repositoryId: string;
            githubId: bigint;
            date: Date;
          };
        };
        create: Row;
        update: Row;
      }): Row => {
        const k = where.repositoryId_githubId_date;
        const key = `${k.repositoryId}:${String(k.githubId)}:${k.date.toISOString().slice(0, 10)}`;
        const existing = box.store.contributions.get(key);
        const row = existing ? applyUpdate(existing, update) : { ...create };
        box.store.contributions.set(key, row);
        return row;
      },
      deleteMany: ({
        where,
      }: {
        where: { repositoryId: string; githubId: bigint; date: Date };
      }): { count: number } => {
        const key = `${where.repositoryId}:${String(where.githubId)}:${where.date.toISOString().slice(0, 10)}`;
        return { count: box.store.contributions.delete(key) ? 1 : 0 };
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
    expect(box.store.contributions.size).toBeGreaterThan(0);
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
  it('중간 실패는 frontier 를 건드리지 않지만 스윕을 세우지도 않는다 — 실패는 백오프로 되돌아온다', async () => {
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
    // 실패해도 사이클은 닫힌다(DD1) — 닫히지 않으면 커서가 리셋되지 않아
    // 커서를 전진시킨 저장소로 되돌아갈 길이 사라진다. 실패는 사이클을 막는
    // 대신 `failureCount`·`nextRunAt` 백오프와 stream 오류 코드로 남는다.
    expect(result.cycleCompleted).toBe(true);
    // 성공한 저장소가 없으므로 처리 수는 0이다 — 시도와 처리는 다르다.
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
    // 사이클이 닫히면서 커서가 리셋된다. 실패 저장소는 백오프가 지나면
    // 다음 사이클에서 다시 시도되므로 버려지지 않는다.
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

  // 이 describe는 prototype spy를 쓴다. 단언이 실패해 테스트 본문의 `mockRestore()`에
  // 도달하지 못하면 그 spy가 뒤따르는 모든 테스트로 새어 나가 원인과 무관한 무더기 실패를
  // 만든다 — 실제로 변이 검증에서 그렇게 됐다. 해제를 본문이 아니라 여기에 둔다.
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  /**
   * 회귀 가드 — 팀원 목록 조회(`listRepositoryTeamMembers`)는 세 stream이 공유하지만 반드시
   * COMMIT stream의 `trackStreamOutcome` **안**에서 일어나야 한다. 이 조회를 래퍼 밖으로 빼면
   * 실패가 상위 catch의 로그로만 남고 stream 행은 깨끗한 채여서, 운영자가 `system-status`로
   * "수집이 왜 멈췄는지"를 판정할 근거를 잃는다(#546 계약).
   */
  it('팀원 목록 조회가 실패해도 그 사실이 COMMIT stream의 lastErrorCode에 남는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    quietStreams(client);
    jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'listRepositoryTeamMembers',
      )
      .mockRejectedValue(new Error('synthetic team member lookup failure'));

    const result = await createService(db, client).run('owner-1');

    expect(result.status).toBe('COMPLETED');
    const stream = streamOf(box, 'COMMIT');
    // provider 오류가 아니므로 종류를 특정하지 않는 고정 코드가 남는다.
    expect(stream.lastErrorCode).toBe(DEFAULT_STREAM_ERROR_CODE);
    expect(stream.lastErrorAt).toBeInstanceOf(Date);
    // 실패한 저장소를 지나쳐 커서를 전진시키지 않는다.
    expect(
      box.store.cursors.get('1:org:synthetic-org')?.lastGithubRepositoryId ??
        null,
    ).toBeNull();
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
interface SeedMember {
  githubId: bigint;
  nickname: string;
}

/**
 * `Repository`(#449) 소유 행 + 그 팀의 `TeamMember`(join된 `User`) 시드. `teamId`가 null이면
 * 팀을 특정할 수 없는 저장소가 되어 production이 저장소 전량 경로로 떨어진다.
 */
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

describe('CollectionSyncService — 팀원 단위 author-scoped 커밋 수집', () => {
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

/**
 * ADR-009 «PR·릴리스는 적재 시 거른다»(#680). 커밋과 달리 PR·릴리스는 provider 쪽에
 * author 인자가 없어 전량 받은 뒤 적재 직전에 거른다. 그래서 이 suite가 확인해야 하는
 * 것은 두 가지다 — (1) 비팀원·작성자 불명이 fact와 집계에 남지 않는가, (2) 거르기가
 * 커서를 망가뜨리지 않는가(다음 run이 같은 것을 다시 받지도, 건너뛰지도 않는가).
 */
describe('CollectionSyncService — PR·릴리스 적재의 팀원 필터(ADR-009)', () => {
  const MEMBER_ID = 11n;
  const OUTSIDER_ID = '99';

  const pullRequest = (
    overrides: Partial<CollectionPullRequest> = {},
  ): CollectionPullRequest => ({
    id: '400',
    number: 4,
    state: 'open',
    draft: false,
    mergedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    authorLogin: 'alice',
    authorGithubId: '11',
    htmlUrl: 'https://example.invalid/pull/4',
    ...overrides,
  });

  const release = (
    overrides: Partial<CollectionRelease> = {},
  ): CollectionRelease => ({
    id: '600',
    tagName: 'v1.0.0',
    name: 'v1.0.0',
    publishedAt: '2026-08-01T00:00:00.000Z',
    authorLogin: 'alice',
    authorGithubId: '11',
    htmlUrl: 'https://example.invalid/releases/v1.0.0',
    ...overrides,
  });

  /**
   * 실제 `CollectionAppClient.listNewPullRequests`의 계약을 그대로 흉내 내는 stub —
   * tie frontier보다 **새로운** PR만 새 것부터 돌려주고, `newFrontier`를 자기가 돌려준
   * 목록의 첫 항목(작성자 무관)으로 계산한다. 고정 배열을 돌려주는 mock으로는
   * "다음 run이 같은 것을 다시 받지 않는다"를 검증할 수 없어서 이 형태가 필요하다.
   */
  const servePullRequests =
    (all: readonly CollectionPullRequest[]) =>
    (...args: unknown[]): Promise<PullRequestIncrementalResult> => {
      const tie = args[2] as { createdAt: string; id: string } | null;
      const newestFirst = [...all].sort((a, b) => {
        const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        return byCreatedAt !== 0
          ? byCreatedAt
          : Number(BigInt(b.id) - BigInt(a.id));
      });
      const fresh =
        tie === null
          ? newestFirst
          : newestFirst.filter((item) =>
              Date.parse(item.createdAt) === Date.parse(tie.createdAt)
                ? BigInt(item.id) > BigInt(tie.id)
                : Date.parse(item.createdAt) > Date.parse(tie.createdAt),
            );
      return Promise.resolve({
        pullRequests: fresh,
        newFrontier: fresh[0]
          ? { createdAt: fresh[0].createdAt, id: fresh[0].id }
          : tie,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      });
    };

  const storedPullRequestLogins = (box: { store: Store }): unknown[] =>
    [...box.store.pullRequestFacts.values()].map(
      (fact) => fact.authorGithubLogin,
    );
  const storedReleaseLogins = (box: { store: Store }): unknown[] =>
    [...box.store.releaseFacts.values()].map((fact) => fact.authorGithubLogin);

  it('팀원이 만든 PR·릴리스만 적재하고 비팀원 것은 fact에도 집계에도 남기지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [
        pullRequest({
          id: '401',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
        pullRequest({ id: '400' }),
      ],
      newFrontier: { createdAt: '2026-08-01T00:00:00.000Z', id: '401' },
      fingerprint: fingerprint('/repos/o/r/pulls'),
    });
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '601:false:2026-08-01T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release-1',
    });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({
          id: '601',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
        release({ id: '600' }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    await createService(db, client).run('owner-1');

    expect(storedPullRequestLogins(box)).toEqual(['alice']);
    expect(storedReleaseLogins(box)).toEqual(['alice']);
    expect([...box.store.pullRequestFacts.values()][0]?.authorGithubId).toBe(
      MEMBER_ID,
    );
    // 비팀원 식별자가 어떤 fact에도 남지 않는다 — 필드 하나만 보고 넘어가지 않도록
    // 저장된 행 전체를 문자열로 펴서 확인한다(BigInt가 섞여 있어 JSON 대신 String).
    const storedFacts = [
      ...box.store.pullRequestFacts.values(),
      ...box.store.releaseFacts.values(),
    ]
      .flatMap((fact) => Object.values(fact).map((value) => String(value)))
      .join('|');
    expect(storedFacts).not.toMatch(/outsider/);
    expect(storedFacts).not.toMatch(/\b99\b/);
    // facts에 안 들어갔으므로 집계도 만들어지지 않는다 — 집계 코드를 따로 손대지
    // 않아도 되는 근거가 이것이다.
    expect([...box.store.contributions.keys()]).toEqual([
      'repo-1:11:2026-08-01',
    ]);
  });

  it('작성자를 특정할 수 없는(authorGithubId null) PR·릴리스는 적재하지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [
        pullRequest({ id: '402', authorLogin: null, authorGithubId: null }),
      ],
      newFrontier: { createdAt: '2026-08-01T00:00:00.000Z', id: '402' },
      fingerprint: fingerprint('/repos/o/r/pulls'),
    });
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '602:false:2026-08-01T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release-1',
    });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({ id: '602', authorLogin: null, authorGithubId: null }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    await createService(db, client).run('owner-1');

    expect(box.store.pullRequestFacts.size).toBe(0);
    expect(box.store.releaseFacts.size).toBe(0);
    // 그래도 stream은 READY로 전진한다 — 남길 것이 없다는 것과 아직 못 읽었다는 것은 다르다.
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.status).toBe('READY');
    expect(box.store.streams.get('repo-1:RELEASE')?.status).toBe('READY');
  });

  it('PR 커서는 거른 항목 위로 전진한다 — 다음 run이 같은 PR을 다시 받지 않고 새 PR만 받는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const memberOld = pullRequest({
      id: '400',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    // 가장 새 PR이 비팀원 것이다 — 거른 뒤 길이로 커서를 정하면 여기서 멈춰 버린다.
    const outsiderNewest = pullRequest({
      id: '401',
      createdAt: '2026-08-02T00:00:00.000Z',
      authorLogin: 'outsider',
      authorGithubId: OUTSIDER_ID,
    });
    const served = [memberOld, outsiderNewest];
    client.listNewPullRequests.mockImplementation(servePullRequests(served));

    const service = createService(db, client);
    await service.run('owner-1');

    expect(storedPullRequestLogins(box)).toEqual(['alice']);
    const afterFirst = box.store.streams.get('repo-1:PULL_REQUEST');
    // 커서는 거른 항목(비팀원 최신 PR) 위에 선다.
    expect(afterFirst?.frontierEntityId).toBe(401n);
    expect(afterFirst?.frontierCreatedAt).toEqual(
      new Date('2026-08-02T00:00:00.000Z'),
    );

    // 두 번째 run: 새 팀원 PR 하나가 추가됐다.
    served.push(
      pullRequest({ id: '402', createdAt: '2026-08-03T00:00:00.000Z' }),
    );
    await service.run('owner-1');

    // 두 번째 호출이 받은 tie frontier가 첫 run이 세운 값 그대로다.
    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toEqual({
      createdAt: '2026-08-02T00:00:00.000Z',
      id: '401',
    });
    // 이미 지난 PR은 다시 오지 않았고(중복 없음), 새 PR은 빠짐없이 들어왔다.
    expect(
      [...box.store.pullRequestFacts.values()]
        .map((fact) => String(fact.githubPullRequestId))
        .sort(),
    ).toEqual(['400', '402']);
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      402n,
    );
  });

  /**
   * 가장 위험한 경계 — 이미 READY(=`tieFrontier !== null`)인 stream이 받은 페이지가 **전부**
   * 제3자인 경우. 조기 반환이 거른 **뒤** 길이를 보면 frontier가 제자리에 멈춰 매 run 같은
   * 페이지를 영원히 다시 받는다. 혼합 페이지 테스트로는 이 결함이 살아남는다(팀원 것이 하나라도
   * 있으면 거른 뒤 길이가 0이 아니라 조기 반환에 걸리지 않기 때문).
   */
  it('READY stream이 받은 페이지가 전부 비팀원이어도 커서가 전진한다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const memberSeed = pullRequest({
      id: '400',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    const served = [memberSeed];
    client.listNewPullRequests.mockImplementation(servePullRequests(served));

    const service = createService(db, client);
    // 1회차: 팀원 PR 하나로 stream을 READY + frontier 있는 상태로 만든다.
    await service.run('owner-1');
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      400n,
    );

    // 2회차: 이번 페이지는 전부 비팀원이다.
    served.push(
      pullRequest({
        id: '401',
        createdAt: '2026-08-02T00:00:00.000Z',
        authorLogin: 'outsider',
        authorGithubId: OUTSIDER_ID,
      }),
      pullRequest({
        id: '402',
        createdAt: '2026-08-03T00:00:00.000Z',
        authorLogin: 'outsider2',
        authorGithubId: '98',
      }),
    );
    await service.run('owner-1');

    // 아무것도 적재되지 않았지만 커서는 그 페이지 너머로 전진한다.
    expect(storedPullRequestLogins(box)).toEqual(['alice']);
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      402n,
    );

    // 3회차: 전진한 커서 덕에 이미 본 비팀원 PR을 다시 요청하지 않고, 새 팀원 PR만 들어온다.
    served.push(
      pullRequest({ id: '403', createdAt: '2026-08-04T00:00:00.000Z' }),
    );
    await service.run('owner-1');

    expect(client.listNewPullRequests.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-08-03T00:00:00.000Z',
      id: '402',
    });
    expect(
      [...box.store.pullRequestFacts.values()]
        .map((fact) => String(fact.githubPullRequestId))
        .sort(),
    ).toEqual(['400', '403']);
  });

  it('릴리스 frontierSha는 목록이 아니라 probe가 준 값이다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '699:false:2026-08-09T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release-probe',
    });
    // 목록에는 probe가 본 릴리스(699)가 아예 없고, 있는 것은 전부 비팀원 것이다.
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({
          id: '601',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    await createService(db, client).run('owner-1');

    const stream = box.store.streams.get('repo-1:RELEASE');
    // 거른 목록이 frontier에 끼어들지 않는다 — 값은 probe 응답 그대로다.
    expect(stream?.frontierSha).toBe('699:false:2026-08-09T00:00:00.000Z');
    expect(stream?.etag).toBe('etag-release-probe');
    expect(box.store.releaseFacts.size).toBe(0);
  });

  it('릴리스를 전부 걸러도 ETag가 전진해 다음 run이 목록을 다시 받지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.probeLatestRelease
      .mockResolvedValueOnce({
        changed: true,
        frontier: { probe: '601:false:2026-08-01T00:00:00.000Z' },
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'etag-release-1',
      })
      // 두 번째 run은 위 ETag로 조건부 요청해 304를 받는다.
      .mockResolvedValueOnce({
        changed: false,
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'etag-release-1',
      });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({
          id: '601',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    const service = createService(db, client);
    await service.run('owner-1');
    await service.run('owner-1');

    expect(box.store.releaseFacts.size).toBe(0);
    expect(box.store.streams.get('repo-1:RELEASE')?.etag).toBe(
      'etag-release-1',
    );
    // 두 번째 probe가 첫 run의 ETag를 그대로 들고 갔고, 목록 호출은 늘지 않았다.
    expect(client.probeLatestRelease.mock.calls[1]?.[2]).toBe('etag-release-1');
    expect(client.listChangedPublishedReleases).toHaveBeenCalledTimes(1);
  });

  it('나중에 합류한 팀원의 과거 릴리스는 다음 변경 sweep에 들어온다(PR은 커서 아래라 들어오지 않는다)', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const carolPullRequest = pullRequest({
      id: '410',
      createdAt: '2026-07-01T00:00:00.000Z',
      authorLogin: 'carol',
      authorGithubId: '33',
    });
    client.listNewPullRequests.mockImplementation(
      servePullRequests([carolPullRequest]),
    );
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '610:false:2026-07-01T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: null,
    });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({
          id: '610',
          publishedAt: '2026-07-01T00:00:00.000Z',
          authorLogin: 'carol',
          authorGithubId: '33',
        }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    const service = createService(db, client);
    await service.run('owner-1');
    expect(box.store.pullRequestFacts.size).toBe(0);
    expect(box.store.releaseFacts.size).toBe(0);

    // carol이 팀에 합류한다.
    box.store.teamMembers.set('later', {
      id: 'later',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 6, 15)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    await service.run('owner-1');

    // 릴리스는 매번 전량을 다시 받으므로 합류 후 sweep에서 그대로 채워진다.
    expect(storedReleaseLogins(box)).toEqual(['carol']);
    // PR은 커서가 이미 그 위로 지나가 다시 오지 않는다 — 현재 계약을 명시적으로 고정한다.
    // (커밋 경로가 #678에서 얻은 백필 성질이 PR에는 성립하지 않는다. 후속 과제.)
    expect(box.store.pullRequestFacts.size).toBe(0);
  });

  it('팀을 특정할 수 없는 저장소는 종전대로 작성자를 가리지 않고 적재한다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    // 소유 `Repository` 행이 아예 없다 — `listRepositoryTeamMembers`가 null을 준다.
    const client = createClient([repository]);
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [
        pullRequest({
          id: '401',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
      ],
      newFrontier: { createdAt: '2026-08-01T00:00:00.000Z', id: '401' },
      fingerprint: fingerprint('/repos/o/r/pulls'),
    });
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '601:false:2026-08-01T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release-1',
    });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [
        release({
          id: '601',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    await createService(db, client).run('owner-1');

    expect(storedPullRequestLogins(box)).toEqual(['outsider']);
    expect(storedReleaseLogins(box)).toEqual(['outsider']);
  });
});

/**
 * DD1 — 저장소 하나의 실패가 나머지를 굶기지 않는다.
 *
 * 이 저장소가 실제로 겪은 실패 모드다. 예전 코드는 실패한 저장소에서 `break` 해
 * 커서를 세웠고, 그 저장소가 영구 실패면 뒤의 모든 저장소가 영영 수집되지 않았다.
 *
 * 반대로 커서만 전진시키면 실패 저장소를 버리게 된다 — 사이클이 닫혀야 커서가
 * 리셋되는데 실패가 사이클을 막으면 되돌아갈 길이 없기 때문이다.
 * 그래서 둘을 같이 바꿨고, 아래가 그 두 성질을 각각 고정한다.
 */
describe('CollectionSyncService — 실패 저장소 격리 (DD1)', () => {
  /** `repo-broken` 만 상류에서 실패하는 클라이언트. 신규 저장소는 backfill 경로를 탄다. */
  function failingFirstClient(
    repositories: ReturnType<typeof providerRepository>[],
  ): ClientMock {
    const client = createClient(repositories);
    client.listCommitsUntilKnownSha.mockImplementation(
      (_owner: string, repo: string) =>
        repo === 'repo-broken'
          ? Promise.reject(new Error('upstream is broken'))
          : Promise.resolve({
              commits: [],
              disconnectedFullScan: false,
              fingerprint: fingerprint('/repos/o/r/commits'),
            }),
    );
    return client;
  }

  it('앞선 저장소가 실패해도 뒤의 저장소를 계속 처리한다', async () => {
    const { db, box } = createFakeDb();
    const repositories = [
      providerRepository({ id: '1001', fullName: 'synthetic-org/repo-broken' }),
      providerRepository({
        id: '1002',
        fullName: 'synthetic-org/repo-healthy',
      }),
    ];
    const service = createService(db, failingFirstClient(repositories));

    const result = await service.run('synthetic-org');

    // 실패한 하나 때문에 멈추지 않는다 — 뒤의 저장소가 실제로 처리됐다.
    expect(result.processedRepositoryCount).toBe(1);
    // 전부 시도했으므로 사이클은 닫힌다. 닫혀야 커서가 리셋되고,
    // 리셋돼야 실패 저장소로 되돌아갈 수 있다.
    expect(result.cycleCompleted).toBe(true);
    const cursor = [...box.store.cursors.values()][0];
    expect(cursor?.lastGithubRepositoryId).toBeNull();
  });

  it('실패 저장소는 failureCount 와 nextRunAt 백오프로 되돌아올 약속을 남긴다', async () => {
    const { db, box } = createFakeDb();
    const repositories = [
      providerRepository({ id: '1001', fullName: 'synthetic-org/repo-broken' }),
      providerRepository({
        id: '1002',
        fullName: 'synthetic-org/repo-healthy',
      }),
    ];
    const service = createService(db, failingFirstClient(repositories));

    await service.run('synthetic-org');

    const rows = [...box.store.repositories.values()];
    const broken = rows.find(
      (row) => row.nameWithOwner === 'synthetic-org/repo-broken',
    );
    const healthy = rows.find(
      (row) => row.nameWithOwner === 'synthetic-org/repo-healthy',
    );

    // 실패: 횟수가 오르고 다음 차례가 미뤄진다. 버려지는 게 아니라 미뤄지는 것이다.
    expect(broken?.failureCount).toBe(1);
    expect(broken?.nextRunAt).toBeInstanceOf(Date);
    // 첫 실패는 정기 주기만큼만 미룬다 — 일시적 오류에 벌을 주면 복구가 느려진다.
    const healthyNext = healthy?.nextRunAt as Date;
    expect((broken?.nextRunAt as Date).getTime()).toBe(healthyNext.getTime());

    // 성공: 실패 이력이 지워지고 마지막 성공 시각이 남는다.
    expect(healthy?.failureCount).toBe(0);
    expect(healthy?.lastSuccessAt).toBeInstanceOf(Date);
  });

  it('연속 실패는 백오프를 늘린다 — 계속 실패하는 저장소가 큐를 잡아먹지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repositories = [
      providerRepository({ id: '1001', fullName: 'synthetic-org/repo-broken' }),
      providerRepository({
        id: '1002',
        fullName: 'synthetic-org/repo-healthy',
      }),
    ];
    const service = createService(db, failingFirstClient(repositories));

    await service.run('synthetic-org');
    await service.run('synthetic-org');

    const rows = [...box.store.repositories.values()];
    const broken = rows.find(
      (row) => row.nameWithOwner === 'synthetic-org/repo-broken',
    );
    const healthy = rows.find(
      (row) => row.nameWithOwner === 'synthetic-org/repo-healthy',
    );

    // 두 번째 실패부터 정기 주기보다 뒤로 밀린다. 상한이 있으므로 영구 제외되지는 않는다.
    expect(broken?.failureCount).toBe(2);
    expect((broken?.nextRunAt as Date).getTime()).toBeGreaterThan(
      (healthy?.nextRunAt as Date).getTime(),
    );
  });
});
