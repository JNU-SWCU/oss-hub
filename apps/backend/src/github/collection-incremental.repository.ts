import { Injectable } from '@nestjs/common';
import { PlatformRepository } from '../platform/platform.repository';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { RepoLedgerRepository } from '../platform/repo-ledger.repository';
import type {
  CollectionAppClientTokenProvider,
  CollectionAppClient,
  CollectionContribution,
  CollectionContributionKind,
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

  teamId?: string | null;
  programId?: string | null;
}

export interface CollectionTarget extends CollectionRepositoryRow {
  lastSuccessAt: Date | null;
}

export interface RecordContributionsResult {
  readonly inserted: number;
  readonly authorFilled: number;
}

type CollectionStoreClient = Pick<
  Prisma.TransactionClient,
  | '$executeRaw'
  | '$executeRawUnsafe'
  | '$queryRaw'
  | '$queryRawUnsafe'
  | 'collectionSyncLease'
  | 'githubRepository'
  | 'repo'
>;

interface ContributionInsertSummary {
  readonly candidates: number;
  readonly missing_repo: number;
  readonly inserted: number;
  readonly author_filled: number;
}

const isContributionInsertSummary = (
  value: unknown,
): value is ContributionInsertSummary => {
  if (value === null || typeof value !== 'object') return false;
  const record = value as {
    candidates?: unknown;
    missing_repo?: unknown;
    inserted?: unknown;
    author_filled?: unknown;
  };
  return (
    Number.isInteger(record.candidates) &&
    Number.isInteger(record.missing_repo) &&
    Number.isInteger(record.inserted) &&
    Number.isInteger(record.author_filled)
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

  async recordContributions(
    repositoryId: string,
    kind: CollectionContributionKind,
    facts: readonly CollectionContribution[],
  ): Promise<RecordContributionsResult> {
    if (facts.length === 0) return { inserted: 0, authorFilled: 0 };
    return this.inSameTransaction((store) =>
      this.insertContributions(store, repositoryId, kind, facts),
    );
  }

  private async insertContributions(
    store: CollectionStoreClient,
    repositoryId: string,
    kind: CollectionContributionKind,
    facts: readonly CollectionContribution[],
  ): Promise<RecordContributionsResult> {
    const incoming = Prisma.join(
      facts.map(
        (fact) =>
          Prisma.sql`(${fact.githubKey}::text, ${fact.authorGithubId}::bigint, ${fact.occurredAt}::timestamptz)`,
      ),
    );
    const rows = await store.$queryRaw<readonly unknown[]>`
      WITH incoming(github_key, author_github_id, occurred_at) AS (
        VALUES ${incoming}
      ),
      repository_row AS (
        SELECT ${repositoryId}::text AS repository_id
      ),
      ensured_repo AS (
        INSERT INTO "repo" ("github_repo_id", "owner_name", "source", "gone_at")
        SELECT
          repository."githubRepositoryId",
          repository."nameWithOwner",
          repository."source",
          CASE
            WHEN repository."presence" = 'ABSENT' THEN repository."updatedAt"
            ELSE NULL
          END
        FROM "GithubRepository" AS repository
        JOIN repository_row AS row
          ON repository."id" = row.repository_id
        ON CONFLICT ("github_repo_id") DO NOTHING
        RETURNING "github_repo_id"
      ),
      present_repo AS (
        SELECT ensured."github_repo_id"
        FROM ensured_repo AS ensured
        UNION
        SELECT existing."github_repo_id"
        FROM "repo" AS existing
        JOIN "GithubRepository" AS repository
          ON repository."githubRepositoryId" = existing."github_repo_id"
        JOIN repository_row AS row
          ON repository."id" = row.repository_id
      ),
      candidates AS (
        SELECT
          repository."githubRepositoryId" AS repo_id,
          incoming.github_key,
          incoming.author_github_id,
          incoming.occurred_at,
          CURRENT_TIMESTAMP AS first_seen_at
        FROM incoming
        CROSS JOIN repository_row AS row
        JOIN "GithubRepository" AS repository
          ON repository."id" = row.repository_id
      ),
      inserted AS (
        INSERT INTO "contribution" (
          "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
        )
        SELECT
          candidate.repo_id,
          ${kind}::"contribution_kind",
          candidate.github_key,
          candidate.author_github_id,
          candidate.occurred_at,
          candidate.first_seen_at
        FROM candidates AS candidate
        JOIN present_repo AS present
          ON present."github_repo_id" = candidate.repo_id
        ON CONFLICT ("repo_id", "kind", "github_key") DO UPDATE
          SET "author_github_id" = EXCLUDED."author_github_id"
          WHERE "contribution"."author_github_id" IS NULL
            AND EXCLUDED."author_github_id" IS NOT NULL
        RETURNING ("xmax" = 0) AS fresh
      )
      SELECT
        (SELECT count(*)::int FROM candidates) AS candidates,
        (SELECT count(*)::int FROM candidates AS candidate
          WHERE NOT EXISTS (
            SELECT 1 FROM present_repo AS present
            WHERE present."github_repo_id" = candidate.repo_id
          )) AS missing_repo,
        (SELECT count(*)::int FROM inserted WHERE fresh) AS inserted,
        (SELECT count(*)::int FROM inserted WHERE NOT fresh) AS author_filled
    `;
    const summary: unknown = rows[0];
    if (!isContributionInsertSummary(summary)) {
      throw new Error('contribution insert summary was not an integer');
    }
    if (summary.missing_repo > 0 || summary.candidates < facts.length) {
      process.stderr.write(
        `${JSON.stringify({
          level: 'debug',
          event: 'collection.ledger.contribution_skipped_missing_repo',
          kind,
          missingRepoCount: summary.missing_repo,
          candidateCount: summary.candidates,
        })}\n`,
      );
      throw new Error(
        `contribution repository row is missing: missing_repo=${summary.missing_repo} candidates=${summary.candidates}`,
      );
    }
    return { inserted: summary.inserted, authorFilled: summary.author_filled };
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

    return this.inSameTransaction(async (store) => {
      const updated = await store.githubRepository.updateMany({
        where: {
          githubRepositoryId: input.githubRepositoryId,
          source: 'EXTERNAL_PUBLIC',
        },
        data: currentObservation,
      });
      if (updated.count === 0) return false;
      await new RepoLedgerRepository().write(store, input.githubRepositoryId);
      return true;
    });
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
    await this.inSameTransaction(async (store) => {
      await store.githubRepository.updateMany({
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
      await new RepoLedgerRepository().write(store, input.githubRepositoryId);
    });
    const current = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId: input.githubRepositoryId },
    });
    return current?.source === input.source ? current : null;
  }

  async markRepositoryGone(
    githubRepositoryId: bigint,
    observedAt: Date,
    source: RepositorySource,
  ): Promise<void> {
    await this.inSameTransaction(async (store) => {
      await store.githubRepository.updateMany({
        where: { githubRepositoryId, source },
        data: {
          presence: 'ABSENT',
          lastCompleteInventoryObservedAt: observedAt,
        },
      });
      await new RepoLedgerRepository().write(store, githubRepositoryId);
    });
  }

  async recordRepositorySuccess(
    githubRepositoryIds: readonly bigint[],
    succeededAt: Date,
  ): Promise<void> {
    if (githubRepositoryIds.length === 0) return;
    await this.db.$executeRaw`
      UPDATE "repo"
      SET "last_success_at" = ${succeededAt}
      WHERE "github_repo_id" IN (${Prisma.join(githubRepositoryIds)})
    `;
  }

  async listCollectionTargets(
    source: RepositorySource,
  ): Promise<CollectionTarget[]> {
    const repositories = await this.db.githubRepository.findMany({
      where: {
        source,
        presence: 'PRESENT',
        ...(source === 'EXTERNAL_PUBLIC' ? { visibility: 'PUBLIC' } : {}),
        ...this.platform.collectionTargetWhere(),
      },
      orderBy: { githubRepositoryId: 'asc' },
    });
    const ledger = await this.db.repo.findMany({
      where: {
        githubRepoId: {
          in: repositories.map((repository) => repository.githubRepositoryId),
        },
      },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
    const lastSuccessAt = new Map(
      ledger.map((row) => [row.githubRepoId, row.lastSuccessAt]),
    );
    return repositories.map((repository) => ({
      ...repository,
      lastSuccessAt: lastSuccessAt.get(repository.githubRepositoryId) ?? null,
    }));
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
