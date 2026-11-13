import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ActivityVisibility,
  UserType,
  type Prisma,
} from '@prisma/client';
import {
  ContributorReadRepository,
  type StandingRow,
} from '../platform/contributor-read.repository';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_DEPARTMENT_SELECT,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';

export type RankingRepositoryViewerClass = 'public' | 'member' | 'staff';

export interface RankingMetricRow {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingMonthlySnapshotRow {
  readonly githubId: bigint;
  readonly month: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingMetricsQuery {
  readonly currentYear?: number;
}

const RANKING_ELIGIBLE_MEMBER: Prisma.UserWhereInput = {
  type: UserType.STUDENT,
};

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const seoulDayStart = (instant: Date): Date =>
  new Date(
    Math.floor((instant.getTime() + SEOUL_OFFSET_MS) / DAY_MS) * DAY_MS -
      SEOUL_OFFSET_MS,
  );

type ActivityRow = StandingRow;

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findViewerClass(
    githubId: bigint | null,
  ): Promise<RankingRepositoryViewerClass> {
    if (githubId === null) {
      return 'public';
    }
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    if (actor === null || actor.accountStatus !== AccountStatus.ACTIVE) {
      return 'public';
    }
    if (
      actor.type === 'STAFF' &&
      actor.approvalStatus === 'APPROVED' &&
      actor.profileCreatedAt !== null &&
      actor.name !== null &&
      actor.department !== null
    ) {
      return 'staff';
    }
    return 'member';
  }

  async findMetrics(
    query: RankingMetricsQuery,
  ): Promise<readonly RankingMetricRow[]> {
    return this.foldMetrics(
      new ContributorReadRepository(this.prisma).readStandingRows({
        year: query.currentYear ?? null,
        visibility: null,
      }),
    );
  }

  async findPreviousCycleMetrics(
    query: RankingMetricsQuery,
    now: Date,
  ): Promise<readonly RankingMetricRow[]> {
    const rows = await new ContributorReadRepository(
      this.prisma,
    ).readRowsBefore(
      {
        year: query.currentYear === undefined ? null : query.currentYear,
        visibility: null,
      },
      seoulDayStart(now),
    );
    return rows.length === 0 ? [] : this.foldMetrics(Promise.resolve(rows));
  }

  private async foldMetrics(
    activity: Promise<readonly ActivityRow[]>,
  ): Promise<readonly RankingMetricRow[]> {
    const [users, activityRows] = await Promise.all([
      this.prisma.user.findMany({
        where: RANKING_ELIGIBLE_MEMBER,
        select: {
          githubId: true,
          nickname: true,
          ...USER_PROFILE_DEPARTMENT_SELECT,
        },
      }),
      activity,
    ]);

    const folded = new Map<
      string,
      {
        commitCount: number;
        pullRequestCount: number;
        issueCount: number;
        repositoryCount: number;
        starCount: number;
        starYear: number;
      }
    >();
    const NO_STAR_YEAR = Number.NEGATIVE_INFINITY;
    for (const row of activityRows) {
      const key = row.githubId.toString();
      const isPublic = row.visibility === ActivityVisibility.PUBLIC;
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          issueCount: row.issueCount,
          repositoryCount: row.repositoryCount,
          starCount: isPublic ? row.starCount : 0,
          starYear: isPublic ? row.year : NO_STAR_YEAR,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.issueCount += row.issueCount;
      current.repositoryCount += row.repositoryCount;
      if (isPublic && row.year >= current.starYear) {
        current.starCount = row.starCount;
        current.starYear = row.year;
      }
    }

    return users
      .filter((user) => user.nickname)
      .map((user) => {
        const totals = folded.get(user.githubId.toString());
        return {
          githubId: user.githubId,
          githubLogin: user.nickname,
          department: user.department ?? null,
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          issueCount: totals?.issueCount ?? 0,
          repositoryCount: totals?.repositoryCount ?? 0,
          starCount: totals?.starCount ?? 0,
        };
      });
  }

  async findMonthlySnapshots(
    year: number,
  ): Promise<readonly RankingMonthlySnapshotRow[]> {
    return this.prisma.$queryRaw<RankingMonthlySnapshotRow[]>`
      SELECT
        observed.github_id AS "githubId",
        observed.month,
        (public_row.commit_count + COALESCE(private_row.commit_count, 0))::int
          AS "commitCount",
        (public_row.pull_request_count
          + COALESCE(private_row.pull_request_count, 0))::int
          AS "pullRequestCount",
        (public_row.issue_count + COALESCE(private_row.issue_count, 0))::int
          AS "issueCount",
        (public_row.repository_count
          + COALESCE(private_row.repository_count, 0))::int
          AS "repositoryCount",
        public_row.star_count AS "starCount"
      FROM (
        SELECT DISTINCT
          observation.github_id,
          month_bound.month,
          month_bound.month_end
        FROM github_user_activity_history AS observation
        CROSS JOIN LATERAL (
          SELECT
            EXTRACT(
              MONTH FROM observation.observed_at AT TIME ZONE 'Asia/Seoul'
            )::int AS month,
            (date_trunc('month', observation.observed_at AT TIME ZONE 'Asia/Seoul')
              + INTERVAL '1 month') AT TIME ZONE 'Asia/Seoul' AS month_end
        ) AS month_bound
        WHERE observation.year = ${year}
          AND EXTRACT(
            YEAR FROM observation.observed_at AT TIME ZONE 'Asia/Seoul'
          ) = ${year}
      ) AS observed
      CROSS JOIN LATERAL (
        SELECT
          latest.commit_count,
          latest.pull_request_count,
          latest.issue_count,
          latest.repository_count,
          latest.star_count
        FROM github_user_activity_history AS latest
        WHERE latest.github_id = observed.github_id
          AND latest.year = ${year}
          AND latest.visibility = 'PUBLIC'::"ActivityVisibility"
          AND latest.observed_at < observed.month_end
        ORDER BY latest.observed_at DESC
        LIMIT 1
      ) AS public_row
      LEFT JOIN LATERAL (
        SELECT
          latest.commit_count,
          latest.pull_request_count,
          latest.issue_count,
          latest.repository_count
        FROM github_user_activity_history AS latest
        WHERE latest.github_id = observed.github_id
          AND latest.year = ${year}
          AND latest.visibility = 'PRIVATE'::"ActivityVisibility"
          AND latest.observed_at < observed.month_end
        ORDER BY latest.observed_at DESC
        LIMIT 1
      ) AS private_row ON true
    `;
  }

  async findNamesByGithubIds(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string | null>> {
    const uniqueIds = [...new Set(githubIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      where: { githubId: { in: uniqueIds } },
      select: {
        githubId: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return new Map(users.map((user) => [user.githubId, user.name ?? null]));
  }

  async listYears(): Promise<readonly number[]> {
    return new ContributorReadRepository(this.prisma).readStandingYears({
      year: null,
      visibility: null,
    });
  }

  async findDataAsOf(): Promise<Date | null> {
    return new ContributorReadRepository(this.prisma).readStandingObservedAt({
      year: null,
      visibility: null,
    });
  }
}
