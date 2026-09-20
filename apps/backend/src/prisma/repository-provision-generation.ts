import {
  Prisma,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  type RepositoryConnectionMode,
  type RepositorySource,
} from '@prisma/client';

export interface RepositoryProvisionHistoryPayload {
  readonly applicationId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly requestedAt: string;
}

export type RepositoryProvisionHistoryPayloadParser = (
  value: unknown,
) => RepositoryProvisionHistoryPayload;

export class InvalidRepositoryProvisionHistoryEventError extends Error {
  override readonly name = 'InvalidRepositoryProvisionHistoryEventError';
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

export async function writeRepositoryIssuanceHistory(
  transaction: Prisma.TransactionClient,
  input: RepositoryIssuanceHistoryInput,
  parsePayload: RepositoryProvisionHistoryPayloadParser,
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

  const payload = parsePayload(event.payload);
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

export async function transferProvisionGeneration(
  transaction: Prisma.TransactionClient,
  input: {
    readonly applicationId: string;
    readonly newEventId: string;
    readonly now: Date;
  },
  parsePayload: RepositoryProvisionHistoryPayloadParser,
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
    await writeRepositoryIssuanceHistory(
      transaction,
      {
        requestId: existing.currentEventId,
        applicationId: input.applicationId,
        repositoryId: null,
        source: null,
        outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        closedAt: input.now,
      },
      parsePayload,
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

/**
 * 동기 OWN 교체는 새 worker 세대를 만들지 않는다. 대신 실행 중인 비동기 세대를
 * SUPERSEDED로 닫고 job을 새 current repository의 완료 projection으로 맞춘다.
 */
export async function settleProvisionGenerationForSynchronousConnection(
  transaction: Prisma.TransactionClient,
  input: {
    readonly applicationId: string;
    readonly repositoryId: string;
    readonly now: Date;
  },
  parseEvent: RepositoryProvisionHistoryPayloadParser,
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
    await writeRepositoryIssuanceHistory(
      transaction,
      {
        requestId: existing.currentEventId,
        applicationId: input.applicationId,
        repositoryId: null,
        source: null,
        outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        closedAt: input.now,
      },
      parseEvent,
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
