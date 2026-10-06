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
  CollectionIssue,
  CollectionPullRequest,
  CollectionRelease,
  CollectionRepository as ProviderRepository,
  CommitHeadProbeResult,
  CommitTraversalResult,
  IssueIncrementalResult,
  PullRequestIncrementalResult,
  ReleaseListingResult,
  ReleaseProbeResult,
} from '../collection-app.client';
import type { CollectionAppTokenProvider } from '../collection-app.token';
import type { RequestFingerprint } from '../collection-app.frontier';
import { ProviderRequestQueue } from '../collection-provider-queue';

type Row = Record<string, unknown>;

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
  issueFacts: Map<string, Row>;
  contributions: Map<string, Row>;
  recomputeCalls: number;
  streams: Map<string, Row>;
  cursors: Map<string, Row>;
  leases: Map<string, Row>;

  owningRepositories: Map<string, Row>;

  teamMembers: Map<string, Row>;

  sweepHistory: Map<string, Row>;
}

const emptyStore = (): Store => ({
  repositories: new Map(),
  commitFacts: new Map(),
  pullRequestFacts: new Map(),
  releaseFacts: new Map(),
  issueFacts: new Map(),
  contributions: new Map(),
  recomputeCalls: 0,
  streams: new Map(),
  cursors: new Map(),
  leases: new Map(),
  owningRepositories: new Map(),
  teamMembers: new Map(),
  sweepHistory: new Map(),
});

const cloneStore = (store: Store): Store => ({
  repositories: new Map(store.repositories),
  commitFacts: new Map(store.commitFacts),
  pullRequestFacts: new Map(store.pullRequestFacts),
  releaseFacts: new Map(store.releaseFacts),
  issueFacts: new Map(store.issueFacts),
  contributions: new Map(store.contributions),
  recomputeCalls: store.recomputeCalls,
  streams: new Map(store.streams),
  cursors: new Map(store.cursors),
  leases: new Map(store.leases),
  owningRepositories: new Map(store.owningRepositories),
  teamMembers: new Map(store.teamMembers),
  sweepHistory: new Map(store.sweepHistory),
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
  failPullRequestIds: Set<bigint>;

  failSweepHistoryWrite: boolean;
  failRegisteredGithubIdsLookup: boolean;
  registeredGithubIds: Set<bigint>;
  registeredGithubIdsLookupCount: number;
}

const repoKey = (repoId: bigint): string => String(repoId);
const cursorKey = (appId: bigint, scope: string): string =>
  `${String(appId)}:${scope}`;

function makeFacade(box: { store: Store }, control: FailureControl): unknown {
  return {
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
      }): Row | null => {
        const key = repoKey(where.githubRepositoryId);
        const base = box.store.repositories.get(key);
        const owning = box.store.owningRepositories.get(key);
        if (base === undefined && owning === undefined) return null;
        return { ...(base ?? {}), ...(owning ?? {}) };
      },

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
          if (box.store.commitFacts.has(key)) continue;
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
        const failing = data.find((item) =>
          control.failPullRequestIds.has(item.githubPullRequestId),
        );
        if (failing) {
          throw new Error(
            `synthetic pull request fact failure: ${String(failing.githubPullRequestId)}`,
          );
        }
        let count = 0;
        for (const item of data) {
          const key = `${item.repositoryId}:${String(item.githubPullRequestId)}`;
          if (box.store.pullRequestFacts.has(key)) continue;
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
          if (box.store.releaseFacts.has(key)) continue;
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
    githubIssueHistory: {
      createMany: ({
        data,
      }: {
        data: ReadonlyArray<
          Row & { repositoryId: string; githubIssueId: bigint }
        >;
      }): { count: number } => {
        let count = 0;
        for (const item of data) {
          const key = `${item.repositoryId}:${String(item.githubIssueId)}`;
          if (box.store.issueFacts.has(key)) continue;
          box.store.issueFacts.set(key, {
            id: `issue-${box.store.issueFacts.size + 1}`,
            ...item,
          });
          count += 1;
        }
        return { count };
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

    user: {
      findMany: jest.fn(() => {
        control.registeredGithubIdsLookupCount += 1;
        if (control.failRegisteredGithubIdsLookup) {
          throw new Error('synthetic registered github id lookup failure');
        }
        return [...control.registeredGithubIds].map((githubId) => ({
          githubId,
        }));
      }),
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

    $executeRaw: (query: TemplateStringsArray): number => {
      void query;
      box.store.recomputeCalls += 1;
      return 1;
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

    collectionSweepHistory: {
      create: ({ data }: { data: Row }): Row => {
        if (control.failSweepHistoryWrite) {
          throw new Error('synthetic sweep history write failure');
        }
        const row = {
          id: `sweep-history-${box.store.sweepHistory.size + 1}`,
          ...data,
        };
        box.store.sweepHistory.set(row.id, row);
        return row;
      },
    },

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
  const control: FailureControl = {
    failCommitShas: new Set(),
    failPullRequestIds: new Set(),
    failSweepHistoryWrite: false,
    failRegisteredGithubIdsLookup: false,
    registeredGithubIds: new Set([1n, 11n, 22n, 33n, 98n, 99n]),
    registeredGithubIdsLookupCount: 0,
  };
  const box = { store: emptyStore() };
  const db = makeFacade(box, control) as PrismaService;
  return { db, box, control };
}

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
  getRepository: jest.Mock<Promise<ProviderRepository>, [string, string]>;
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
  listNewIssues: jest.Mock<Promise<IssueIncrementalResult>, unknown[]>;
  resolveUserNodeId: jest.Mock<Promise<string | null>, [string]>;
  listDefaultBranchCommitsByAuthor: jest.Mock<
    Promise<CollectionCommit[]>,
    [string, string, string, string, (string | undefined)?]
  >;
  countDefaultBranchCommitsBetween: jest.Mock<
    Promise<number | null>,
    [string, string, string, string, string]
  >;
}

function createClient(repositories: ProviderRepository[]): ClientMock {
  return {
    listInstallationRepositories: jest
      .fn<Promise<ProviderRepository[]>, []>()
      .mockResolvedValue(repositories),
    getRepository: jest
      .fn<Promise<ProviderRepository>, [string, string]>()
      .mockImplementation((owner, name) =>
        Promise.resolve(
          providerRepository({
            id: '555',
            name,
            fullName: `${owner}/${name}`,
            ownerLogin: owner,
          }),
        ),
      ),
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
    listNewIssues: jest
      .fn<Promise<IssueIncrementalResult>, unknown[]>()
      .mockResolvedValue({
        issues: [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/issues'),
      } satisfies IssueIncrementalResult),

    resolveUserNodeId: jest
      .fn<Promise<string | null>, [string]>()
      .mockImplementation((login) => Promise.resolve(`node:${login}`)),
    listDefaultBranchCommitsByAuthor: jest
      .fn<
        Promise<CollectionCommit[]>,
        [string, string, string, string, (string | undefined)?]
      >()
      .mockResolvedValue([]),
    countDefaultBranchCommitsBetween: jest
      .fn<Promise<number | null>, [string, string, string, string, string]>()
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

    client.listCommitsUntilKnownSha.mockRejectedValue(new Error('boom'));
    client.probeDefaultBranchHead.mockResolvedValue({
      changed: true,
      headSha: null,
      fingerprint: fingerprint('/repos/o/r/commits'),
      etag: null,
    });

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

    const existing = box.store.repositories.get(repoKey(777n));
    expect(existing?.presence).toBe('PRESENT');

    expect(client.listCommitsUntilKnownSha).toHaveBeenCalled();
  });
});

describe('CollectionSyncService — GR-6 external 저장소는 org sweep에서 살아남는다', () => {
  it('service.run()의 완전한 org inventory 관찰이 EXTERNAL_PUBLIC 저장소를 ABSENT로 바꾸지 않는다', async () => {
    const { db, box } = createFakeDb();

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

      applicationId: 'application-external',
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

      applicationId: 'application-external',
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

    expect(result.status).toBe('COMPLETED');
    expect(client.listInstallationRepositories).not.toHaveBeenCalled();

    const stream = box.store.streams.get('repo-external:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBe('external-head-sha');

    expect(box.store.commitFacts.size).toBe(1);
    const fact = [...box.store.commitFacts.values()][0];
    expect(fact?.sha).toBe('external-head-sha');
    expect(fact?.repositoryId).toBe('repo-external');

    expect(box.store.recomputeCalls).toBeGreaterThan(0);
  });

  it('외부 저장소 404를 완전 관찰하면 기존 fact를 지우지 않고 ABSENT로 회수하며 stream을 실행하지 않는다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external-missing',
      githubOrganizationId: null,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/missing-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),

      applicationId: 'application-external',
    });
    const client = createClient([]);
    client.getRepository.mockRejectedValue(
      new CollectionAppClientError('NOT_FOUND'),
    );
    quietStreams(client);
    const result = await createServiceWithExternal(db, client).runExternal(
      'owner-1',
    );

    expect(result.inventoryComplete).toBe(true);
    expect(box.store.repositories.get(repoKey(555n))).toMatchObject({
      visibility: 'PUBLIC',
      presence: 'ABSENT',
    });
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();
    expect(client.listNewPullRequests).not.toHaveBeenCalled();
    expect(client.probeLatestRelease).not.toHaveBeenCalled();
  });

  it('외부 저장소가 private이면 공개 상태를 즉시 회수하고 stream에서 제외한다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external-private',
      githubOrganizationId: null,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/private-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),

      applicationId: 'application-external',
    });
    const client = createClient([]);
    client.getRepository.mockResolvedValue(
      providerRepository({
        id: '555',
        name: 'private-repo',
        fullName: 'student/private-repo',
        ownerLogin: 'student',
        private: true,
        defaultBranch: null,
      }),
    );
    quietStreams(client);

    const result = await createServiceWithExternal(db, client).runExternal(
      'owner-1',
    );

    expect(result.inventoryComplete).toBe(true);
    expect(box.store.repositories.get(repoKey(555n))).toMatchObject({
      visibility: 'PRIVATE',
      presence: 'PRESENT',
    });
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();
  });

  it('metadata 확인 뒤 stream이 권한 거부되면 외부 저장소를 즉시 PRIVATE로 회수한다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external-stream-revoked',
      githubOrganizationId: null,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/revoked-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),

      applicationId: 'application-external',
    });
    const client = createClient([]);
    quietStreams(client);
    client.getRepository.mockResolvedValue(
      providerRepository({
        id: '555',
        name: 'revoked-repo',
        fullName: 'student/revoked-repo',
        ownerLogin: 'student',
        private: false,
      }),
    );
    client.listCommitsUntilKnownSha.mockRejectedValue(
      new CollectionAppClientError('PERMISSION'),
    );

    await createServiceWithExternal(db, client).runExternal('owner-1');

    expect(box.store.repositories.get(repoKey(555n))).toMatchObject({
      visibility: 'PRIVATE',
      presence: 'PRESENT',
    });
    expect(client.listNewPullRequests).not.toHaveBeenCalled();
    expect(client.probeLatestRelease).not.toHaveBeenCalled();
  });

  it('외부 metadata 일시 실패는 기존 PUBLIC/PRESENT 관찰을 회수하지 않는다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(555n), {
      id: 'repo-external-transient',
      githubOrganizationId: null,
      githubRepositoryId: 555n,
      nameWithOwner: 'student/transient-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),

      applicationId: 'application-external',
    });
    const client = createClient([]);
    client.getRepository.mockRejectedValue(
      new CollectionAppClientError('UPSTREAM'),
    );
    quietStreams(client);

    const result = await createServiceWithExternal(db, client).runExternal(
      'owner-1',
    );

    expect(result.inventoryComplete).toBe(false);
    expect(box.store.repositories.get(repoKey(555n))).toMatchObject({
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      lastCompleteInventoryObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(client.listCommitsUntilKnownSha).not.toHaveBeenCalled();
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

describe('CollectionSyncService — 새것이 없는 확인도 확인 시각을 남긴다(#1133)', () => {
  it('네 stream 모두 checkpoint 없이 조기 반환해도 lastRunAt은 이번 확인 시각이 된다', async () => {
    const NOW = new Date('2026-08-01T00:00:00.000Z');
    const PREVIOUS = new Date('2026-07-01T00:00:00.000Z');
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
      lastCompleteInventoryObservedAt: PREVIOUS,
    });
    const ready = (streamType: string, frontier: Row) =>
      box.store.streams.set(`repo-1:${streamType}`, {
        repositoryId: 'repo-1',
        streamType,
        status: 'READY',
        frontierSha: null,
        frontierCreatedAt: null,
        frontierEntityId: null,
        requestFingerprint: 'fp',
        etag: null,
        lastRunAt: PREVIOUS,
        lastErrorAt: PREVIOUS,
        lastErrorCode: DEFAULT_STREAM_ERROR_CODE,
        ...frontier,
      });
    ready('COMMIT', { frontierSha: 'known-head', etag: 'etag-known' });
    ready('PULL_REQUEST', {
      frontierCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
      frontierEntityId: 7n,
    });
    ready('RELEASE', { etag: 'etag-release' });
    ready('ISSUE', {
      frontierCreatedAt: new Date('2026-07-21T00:00:00.000Z'),
      frontierEntityId: 9n,
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
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [],
      newFrontier: { createdAt: '2026-07-20T00:00:00.000Z', id: '7' },
      fingerprint: fingerprint('/repos/o/r/pulls'),
    });
    client.listNewIssues.mockResolvedValue({
      issues: [],
      newFrontier: { createdAt: '2026-07-21T00:00:00.000Z', id: '9' },
      fingerprint: fingerprint('/repos/o/r/issues'),
    });

    await createService(db, client, { now: () => NOW }).run('owner-1');

    for (const streamType of ['COMMIT', 'PULL_REQUEST', 'RELEASE', 'ISSUE']) {
      expect(box.store.streams.get(`repo-1:${streamType}`)).toMatchObject({
        status: 'READY',
        lastRunAt: NOW,
        lastErrorAt: null,
        lastErrorCode: null,
      });
    }

    expect(box.store.streams.get('repo-1:COMMIT')?.frontierSha).toBe(
      'known-head',
    );
    expect(box.store.streams.get('repo-1:PULL_REQUEST')).toMatchObject({
      frontierCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
      frontierEntityId: 7n,
    });
    expect(box.store.pullRequestFacts.size).toBe(0);
    expect(client.listCommitsUntilKnownSha).not.toHaveBeenCalled();
    expect(client.listChangedPublishedReleases).not.toHaveBeenCalled();
  });
});

describe('CollectionSyncService — fenced transactions and lease safety', () => {
  it('가입자 스냅샷 조회가 실패하면 inventory와 fact write 전에 run을 실패시킨다', async () => {
    const { db, box, control } = createFakeDb();
    control.failRegisteredGithubIdsLookup = true;
    const client = createClient([providerRepository()]);

    const result = await createService(db, client).run('owner-1');

    expect(result.status).toBe('FAILED');
    expect(control.registeredGithubIdsLookupCount).toBe(1);
    expect(client.listInstallationRepositories).not.toHaveBeenCalled();
    expect(box.store.repositories.size).toBe(0);
    expect(box.store.commitFacts.size).toBe(0);
    expect(box.store.pullRequestFacts.size).toBe(0);
    expect(box.store.releaseFacts.size).toBe(0);
  });

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

    expect(result.status).toBe('COMPLETED');

    expect(result.cycleCompleted).toBe(true);

    expect(result.processedRepositoryCount).toBe(0);

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

    const service = createService(db, client);
    const originalRepository = new CollectionIncrementalRepository(db);
    const originalAcquire =
      originalRepository.acquireSyncLease.bind(originalRepository);
    jest
      .spyOn(CollectionIncrementalRepository.prototype, 'acquireSyncLease')
      .mockImplementationOnce(async (input) => {
        const token = await originalAcquire(input);
        if (token) {
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

    const service = createService(db, client);
    const result = await service.run('owner-1');
    expect(result.status).toBe('COMPLETED');
  });
});

describe('CollectionSyncService — durable cursor draining a mixed fixture across budget-limited runs', () => {
  it('drains a 100-repository fixture fairly across multiple runs via the durable continuation cursor, never restarting at repo 1', async () => {
    const { db, control } = createFakeDb();
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
          commits: [commit({ sha: `sha-${repoName}` })],
          disconnectedFullScan: true,
          fingerprint: fingerprint('/repos/o/r/commits'),
        });
      });
      return client;
    }

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

    expect(new Set(processedOrder).size).toBe(100);
    expect(runs).toBeGreaterThan(1);

    expect(control.registeredGithubIdsLookupCount).toBe(runs);
    stopAfter = Number.MAX_SAFE_INTEGER;
  });
});

describe('CollectionSyncService — #546 트리거 결과 추적', () => {
  const streamOf = (box: { store: Store }, streamType: string): Row => {
    const repoId = [...box.store.repositories.values()][0]?.id as string;
    return box.store.streams.get(`${repoId}:${streamType}`) ?? {};
  };

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

    expect(stream.status).toBe('PENDING');
  });

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

    expect(stream.lastErrorCode).toBe(DEFAULT_STREAM_ERROR_CODE);
    expect(stream.lastErrorAt).toBeInstanceOf(Date);

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

    let clock = new Date('2026-08-01T00:00:00.000Z');
    const service = createService(db, client, { now: () => clock });
    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBe('PROVIDER_UPSTREAM');

    clock = new Date('2026-08-01T09:00:00.000Z');
    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBeNull();
    expect(streamOf(box, 'COMMIT').lastErrorAt).toBeNull();

    await service.run('owner-1');
    expect(streamOf(box, 'COMMIT').lastErrorCode).toBeNull();
  });

  it('run budget 소진(deadline)은 오류로 기록하지 않는다', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    quietStreams(client);

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
    ...(teamId === null ? {} : { applicationId: `application:${teamId}` }),
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

    expect(client.listCommitsUntilKnownSha).not.toHaveBeenCalled();
    expect(client.probeDefaultBranchHead).not.toHaveBeenCalled();

    const facts = [...box.store.commitFacts.values()];
    expect(facts.map((fact) => fact.sha).sort()).toEqual([
      'sha-alice',
      'sha-bob',
    ]);

    const stream = box.store.streams.get('repo-1:COMMIT');
    expect(stream?.status).toBe('READY');
    expect(stream?.frontierSha).toBeNull();
    expect(stream?.etag).toBeNull();
  });

  it('팀이 없는 저장소는 기존 저장소 전량 REST 경로로 떨어진다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();

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
                authoredCommit('sha-carol-old', 'carol', '33'),
                authoredCommit('sha-carol-new', 'carol', '33'),
              ],
        ),
    );

    const service = createService(db, client);
    await service.run('owner-1');
    expect([...box.store.commitFacts.values()]).toHaveLength(1);

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

    expect(
      box.store.streams.get('repo-1:COMMIT')?.lastErrorCode ?? null,
    ).toBeNull();
  });
});

describe('CollectionSyncService — 팀원이 아닌 사람의 기여(#1133)', () => {
  const NOW = new Date('2026-08-01T00:00:00.000Z');
  const WINDOW = {
    applicationId: 'application-1',
    programId: 'program-1',
    startAt: new Date('2026-07-09T15:00:00.000Z'),
    endAt: new Date('9999-12-31T23:59:59.999Z'),
    countedThrough: null as Date | null,
  };
  const pullRequestItem = (
    id: string,
    createdAt: string,
    authorLogin: string | null,
    authorGithubId: string | null,
  ): CollectionPullRequest => ({
    id,
    number: Number(id),
    state: 'open',
    draft: false,
    mergedAt: null,
    createdAt,
    updatedAt: createdAt,
    authorLogin,
    authorGithubId,
    htmlUrl: `https://example.invalid/pull/${id}`,
  });
  const issueItem = (
    id: string,
    createdAt: string,
    authorLogin: string | null,
    authorGithubId: string | null,
  ): CollectionIssue => ({
    id,
    state: 'open',
    createdAt,
    authorLogin,
    authorGithubId,
  });

  const isWindowCall = (frontier: unknown): boolean =>
    (frontier as { id?: string } | null)?.id === '0';

  const seedTeamRepository = () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    return { db, box, client: createClient([repository]) };
  };

  afterEach(() => jest.restoreAllMocks());

  const spyWindow = (window: typeof WINDOW | null = WINDOW) =>
    jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'findOutsiderCountingWindow',
      )
      .mockResolvedValue(window);
  const spyTeamCommits = (count: number) =>
    jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'countTeamCommitsBetween',
      )
      .mockResolvedValue(count);
  const spySave = () =>
    jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'saveOutsiderContribution',
      )
      .mockResolvedValue();

  it('커밋은 기간 전체 − 팀원합으로, PR·Issue는 팀원도 봇도 아닌 계정의 것만 세어 한 행으로 덮어쓴다', async () => {
    const { db, client } = seedTeamRepository();
    client.countDefaultBranchCommitsBetween.mockResolvedValue(7);
    const pullRequests = [
      pullRequestItem('7', '2026-07-20T00:00:00Z', 'outsider', '99'),
      pullRequestItem('6', '2026-07-19T00:00:00Z', 'alice', '11'),
      pullRequestItem('5', '2026-07-18T00:00:00Z', 'renovate[bot]', '2740'),
    ];
    client.listNewPullRequests.mockImplementation((_o, _r, frontier) =>
      Promise.resolve({
        pullRequests: isWindowCall(frontier) ? pullRequests : [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      }),
    );
    const issues = [
      issueItem('9', '2026-07-21T00:00:00Z', 'outsider-2', '98'),
      issueItem('8', '2026-07-21T00:00:00Z', 'alice', '11'),
      issueItem('10', '2026-07-22T00:00:00Z', null, null),
    ];
    client.listNewIssues.mockImplementation((_o, _r, frontier) =>
      Promise.resolve({
        issues: isWindowCall(frontier) ? issues : [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/issues'),
      }),
    );
    spyWindow();
    const team = spyTeamCommits(5);
    const save = spySave();

    await createService(db, client, { now: () => NOW }).run('owner-1');

    expect(client.countDefaultBranchCommitsBetween).toHaveBeenCalledWith(
      'synthetic-org',
      'repo',
      'main',
      '2026-07-09T15:00:00Z',
      '2026-08-01T00:00:00Z',
    );
    expect(team).toHaveBeenCalledWith(
      'repo-1',
      [11n],
      new Date('2026-07-09T15:00:00.000Z'),
      NOW,
    );
    expect(client.listNewPullRequests).toHaveBeenCalledWith(
      'synthetic-org',
      'repo',
      { createdAt: '2026-07-09T15:00:00.000Z', id: '0' },
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      applicationId: 'application-1',
      programId: 'program-1',
      windowStartAt: WINDOW.startAt,
      windowEndAt: WINDOW.endAt,
      commitCount: 2,
      pullRequestCount: 1,
      issueCount: 1,
      observedAt: NOW,
    });
  });

  it('끝난 프로그램은 종료 시각까지만 센다', async () => {
    const { db, client } = seedTeamRepository();
    const endAt = new Date('2026-07-20T14:59:59.999Z');
    client.listNewPullRequests.mockImplementation((_o, _r, frontier) =>
      Promise.resolve({
        pullRequests: isWindowCall(frontier)
          ? [
              pullRequestItem('8', '2026-07-25T00:00:00Z', 'outsider', '99'),
              pullRequestItem('7', '2026-07-19T00:00:00Z', 'outsider', '99'),
            ]
          : [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      }),
    );
    spyWindow({ ...WINDOW, endAt });
    spyTeamCommits(0);
    const save = spySave();

    await createService(db, client, { now: () => NOW }).run('owner-1');

    expect(client.countDefaultBranchCommitsBetween).toHaveBeenCalledWith(
      'synthetic-org',
      'repo',
      'main',
      '2026-07-09T15:00:00Z',
      '2026-07-20T14:59:59Z',
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestCount: 1, windowEndAt: endAt }),
    );
  });

  it('끝난 프로그램을 끝난 뒤 이미 셌다면 다시 세지 않는다', async () => {
    const endAt = new Date('2026-07-20T14:59:59.999Z');

    const running = seedTeamRepository();
    spyWindow({
      ...WINDOW,
      endAt,
      countedThrough: new Date('2026-07-20T00:00:00Z'),
    });
    spyTeamCommits(0);
    const save = spySave();
    await createService(running.db, running.client, { now: () => NOW }).run(
      'owner-1',
    );
    expect(save).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    const closed = seedTeamRepository();
    spyWindow({
      ...WINDOW,
      endAt,
      countedThrough: new Date('2026-07-21T00:00:00Z'),
    });
    const skipped = spySave();
    await createService(closed.db, closed.client, { now: () => NOW }).run(
      'owner-1',
    );
    expect(
      closed.client.countDefaultBranchCommitsBetween,
    ).not.toHaveBeenCalled();
    expect(closed.client.listNewPullRequests).not.toHaveBeenCalledWith(
      'synthetic-org',
      'repo',
      expect.objectContaining({ id: '0' }),
    );
    expect(skipped).not.toHaveBeenCalled();
  });

  it('기본 브랜치가 없으면 커밋은 0으로, 전체가 팀원합보다 작으면 옛 값을 둔다', async () => {
    const first = seedTeamRepository();
    first.client.countDefaultBranchCommitsBetween.mockResolvedValue(null);
    spyWindow();
    spyTeamCommits(0);
    const save = spySave();
    await createService(first.db, first.client, { now: () => NOW }).run(
      'owner-1',
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ commitCount: 0 }),
    );

    save.mockClear();
    const second = seedTeamRepository();
    second.client.countDefaultBranchCommitsBetween.mockResolvedValue(1);
    spyTeamCommits(2);
    await createService(second.db, second.client, { now: () => NOW }).run(
      'owner-1',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('신청 연결이 없는 저장소는 세지 않는다', async () => {
    const { db, client } = seedTeamRepository();
    spyWindow(null);
    const save = spySave();

    await createService(db, client, { now: () => NOW }).run('owner-1');

    expect(client.countDefaultBranchCommitsBetween).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('팀이 없는 저장소는 기준 프로그램도 찾지 않는다', async () => {
    const { db } = createFakeDb();
    const client = createClient([providerRepository()]);
    const find = spyWindow();

    await createService(db, client, { now: () => NOW }).run('owner-1');

    expect(find).not.toHaveBeenCalled();
    expect(client.countDefaultBranchCommitsBetween).not.toHaveBeenCalled();
  });

  it('세다가 실패해도 저장소 수집은 성공으로 두고 옛 값을 건드리지 않는다', async () => {
    const { db, box, client } = seedTeamRepository();
    client.listNewIssues.mockImplementation((_o, _r, frontier) =>
      isWindowCall(frontier)
        ? Promise.reject(new Error('synthetic outsider failure'))
        : Promise.resolve({
            issues: [],
            newFrontier: null,
            fingerprint: fingerprint('/repos/o/r/issues'),
          }),
    );
    spyWindow();
    spyTeamCommits(0);
    const save = spySave();
    const warned = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await createService(db, client, { now: () => NOW }).run('owner-1');

    expect(save).not.toHaveBeenCalled();
    expect(
      warned.mock.calls.map(
        ([payload]) => (payload as Record<string, unknown>).event,
      ),
    ).toContain('collection.sync.outsider_contribution_failed');
    expect(
      box.store.streams.get('repo-1:ISSUE')?.lastErrorCode ?? null,
    ).toBeNull();
    expect(
      box.store.repositories.get(repoKey(BigInt(providerRepository().id)))
        ?.failureCount ?? 0,
    ).toBe(0);
  });
});

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

    const storedFacts = [
      ...box.store.pullRequestFacts.values(),
      ...box.store.releaseFacts.values(),
    ]
      .flatMap((fact) => Object.values(fact).map((value) => String(value)))
      .join('|');
    expect(storedFacts).not.toMatch(/outsider/);
    expect(storedFacts).not.toMatch(/\b99\b/);

    expect(box.store.recomputeCalls).toBe(2);
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

    expect(afterFirst?.frontierEntityId).toBe(401n);
    expect(afterFirst?.frontierCreatedAt).toEqual(
      new Date('2026-08-02T00:00:00.000Z'),
    );

    served.push(
      pullRequest({ id: '402', createdAt: '2026-08-03T00:00:00.000Z' }),
    );
    await service.run('owner-1');

    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toEqual({
      createdAt: '2026-08-02T00:00:00.000Z',
      id: '401',
    });

    expect(
      [...box.store.pullRequestFacts.values()]
        .map((fact) => String(fact.githubPullRequestId))
        .sort(),
    ).toEqual(['400', '402']);
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      402n,
    );
  });

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

    await service.run('owner-1');
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      400n,
    );

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

    expect(storedPullRequestLogins(box)).toEqual(['alice']);
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierEntityId).toBe(
      402n,
    );

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

    expect(client.probeLatestRelease.mock.calls[1]?.[2]).toBe('etag-release-1');
    expect(client.listChangedPublishedReleases).toHaveBeenCalledTimes(1);
  });

  it('나중에 합류한 팀원의 과거 PR·릴리스를 다음 sweep에 한 번만 백필한다', async () => {
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
    expect(client.listNewPullRequests.mock.calls[0]?.[2]).toBeNull();

    box.store.teamMembers.set('later', {
      id: 'later',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 6, 15)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    await service.run('owner-1');

    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toBeNull();
    expect(storedPullRequestLogins(box)).toEqual(['carol']);

    expect(storedReleaseLogins(box)).toEqual(['carol']);

    await service.run('owner-1');

    expect(client.listNewPullRequests.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-07-01T00:00:00.000Z',
      id: '410',
    });
    expect(box.store.pullRequestFacts.size).toBe(1);
  });

  it('run snapshot 뒤 가입한 팀원은 처리 표식에서 빼 다음 run에 과거 PR을 백필한다', async () => {
    const { db, box, control } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const davePullRequest = pullRequest({
      id: '420',
      createdAt: '2026-06-01T00:00:00.000Z',
      authorLogin: 'dave',
      authorGithubId: '44',
    });
    const client = createClient([repository]);
    client.listNewPullRequests.mockImplementation(
      servePullRequests([davePullRequest]),
    );
    client.listInstallationRepositories.mockImplementationOnce(() => {
      box.store.teamMembers.set('joined-after-snapshot', {
        id: 'joined-after-snapshot',
        teamId: 'team-1',
        createdAt: new Date(Date.UTC(2026, 5, 1)),
        user: { githubId: 44n, nickname: 'dave' },
      });
      return Promise.resolve([repository]);
    });

    const service = createService(db, client);
    await service.run('owner-1');
    expect(storedPullRequestLogins(box)).toEqual([]);

    control.registeredGithubIds.add(44n);
    await service.run('owner-1');

    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toBeNull();
    expect(storedPullRequestLogins(box)).toEqual(['dave']);
  });

  it('기존 READY PR stream의 null 팀원 표식을 한 번 repair하고 다음 sweep은 증분으로 돌아간다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const served = [
      pullRequest({ id: '400' }),
      pullRequest({
        id: '401',
        createdAt: '2026-08-02T00:00:00.000Z',
        authorLogin: 'outsider',
        authorGithubId: OUTSIDER_ID,
      }),
    ];
    client.listNewPullRequests.mockImplementation(servePullRequests(served));
    const service = createService(db, client);

    await service.run('owner-1');
    const streamKey = 'repo-1:PULL_REQUEST';
    const current = box.store.streams.get(streamKey);
    expect(current?.frontierSha).toMatch(/^team-members:v1:[0-9a-f]{64}$/);

    box.store.streams.set(streamKey, { ...current, frontierSha: null });
    box.store.pullRequestFacts.clear();
    box.store.contributions.clear();

    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toBeNull();
    expect(storedPullRequestLogins(box)).toEqual(['alice']);
    expect(box.store.streams.get(streamKey)?.frontierSha).toMatch(
      /^team-members:v1:[0-9a-f]{64}$/,
    );

    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-08-02T00:00:00.000Z',
      id: '401',
    });
  });

  it('팀원 fingerprint는 조회 순서에는 불변이고 같은 인원수의 계정 교체에는 변한다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
      { githubId: 22n, nickname: 'bob' },
    ]);
    const client = createClient([repository]);
    client.listNewPullRequests.mockImplementation(
      servePullRequests([pullRequest({ id: '400' })]),
    );
    const service = createService(db, client);

    await service.run('owner-1');
    const initialMarker = box.store.streams.get(
      'repo-1:PULL_REQUEST',
    )?.frontierSha;

    const reversed = [...box.store.teamMembers.entries()].reverse();
    box.store.teamMembers.clear();
    for (const [id, member] of reversed) box.store.teamMembers.set(id, member);
    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toEqual({
      createdAt: '2026-08-01T00:00:00.000Z',
      id: '400',
    });
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierSha).toBe(
      initialMarker,
    );

    box.store.teamMembers.delete(`${String(repository.id)}:1`);
    box.store.teamMembers.set('same-count-replacement', {
      id: 'same-count-replacement',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 6, 15)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[2]?.[2]).toBeNull();
    expect(box.store.streams.get('repo-1:PULL_REQUEST')?.frontierSha).not.toBe(
      initialMarker,
    );
  });

  it('팀원 변화 repair 중 PR fact 저장이 실패하면 marker와 tie를 함께 롤백하고 재시도한다', async () => {
    const { db, box, control } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: MEMBER_ID, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const served = [pullRequest({ id: '400' })];
    client.listNewPullRequests.mockImplementation(servePullRequests(served));

    let clock = new Date('2026-08-01T00:00:00.000Z');
    const service = createService(db, client, { now: () => clock });

    await service.run('owner-1');
    const streamKey = 'repo-1:PULL_REQUEST';
    const before = box.store.streams.get(streamKey);
    box.store.teamMembers.set('later', {
      id: 'later',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 6, 15)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    served.push(
      pullRequest({
        id: '410',
        createdAt: '2026-07-01T00:00:00.000Z',
        authorLogin: 'carol',
        authorGithubId: '33',
      }),
    );
    control.failPullRequestIds.add(410n);

    clock = new Date('2026-08-03T09:00:00.000Z');
    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[1]?.[2]).toBeNull();
    expect(box.store.streams.get(streamKey)?.frontierSha).toBe(
      before?.frontierSha,
    );
    expect(box.store.streams.get(streamKey)?.frontierEntityId).toBe(
      before?.frontierEntityId,
    );
    expect(storedPullRequestLogins(box)).toEqual(['alice']);

    control.failPullRequestIds.delete(410n);
    clock = new Date('2026-08-04T09:00:00.000Z');
    await service.run('owner-1');
    expect(client.listNewPullRequests.mock.calls[2]?.[2]).toBeNull();
    expect(storedPullRequestLogins(box).sort()).toEqual(['alice', 'carol']);
    expect(box.store.streams.get(streamKey)?.frontierSha).not.toBe(
      before?.frontierSha,
    );
  });

  it('팀을 특정할 수 없는 저장소는 provider 전량을 읽되 중앙 writer가 가입자만 적재한다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();

    const client = createClient([repository]);
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [
        pullRequest({
          id: '401',
          authorLogin: 'outsider',
          authorGithubId: OUTSIDER_ID,
        }),
        pullRequest({
          id: '402',
          authorLogin: 'unregistered-outsider',
          authorGithubId: '999',
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
        release({
          id: '602',
          authorLogin: 'unregistered-outsider',
          authorGithubId: '999',
        }),
      ],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });

    await createService(db, client).run('owner-1');

    expect(storedPullRequestLogins(box)).toEqual(['outsider']);
    expect(storedReleaseLogins(box)).toEqual(['outsider']);
  });
});

describe('CollectionSyncService — Issue stream(#1133)', () => {
  type ListingItem = CollectionIssue & { pullRequest?: boolean };

  const issue = (overrides: Partial<ListingItem> = {}): ListingItem => ({
    id: '800',
    state: 'open',
    createdAt: '2026-08-01T00:00:00.000Z',
    authorLogin: 'alice',
    authorGithubId: '11',
    ...overrides,
  });

  const serveIssueListing =
    (listing: readonly ListingItem[]) =>
    (...args: unknown[]): Promise<IssueIncrementalResult> => {
      const tie = args[2] as { createdAt: string; id: string } | null;
      const fresh = [...listing]
        .sort((a, b) => {
          const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          return byCreatedAt !== 0
            ? byCreatedAt
            : Number(BigInt(b.id) - BigInt(a.id));
        })
        .filter(
          (item) =>
            tie === null ||
            (Date.parse(item.createdAt) === Date.parse(tie.createdAt)
              ? BigInt(item.id) > BigInt(tie.id)
              : Date.parse(item.createdAt) > Date.parse(tie.createdAt)),
        );
      return Promise.resolve({
        issues: fresh.filter((item) => !item.pullRequest),
        newFrontier: fresh[0]
          ? { createdAt: fresh[0].createdAt, id: fresh[0].id }
          : tie,
        fingerprint: fingerprint('/repos/o/r/issues'),
      });
    };

  const storedIssueIds = (box: { store: Store }): string[] =>
    [...box.store.issueFacts.values()]
      .map((fact) => String(fact.githubIssueId))
      .sort();

  it('팀원 issue만 적재하고 비팀원·작성자 불명 issue는 fact로 남기지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listNewIssues.mockImplementation(
      serveIssueListing([
        issue({ id: '800' }),

        issue({ id: '801', authorLogin: 'outsider', authorGithubId: '99' }),
        issue({ id: '802', authorLogin: null, authorGithubId: null }),
      ]),
    );

    const result = await createService(db, client).run('owner-1');

    expect(storedIssueIds(box)).toEqual(['800']);
    expect([...box.store.issueFacts.values()][0]).toMatchObject({
      authorGithubId: 11n,
      state: 'open',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(result.insertedFactCount).toBe(1);
    const stream = box.store.streams.get('repo-1:ISSUE');
    expect(stream?.status).toBe('READY');

    expect(stream?.frontierEntityId).toBe(802n);
  });

  it('새로 읽힌 원본이 PR뿐이어도 Issue 커서가 전진해 다음 sweep이 같은 페이지를 다시 받지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    const listing = [issue({ id: '800' })];
    client.listNewIssues.mockImplementation(serveIssueListing(listing));
    const service = createService(db, client);

    await service.run('owner-1');
    expect(box.store.streams.get('repo-1:ISSUE')?.frontierEntityId).toBe(800n);

    listing.push(
      issue({
        id: '801',
        createdAt: '2026-08-02T00:00:00.000Z',
        pullRequest: true,
      }),
      issue({
        id: '802',
        createdAt: '2026-08-03T00:00:00.000Z',
        pullRequest: true,
      }),
    );
    await service.run('owner-1');
    const afterPullRequests = box.store.streams.get('repo-1:ISSUE');
    expect(afterPullRequests?.frontierEntityId).toBe(802n);
    expect(afterPullRequests?.frontierCreatedAt).toEqual(
      new Date('2026-08-03T00:00:00.000Z'),
    );
    expect(storedIssueIds(box)).toEqual(['800']);

    await service.run('owner-1');
    expect(client.listNewIssues.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-08-03T00:00:00.000Z',
      id: '802',
    });
  });

  it('팀원 구성이 바뀐 sweep은 Issue 커서를 버리고 한 번 전부 다시 읽은 뒤 증분으로 돌아간다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listNewIssues.mockImplementation(
      serveIssueListing([
        issue({ id: '800' }),
        issue({
          id: '790',
          createdAt: '2026-07-01T00:00:00.000Z',
          authorLogin: 'carol',
          authorGithubId: '33',
        }),
      ]),
    );
    const service = createService(db, client);

    await service.run('owner-1');
    expect(client.listNewIssues.mock.calls[0]?.[2]).toBeNull();
    expect(storedIssueIds(box)).toEqual(['800']);

    box.store.teamMembers.set('later', {
      id: 'later',
      teamId: 'team-1',
      createdAt: new Date(Date.UTC(2026, 6, 15)),
      user: { githubId: 33n, nickname: 'carol' },
    });
    await service.run('owner-1');

    expect(client.listNewIssues.mock.calls[1]?.[2]).toBeNull();
    expect(storedIssueIds(box)).toEqual(['790', '800']);
    expect(box.store.streams.get('repo-1:ISSUE')?.frontierSha).toMatch(
      /^team-members:v1:[0-9a-f]{64}$/,
    );

    await service.run('owner-1');
    expect(client.listNewIssues.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-08-01T00:00:00.000Z',
      id: '800',
    });
  });

  it('Issue 권한이 없으면 오류는 ISSUE 행에만 남고 저장소는 실패로 세지 않는다', async () => {
    const { db, box } = createFakeDb();
    const repository = providerRepository();
    const client = createClient([repository]);
    client.listCommitsUntilKnownSha.mockResolvedValue({
      commits: [commit({ sha: 'sha-kept' })],
      disconnectedFullScan: true,
      fingerprint: fingerprint('/repos/o/r/commits'),
    });

    client.listNewIssues.mockRejectedValue(
      new CollectionAppClientError('PERMISSION'),
    );

    const result = await createService(db, client).run('owner-1');

    expect(result.status).toBe('COMPLETED');
    expect(result.processedRepositoryCount).toBe(1);
    expect([...box.store.commitFacts.values()].map((fact) => fact.sha)).toEqual(
      ['sha-kept'],
    );
    expect(box.store.streams.get('repo-1:ISSUE')?.lastErrorCode).toBe(
      'PROVIDER_PERMISSION',
    );

    expect(box.store.repositories.get(repoKey(100n))?.failureCount ?? 0).toBe(
      0,
    );
    expect(box.store.streams.get('repo-1:COMMIT')?.lastErrorCode ?? null).toBe(
      null,
    );

    expect(box.store.repositories.get(repoKey(100n))?.visibility).toBe(
      'PUBLIC',
    );
  });

  it('Issue 목록의 다른 오류는 다른 stream처럼 저장소 실패로 센다', async () => {
    const { db, box } = createFakeDb();
    const client = createClient([providerRepository()]);
    client.listNewIssues.mockRejectedValue(
      new CollectionAppClientError('UPSTREAM'),
    );

    const result = await createService(db, client).run('owner-1');

    expect(result.processedRepositoryCount).toBe(0);
    expect(box.store.streams.get('repo-1:ISSUE')?.lastErrorCode).toBe(
      'PROVIDER_UPSTREAM',
    );
    expect(box.store.repositories.get(repoKey(100n))?.failureCount).toBe(1);
  });
});

describe('CollectionSyncService — 실패 저장소 격리 (DD1)', () => {
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

    expect(result.processedRepositoryCount).toBe(1);

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

    expect(broken?.failureCount).toBe(1);
    expect(broken?.nextRunAt).toBeInstanceOf(Date);

    const healthyNext = healthy?.nextRunAt as Date;
    expect((broken?.nextRunAt as Date).getTime()).toBeGreaterThan(
      healthyNext.getTime(),
    );

    expect(healthy?.failureCount).toBe(0);
    expect(healthy?.lastSuccessAt).toBeInstanceOf(Date);
  });
});

describe('CollectionSyncService — 시스템 상태 관측성 2단계: sweep-history 기록', () => {
  const historyPullRequest = (
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

  const historyRelease = (
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

  function seedRepositoryWithOneOfEachStream(): {
    db: PrismaService;
    box: { store: Store };
    control: FailureControl;
    client: ClientMock;
  } {
    const { db, box, control } = createFakeDb();
    const repository = providerRepository();
    seedOwningRepository(box, BigInt(repository.id), 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([repository]);
    client.listDefaultBranchCommitsByAuthor.mockResolvedValue([
      commit({ sha: 'sha-1', authorLogin: 'alice', authorGithubId: '11' }),
    ]);
    client.listNewPullRequests.mockResolvedValue({
      pullRequests: [historyPullRequest()],
      newFrontier: { createdAt: '2026-08-01T00:00:00.000Z', id: '400' },
      fingerprint: fingerprint('/repos/o/r/pulls'),
    });
    client.probeLatestRelease.mockResolvedValue({
      changed: true,
      frontier: { probe: '600:false:2026-08-01T00:00:00.000Z' },
      fingerprint: fingerprint('/repos/o/r/releases'),
      etag: 'etag-release-1',
    });
    client.listChangedPublishedReleases.mockResolvedValue({
      releases: [historyRelease()],
      fingerprint: fingerprint('/repos/o/r/releases'),
    });
    return { db, box, control, client };
  }

  it('사이클 완료 sweep 하나가 CollectionSweepHistory에 stream별 건수·부울 결과를 정확히 남긴다', async () => {
    const { db, box, client } = seedRepositoryWithOneOfEachStream();
    const now = new Date('2026-08-01T12:00:00.000Z');
    const service = createService(db, client, { now: () => now });

    const result = await service.run('owner-1');

    expect(result.insertedFactCount).toBe(3);
    expect(result.cycleCompleted).toBe(true);
    expect(result.stoppedForBudget).toBe(false);

    const rows = [...box.store.sweepHistory.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      appId: 1n,
      scope: 'org:synthetic-org',
      kind: 'SWEEP',
      sweepFinishedAt: now,
      cycleStartedAt: now,
      insertedCommitCount: 1,
      insertedPullRequestCount: 1,
      insertedReleaseCount: 1,
      insertedIssueCount: 0,
      attemptedRepositoryCount: 1,
      processedRepositoryCount: 1,
      failedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
    });
  });

  it('앞 stream 적재 뒤 다음 stream이 실패해도 이미 커밋된 건수를 이력에 남긴다', async () => {
    const { db, box, client } = seedRepositoryWithOneOfEachStream();
    client.listNewPullRequests.mockRejectedValue(
      new Error('synthetic pull request failure'),
    );
    const now = new Date('2026-08-01T12:00:00.000Z');
    const service = createService(db, client, { now: () => now });

    const result = await service.run('owner-1');

    expect(result.insertedFactCount).toBe(1);
    const rows = [...box.store.sweepHistory.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      insertedCommitCount: 1,
      insertedPullRequestCount: 0,
      insertedReleaseCount: 0,
      attemptedRepositoryCount: 1,
      processedRepositoryCount: 0,
      failedRepositoryCount: 1,
      cycleCompleted: true,
    });
  });

  it('순회가 넣은 Issue 수도 이력에 남긴다(#1133)', async () => {
    const { db, box, client } = seedRepositoryWithOneOfEachStream();
    client.listNewIssues.mockResolvedValue({
      issues: [
        {
          id: '700',
          state: 'open',
          createdAt: '2026-08-01T00:00:00.000Z',
          authorLogin: 'alice',
          authorGithubId: '11',
        },
      ],
      newFrontier: { createdAt: '2026-08-01T00:00:00.000Z', id: '700' },
      fingerprint: fingerprint('/repos/o/r/issues'),
    });
    const service = createService(db, client, {
      now: () => new Date('2026-08-01T12:00:00.000Z'),
    });

    const result = await service.run('owner-1');

    expect(result.insertedFactCount).toBe(4);
    expect([...box.store.sweepHistory.values()]).toEqual([
      expect.objectContaining({
        kind: 'SWEEP',
        insertedCommitCount: 1,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 1,
        insertedIssueCount: 1,
      }),
    ]);
  });

  it('진행 중이던 사이클(커서가 이미 어느 저장소까지 진행함)에서는 그 cycleStartedAt을 그대로 이어 기록한다', async () => {
    const { db, box, client } = seedRepositoryWithOneOfEachStream();

    const priorCycleStartedAt = new Date('2026-07-31T09:00:00.000Z');
    box.store.cursors.set(cursorKey(1n, 'org:synthetic-org'), {
      appId: 1n,
      scope: 'org:synthetic-org',
      lastGithubRepositoryId: 50n,
      cycleStartedAt: priorCycleStartedAt,
      cycleCompletedAt: null,
    });
    const now = new Date('2026-08-01T12:00:00.000Z');
    const service = createService(db, client, { now: () => now });

    await service.run('owner-1');

    const rows = [...box.store.sweepHistory.values()];
    expect(rows[0]).toMatchObject({
      sweepFinishedAt: now,
      cycleStartedAt: priorCycleStartedAt,
    });
  });

  it('sweep-history 기록이 실패해도 sweep 자체의 결과(반환값·커서 전진)는 막지 않는다', async () => {
    const { db, box, control, client } = seedRepositoryWithOneOfEachStream();
    control.failSweepHistoryWrite = true;
    const warned = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = createService(db, client);

    const result = await service.run('owner-1');

    expect(result.cycleCompleted).toBe(true);
    expect(result.processedRepositoryCount).toBe(1);
    expect(result.insertedFactCount).toBe(3);

    expect(box.store.sweepHistory.size).toBe(0);

    const observed = warned.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find(
        (payload) =>
          payload?.event === 'collection.sync.sweep_history_write_failed',
      );
    expect(observed).toMatchObject({ scope: 'org:synthetic-org' });
    warned.mockRestore();
  });
});

describe('CollectionSyncService — 연결 직후 저장소 1건 수집 (runRepository)', () => {
  const NOW = new Date('2026-08-01T00:00:00.000Z');
  const ORG_LEASE = cursorKey(1n, 'org:synthetic-org');
  const linkedRow = (overrides: Row = {}): Row => ({
    id: 'repo-linked',
    githubOrganizationId: GITHUB_ORG_ID,
    githubRepositoryId: 100n,
    nameWithOwner: 'synthetic-org/linked',
    defaultBranch: 'main',
    archived: false,
    visibility: 'PRIVATE',
    presence: 'PRESENT',
    source: 'ORG_PROVISIONED',
    lastCompleteInventoryObservedAt: new Date('2026-07-01T00:00:00.000Z'),
    applicationId: 'application-1',
    programId: 'program-1',
    teamId: 'team-1',
    ...overrides,
  });
  const providerCallCount = (client: ClientMock): number =>
    (Object.values(client) as jest.Mock[]).reduce<number>(
      (total, mock) => total + mock.mock.calls.length,
      0,
    );

  it('연결된 조직 저장소를 sweep cursor 없이 바로 수집하고, 이력에는 연결 즉시 수집 한 줄을 남긴다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(100n), linkedRow());
    seedOwningRepository(box, 100n, 'team-1', [
      { githubId: 11n, nickname: 'alice' },
    ]);
    const client = createClient([]);
    client.listDefaultBranchCommitsByAuthor.mockResolvedValue([
      commit({ sha: 'sha-linked', authorLogin: 'alice', authorGithubId: '11' }),
    ]);

    const result = await createService(db, client).runRepository(
      'owner-link',
      100n,
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 1,
      insertedFactCount: 1,
    });
    expect(client.listInstallationRepositories).not.toHaveBeenCalled();
    expect([...box.store.commitFacts.values()]).toEqual([
      expect.objectContaining({
        repositoryId: 'repo-linked',
        sha: 'sha-linked',
      }),
    ]);
    expect(box.store.repositories.get(repoKey(100n))).toMatchObject({
      failureCount: 0,
      lastSuccessAt: NOW,
    });
    expect(box.store.cursors.size).toBe(0);

    expect([...box.store.sweepHistory.values()]).toEqual([
      expect.objectContaining({
        appId: 1n,
        scope: 'org:synthetic-org',
        kind: 'REPOSITORY_LINK',
        cycleStartedAt: null,
        insertedCommitCount: 1,
        insertedPullRequestCount: 0,
        insertedReleaseCount: 0,
        insertedIssueCount: 0,
        attemptedRepositoryCount: 1,
        processedRepositoryCount: 1,
        failedRepositoryCount: 0,
        cycleCompleted: false,
        stoppedForBudget: false,
      }),
    ]);

    expect(box.store.leases.get(ORG_LEASE)).toMatchObject({ expiresAt: NOW });
  });

  it('sweep이 scope lease를 쥐고 있으면 provider를 부르지 않고 SKIPPED_LEASE_HELD다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(100n), linkedRow());
    box.store.leases.set(ORG_LEASE, {
      appId: 1n,
      scope: 'org:synthetic-org',
      ownerId: 'scheduler:sweep',
      epoch: 1n,
      runId: 'sweep-run',
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const client = createClient([]);

    const result = await createService(db, client).runRepository(
      'owner-link',
      100n,
    );

    expect(result.status).toBe('SKIPPED_LEASE_HELD');
    expect(providerCallCount(client)).toBe(0);
    expect(box.store.sweepHistory.size).toBe(0);
    expect(box.store.leases.get(ORG_LEASE)).toMatchObject({
      runId: 'sweep-run',
    });
  });

  it.each([
    [
      '조직 밖 비공개 저장소',
      {
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PRIVATE',
        githubOrganizationId: null,
      },
    ],
    ['기본 브랜치를 아직 모르는 저장소', { defaultBranch: null }],
    ['연결이 풀리고 팀 이력만 남은 저장소', { applicationId: null }],
    [
      '프로그램 삭제로 연결이 모두 풀린 조직 밖 저장소',
      {
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PUBLIC',
        githubOrganizationId: null,
        applicationId: null,
        programId: null,
        teamId: null,
      },
    ],
    ['사라진 저장소', { presence: 'ABSENT' }],
  ])(
    '%s는 lease도 provider도 건드리지 않고 SKIPPED다',
    async (_label, overrides) => {
      const { db, box } = createFakeDb();
      box.store.repositories.set(repoKey(100n), linkedRow(overrides));
      const client = createClient([]);

      const result = await createServiceWithExternal(db, client).runRepository(
        'owner-link',
        100n,
      );

      expect(result.status).toBe('SKIPPED');
      expect(providerCallCount(client)).toBe(0);
      expect(box.store.leases.size).toBe(0);
      expect(box.store.sweepHistory.size).toBe(0);
    },
  );

  it('rate budget이 바닥이면 sweep 루프처럼 provider를 부르지 않고 멈춘다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(100n), linkedRow());
    const client = createClient([]);
    const runtime = runtimeFor(client);
    jest.spyOn(runtime.queue, 'shouldStop').mockReturnValue(true);
    const service = new CollectionSyncService(
      new CollectionIncrementalRepository(db),
      () => runtime,
      () => Promise.resolve(GITHUB_ORG_ID),
      () => NOW,
      () => 'run-1',
    );

    const result = await service.runRepository('owner-link', 100n);

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 0,
      stoppedForBudget: true,
    });
    expect(providerCallCount(client)).toBe(0);
    expect(box.store.repositories.get(repoKey(100n))?.lastSuccessAt).toBe(
      undefined,
    );
    expect([...box.store.sweepHistory.values()]).toEqual([
      expect.objectContaining({
        kind: 'REPOSITORY_LINK',
        attemptedRepositoryCount: 0,
        processedRepositoryCount: 0,
        stoppedForBudget: true,
      }),
    ]);
  });

  it('수집 직전에 다시 읽어 보니 연결이 풀려 있으면 수집도 이력도 남기지 않는다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(repoKey(100n), linkedRow());
    const client = createClient([]);
    const detached = { ...linkedRow(), applicationId: null };
    const read = jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'findRepositoryByLogicalKey',
      )

      .mockResolvedValueOnce(linkedRow() as never)
      .mockResolvedValueOnce(detached as never);

    const result = await createService(db, client).runRepository(
      'owner-link',
      100n,
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(result.processedRepositoryCount).toBe(0);
    expect(providerCallCount(client)).toBe(0);
    expect(box.store.sweepHistory.size).toBe(0);
    read.mockRestore();
  });

  it('sweep 도중 연결이 풀린 저장소는 시작할 때 읽은 목록에 있어도 수집하지 않는다', async () => {
    const { db, box } = createFakeDb();
    box.store.repositories.set(
      repoKey(100n),
      linkedRow({ id: 'repo-a', nameWithOwner: 'synthetic-org/repo-a' }),
    );
    box.store.repositories.set(
      repoKey(200n),
      linkedRow({
        id: 'repo-b',
        githubRepositoryId: 200n,
        nameWithOwner: 'synthetic-org/repo-b',
        applicationId: 'application-b',
        teamId: 'team-b',
      }),
    );
    const client = createClient([
      providerRepository({ name: 'repo-a', fullName: 'synthetic-org/repo-a' }),
      providerRepository({
        id: '200',
        name: 'repo-b',
        fullName: 'synthetic-org/repo-b',
      }),
    ]);
    client.listNewPullRequests.mockImplementation((_owner, repo) => {
      if (repo === 'repo-a') {
        box.store.repositories.set(repoKey(200n), {
          ...box.store.repositories.get(repoKey(200n)),
          applicationId: null,
        });
      }
      return Promise.resolve({
        pullRequests: [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      });
    });

    const result = await createService(db, client).run('owner-1');

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 1,
    });
    expect(
      client.listNewPullRequests.mock.calls.map(([, repo]) => repo),
    ).toEqual(['repo-a']);

    expect(box.store.repositories.get(repoKey(200n))?.failureCount ?? 0).toBe(
      0,
    );
  });
});
