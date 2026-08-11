import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSingleProvisionUpdate } from '../repository-provision-state.helpers';
import { DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS } from '../repository-provision.failure';

export interface ClaimRepositoryProvisionJobInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedRepositoryProvisionJob {
  readonly id: string;
  readonly applicationId: string;
  readonly repositoryId: string | null;
  readonly attemptCount: number;
}

type ClaimedRepositoryProvisionJobRow = ClaimedRepositoryProvisionJob;

@Injectable()
export class RepositoryProvisionJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimNext(
    input: ClaimRepositoryProvisionJobInput,
  ): Promise<ClaimedRepositoryProvisionJob | null> {
    const leaseCutoff = new Date(input.now.getTime() - input.leaseMs);
    const jobs = await this.prisma.$queryRaw<
      ClaimedRepositoryProvisionJobRow[]
    >(Prisma.sql`
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
      RETURNING job."id", job."applicationId", job."repositoryId", job."attemptCount"
    `);
    return jobs[0] ?? null;
  }
  async claimNextReconciliation(
    input: ClaimRepositoryProvisionJobInput,
  ): Promise<ClaimedRepositoryProvisionJob | null> {
    const jobs = await this.prisma.$queryRaw<
      ClaimedRepositoryProvisionJobRow[]
    >(
      Prisma.sql`
        WITH candidate AS (
          SELECT job."id"
          FROM "RepositoryProvisionJob" AS job
          WHERE job."status" = CAST(${RepositoryProvisionJobStatus.SUCCEEDED} AS "RepositoryProvisionJobStatus")
            AND job."nextAttemptAt" <= ${input.now}
            AND EXISTS (
              SELECT 1
              FROM "RepositoryInvitation" AS invitation
              WHERE invitation."repositoryId" = job."repositoryId"
                AND invitation."status" = CAST(${RepositoryInvitationStatus.PENDING} AS "RepositoryInvitationStatus")
                AND invitation."reconciliationCount" < ${DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS}
            )
          ORDER BY job."nextAttemptAt", job."createdAt", job."id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "RepositoryProvisionJob" AS job
        SET "status" = CAST(${RepositoryProvisionJobStatus.PROCESSING} AS "RepositoryProvisionJobStatus"),
            "lockedAt" = ${input.now},
            "lockedBy" = ${input.workerId},
            "finishedAt" = NULL,
            "updatedAt" = ${input.now}
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job."id", job."applicationId", job."repositoryId", job."attemptCount"
      `,
    );
    return jobs[0] ?? null;
  }

  async renewLease(jobId: string, workerId: string, now: Date): Promise<void> {
    const updated = await this.prisma.repositoryProvisionJob.updateMany({
      where: {
        id: jobId,
        status: RepositoryProvisionJobStatus.PROCESSING,
        lockedBy: workerId,
      },
      data: { lockedAt: now },
    });
    assertSingleProvisionUpdate(updated.count);
  }
}
