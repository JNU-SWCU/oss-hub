import { Injectable } from '@nestjs/common';
import { PlatformRepository } from '../platform/platform.repository';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type {
  CollectionAppClientTokenProvider,
  CollectionAppClient,
} from './collection-app.client';
import type { ProviderRequestQueueClient } from './provider-request-queue.client';

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;

  tokens: CollectionAppClientTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueueClient;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;

interface SyncLeaseKey {
  appId: bigint;
  scope: string;
}

export interface SyncLeaseToken extends SyncLeaseKey {
  ownerId: string;
  epoch: bigint;
  runId: string;
  expiresAt: Date;
}

export interface AcquireSyncLeaseInput extends SyncLeaseKey {
  ownerId: string;
  runId: string;
  now: Date;
  expiresAt: Date;
}

export type RepositorySource = 'ORG_PROVISIONED' | 'EXTERNAL_PUBLIC';

export type CollectionStreamType =
  'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';

type CollectionRunKind = 'SWEEP' | 'REPOSITORY_LINK';

type CollectionStreamStatus = 'PENDING' | 'BACKFILLING' | 'READY' | 'VERIFYING';

type CollectionRepositoryPresence = 'PRESENT' | 'ABSENT';

type CollectionRepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export interface CollectionRepositoryRow {
  id: string;
  githubOrganizationId: bigint | null;
  githubRepositoryId: bigint;
  nameWithOwner: string;
  defaultBranch: string | null;
  archived: boolean;
  visibility: CollectionRepositoryVisibility;
  presence: CollectionRepositoryPresence;
  source: RepositorySource;
  lastCompleteInventoryObservedAt: Date | null;

  nextRunAt?: Date | null;

  failureCount?: number;

  teamId?: string | null;
  programId?: string | null;
}

export interface RepositoryTeamMemberAccount {
  githubId: bigint;
  nickname: string;
}

export interface CommitFactInput {
  sha: string;
  committedAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export interface PullRequestFactInput {
  githubPullRequestId: bigint;
  state: string;
  createdAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export interface ReleaseFactInput {
  githubReleaseId: bigint;
  publishedAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export interface IssueFactInput {
  githubIssueId: bigint;
  state: string;
  createdAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export type RegisteredGithubIdSet = ReadonlySet<bigint>;

export interface RecordFactsResult {
  readonly acceptedCount: number;
  readonly insertedCount: number;
}

export interface StreamFrontierInput {
  repositoryId: string;
  streamType: CollectionStreamType;
  status?: CollectionStreamStatus;
  frontierSha?: string | null;
  frontierCreatedAt?: Date | null;
  frontierEntityId?: bigint | null;
  requestFingerprint?: string | null;
  etag?: string | null;
  lastRunAt?: Date;
  lastErrorAt?: Date | null;
  lastErrorCode?: string | null;
}

export interface StreamFrontierRow {
  repositoryId: string;
  streamType: CollectionStreamType;
  status: CollectionStreamStatus;
  frontierSha: string | null;
  frontierCreatedAt: Date | null;
  frontierEntityId: bigint | null;
  requestFingerprint: string | null;
  etag: string | null;
  lastRunAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
}

export interface SyncCursorInput {
  appId: bigint;
  scope: string;
  lastGithubRepositoryId?: bigint | null;
  cycleStartedAt?: Date | null;
  cycleCompletedAt?: Date | null;
}

export interface SyncCursorRow {
  appId: bigint;
  scope: string;
  lastGithubRepositoryId: bigint | null;
  cycleStartedAt: Date | null;
  cycleCompletedAt: Date | null;
}

export interface RecordSweepHistoryInput {
  appId: bigint;
  scope: string;
  kind: CollectionRunKind;
  sweepFinishedAt: Date;
  cycleStartedAt: Date | null;
  insertedCommitCount: number;
  insertedPullRequestCount: number;
  insertedReleaseCount: number;
  insertedIssueCount: number;
  attemptedRepositoryCount: number;
  processedRepositoryCount: number;
  failedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
}

type CollectionSyncRunTrigger = 'CRON' | 'MANUAL' | 'CLI' | 'UNKNOWN';

type CollectionSyncRunStatusProjection = 'RUNNING' | 'FAILED' | 'COMPLETED';

export interface CollectionSyncStreamSummary {
  readyCount: number;
  backfillingCount: number;
  pendingCount: number;
  verifyingCount: number;
  failedCount: number;
}

export interface CollectionSyncRunRow {
  runId: string;
  scope: string;
  trigger: CollectionSyncRunTrigger;
  status: CollectionSyncRunStatusProjection;

  startedAt: Date | null;

  lastObservedAt: Date;
  cycleCompletedAt: Date | null;
  streams: CollectionSyncStreamSummary;

  errorCodes: readonly string[];
}

const asiaSeoulDate = (at: Date): Date => {
  const shifted = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
};

const EXTERNAL_SCOPE = 'external';

const sourceForScope = (scope: string): RepositorySource =>
  scope === EXTERNAL_SCOPE ? 'EXTERNAL_PUBLIC' : 'ORG_PROVISIONED';

const triggerForOwnerId = (ownerId: string): CollectionSyncRunTrigger => {
  if (ownerId.startsWith('scheduler:')) return 'CRON';
  if (ownerId.startsWith('admin:')) return 'MANUAL';
  if (ownerId.startsWith('cli:')) return 'CLI';
  return 'UNKNOWN';
};

const emptyStreamSummary = (): CollectionSyncStreamSummary => ({
  readyCount: 0,
  backfillingCount: 0,
  pendingCount: 0,
  verifyingCount: 0,
  failedCount: 0,
});

interface AffectedDay {
  date: Date;
  githubId: bigint | null;
}

type CollectionStoreClient = Pick<
  Prisma.TransactionClient,
  | '$executeRaw'
  | '$executeRawUnsafe'
  | '$queryRaw'
  | '$queryRawUnsafe'
  | 'collectionCommitFact'
  | 'collectionPullRequestFact'
  | 'collectionReleaseFact'
  | 'collectionRepositoryStream'
  | 'collectionSweepHistory'
  | 'collectionSyncCursor'
  | 'collectionSyncLease'
  | 'contribution'
  | 'githubIssueHistory'
  | 'githubRepository'
  | 'githubRepositoryOutsiderContribution'
  | 'teamMember'
  | 'user'
>;

type ContributionFactKind = 'commit' | 'pull_request' | 'issue' | 'release';

interface ContributionFactShape {
  readonly table: string;
  readonly keyColumn: string;
  readonly kind: ContributionFactKind;
  readonly occurredAtColumn: string;
  readonly githubKeySql: string;
}

const CONTRIBUTION_FACT_SHAPES = {
  commit: {
    table: '"CollectionCommitFact"',
    keyColumn: '"sha"',
    kind: 'commit',
    occurredAtColumn: '"committedAt"',
    githubKeySql: 'fact."sha"',
  },
  pull_request: {
    table: '"CollectionPullRequestFact"',
    keyColumn: '"githubPullRequestId"',
    kind: 'pull_request',
    occurredAtColumn: '"createdAt"',
    githubKeySql: 'fact."githubPullRequestId"::text',
  },
  issue: {
    table: '"GithubIssueHistory"',
    keyColumn: '"githubIssueId"',
    kind: 'issue',
    occurredAtColumn: '"createdAt"',
    githubKeySql: 'fact."githubIssueId"::text',
  },
  release: {
    table: '"CollectionReleaseFact"',
    keyColumn: '"githubReleaseId"',
    kind: 'release',
    occurredAtColumn: '"publishedAt"',
    githubKeySql: 'fact."githubReleaseId"::text',
  },
} as const satisfies Record<ContributionFactKind, ContributionFactShape>;

const contributionFactShape = (
  kind: ContributionFactKind,
): ContributionFactShape => CONTRIBUTION_FACT_SHAPES[kind];

interface ContributionInsertSummary {
  readonly missing_repo: number;
  readonly inserted: number;
}

const isContributionInsertSummary = (
  value: unknown,
): value is ContributionInsertSummary => {
  if (value === null || typeof value !== 'object') return false;
  const record = value as { missing_repo?: unknown; inserted?: unknown };
  return (
    Number.isInteger(record.missing_repo) && Number.isInteger(record.inserted)
  );
};

@Injectable()
export class CollectionIncrementalStoreRepository {
  constructor(
    private readonly db: CollectionStoreClient,
    protected readonly platform: PlatformRepository,
  ) {}

  private async inSameTransaction<T>(
    write: (store: CollectionStoreClient) => Promise<T>,
  ): Promise<T> {
    const client = this.db as CollectionStoreClient & {
      $transaction?: (
        operation: (tx: CollectionStoreClient) => Promise<T>,
      ) => Promise<T>;
    };
    if (typeof client.$transaction !== 'function') return write(this.db);
    return client.$transaction((tx) => write(tx));
  }

  async findRepositoryByLogicalKey(
    githubRepositoryId: bigint,
  ): Promise<CollectionRepositoryRow | null> {
    return this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
    });
  }

  async findCollectionTargetByLogicalKey(
    githubRepositoryId: bigint,
  ): Promise<CollectionRepositoryRow | null> {
    return this.db.githubRepository.findUnique({
      where: {
        githubRepositoryId,
        AND: this.platform.collectionTargetWhere(),
      },
    });
  }

  async listRepositoryTeamMembers(
    githubRepositoryId: bigint,
  ): Promise<RepositoryTeamMemberAccount[] | null> {
    const owning = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
      select: { teamId: true },
    });
    const teamId = owning?.teamId ?? null;
    if (teamId === null) return null;
    const members = await this.db.teamMember.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { githubId: true, nickname: true } } },
    });
    return members.map((member) => ({
      githubId: member.user.githubId,
      nickname: member.user.nickname,
    }));
  }

  private async insertAcceptedContributions(
    store: CollectionStoreClient,
    repositoryId: string,
    kind: ContributionFactKind,
    keys: readonly string[] | readonly bigint[],
  ): Promise<void> {
    if (keys.length === 0) {
      throw new Error('contribution insert requires at least one github key');
    }
    const shape = contributionFactShape(kind);
    const rows = await store.$queryRaw<readonly unknown[]>`
      WITH candidates AS (
        SELECT
          repository."githubRepositoryId" AS repo_id,
          ${Prisma.raw(shape.githubKeySql)} AS github_key,
          fact."authorGithubId" AS author_github_id,
          fact.${Prisma.raw(shape.occurredAtColumn)} AT TIME ZONE 'UTC' AS occurred_at,
          fact."observedAt" AT TIME ZONE 'UTC' AS first_seen_at
        FROM ${Prisma.raw(shape.table)} AS fact
        JOIN "GithubRepository" AS repository
          ON repository."id" = fact."repositoryId"
        WHERE fact."repositoryId" = ${repositoryId}
          AND fact.${Prisma.raw(shape.keyColumn)} = ANY(${keys})
      ),
      inserted AS (
        INSERT INTO "contribution" (
          "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
        )
        SELECT
          candidate.repo_id,
          ${Prisma.raw(`'${shape.kind}'::"contribution_kind"`)},
          candidate.github_key,
          candidate.author_github_id,
          candidate.occurred_at,
          candidate.first_seen_at
        FROM candidates AS candidate
        JOIN "repo" ON "repo"."github_repo_id" = candidate.repo_id
        ON CONFLICT ("repo_id", "kind", "github_key") DO NOTHING
        RETURNING 1
      )
      SELECT
        (SELECT count(*)::int FROM candidates AS candidate
          WHERE NOT EXISTS (
            SELECT 1 FROM "repo"
            WHERE "repo"."github_repo_id" = candidate.repo_id
          )) AS missing_repo,
        (SELECT count(*)::int FROM inserted) AS inserted
    `;
    const summary: unknown = rows[0];
    if (!isContributionInsertSummary(summary)) {
      throw new Error('contribution insert summary was not an integer');
    }
    if (summary.missing_repo > 0) {
      process.stderr.write(
        `${JSON.stringify({
          level: 'debug',
          event: 'collection.ledger.contribution_skipped_missing_repo',
          kind,
          missingRepoCount: summary.missing_repo,
        })}\n`,
      );
    }
  }

  async recordCommitFacts(
    repositoryId: string,
    facts: readonly CommitFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { insertedCount } = await this.inSameTransaction(async (store) => {
      const created = await store.collectionCommitFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          sha: fact.sha,
          committedAt: fact.committedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
      await this.insertAcceptedContributions(
        store,
        repositoryId,
        'commit',
        acceptedFacts.map((fact) => fact.sha),
      );
      return { insertedCount: created.count };
    });

    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.committedAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async recordPullRequestFacts(
    repositoryId: string,
    facts: readonly PullRequestFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { insertedCount } = await this.inSameTransaction(async (store) => {
      const created = await store.collectionPullRequestFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          githubPullRequestId: fact.githubPullRequestId,
          state: fact.state,
          createdAt: fact.createdAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
      await this.insertAcceptedContributions(
        store,
        repositoryId,
        'pull_request',
        acceptedFacts.map((fact) => fact.githubPullRequestId),
      );
      return { insertedCount: created.count };
    });

    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.createdAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async recordReleaseFacts(
    repositoryId: string,
    facts: readonly ReleaseFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { insertedCount } = await this.inSameTransaction(async (store) => {
      const created = await store.collectionReleaseFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          githubReleaseId: fact.githubReleaseId,
          publishedAt: fact.publishedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
      await this.insertAcceptedContributions(
        store,
        repositoryId,
        'release',
        acceptedFacts.map((fact) => fact.githubReleaseId),
      );
      return { insertedCount: created.count };
    });

    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.publishedAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async recordIssueFacts(
    repositoryId: string,
    facts: readonly IssueFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { insertedCount } = await this.inSameTransaction(async (store) => {
      const created = await store.githubIssueHistory.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          githubIssueId: fact.githubIssueId,
          state: fact.state,
          createdAt: fact.createdAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
      await this.insertAcceptedContributions(
        store,
        repositoryId,
        'issue',
        acceptedFacts.map((fact) => fact.githubIssueId),
      );
      return { insertedCount: created.count };
    });
    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.createdAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async listRegisteredGithubIds(): Promise<RegisteredGithubIdSet> {
    const users = await this.db.user.findMany({ select: { githubId: true } });
    return new Set(users.map((user) => user.githubId));
  }

  private onlyRegisteredFacts<
    T extends { readonly authorGithubId?: bigint | null },
  >(
    facts: readonly T[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): readonly T[] {
    return facts.filter(
      (fact) =>
        typeof fact.authorGithubId === 'bigint' &&
        registeredGithubIds.has(fact.authorGithubId),
    );
  }

  async enrollExternalRepository(input: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly observedAt: Date;
  }): Promise<boolean> {
    const currentObservation = {
      nameWithOwner: input.nameWithOwner,
      defaultBranch: input.defaultBranch,
      archived: input.archived,
      visibility: 'PUBLIC' as const,
      presence: 'PRESENT' as const,
      lastCompleteInventoryObservedAt: input.observedAt,
    };

    const updated = await this.db.githubRepository.updateMany({
      where: {
        githubRepositoryId: input.githubRepositoryId,
        source: 'EXTERNAL_PUBLIC',
      },
      data: {
        ...currentObservation,
        nextRunAt: input.observedAt,
        failureCount: 0,
      },
    });
    if (updated.count === 0) return false;
    return true;
  }

  async refreshRepositoryObservation(input: {
    readonly source: RepositorySource;
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly visibility: 'PRIVATE' | 'PUBLIC';
    readonly observedAt: Date;
  }): Promise<CollectionRepositoryRow | null> {
    await this.db.githubRepository.updateMany({
      where: {
        githubRepositoryId: input.githubRepositoryId,
        source: input.source,
      },
      data: {
        nameWithOwner: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: input.observedAt,
      },
    });
    const current = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId: input.githubRepositoryId },
    });
    return current?.source === input.source ? current : null;
  }

  async markRepositoryUnavailable(
    githubRepositoryId: bigint,
    unavailable: 'ABSENT' | 'PRIVATE',
    observedAt: Date,
    source: RepositorySource,
  ): Promise<void> {
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId, source },
      data: {
        ...(unavailable === 'ABSENT'
          ? { presence: 'ABSENT' as const }
          : { visibility: 'PRIVATE' as const }),
        lastCompleteInventoryObservedAt: observedAt,
      },
    });
  }

  async recordRepositoryFailure(
    githubRepositoryId: bigint,
    nextRunAtAfter: (failureCount: number) => Date,
  ): Promise<void> {
    const current = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
      select: { failureCount: true },
    });
    const failureCount = (current?.failureCount ?? 0) + 1;
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId },
      data: {
        failureCount,
        nextRunAt: nextRunAtAfter(failureCount),
      },
    });
  }

  async recordRepositorySuccess(
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<void> {
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId },
      data: { failureCount: 0, lastSuccessAt: now, nextRunAt: now },
    });
  }

  private async rebuildAffectedContributions(
    repositoryId: string,
    affected: readonly AffectedDay[],
  ): Promise<void> {
    const targets = new Map<string, { githubId: bigint; date: Date }>();
    for (const entry of affected) {
      if (entry.githubId === null) continue;
      targets.set(`${entry.githubId}:${entry.date.getTime()}`, {
        githubId: entry.githubId,
        date: entry.date,
      });
    }
    if (targets.size === 0) return;

    const rows = [...targets.values()];
    const githubIds = [...new Set(rows.map((row) => row.githubId))];
    const dates = [...new Set(rows.map((row) => row.date.getTime()))].map(
      (time) => new Date(time),
    );

    await this.db.contribution.deleteMany({
      where: { repositoryId, githubId: { in: githubIds }, date: { in: dates } },
    });

    await this.db.$executeRaw`
      INSERT INTO "Contribution" (
        "repositoryId", "githubId", "date",
        "commitCount", "pullRequestCount", "releaseCount", "issueCount", "updatedAt"
      )
      SELECT
        f."repositoryId",
        f."githubId",
        f."day",
        SUM(f."commit")::int,
        SUM(f."pr")::int,
        SUM(f."release")::int,
        SUM(f."issue")::int,
        NOW()
      FROM (
        SELECT "repositoryId", "authorGithubId" AS "githubId",
               ((("committedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date) AS "day",
               1 AS "commit", 0 AS "pr", 0 AS "release", 0 AS "issue"
          FROM "CollectionCommitFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
        UNION ALL
        SELECT "repositoryId", "authorGithubId",
               ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date),
               0, 1, 0, 0
          FROM "CollectionPullRequestFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
        UNION ALL
        SELECT "repositoryId", "authorGithubId",
               ((("publishedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date),
               0, 0, 1, 0
          FROM "CollectionReleaseFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
        UNION ALL
        SELECT "repositoryId", "authorGithubId",
               ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date),
               0, 0, 0, 1
          FROM "GithubIssueHistory"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
      ) AS f
      WHERE f."githubId" = ANY(${githubIds})
        AND f."day" = ANY(${dates.map((date) => date.toISOString().slice(0, 10))}::date[])
      GROUP BY f."repositoryId", f."githubId", f."day"
      ON CONFLICT ("repositoryId", "githubId", "date") DO UPDATE SET
        "commitCount" = EXCLUDED."commitCount",
        "pullRequestCount" = EXCLUDED."pullRequestCount",
        "releaseCount" = EXCLUDED."releaseCount",
        "issueCount" = EXCLUDED."issueCount",
        "updatedAt" = NOW()
    `;
  }

  private async findLatestGithubLogin(
    repositoryId: string,
    githubUserId: bigint,
    start: Date,
    end: Date,
  ): Promise<string | null> {
    const [commit, pullRequest, release] = await Promise.all([
      this.db.collectionCommitFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          committedAt: { gte: start, lt: end },
        },
        orderBy: { committedAt: 'desc' },
        select: { authorGithubLogin: true, committedAt: true },
      }),
      this.db.collectionPullRequestFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          createdAt: { gte: start, lt: end },
        },
        orderBy: { createdAt: 'desc' },
        select: { authorGithubLogin: true, createdAt: true },
      }),
      this.db.collectionReleaseFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          publishedAt: { gte: start, lt: end },
        },
        orderBy: { publishedAt: 'desc' },
        select: { authorGithubLogin: true, publishedAt: true },
      }),
    ]);
    const candidates: Array<{ at: Date; login: string | null }> = [];
    if (commit)
      candidates.push({
        at: commit.committedAt,
        login: commit.authorGithubLogin,
      });
    if (pullRequest) {
      candidates.push({
        at: pullRequest.createdAt,
        login: pullRequest.authorGithubLogin,
      });
    }
    if (release) {
      candidates.push({
        at: release.publishedAt,
        login: release.authorGithubLogin,
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort((left, right) => right.at.getTime() - left.at.getTime());
    const [latest] = candidates;
    return latest ? latest.login : null;
  }

  async upsertStreamFrontier(
    input: StreamFrontierInput,
  ): Promise<StreamFrontierRow> {
    return this.db.collectionRepositoryStream.upsert({
      where: {
        repositoryId_streamType: {
          repositoryId: input.repositoryId,
          streamType: input.streamType,
        },
      },
      create: {
        repositoryId: input.repositoryId,
        streamType: input.streamType,
        status: input.status ?? 'PENDING',
        frontierSha: input.frontierSha ?? null,
        frontierCreatedAt: input.frontierCreatedAt ?? null,
        frontierEntityId: input.frontierEntityId ?? null,
        requestFingerprint: input.requestFingerprint ?? null,
        etag: input.etag ?? null,
        lastRunAt: input.lastRunAt ?? null,
        lastErrorAt: input.lastErrorAt ?? null,
        lastErrorCode: input.lastErrorCode ?? null,
      },
      update: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.frontierSha !== undefined
          ? { frontierSha: input.frontierSha }
          : {}),
        ...(input.frontierCreatedAt !== undefined
          ? { frontierCreatedAt: input.frontierCreatedAt }
          : {}),
        ...(input.frontierEntityId !== undefined
          ? { frontierEntityId: input.frontierEntityId }
          : {}),
        ...(input.requestFingerprint !== undefined
          ? { requestFingerprint: input.requestFingerprint }
          : {}),
        ...(input.etag !== undefined ? { etag: input.etag } : {}),
        ...(input.lastRunAt !== undefined
          ? { lastRunAt: input.lastRunAt }
          : {}),
        ...(input.lastErrorAt !== undefined
          ? { lastErrorAt: input.lastErrorAt }
          : {}),
        ...(input.lastErrorCode !== undefined
          ? { lastErrorCode: input.lastErrorCode }
          : {}),
      },
    });
  }

  async getStreamFrontier(
    repositoryId: string,
    streamType: StreamFrontierInput['streamType'],
  ): Promise<StreamFrontierRow | null> {
    return this.db.collectionRepositoryStream.findUnique({
      where: { repositoryId_streamType: { repositoryId, streamType } },
    });
  }

  async markStreamOutcome(
    repositoryId: string,
    streamType: StreamFrontierInput['streamType'],
    outcome:
      | { readonly checkedAt: Date }
      | { readonly lastErrorAt: Date; readonly lastErrorCode: string },
  ): Promise<void> {
    if ('lastErrorCode' in outcome) {
      await this.upsertStreamFrontier({
        repositoryId,
        streamType,
        lastErrorAt: outcome.lastErrorAt,
        lastErrorCode: outcome.lastErrorCode,
      });
      return;
    }
    await this.db.collectionRepositoryStream.updateMany({
      where: { repositoryId, streamType },
      data: {
        lastRunAt: outcome.checkedAt,
        lastErrorAt: null,
        lastErrorCode: null,
      },
    });
  }

  async upsertSyncCursor(input: SyncCursorInput): Promise<SyncCursorRow> {
    return this.db.collectionSyncCursor.upsert({
      where: {
        appId_scope: {
          appId: input.appId,
          scope: input.scope,
        },
      },
      create: {
        appId: input.appId,
        scope: input.scope,
        lastGithubRepositoryId: input.lastGithubRepositoryId ?? null,
        cycleStartedAt: input.cycleStartedAt ?? null,
        cycleCompletedAt: input.cycleCompletedAt ?? null,
      },
      update: {
        ...(input.lastGithubRepositoryId !== undefined
          ? { lastGithubRepositoryId: input.lastGithubRepositoryId }
          : {}),
        ...(input.cycleStartedAt !== undefined
          ? { cycleStartedAt: input.cycleStartedAt }
          : {}),
        ...(input.cycleCompletedAt !== undefined
          ? { cycleCompletedAt: input.cycleCompletedAt }
          : {}),
      },
    });
  }

  async getSyncCursor(
    appId: bigint,
    scope: string,
  ): Promise<SyncCursorRow | null> {
    return this.db.collectionSyncCursor.findUnique({
      where: { appId_scope: { appId, scope } },
    });
  }

  async recordSweepHistory(input: RecordSweepHistoryInput): Promise<void> {
    await this.db.collectionSweepHistory.create({
      data: {
        appId: input.appId,
        scope: input.scope,
        kind: input.kind,
        sweepFinishedAt: input.sweepFinishedAt,
        cycleStartedAt: input.cycleStartedAt,
        insertedCommitCount: input.insertedCommitCount,
        insertedPullRequestCount: input.insertedPullRequestCount,
        insertedReleaseCount: input.insertedReleaseCount,
        insertedIssueCount: input.insertedIssueCount,
        attemptedRepositoryCount: input.attemptedRepositoryCount,
        processedRepositoryCount: input.processedRepositoryCount,
        failedRepositoryCount: input.failedRepositoryCount,
        cycleCompleted: input.cycleCompleted,
        stoppedForBudget: input.stoppedForBudget,
      },
    });
  }

  async listSyncRuns(
    now: Date,
    limit: number,
  ): Promise<CollectionSyncRunRow[]> {
    const leases = await this.db.collectionSyncLease.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        appId: true,
        scope: true,
        ownerId: true,
        runId: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    if (leases.length === 0) return [];

    const cursors = await this.db.collectionSyncCursor.findMany({
      where: {
        OR: leases.map((lease) => ({
          appId: lease.appId,
          scope: lease.scope,
        })),
      },
      select: {
        appId: true,
        scope: true,
        cycleStartedAt: true,
        cycleCompletedAt: true,
      },
    });
    const cursorKey = (appId: bigint, scope: string): string =>
      `${appId.toString()}:${scope}`;
    const cursorByKey = new Map(
      cursors.map((cursor) => [cursorKey(cursor.appId, cursor.scope), cursor]),
    );

    const summaries = new Map<
      RepositorySource,
      { streams: CollectionSyncStreamSummary; errorCodes: string[] }
    >();
    for (const source of new Set(
      leases.map((lease) => sourceForScope(lease.scope)),
    )) {
      summaries.set(source, await this.summarizeStreams(source));
    }

    return leases.map((lease) => {
      const source = sourceForScope(lease.scope);
      const summary = summaries.get(source) ?? {
        streams: emptyStreamSummary(),
        errorCodes: [],
      };
      const cursor = cursorByKey.get(cursorKey(lease.appId, lease.scope));
      const running = lease.expiresAt.getTime() > now.getTime();
      return {
        runId: lease.runId,
        scope: lease.scope,
        trigger: triggerForOwnerId(lease.ownerId),
        status: running
          ? 'RUNNING'
          : summary.errorCodes.length > 0
            ? 'FAILED'
            : 'COMPLETED',
        startedAt: cursor?.cycleStartedAt ?? null,
        lastObservedAt: lease.updatedAt,
        cycleCompletedAt: cursor?.cycleCompletedAt ?? null,
        streams: summary.streams,
        errorCodes: summary.errorCodes,
      };
    });
  }

  private async summarizeStreams(
    source: RepositorySource,
  ): Promise<{ streams: CollectionSyncStreamSummary; errorCodes: string[] }> {
    const where = { repository: { source, presence: 'PRESENT' } } as const;
    const [statusGroups, errorGroups] = await Promise.all([
      this.db.collectionRepositoryStream.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.db.collectionRepositoryStream.groupBy({
        by: ['lastErrorCode'],
        where: { ...where, lastErrorCode: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const countFor = (status: string): number =>
      statusGroups.find((group) => group.status === status)?._count._all ?? 0;
    const failedGroups = errorGroups.filter(
      (group): group is typeof group & { lastErrorCode: string } =>
        typeof group.lastErrorCode === 'string',
    );
    return {
      streams: {
        readyCount: countFor('READY'),
        backfillingCount: countFor('BACKFILLING'),
        pendingCount: countFor('PENDING'),
        verifyingCount: countFor('VERIFYING'),
        failedCount: failedGroups.reduce(
          (total, group) => total + group._count._all,
          0,
        ),
      },
      errorCodes: failedGroups.map((group) => group.lastErrorCode).sort(),
    };
  }

  async findOutsiderCountingWindow(repositoryId: string): Promise<{
    teamId: string;
    programId: string;
    startAt: Date;
    endAt: Date;
    countedThrough: Date | null;
  } | null> {
    const row = await this.db.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        teamId: true,
        team: {
          select: {
            program: { select: { id: true, startAt: true, endAt: true } },
          },
        },
        outsider: true,
      },
    });
    if (!row || row.teamId === null || row.team === null) return null;
    const counted = row.outsider;
    const sameBasis =
      counted !== null &&
      counted.teamId === row.teamId &&
      counted.programId === row.team.program.id &&
      counted.windowStartAt.getTime() === row.team.program.startAt.getTime() &&
      counted.windowEndAt.getTime() === row.team.program.endAt.getTime();
    return {
      teamId: row.teamId,
      programId: row.team.program.id,
      startAt: row.team.program.startAt,
      endAt: row.team.program.endAt,
      countedThrough: sameBasis ? counted.observedAt : null,
    };
  }

  async countTeamCommitsBetween(
    repositoryId: string,
    memberGithubIds: readonly bigint[],
    since: Date,
    until: Date,
  ): Promise<number> {
    if (memberGithubIds.length === 0) return 0;
    return this.db.collectionCommitFact.count({
      where: {
        repositoryId,
        authorGithubId: { in: [...memberGithubIds] },
        committedAt: { gte: since, lte: until },
      },
    });
  }

  async saveOutsiderContribution(input: {
    repositoryId: string;
    teamId: string;
    programId: string;
    windowStartAt: Date;
    windowEndAt: Date;
    commitCount: number;
    pullRequestCount: number;
    issueCount: number;
    observedAt: Date;
  }): Promise<void> {
    const { repositoryId, ...values } = input;
    await this.db.githubRepositoryOutsiderContribution.upsert({
      where: { repositoryId },
      create: input,
      update: values,
    });
  }

  async listOrganizationRepositories(): Promise<CollectionRepositoryRow[]> {
    return this.db.githubRepository.findMany({
      where: {
        source: 'ORG_PROVISIONED',
        ...this.platform.collectionTargetWhere(),
      },
    });
  }

  async listExternalRepositories(): Promise<CollectionRepositoryRow[]> {
    return this.db.githubRepository.findMany({
      where: {
        source: 'EXTERNAL_PUBLIC',
        ...this.platform.collectionTargetWhere(),
      },
    });
  }

  async acquireSyncLease(
    input: AcquireSyncLeaseInput,
  ): Promise<SyncLeaseToken | null> {
    const rows = await this.db.$queryRawUnsafe<SyncLeaseToken[]>(
      `INSERT INTO "CollectionSyncLease" ("appId", "scope", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT ("appId", "scope") DO UPDATE SET
         "epoch" = "CollectionSyncLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
         "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
       WHERE "CollectionSyncLease"."expiresAt" <= $6
       RETURNING "appId", "scope", "ownerId", "epoch", "runId", "expiresAt"`,
      input.appId,
      input.scope,
      input.ownerId,
      input.expiresAt,
      input.runId,
      input.now,
    );
    return rows[0] ?? null;
  }

  async heartbeatSyncLease(
    token: SyncLeaseToken,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "CollectionSyncLease" SET "expiresAt" = $6, "updatedAt" = $5
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "expiresAt" > $5 AND "runId" = $7`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      now,
      expiresAt,
      token.runId,
    );
    if (count !== 1) throw new Error('Collection sync lease is stale');
  }

  async releaseSyncLease(token: SyncLeaseToken, now: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE "CollectionSyncLease" SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
  }

  async assertSyncLeaseValid(token: SyncLeaseToken, now: Date): Promise<void> {
    const rows = await this.db.$queryRawUnsafe<Array<{ owned: boolean }>>(
      `SELECT true AS "owned" FROM "CollectionSyncLease" WHERE "appId" = $1 AND "scope" = $2
       AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5 AND "expiresAt" > $6 FOR UPDATE`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
    if (!rows[0]) throw new Error('Collection sync lease is stale');
  }
}

@Injectable()
export class CollectionIncrementalRepository extends CollectionIncrementalStoreRepository {
  constructor(
    private readonly prisma: PrismaService,
    platform: PlatformRepository,
  ) {
    super(prisma, platform);
  }

  async runInTransaction<T>(
    fn: (store: CollectionIncrementalStoreRepository) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn(new CollectionIncrementalStoreRepository(tx, this.platform)),
    );
  }

  override async enrollExternalRepository(
    input: Parameters<
      CollectionIncrementalStoreRepository['enrollExternalRepository']
    >[0],
  ): Promise<boolean> {
    return this.runInTransaction((store) =>
      store.enrollExternalRepository(input),
    );
  }
}
