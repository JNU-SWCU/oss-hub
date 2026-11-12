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

const activityCountsMatch = (
  left: ActivityCountSnapshot,
  right: ActivityCountSnapshot,
): boolean =>
  left.commitCount === right.commitCount &&
  left.pullRequestCount === right.pullRequestCount &&
  left.issueCount === right.issueCount &&
  left.repositoryCount === right.repositoryCount &&
  left.starCount === right.starCount;

const writeActivityLedgerRow = async (
  transaction: Prisma.TransactionClient,
  observation: ActivityLedgerRow,
): Promise<void> => {
  const identity = {
    githubId: observation.githubId,
    year: observation.year,
    visibility: observation.visibility,
    observedAt: observation.observedAt,
  };
  const counts: ActivityCountSnapshot = {
    commitCount: observation.commitCount,
    pullRequestCount: observation.pullRequestCount,
    issueCount: observation.issueCount,
    repositoryCount: observation.repositoryCount,
    starCount: observation.starCount,
  };
  const current = await transaction.githubUserActivityObservation.findUnique({
    where: { githubId_year_visibility_observedAt: identity },
    select: {
      commitCount: true,
      pullRequestCount: true,
      issueCount: true,
      repositoryCount: true,
      starCount: true,
    },
  });
  if (current !== null && !activityCountsMatch(current, counts)) {
    await transaction.githubUserActivityObservation.update({
      where: { githubId_year_visibility_observedAt: identity },
      data: counts,
    });
  }
  const latest = await transaction.githubUserActivityObservation.findFirst({
    where: {
      githubId: observation.githubId,
      year: observation.year,
      visibility: observation.visibility,
    },
    orderBy: { observedAt: 'desc' },
    select: {
      commitCount: true,
      pullRequestCount: true,
      issueCount: true,
      repositoryCount: true,
      starCount: true,
    },
  });
  if (latest === null) {
    await transaction.githubUserActivityObservation.create({
      data: { ...identity, ...counts },
    });
    return;
  }
  if (activityCountsMatch(latest, counts)) return;
  if (current !== null) return;
  await transaction.githubUserActivityObservation.create({
    data: { ...identity, ...counts },
  });
};

@Injectable()
export class CollectionUserActivityRepository {
  constructor(private readonly db: PrismaService) {}

  async listActiveUsers(): Promise<CollectionActivityUserRow[]> {
    return this.db.user.findMany({
      where: { accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true, nickname: true },
      orderBy: { githubId: 'asc' },
    });
  }

  async snapshotCycle(dayStart: Date): Promise<void> {
    const taken = await this.db.githubUserActivityCycleSnapshot.findFirst({
      where: { snapshotAt: { gte: dayStart } },
      select: { githubId: true },
    });
    if (taken !== null) return;
    await this.db.$transaction([
      this.db.githubUserActivityCycleSnapshot.deleteMany(),
      this.db
        .$executeRaw`INSERT INTO "GithubUserActivityCycleSnapshot" ("githubId", "githubLogin", "year", "visibility", "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount", "observedAt") SELECT "githubId", "githubLogin", "year", "visibility", "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount", "observedAt" FROM "GithubUserActivityHistory"`,
    ]);
  }

  async hasObservation(githubId: bigint, year: number): Promise<boolean> {
    const existing = await this.db.githubUserActivityHistory.findUnique({
      where: {
        githubId_year_visibility: {
          githubId,
          year,
          visibility: ActivityVisibility.PUBLIC,
        },
      },
      select: { githubId: true },
    });
    return existing !== null;
  }

  async upsertObservation(
    observation: CollectionUserActivityObservationInput,
  ): Promise<void> {
    const { githubId, year, month, githubLogin, ...counts } = observation;
    const visibility = ActivityVisibility.PUBLIC;
    const row = { githubLogin, ...counts };
    await this.db.$transaction(async (transaction) => {
      await transaction.githubUserActivityHistory.upsert({
        where: { githubId_year_visibility: { githubId, year, visibility } },
        create: { githubId, year, ...row, visibility },
        update: { ...row, visibility },
      });
      await writeActivityLedgerRow(transaction, {
        githubId,
        year,
        visibility,
        commitCount: counts.commitCount,
        pullRequestCount: counts.pullRequestCount,
        issueCount: counts.issueCount,
        repositoryCount: counts.repositoryCount,
        starCount: counts.starCount,
        observedAt: counts.observedAt,
      });
      const privateCounts =
        await transaction.githubUserActivityHistory.findUnique({
          where: {
            githubId_year_visibility: {
              githubId,
              year,
              visibility: ActivityVisibility.PRIVATE,
            },
          },
          select: {
            commitCount: true,
            pullRequestCount: true,
            issueCount: true,
            repositoryCount: true,
          },
        });
      const monthly = {
        ...counts,
        commitCount: counts.commitCount + (privateCounts?.commitCount ?? 0),
        pullRequestCount:
          counts.pullRequestCount + (privateCounts?.pullRequestCount ?? 0),
        issueCount: counts.issueCount + (privateCounts?.issueCount ?? 0),
        repositoryCount:
          counts.repositoryCount + (privateCounts?.repositoryCount ?? 0),
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
    await this.db.$transaction(async (transaction) => {
      await transaction.githubUserActivityHistory.upsert({
        where: { githubId_year_visibility: { githubId, year, visibility } },
        create: { githubId, year, ...row, visibility, starCount: 0 },
        update: { ...row, visibility, starCount: 0 },
      });
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
