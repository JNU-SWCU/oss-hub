import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../audit-log/audit-log.repository';
import { writeRepositoryIssuanceHistory } from '../../prisma/repository-provision-generation';
import { PrismaService } from '../../prisma/prisma.service';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from '../repository-identity';
import {
  parseRepositoryProvisionEvent,
  REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
  REPOSITORY_PROVISION_EVENT_TYPE,
} from '../repository-provision-event';

export interface ClaimProvisionEventInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedProvisionEvent {
  readonly id: string;
  readonly aggregateId: string;
  /// consumer dispatch의 유일한 근거 — payload 모양으로 type을 추측하지 않는다.
  readonly type: string;
  readonly payload: Prisma.JsonValue;
}

export interface ProvisionJobReference {
  readonly id: string;
  readonly currentEventId: string | null;
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
    /**
     * 지금 이 신청에 연결된 저장소 — 현재 연결의 정본이다.
     * 발급 job(`RepositoryProvisionJob.repository`)을 따라가지 않는다 — 그쪽은 과거
     * 발급이 남긴 결과라 저장소를 교체하면 옛 행을 가리킨다.
     * `GithubRepository.applicationId`가 unique라 이 관계는 항상 한 건이고,
     * 신청과 어긋난 행은 구조적으로 여기로 올라올 수 없다.
     */
    readonly repository: {
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly visibility: RepositoryVisibility;
      readonly source: RepositorySource;
      readonly invitations: readonly {
        readonly status: RepositoryInvitationStatus;
      }[];
    } | null;
  };
  readonly status: RepositoryProvisionJobStatus;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
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

/// `Application.repository`로 읽으므로 이 행은 정의상 그 신청의 저장소다 — applicationId를
/// 다시 대조할 필요가 없고, 인벤토리 스윙이 만든 무관한 행은 이 관계에 올라오지 않는다.
function toOwnedRepository(row: {
  readonly id: string;
  readonly nameWithOwner: string;
  readonly source: RepositorySource;
  readonly visibility: RepositoryVisibility;
  readonly invitations: readonly {
    readonly status: RepositoryInvitationStatus;
  }[];
}): NonNullable<OwnedProvisionJob['application']['repository']> {
  return {
    id: row.id,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
    source: row.source,
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
  findProvisionJob(
    applicationId: string,
  ): Promise<ProvisionJobReference | null>;
  confirmSupersededProvisionEvent(
    eventId: string,
    applicationId: string,
    now: Date,
  ): Promise<void>;
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

type ClaimedProvisionEventRow = ClaimedProvisionEvent;

type LockedProvisionJobRow = {
  readonly id: string;
  readonly status: RepositoryProvisionJobStatus;
  readonly nextAttemptAt: Date;
  readonly currentEventId: string | null;
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
        WHERE "type" IN (
            ${REPOSITORY_PROVISION_EVENT_TYPE},
            ${REPOSITORY_ACCESS_SYNC_EVENT_TYPE}
          )
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
      RETURNING event."id", event."aggregateId", event."type", event."payload"
    `);
    return events[0] ?? null;
  }

  /**
   * event당 job은 application당 한 건이지만, 기존 행을 그대로 두면 종료된 job은 다시 깨지지 않는다.
   * 같은 트랜잭션에서 행을 잠그고 status별로만 손대서 worker의 lease/완료 경합을 깨지 않는다.
   * Job행 외에 Team/TeamMember를 잠그지 않는다(#66 완료 경로와의 lock 순서 계약).
   */
  async upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference> {
    const locked = await this.transaction.$queryRaw<LockedProvisionJobRow[]>(
      Prisma.sql`
        SELECT "id", "status", "nextAttemptAt", "currentEventId"
        FROM "RepositoryProvisionJob"
        WHERE "applicationId" = ${applicationId}
        FOR UPDATE
      `,
    );
    const existing = locked[0];
    if (existing === undefined) {
      // 최초 생성은 applicationId unique에 기대는 idempotent 경로를 그대로 유지한다.
      return this.transaction.repositoryProvisionJob.upsert({
        where: { applicationId },
        update: {},
        create: {
          applicationId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: now,
        },
        select: { id: true, currentEventId: true },
      });
    }

    if (
      existing.status === RepositoryProvisionJobStatus.SUCCEEDED ||
      existing.status === RepositoryProvisionJobStatus.FAILED_FINAL
    ) {
      // 종료 상태는 새 요청으로 다시 무장한다 — 이전 실패 흔적은 남기지 않는다.
      await this.transaction.repositoryProvisionJob.update({
        where: { id: existing.id },
        data: {
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: now,
          attemptCount: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          finishedAt: null,
        },
      });
      return {
        id: existing.id,
        currentEventId: existing.currentEventId,
      };
    }

    if (
      existing.status === RepositoryProvisionJobStatus.PENDING ||
      existing.status === RepositoryProvisionJobStatus.FAILED_RETRYABLE
    ) {
      // 대기/재시도 중이면 진행 중인 backoff 시도 횟수를 되돌리지 않고 시각만 앞당긴다.
      if (existing.nextAttemptAt.getTime() > now.getTime()) {
        await this.transaction.repositoryProvisionJob.update({
          where: { id: existing.id },
          data: { nextAttemptAt: now },
        });
      }
      return {
        id: existing.id,
        currentEventId: existing.currentEventId,
      };
    }

    // PROCESSING: 행 잠금만 잡아 완료 경합을 직렬화하고 lease는 건드리지 않는다.
    return {
      id: existing.id,
      currentEventId: existing.currentEventId,
    };
  }

  async findProvisionJob(
    applicationId: string,
  ): Promise<ProvisionJobReference | null> {
    return this.transaction.repositoryProvisionJob.findUnique({
      where: { applicationId },
      select: { id: true, currentEventId: true },
    });
  }

  async confirmSupersededProvisionEvent(
    eventId: string,
    applicationId: string,
    now: Date,
  ): Promise<void> {
    await writeRepositoryIssuanceHistory(
      this.transaction,
      {
        requestId: eventId,
        applicationId,
        repositoryId: null,
        source: null,
        outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        closedAt: now,
      },
      parseRepositoryProvisionEvent,
    );
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
            members: { some: { user: { githubId } } },
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
            repository: {
              select: {
                id: true,
                nameWithOwner: true,
                visibility: true,
                source: true,
                invitations: {
                  where: {
                    githubLogin: {
                      equals: user.nickname.trim(),
                      mode: 'insensitive',
                    },
                  },
                  select: { status: true },
                },
              },
            },
          },
        },
      },
    });
    return jobs.map((job) => ({
      ...job,
      application: {
        ...job.application,
        repository:
          job.application.repository === null
            ? null
            : toOwnedRepository(job.application.repository),
      },
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
