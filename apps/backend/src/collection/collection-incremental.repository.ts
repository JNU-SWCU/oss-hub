import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CollectionRepositoryRow,
  CommitFactInput,
  ContributorYearAggregateRow,
  PullRequestFactInput,
  RecordFactsResult,
  RecordRepositoryObservationInput,
  ReleaseFactInput,
  RepositoryYearAggregateRow,
  StreamFrontierInput,
  StreamFrontierRow,
  SyncCursorInput,
  SyncCursorRow,
} from './collection-incremental.types';
import { zeroRepositoryYearAggregate } from './collection-incremental.types';
import type {
  AcquireSyncLeaseInput,
  SyncLeaseToken,
} from './collection-sync.types';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Asia/Seoul(UTC+9, DST 없음) 기준 연도. */
export const asiaSeoulYear = (at: Date): number =>
  new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();

const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === UNIQUE_CONSTRAINT_VIOLATION;

@Injectable()
export class CollectionIncrementalRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Runs `fn` against a repository instance scoped to one Prisma interactive
   * transaction — a mid-callback throw rolls back every write `fn` made
   * through it. Used by the todo 8 generation import command so a failure
   * partway through one repository's facts/streams never leaves that
   * repository in a half-imported state (the run simply does not progress
   * for that repository, and can be retried from scratch next time).
   */
  async runInTransaction<T>(
    fn: (repo: CollectionIncrementalRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction((tx) =>
      fn(new CollectionIncrementalRepository(tx as unknown as PrismaService)),
    );
  }

  /**
   * complete inventory 관찰 1건을 반영한다. visibility/presence 갱신은 이 경로로만
   * 일어난다(DEC-46) — partial 관찰은 이 메서드를 호출하지 않는다.
   */
  async recordRepositoryObservation(
    input: RecordRepositoryObservationInput,
  ): Promise<CollectionRepositoryRow> {
    return this.db.collectionRepository.upsert({
      where: {
        githubOrganizationId_githubRepositoryId: {
          githubOrganizationId: input.githubOrganizationId,
          githubRepositoryId: input.githubRepositoryId,
        },
      },
      create: {
        githubOrganizationId: input.githubOrganizationId,
        githubRepositoryId: input.githubRepositoryId,
        fullName: input.fullName,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        lastCompleteInventoryObservedAt: input.observedAt,
      },
      update: {
        fullName: input.fullName,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        lastCompleteInventoryObservedAt: input.observedAt,
      },
    });
  }

  async findRepositoryByLogicalKey(
    githubOrganizationId: bigint,
    githubRepositoryId: bigint,
  ): Promise<CollectionRepositoryRow | null> {
    return this.db.collectionRepository.findUnique({
      where: {
        githubOrganizationId_githubRepositoryId: {
          githubOrganizationId,
          githubRepositoryId,
        },
      },
    });
  }

  async recordCommitFacts(
    repositoryId: string,
    facts: readonly CommitFactInput[],
  ): Promise<RecordFactsResult> {
    let insertedCount = 0;
    for (const fact of facts) {
      const inserted = await this.tryInsertFact(() =>
        this.db.collectionCommitFact.create({
          data: {
            repositoryId,
            sha: fact.sha,
            committedAt: fact.committedAt,
            authorGithubId: fact.authorGithubId ?? null,
            authorGithubLogin: fact.authorGithubLogin ?? null,
          },
        }),
      );
      if (!inserted) continue;
      insertedCount += 1;
      await this.incrementYearAggregates(repositoryId, {
        year: asiaSeoulYear(fact.committedAt),
        githubUserId: fact.authorGithubId ?? null,
        githubLogin: fact.authorGithubLogin ?? null,
        field: 'commitCount',
      });
    }
    return { insertedCount };
  }

  async recordPullRequestFacts(
    repositoryId: string,
    facts: readonly PullRequestFactInput[],
  ): Promise<RecordFactsResult> {
    let insertedCount = 0;
    for (const fact of facts) {
      const inserted = await this.tryInsertFact(() =>
        this.db.collectionPullRequestFact.create({
          data: {
            repositoryId,
            githubPullRequestId: fact.githubPullRequestId,
            state: fact.state,
            createdAt: fact.createdAt,
            authorGithubId: fact.authorGithubId ?? null,
            authorGithubLogin: fact.authorGithubLogin ?? null,
          },
        }),
      );
      if (!inserted) continue;
      insertedCount += 1;
      await this.incrementYearAggregates(repositoryId, {
        year: asiaSeoulYear(fact.createdAt),
        githubUserId: fact.authorGithubId ?? null,
        githubLogin: fact.authorGithubLogin ?? null,
        field: 'pullRequestCount',
      });
    }
    return { insertedCount };
  }

  async recordReleaseFacts(
    repositoryId: string,
    facts: readonly ReleaseFactInput[],
  ): Promise<RecordFactsResult> {
    let insertedCount = 0;
    for (const fact of facts) {
      const inserted = await this.tryInsertFact(() =>
        this.db.collectionReleaseFact.create({
          data: {
            repositoryId,
            githubReleaseId: fact.githubReleaseId,
            publishedAt: fact.publishedAt,
            authorGithubId: fact.authorGithubId ?? null,
            authorGithubLogin: fact.authorGithubLogin ?? null,
          },
        }),
      );
      if (!inserted) continue;
      insertedCount += 1;
      await this.incrementYearAggregates(repositoryId, {
        year: asiaSeoulYear(fact.publishedAt),
        githubUserId: fact.authorGithubId ?? null,
        githubLogin: fact.authorGithubLogin ?? null,
        field: 'releaseCount',
      });
    }
    return { insertedCount };
  }

  /** unique key 충돌(중복 fact)은 무시하고 false를 반환한다 — 그 외 오류는 그대로 던진다. */
  private async tryInsertFact<T>(insert: () => Promise<T>): Promise<boolean> {
    try {
      await insert();
      return true;
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  private async incrementYearAggregates(
    repositoryId: string,
    input: {
      year: number;
      githubUserId: bigint | null;
      githubLogin: string | null;
      field: 'commitCount' | 'pullRequestCount' | 'releaseCount';
    },
  ): Promise<void> {
    await this.db.collectionRepositoryYearAggregate.upsert({
      where: { repositoryId_year: { repositoryId, year: input.year } },
      create: {
        repositoryId,
        year: input.year,
        [input.field]: 1,
      },
      update: {
        [input.field]: { increment: 1 },
      },
    });

    if (input.githubUserId === null) return;
    await this.db.collectionContributorYearAggregate.upsert({
      where: {
        repositoryId_githubUserId_year: {
          repositoryId,
          githubUserId: input.githubUserId,
          year: input.year,
        },
      },
      create: {
        repositoryId,
        githubUserId: input.githubUserId,
        githubLogin: input.githubLogin ?? '',
        year: input.year,
        [input.field]: 1,
      },
      update: {
        githubLogin: input.githubLogin ?? undefined,
        [input.field]: { increment: 1 },
      },
    });
  }

  /** 존재하지 않는 연도는 0으로 채워 반환한다 — 매년 1/1 read가 안전하다. */
  async getRepositoryYearAggregate(
    repositoryId: string,
    year: number,
  ): Promise<RepositoryYearAggregateRow> {
    const row = await this.db.collectionRepositoryYearAggregate.findUnique({
      where: { repositoryId_year: { repositoryId, year } },
    });
    return row ?? zeroRepositoryYearAggregate(repositoryId, year);
  }

  async getContributorYearAggregate(
    repositoryId: string,
    githubUserId: bigint,
    year: number,
  ): Promise<ContributorYearAggregateRow | null> {
    return this.db.collectionContributorYearAggregate.findUnique({
      where: {
        repositoryId_githubUserId_year: { repositoryId, githubUserId, year },
      },
    });
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

  async upsertSyncCursor(input: SyncCursorInput): Promise<SyncCursorRow> {
    return this.db.collectionSyncCursor.upsert({
      where: {
        appId_organizationLogin: {
          appId: input.appId,
          organizationLogin: input.organizationLogin,
        },
      },
      create: {
        appId: input.appId,
        organizationLogin: input.organizationLogin,
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
    organizationLogin: string,
  ): Promise<SyncCursorRow | null> {
    return this.db.collectionSyncCursor.findUnique({
      where: { appId_organizationLogin: { appId, organizationLogin } },
    });
  }

  /**
   * complete inventory 관찰 이후 더 이상 목록에 없는 저장소를 ABSENT로 표시한다 — 이 경로 역시
   * DEC-46(visibility/presence는 complete inventory 관찰에서만 갱신)을 지키며, 호출자가 lease-fenced
   * 트랜잭션(`runInTransaction` + `assertSyncLeaseValid`) 안에서 호출한다.
   */
  async markAbsentRepositories(
    githubOrganizationId: bigint,
    presentGithubRepositoryIds: readonly bigint[],
    observedAt: Date,
  ): Promise<void> {
    await this.db.collectionRepository.updateMany({
      where: {
        githubOrganizationId,
        presence: 'PRESENT',
        githubRepositoryId: { notIn: [...presentGithubRepositoryIds] },
      },
      data: { presence: 'ABSENT', lastCompleteInventoryObservedAt: observedAt },
    });
  }

  /** partial inventory(이번 run의 provider listing 실패) 시 stream sync가 이어갈 이전 관찰. */
  async listPresentRepositories(
    githubOrganizationId: bigint,
  ): Promise<CollectionRepositoryRow[]> {
    return this.db.collectionRepository.findMany({
      where: { githubOrganizationId, presence: 'PRESENT' },
    });
  }

  /**
   * `CollectionSyncLease`를 획득한다 — 만료된 lease만 epoch을 증가시키며 훔칠 수 있다
   * (`CanonicalCollectionRepository.acquireLease`와 동일한 fencing 패턴, 별도 run 후보 테이블 없음).
   */
  async acquireSyncLease(
    input: AcquireSyncLeaseInput,
  ): Promise<SyncLeaseToken | null> {
    const rows = await this.db.$queryRawUnsafe<SyncLeaseToken[]>(
      `INSERT INTO "CollectionSyncLease" ("appId", "organizationLogin", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT ("appId", "organizationLogin") DO UPDATE SET
         "epoch" = "CollectionSyncLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
         "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
       WHERE "CollectionSyncLease"."expiresAt" <= $6
       RETURNING "appId", "organizationLogin", "ownerId", "epoch", "runId", "expiresAt"`,
      input.appId,
      input.organizationLogin,
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
       WHERE "appId" = $1 AND "organizationLogin" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "expiresAt" > $5 AND "runId" = $7`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      now,
      expiresAt,
      token.runId,
    );
    if (count !== 1) throw new Error('Collection sync lease is stale');
  }

  /** best-effort 정리 — 이미 다른 owner가 훔친 lease라면 아무 것도 하지 않는다. */
  async releaseSyncLease(token: SyncLeaseToken, now: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE "CollectionSyncLease" SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "organizationLogin" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
  }

  /**
   * 매 fenced 트랜잭션의 첫 문장으로 호출한다 — `SELECT ... FOR UPDATE`로 현재 트랜잭션 안에서
   * lease 소유권을 잠그고 확인한다(`CanonicalCollectionRepository.assertLease`와 동일 패턴).
   * stale이면 그 트랜잭션의 모든 쓰기가 커밋되지 않는다.
   */
  async assertSyncLeaseValid(token: SyncLeaseToken, now: Date): Promise<void> {
    const rows = await this.db.$queryRawUnsafe<Array<{ owned: boolean }>>(
      `SELECT true AS "owned" FROM "CollectionSyncLease" WHERE "appId" = $1 AND "organizationLogin" = $2
       AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5 AND "expiresAt" > $6 FOR UPDATE`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
    if (!rows[0]) throw new Error('Collection sync lease is stale');
  }
}
