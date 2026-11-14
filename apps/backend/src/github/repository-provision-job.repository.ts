import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import {
  Prisma,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import {
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionSupersededError,
} from './repository-provision-state.error';

export interface ClaimRepositoryProvisionJobInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedRepositoryProvisionJob {
  readonly id: string;
  readonly teamId: string;
  readonly requestId: string;
  readonly repoId: bigint | null;
  readonly attemptCount: number;
}

@Injectable()
export class RepositoryProvisionJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  claimedJobWhere(jobId: string, workerId: string) {
    return {
      id: jobId,
      status: RepositoryProvisionJobStatus.PROCESSING,
      lockedBy: workerId,
    } as const;
  }

  async assertProvisionLease(
    transaction: Prisma.TransactionClient | PrismaService,
    jobId: string,
    workerId: string,
  ): Promise<void> {
    const count = await transaction.repositoryProvisionJob.count({
      where: this.claimedJobWhere(jobId, workerId),
    });
    this.assertSingleProvisionUpdate(count);
  }

  async assertCurrentRequest(
    transaction: Prisma.TransactionClient,
    jobId: string,
    workerId: string,
    expectedRequestId: string,
  ): Promise<{
    readonly teamId: string;
    readonly repoId: bigint | null;
  }> {
    const rows = await transaction.$queryRaw<
      readonly {
        readonly teamId: string;
        readonly currentEventId: string | null;
        readonly repoId: bigint | null;
        readonly status: RepositoryProvisionJobStatus;
        readonly lockedBy: string | null;
      }[]
    >(Prisma.sql`
    SELECT "teamId", "currentEventId", "repo_id" AS "repoId", "status", "lockedBy"
    FROM "RepositoryProvisionJob"
    WHERE "id" = ${jobId}
    FOR UPDATE
  `);
    const row = rows[0];
    if (row === undefined) {
      throw new RepositoryProvisionLeaseLostError();
    }
    if (row.currentEventId !== expectedRequestId) {
      throw new RepositoryProvisionSupersededError(expectedRequestId);
    }
    if (
      row.status !== RepositoryProvisionJobStatus.PROCESSING ||
      row.lockedBy !== workerId
    ) {
      throw new RepositoryProvisionLeaseLostError();
    }
    return {
      teamId: row.teamId,
      repoId: row.repoId,
    };
  }

  assertSingleProvisionUpdate(count: number): void {
    if (count !== 1) {
      throw new RepositoryProvisionLeaseLostError();
    }
  }

  async claimNext(
    input: ClaimRepositoryProvisionJobInput,
  ): Promise<ClaimedRepositoryProvisionJob | null> {
    const leaseCutoff = new Date(input.now.getTime() - input.leaseMs);
    const jobs = await this.prisma.$queryRaw<ClaimedRepositoryProvisionJob[]>(
      Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "RepositoryProvisionJob"
        WHERE (
          (
            "status" IN (
              CAST(${RepositoryProvisionJobStatus.PENDING} AS "RepositoryProvisionJobStatus"),
              CAST(${RepositoryProvisionJobStatus.FAILED_RETRYABLE} AS "RepositoryProvisionJobStatus")
            )
            AND "nextAttemptAt" <= ${input.now}
          )
          OR (
            "status" = CAST(${RepositoryProvisionJobStatus.PROCESSING} AS "RepositoryProvisionJobStatus")
            AND ("lockedAt" IS NULL OR "lockedAt" < ${leaseCutoff})
          )
        )
          AND "currentEventId" IS NOT NULL
        ORDER BY "nextAttemptAt", "createdAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "RepositoryProvisionJob" AS job
      SET "status" = CAST(${RepositoryProvisionJobStatus.PROCESSING} AS "RepositoryProvisionJobStatus"),
          "attemptCount" = job."attemptCount" + 1,
          "lockedAt" = ${input.now},
          "lockedBy" = ${input.workerId},
          "startedAt" = COALESCE(job."startedAt", ${input.now}),
          "finishedAt" = NULL,
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id",
        job."teamId",
        job."currentEventId" AS "requestId",
        job."repo_id" AS "repoId",
        job."attemptCount"
    `,
    );
    return jobs[0] ?? null;
  }

  async claimNextReconciliation(
    input: ClaimRepositoryProvisionJobInput,
  ): Promise<ClaimedRepositoryProvisionJob | null> {
    const jobs = await this.prisma.$queryRaw<ClaimedRepositoryProvisionJob[]>(
      Prisma.sql`
        WITH candidate AS (
          SELECT job."id"
          FROM "RepositoryProvisionJob" AS job
          JOIN "Program" AS program ON program."id" = (
            SELECT application."programId"
            FROM "Team" AS application
            WHERE application."id" = job."teamId"
          )
          JOIN "repo" AS repository ON repository."github_repo_id" = job."repo_id"
          WHERE job."status" = CAST(${RepositoryProvisionJobStatus.SUCCEEDED} AS "RepositoryProvisionJobStatus")
            AND job."currentEventId" IS NOT NULL
            AND job."repo_id" IS NOT NULL
            AND job."nextAttemptAt" <= ${input.now}
            AND repository."source" = CAST(${RepositorySource.ORG_PROVISIONED} AS "RepositorySource")
            AND program."repositoryProvisioningEnabled" = TRUE
          ORDER BY job."nextAttemptAt", job."createdAt", job."id"
          FOR UPDATE OF job SKIP LOCKED
          LIMIT 1
        )
        UPDATE "RepositoryProvisionJob" AS job
        SET "status" = CAST(${RepositoryProvisionJobStatus.PROCESSING} AS "RepositoryProvisionJobStatus"),
            "attemptCount" = 1,
            "lockedAt" = ${input.now},
            "lockedBy" = ${input.workerId},
            "finishedAt" = NULL,
            "updatedAt" = ${input.now}
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING
          job."id",
          job."teamId",
          job."currentEventId" AS "requestId",
          job."repo_id" AS "repoId",
          job."attemptCount"
      `,
    );
    return jobs[0] ?? null;
  }

  async renewLease(
    jobId: string,
    workerId: string,
    requestId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.assertCurrentRequest(transaction, jobId, workerId, requestId);
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: {
          id: jobId,
          status: RepositoryProvisionJobStatus.PROCESSING,
          lockedBy: workerId,
          currentEventId: requestId,
        },
        data: { lockedAt: now },
      });
      this.assertSingleProvisionUpdate(updated.count);
    });
  }
}
