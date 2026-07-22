import { Injectable } from '@nestjs/common';
import {
  OutboxEventStatus,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event';

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

export interface RepositoryPublishTarget {
  readonly id: string;
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}

export class RepositoryPublishStateError extends Error {
  override readonly name = 'RepositoryPublishStateError';
}

export interface RepositoriesTransactionStore {
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
}

type ClaimedProvisionEventRow = {
  readonly id: string;
  readonly aggregateId: string;
  readonly payload: Prisma.JsonValue;
};

class PrismaRepositoriesTransactionStore implements RepositoriesTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

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

  async findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    return this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        githubRepositoryId: true,
        name: true,
        url: true,
        visibility: true,
        publishedAt: true,
      },
    });
  }

  async markPublished(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<void> {
    const updated = await this.prisma.repository.updateMany({
      where: {
        id: repositoryId,
        githubRepositoryId,
      },
      data: {
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new RepositoryPublishStateError();
    }
  }
}
