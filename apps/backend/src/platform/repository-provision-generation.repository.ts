import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  type RepositorySource,
  type RepositoryConnectionMode,
} from '@prisma/client';
import { InvalidRepositoryProvisionHistoryEventError } from './repository-provision-generation.error';

interface RepositoryProvisionHistoryPayload {
  readonly teamId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly requestedAt: string;
}

export type RepositoryProvisionHistoryPayloadParser = (
  value: unknown,
) => RepositoryProvisionHistoryPayload;

interface LockedProvisionGenerationRow {
  readonly id: string;
  readonly currentEventId: string | null;
}

interface SynchronousProvisionGenerationRow extends LockedProvisionGenerationRow {
  readonly repoId: bigint | null;
  readonly status: RepositoryProvisionJobStatus;
}

interface RepositoryIssuanceHistoryInput {
  readonly requestId: string;
  readonly teamId: string;
  readonly githubRepositoryId: bigint | null;
  readonly source: RepositorySource | null;
  readonly outcome: RepositoryIssuanceOutcome;
  readonly lastErrorCode?: string | null;
  readonly closedAt: Date;
}

@Injectable()
export class RepositoryProvisionGenerationRepository {
  async writeRepositoryIssuanceHistory(
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
      event.aggregateType !== 'Team' ||
      event.aggregateId !== input.teamId ||
      payload.teamId !== input.teamId
    ) {
      throw new InvalidRepositoryProvisionHistoryEventError();
    }

    await transaction.repositoryIssuanceHistory.createMany({
      data: [
        {
          requestId: input.requestId,
          teamId: input.teamId,
          repoId: input.githubRepositoryId,
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

  async transferProvisionGeneration(
    transaction: Prisma.TransactionClient,
    input: {
      readonly teamId: string;
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
      WHERE job."teamId" = ${input.teamId}
      FOR UPDATE OF job
    `,
    );
    const existing = rows[0];

    if (
      existing?.currentEventId != null &&
      existing.currentEventId !== input.newEventId
    ) {
      await this.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          teamId: input.teamId,
          githubRepositoryId: null,
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
          teamId: input.teamId,
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
        repoId: null,
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

  async settleProvisionGenerationForSynchronousConnection(
    transaction: Prisma.TransactionClient,
    input: {
      readonly teamId: string;
      readonly githubRepositoryId: bigint;
      readonly now: Date;
    },
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    const existing = (
      await transaction.$queryRaw<readonly SynchronousProvisionGenerationRow[]>(
        Prisma.sql`
        SELECT
          job."id",
          job."currentEventId",
          job."repo_id" AS "repoId",
          job."status"
        FROM "RepositoryProvisionJob" AS job
        WHERE job."teamId" = ${input.teamId}
        FOR UPDATE
      `,
      )
    )[0];

    if (existing?.currentEventId != null) {
      await this.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          teamId: input.teamId,
          githubRepositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: input.now,
        },
        parsePayload,
      );
    }
    if (
      existing?.currentEventId === null &&
      existing.repoId === input.githubRepositoryId &&
      existing.status === RepositoryProvisionJobStatus.SUCCEEDED
    ) {
      return;
    }

    await transaction.repositoryProvisionJob.upsert({
      where: { teamId: input.teamId },
      create: {
        teamId: input.teamId,
        currentEventId: null,
        repoId: input.githubRepositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: input.now,
        finishedAt: input.now,
      },
      update: {
        currentEventId: null,
        repoId: input.githubRepositoryId,
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
