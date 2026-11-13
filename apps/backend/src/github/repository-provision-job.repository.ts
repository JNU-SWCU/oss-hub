import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import {
  AccountStatus,
  ActivityVisibility,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import {
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionSupersededError,
} from './repository-provision-state.error';

@Injectable()
export class CollectionCutoverRepository {
  constructor(private readonly db: PrismaService) {}

  async isQuiesced(now: Date): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<Array<{ quiesced: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "CollectionCutoverLease" WHERE "expiresAt" > $1) AS "quiesced"`,
      now,
    );
    return rows[0]?.quiesced ?? false;
  }
}

export interface CollectionActivityUserRow {
  readonly githubId: bigint;
  readonly nickname: string;
}

export interface CollectionUserActivityObservationInput {
  readonly githubId: bigint;
  readonly year: number;
  readonly month: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly observedAt: Date;
}

interface ActivityCountSnapshot {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

interface ActivityLedgerRow extends ActivityCountSnapshot {
  readonly githubId: bigint;
  readonly year: number;
  readonly visibility: ActivityVisibility;
  readonly observedAt: Date;
}

interface PrivateActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
}

const EMPTY_PRIVATE_COUNTS: PrivateActivityCounts = {
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
};

const isPrivateActivityCounts = (
  value: unknown,
): value is PrivateActivityCounts => {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<PrivateActivityCounts>;
  return (
    Number.isInteger(row.commitCount) &&
    Number.isInteger(row.pullRequestCount) &&
    Number.isInteger(row.issueCount) &&
    Number.isInteger(row.repositoryCount)
  );
};

const latestPrivateCounts = async (
  transaction: Prisma.TransactionClient,
  githubId: bigint,
  year: number,
): Promise<PrivateActivityCounts> => {
  const rows = await transaction.$queryRaw<readonly unknown[]>`
    SELECT
      commit_count AS "commitCount",
      pull_request_count AS "pullRequestCount",
      issue_count AS "issueCount",
      repository_count AS "repositoryCount"
    FROM "github_user_activity_history"
    WHERE "github_id" = ${githubId}
      AND "year" = ${year}
      AND visibility = 'PRIVATE'::"ActivityVisibility"
    ORDER BY "observed_at" DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return EMPTY_PRIVATE_COUNTS;
  if (!isPrivateActivityCounts(row)) {
    throw new Error('Private activity counts were not integers');
  }
  return row;
};

const writeActivityLedgerRow = async (
  transaction: Prisma.TransactionClient,
  observation: ActivityLedgerRow,
): Promise<void> => {
  await transaction.$executeRaw`
    INSERT INTO "github_user_activity_history" (
      "github_id",
      "year",
      "visibility",
      "commit_count",
      "pull_request_count",
      "issue_count",
      "repository_count",
      "star_count",
      "observed_at"
    )
    SELECT
      incoming."github_id",
      incoming."year",
      incoming."visibility",
      incoming."commit_count",
      incoming."pull_request_count",
      incoming."issue_count",
      incoming."repository_count",
      incoming."star_count",
      incoming."observed_at"
    FROM (
      SELECT
        ${observation.githubId}::bigint AS "github_id",
        ${observation.year}::int AS "year",
        ${observation.visibility}::"ActivityVisibility" AS "visibility",
        ${observation.commitCount}::int AS "commit_count",
        ${observation.pullRequestCount}::int AS "pull_request_count",
        ${observation.issueCount}::int AS "issue_count",
        ${observation.repositoryCount}::int AS "repository_count",
        ${observation.starCount}::int AS "star_count",
        ${observation.observedAt}::timestamptz(3) AS "observed_at"
    ) AS incoming
    WHERE NOT EXISTS (
      SELECT 1
      FROM "github_user_activity_history" AS existing
      WHERE existing."github_id" = incoming."github_id"
        AND existing."year" = incoming."year"
        AND existing."visibility" = incoming."visibility"
        AND existing."observed_at" = (
          SELECT latest."observed_at"
          FROM "github_user_activity_history" AS latest
          WHERE latest."github_id" = incoming."github_id"
            AND latest."year" = incoming."year"
            AND latest."visibility" = incoming."visibility"
          ORDER BY latest."observed_at" DESC
          LIMIT 1
        )
        AND existing."commit_count" = incoming."commit_count"
        AND existing."pull_request_count" = incoming."pull_request_count"
        AND existing."issue_count" = incoming."issue_count"
        AND existing."repository_count" = incoming."repository_count"
        AND existing."star_count" = incoming."star_count"
    )
    ON CONFLICT ("github_id", "year", "visibility", "observed_at") DO UPDATE SET
      "commit_count" = EXCLUDED."commit_count",
      "pull_request_count" = EXCLUDED."pull_request_count",
      "issue_count" = EXCLUDED."issue_count",
      "repository_count" = EXCLUDED."repository_count",
      "star_count" = EXCLUDED."star_count"
  `;
  await transaction.$executeRaw`
    UPDATE "github_user_activity_history" AS existing
    SET "clock_at" = ${observation.observedAt}::timestamptz(3)
    WHERE existing."github_id" = ${observation.githubId}::bigint
      AND existing."year" = ${observation.year}::int
      AND existing."visibility" = ${observation.visibility}::"ActivityVisibility"
      AND existing."commit_count" = ${observation.commitCount}::int
      AND existing."pull_request_count" = ${observation.pullRequestCount}::int
      AND existing."issue_count" = ${observation.issueCount}::int
      AND existing."repository_count" = ${observation.repositoryCount}::int
      AND existing."star_count" = ${observation.starCount}::int
      AND existing."observed_at" < ${observation.observedAt}::timestamptz(3)
      AND (
        existing."clock_at" IS NULL
        OR existing."clock_at" < ${observation.observedAt}::timestamptz(3)
      )
      AND existing."observed_at" = (
        SELECT latest."observed_at"
        FROM "github_user_activity_history" AS latest
        WHERE latest."github_id" = existing."github_id"
          AND latest."year" = existing."year"
          AND latest."visibility" = existing."visibility"
        ORDER BY latest."observed_at" DESC
        LIMIT 1
      )
  `;
};

@Injectable()
export class CollectionUserActivityRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly cutover: CollectionCutoverRepository,
  ) {}

  async listActiveUsers(): Promise<CollectionActivityUserRow[]> {
    return this.db.user.findMany({
      where: { accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true, nickname: true },
      orderBy: { githubId: 'asc' },
    });
  }

  async hasObservation(githubId: bigint, year: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<{ readonly present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM "github_user_activity_history"
        WHERE "github_id" = ${githubId}
          AND "year" = ${year}
          AND "visibility" = 'PUBLIC'::"ActivityVisibility"
      ) AS present
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Activity ledger existence query did not return a row');
    }
    return row.present;
  }

  async upsertObservation(
    observation: CollectionUserActivityObservationInput,
  ): Promise<void> {
    const { githubId, year, month } = observation;
    const visibility = ActivityVisibility.PUBLIC;
    const publicCounts = {
      commitCount: observation.commitCount,
      pullRequestCount: observation.pullRequestCount,
      issueCount: observation.issueCount,
      repositoryCount: observation.repositoryCount,
      starCount: observation.starCount,
      observedAt: observation.observedAt,
    };
    await this.record(async (transaction) => {
      await writeActivityLedgerRow(transaction, {
        githubId,
        year,
        visibility,
        ...publicCounts,
      });
      const privateCounts = await latestPrivateCounts(
        transaction,
        githubId,
        year,
      );
      const monthly = {
        ...publicCounts,
        commitCount: publicCounts.commitCount + privateCounts.commitCount,
        pullRequestCount:
          publicCounts.pullRequestCount + privateCounts.pullRequestCount,
        issueCount: publicCounts.issueCount + privateCounts.issueCount,
        repositoryCount:
          publicCounts.repositoryCount + privateCounts.repositoryCount,
      };
      await transaction.githubUserActivityMonthly.upsert({
        where: { githubId_year_month: { githubId, year, month } },
        create: { githubId, year, month, ...monthly },
        update: monthly,
      });
    });
  }

  async upsertPrivateObservation(
    observation: Omit<
      CollectionUserActivityObservationInput,
      'starCount' | 'month'
    >,
  ): Promise<void> {
    const { githubId, year, ...row } = observation;
    const visibility = ActivityVisibility.PRIVATE;
    await this.record(async (transaction) => {
      await writeActivityLedgerRow(transaction, {
        githubId,
        year,
        visibility,
        commitCount: row.commitCount,
        pullRequestCount: row.pullRequestCount,
        issueCount: row.issueCount,
        repositoryCount: row.repositoryCount,
        starCount: 0,
        observedAt: row.observedAt,
      });
    });
  }

  private async record(
    write: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    if (await this.cutover.isQuiesced(new Date())) return;
    await this.db.$transaction(write);
  }
}

export interface ClaimRepositoryProvisionJobInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedRepositoryProvisionJob {
  readonly id: string;
  readonly teamId: string;
  readonly requestId: string;
  readonly repositoryId: string | null;
  readonly attemptCount: number;
}

type ClaimedRepositoryProvisionJobRow = ClaimedRepositoryProvisionJob;

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
    readonly repositoryId: string | null;
  }> {
    const rows = await transaction.$queryRaw<
      readonly {
        readonly teamId: string;
        readonly currentEventId: string | null;
        readonly repositoryId: string | null;
        readonly status: RepositoryProvisionJobStatus;
        readonly lockedBy: string | null;
      }[]
    >(Prisma.sql`
    SELECT "teamId", "currentEventId", "repositoryId", "status", "lockedBy"
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
      repositoryId: row.repositoryId,
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
        job."repositoryId",
        job."attemptCount"
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
          JOIN "Program" AS program ON program."id" = (
            SELECT application."programId"
            FROM "Team" AS application
            WHERE application."id" = job."teamId"
          )
          JOIN "GithubRepository" AS repository ON repository."id" = job."repositoryId"
          WHERE job."status" = CAST(${RepositoryProvisionJobStatus.SUCCEEDED} AS "RepositoryProvisionJobStatus")
            AND job."currentEventId" IS NOT NULL
            AND job."repositoryId" IS NOT NULL
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
          job."repositoryId",
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
