import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../audit-log/audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from '../repository-identity';
import { REPOSITORY_PROVISION_EVENT_TYPE } from '../repository-provision-event';

export interface ClaimProvisionEventInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedProvisionEvent {
  readonly id: string;
  readonly aggregateId: string;
  readonly payload: Prisma.JsonValue;
}

export interface ProvisionJobReference {
  readonly id: string;
}
export interface OwnedProvisionJob {
  readonly application: {
    readonly id: string;
    readonly teamId: string | null;
    readonly repositoryConnectionMode: RepositoryConnectionMode;
    readonly applicant: {
      readonly nickname: string;
    };
    readonly program: {
      readonly name: string;
    };
    readonly team: {
      readonly name: string;
      readonly _count: { readonly members: number };
    } | null;
  };
  readonly status: RepositoryProvisionJobStatus;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
  readonly repository: {
    readonly id: string;
    readonly applicationId: string;
    readonly name: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly invitations: readonly {
      readonly status: RepositoryInvitationStatus;
    }[];
  } | null;
}

export interface RepositoryPublishTarget {
  readonly id: string;
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}

/// GithubRepository는 name/url 컬럼을 두지 않는다(#617 단계 D) — nameWithOwner에서 유도해
/// 기존 RepositoryPublishTarget 계약 모양을 유지한다.
function toPublishTarget(row: {
  readonly id: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}): RepositoryPublishTarget {
  return {
    id: row.id,
    githubRepositoryId: row.githubRepositoryId,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
    publishedAt: row.publishedAt,
  };
}

/// RepositoryProvisionJob.repository는 recordRepository가 만든 행만 가리킨다 — applicationId가
/// null인 행(인벤토리 스윕이 만든 무관한 행)을 이 관계로 볼 일은 없다.
function toOwnedRepository(row: {
  readonly id: string;
  readonly applicationId: string | null;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
  readonly invitations: readonly { readonly status: RepositoryInvitationStatus }[];
}): NonNullable<OwnedProvisionJob['repository']> {
  if (row.applicationId === null) {
    throw new RepositoryPublishStateError();
  }
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
    invitations: row.invitations,
  };
}

export class RepositoryPublishStateError extends Error {
  override readonly name = 'RepositoryPublishStateError';
}

export interface RepositoriesTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  claimProvisionEvent(
    input: ClaimProvisionEventInput,
  ): Promise<ClaimedProvisionEvent | null>;
  upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference>;
  completeProvisionEvent(
    eventId: string,
    workerId: string,
    now: Date,
  ): Promise<void>;
  failProvisionEvent(eventId: string, workerId: string): Promise<void>;
  findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null>;
  publishRepositoryIfPrivate(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<boolean>;
}

type ClaimedProvisionEventRow = {
  readonly id: string;
  readonly aggregateId: string;
  readonly payload: Prisma.JsonValue;
};

class PrismaRepositoriesTransactionStore implements RepositoriesTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    const repository = await this.transaction.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        githubRepositoryId: true,
        nameWithOwner: true,
        visibility: true,
        publishedAt: true,
      },
    });
    return repository === null ? null : toPublishTarget(repository);
  }

  async publishRepositoryIfPrivate(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.transaction.githubRepository.updateMany({
      where: {
        id: repositoryId,
        githubRepositoryId,
        visibility: RepositoryVisibility.PRIVATE,
      },
      data: {
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      },
    });
    return updated.count === 1;
  }

  async claimProvisionEvent(
    input: ClaimProvisionEventInput,
  ): Promise<ClaimedProvisionEvent | null> {
    const leaseCutoff = new Date(input.now.getTime() - input.leaseMs);
    const events = await this.transaction.$queryRaw<
      ClaimedProvisionEventRow[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "type" = ${REPOSITORY_PROVISION_EVENT_TYPE}
          AND "aggregateType" = 'Application'
          AND "availableAt" <= ${input.now}
          AND (
            "status" = CAST(${OutboxEventStatus.PENDING} AS "OutboxEventStatus")
            OR (
              "status" = CAST(${OutboxEventStatus.PROCESSING} AS "OutboxEventStatus")
              AND "lockedAt" < ${leaseCutoff}
            )
          )
        ORDER BY "createdAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "OutboxEvent" AS event
      SET "status" = CAST(${OutboxEventStatus.PROCESSING} AS "OutboxEventStatus"),
          "attemptCount" = event."attemptCount" + 1,
          "lockedAt" = ${input.now},
          "lockedBy" = ${input.workerId},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE event."id" = candidate."id"
      RETURNING event."id", event."aggregateId", event."payload"
    `);
    return events[0] ?? null;
  }

  async upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference> {
    return this.transaction.repositoryProvisionJob.upsert({
      where: { applicationId },
      update: {},
      create: {
        applicationId,
        status: RepositoryProvisionJobStatus.PENDING,
        nextAttemptAt: now,
      },
      select: { id: true },
    });
  }

  async completeProvisionEvent(
    eventId: string,
    workerId: string,
    now: Date,
  ): Promise<void> {
    await this.transaction.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: OutboxEventStatus.PROCESSING,
        lockedBy: workerId,
      },
      data: {
        status: OutboxEventStatus.PROCESSED,
        lockedAt: null,
        lockedBy: null,
        processedAt: now,
        lastError: null,
      },
    });
  }

  async failProvisionEvent(eventId: string, workerId: string): Promise<void> {
    await this.transaction.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: OutboxEventStatus.PROCESSING,
        lockedBy: workerId,
      },
      data: {
        status: OutboxEventStatus.FAILED,
        lockedAt: null,
        lockedBy: null,
        lastError: 'INVALID_REPOSITORY_PROVISION_EVENT',
      },
    });
  }
}

@Injectable()
export class RepositoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: RepositoriesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaRepositoriesTransactionStore(transaction)),
    );
  }
  async listOwnedProvisionJobs(
    githubId: bigint,
  ): Promise<readonly OwnedProvisionJob[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { nickname: true },
    });
    if (user === null) {
      return [];
    }

    const jobs = await this.prisma.repositoryProvisionJob.findMany({
      where: {
        application: {
          status: ApplicationStatus.APPROVED,
          // 모든 신청이 Team을 갖고 개인 참여는 1인 팀이므로(D5) 팀 소속 하나로 판정한다.
          team: {
            OR: [
              { leader: { githubId } },
              { members: { some: { user: { githubId } } } },
            ],
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        lastErrorCode: true,
        updatedAt: true,
        application: {
          select: {
            id: true,
            teamId: true,
            repositoryConnectionMode: true,
            applicant: {
              select: { nickname: true },
            },
            program: {
              select: { name: true },
            },
            team: {
              select: { name: true, _count: { select: { members: true } } },
            },
          },
        },
        repository: {
          select: {
            id: true,
            applicationId: true,
            nameWithOwner: true,
            visibility: true,
            invitations: {
              where: { githubLogin: user.nickname.toLowerCase() },
              select: { status: true },
            },
          },
        },
      },
    });
    return jobs.map((job) => ({
      ...job,
      repository:
        job.repository === null ? null : toOwnedRepository(job.repository),
    }));
  }

  async findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        githubRepositoryId: true,
        nameWithOwner: true,
        visibility: true,
        publishedAt: true,
      },
    });
    return repository === null ? null : toPublishTarget(repository);
  }
}
