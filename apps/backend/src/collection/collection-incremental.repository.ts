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
}
