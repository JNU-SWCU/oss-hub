import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSingleProvisionUpdate } from '../repository-provision-state.helpers';

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
  /**
   * 성공한 job도 주기적으로 다시 집는다 — PENDING 초대가 없어도 팀원 변경으로 생긴 권한 drift를
   * 같은 job에서 맞추기 위함이다. 새 queue/table/cadence를 만들지 않고 worker가 다음 시각을 정한다.
   * OWN 연결은 우리가 권한 authority가 아니므로 절대 재발생시키지 않는다.
   */
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
          JOIN "Application" AS application ON application."id" = job."applicationId"
          JOIN "Program" AS program ON program."id" = application."programId"
          WHERE job."status" = CAST(${RepositoryProvisionJobStatus.SUCCEEDED} AS "RepositoryProvisionJobStatus")
            AND job."repositoryId" IS NOT NULL
            AND job."nextAttemptAt" <= ${input.now}
            AND application."repositoryConnectionMode" = CAST(${RepositoryConnectionMode.NEW} AS "RepositoryConnectionMode")
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
