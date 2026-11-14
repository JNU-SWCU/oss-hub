import { Injectable } from '@nestjs/common';
import { AccountStatus, ActivityVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';

export interface CollectionActivityUserRow {
  readonly githubId: bigint;
  readonly nickname: string;
}

export interface CollectionUserActivityObservationInput {
  readonly githubId: bigint;
  readonly year: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly observedAt: Date;
}

interface ActivityLedgerRow {
  readonly githubId: bigint;
  readonly year: number;
  readonly visibility: ActivityVisibility;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly observedAt: Date;
}

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
  constructor(private readonly db: PrismaService) {}

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

  upsertObservation(
    observation: CollectionUserActivityObservationInput,
  ): Promise<void> {
    return this.writeObservation(observation, ActivityVisibility.PUBLIC);
  }

  upsertPrivateObservation(
    observation: Omit<CollectionUserActivityObservationInput, 'starCount'>,
  ): Promise<void> {
    return this.writeObservation(
      { ...observation, starCount: 0 },
      ActivityVisibility.PRIVATE,
    );
  }

  private async writeObservation(
    observation: CollectionUserActivityObservationInput,
    visibility: ActivityVisibility,
  ): Promise<void> {
    await this.db.$transaction((transaction) =>
      writeActivityLedgerRow(transaction, { ...observation, visibility }),
    );
  }
}
