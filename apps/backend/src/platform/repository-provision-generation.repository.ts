import {
  Prisma,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  type RepositorySource,
  RepositoryConnectionMode,
} from '@prisma/client';
import { InvalidRepositoryProvisionHistoryEventError } from './repository-provision-generation.error';

interface RepositoryProvisionHistoryPayload {
  readonly applicationId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly requestedAt: string;
}

function readHistoryPayload(value: unknown): RepositoryProvisionHistoryPayload {
  const payload =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const { applicationId, repositoryConnectionMode, requestedAt } = payload;
  if (
    typeof applicationId !== 'string' ||
    typeof requestedAt !== 'string' ||
    Number.isNaN(Date.parse(requestedAt))
  ) {
    throw new InvalidRepositoryProvisionHistoryEventError();
  }
  return {
    applicationId,
    repositoryConnectionMode:
      repositoryConnectionMode === RepositoryConnectionMode.OWN
        ? RepositoryConnectionMode.OWN
        : RepositoryConnectionMode.NEW,
    requestedAt,
  };
}

interface LockedProvisionGenerationRow {
  readonly id: string;
  readonly currentEventId: string | null;
}

interface SynchronousProvisionGenerationRow extends LockedProvisionGenerationRow {
  readonly repositoryId: string | null;
  readonly status: RepositoryProvisionJobStatus;
}

interface RepositoryIssuanceHistoryInput {
  readonly requestId: string;
  readonly applicationId: string;
  readonly repositoryId: string | null;
  readonly source: RepositorySource | null;
  readonly outcome: RepositoryIssuanceOutcome;
  readonly lastErrorCode?: string | null;
  readonly closedAt: Date;
}

export class RepositoryProvisionGenerationRepository {
  static async writeRepositoryIssuanceHistory(
    transaction: Prisma.TransactionClient,
    input: RepositoryIssuanceHistoryInput,
  ): Promise<void> {
    const event = await transaction.outboxEvent.findUnique({
      where: { id: input.requestId },
      select: {
        aggregateType: true,
        aggregateId: true,
        payload: true,
      },
    });
    if (event === null) {
      throw new InvalidRepositoryProvisionHistoryEventError();
    }

    const payload = readHistoryPayload(event.payload);
    if (
      event.aggregateType !== 'Application' ||
      event.aggregateId !== input.applicationId ||
      payload.applicationId !== input.applicationId
    ) {
      throw new InvalidRepositoryProvisionHistoryEventError();
    }

    await transaction.repositoryIssuanceHistory.createMany({
      data: [
        {
          requestId: input.requestId,
          applicationId: input.applicationId,
          repositoryId: input.repositoryId,
          connectionMode: payload.repositoryConnectionMode,
          source: input.source,
          outcome: input.outcome,
          lastErrorCode: input.lastErrorCode ?? null,
          requestedAt: new Date(payload.requestedAt),
          closedAt: input.closedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  static async transferProvisionGeneration(
    transaction: Prisma.TransactionClient,
    input: {
      readonly applicationId: string;
      readonly newEventId: string;
      readonly now: Date;
    },
  ): Promise<{ readonly jobId: string }> {
    const rows = await transaction.$queryRaw<LockedProvisionGenerationRow[]>(
      Prisma.sql`
      SELECT
        job."id",
        job."currentEventId"
      FROM "RepositoryProvisionJob" AS job
      WHERE job."applicationId" = ${input.applicationId}
      FOR UPDATE OF job
    `,
    );
    const existing = rows[0];

    if (
      existing?.currentEventId != null &&
      existing.currentEventId !== input.newEventId
    ) {
      await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          applicationId: input.applicationId,
          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: input.now,
        },
      );
    }

    if (existing === undefined) {
      const created = await transaction.repositoryProvisionJob.create({
        data: {
          applicationId: input.applicationId,
          currentEventId: input.newEventId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: input.now,
        },
        select: { id: true },
      });
      return { jobId: created.id };
    }

    await transaction.repositoryProvisionJob.update({
      where: { id: existing.id },
      data: {
        currentEventId: input.newEventId,
        repositoryId: null,
        status: RepositoryProvisionJobStatus.PENDING,
        nextAttemptAt: input.now,
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    return { jobId: existing.id };
  }

  static async settleProvisionGenerationForSynchronousConnection(
    transaction: Prisma.TransactionClient,
    input: {
      readonly applicationId: string;
      readonly repositoryId: string;
      readonly now: Date;
    },
  ): Promise<void> {
    const existing = (
      await transaction.$queryRaw<readonly SynchronousProvisionGenerationRow[]>(
        Prisma.sql`
        SELECT
          job."id",
          job."currentEventId",
          job."repositoryId",
          job."status"
        FROM "RepositoryProvisionJob" AS job
        WHERE job."applicationId" = ${input.applicationId}
        FOR UPDATE
      `,
      )
    )[0];

    if (existing?.currentEventId != null) {
      await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          applicationId: input.applicationId,
          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: input.now,
        },
      );
    }
    if (
      existing?.currentEventId === null &&
      existing.repositoryId === input.repositoryId &&
      existing.status === RepositoryProvisionJobStatus.SUCCEEDED
    ) {
      return;
    }

    await transaction.repositoryProvisionJob.upsert({
      where: { applicationId: input.applicationId },
      create: {
        applicationId: input.applicationId,
        currentEventId: null,
        repositoryId: input.repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: input.now,
        finishedAt: input.now,
      },
      update: {
        currentEventId: null,
        repositoryId: input.repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: input.now,
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        finishedAt: input.now,
      },
    });
  }
}
