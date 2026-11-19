import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, UserType } from '@prisma/client';
import { ContributorReadRepository } from '../platform/contributor-read.repository';
import {
  RANKING_ORDER_BY_SQL,
  STANDING_SQL,
} from '../platform/contributor-read.config';
import {
  RankingAllTimelineRepository,
  type RankingAllTimelineRow,
} from './ranking-all-timeline.repository';

const STANDING = Prisma.raw(STANDING_SQL);
import { PrismaService } from '../platform/prisma.service';
import {
  USER_AUTHORITY_SELECT,
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

interface RankingTimelineSelectedRow {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly rank: number;
  readonly total: number;
}

interface RankingTimelinePointRow {
  readonly month: number;
  readonly githubId: bigint | null;
  readonly rank: number | null;
  readonly total: number | null;
}

export interface RankingTimelineRows {
  readonly selected: readonly RankingTimelineSelectedRow[];
  readonly points: readonly RankingTimelinePointRow[];
}

export interface RankingStreak {
  readonly rankHeldSince: string;
  readonly top10Since: string;
  readonly rankHeldDays: number;
  readonly top10Days: number;
}

export interface RankedPageRow extends RankingMetricRow {
  readonly total: number;
  readonly rank: number;
  readonly previousRank: number | null;
  readonly streak?: RankingStreak | null;
}

export interface RankedPage {
  readonly rows: readonly RankedPageRow[];
  readonly total: number;
}

export interface RankingMetricsQuery {
  readonly currentYear?: number;
}

const RANKING_ELIGIBLE_MEMBER: Prisma.UserWhereInput = {
  type: UserType.STUDENT,
  nickname: { not: '' },
};

const RANKING_MEMBER = Prisma.sql`member.type = 'STUDENT' AND member.login <> ''`;

const RANKING_ORDER = Prisma.sql`ORDER BY ${Prisma.raw(RANKING_ORDER_BY_SQL)}`;

const TIMELINE_LEADERS = 10;

function monthlySnapshotSql(year: number): Prisma.Sql {
  return Prisma.sql`
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

function yearFilter(query: RankingMetricsQuery): Prisma.Sql {
  return query.currentYear === undefined
    ? Prisma.empty
    : Prisma.sql`AND year = ${query.currentYear}`;
}

function currentRows(query: RankingMetricsQuery): Prisma.Sql {
  return Prisma.sql`
    SELECT github_id, year, visibility, commit_count, pull_request_count,
      issue_count, repository_count, star_count
    FROM ${STANDING}
    WHERE true ${yearFilter(query)}
  `;
}

function previousRows(query: RankingMetricsQuery, before: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (github_id, year, visibility)
      github_id, year, visibility, commit_count, pull_request_count,
      issue_count, repository_count, star_count
    FROM ranking_activity_snapshot
    WHERE observed_at < ${before} ${yearFilter(query)}
    ORDER BY github_id, year, visibility, observed_at DESC
  `;
}

function foldedActivity(rows: Prisma.Sql, byPeriod = false): Prisma.Sql {
  const period = byPeriod ? Prisma.sql`from_month,` : Prisma.empty;
  return Prisma.sql`
    SELECT
      ${period} github_id,
      SUM(commit_count)::int AS commit_count,
      SUM(pull_request_count)::int AS pull_request_count,
      SUM(issue_count)::int AS issue_count,
      SUM(repository_count)::int AS repository_count,
      COALESCE(
        (ARRAY_AGG(star_count ORDER BY year DESC)
          FILTER (WHERE visibility = 'PUBLIC'::"ActivityVisibility"))[1],
        0
      )::int AS star_count
    FROM (${rows}) AS activity_rows
    GROUP BY ${period} github_id
  `;
}

function rankedMembers(folded: Prisma.Sql, byPeriod = false): Prisma.Sql {
  const partition = byPeriod
    ? Prisma.sql`PARTITION BY scored.from_month`
    : Prisma.empty;
  return Prisma.sql`
    SELECT
      scored.*,
      (ROW_NUMBER() OVER (${partition} ${RANKING_ORDER}))::int AS rank
    FROM (
      SELECT
        ${byPeriod ? Prisma.sql`grid.from_month,` : Prisma.empty}
        member."githubId" AS github_id,
        member.login,
        member.department,
        folded.github_id IS NOT NULL AS has_observation,
        COALESCE(folded.commit_count, 0) AS commit_count,
        COALESCE(folded.pull_request_count, 0) AS pull_request_count,
        COALESCE(folded.issue_count, 0) AS issue_count,
        COALESCE(folded.repository_count, 0) AS repository_count,
        COALESCE(folded.star_count, 0) AS star_count,
        (COALESCE(folded.commit_count, 0) + COALESCE(folded.pull_request_count, 0)
          + COALESCE(folded.issue_count, 0) + COALESCE(folded.repository_count, 0)
          + COALESCE(folded.star_count, 0))::int AS total
      FROM "User" AS member
      ${byPeriod ? Prisma.sql`CROSS JOIN historical_grid AS grid` : Prisma.empty}
      LEFT JOIN ${folded} AS folded ON folded.github_id = member."githubId"
        ${byPeriod ? Prisma.sql`AND folded.from_month = grid.from_month` : Prisma.empty}
      WHERE ${RANKING_MEMBER}
    ) AS scored
  `;
}

function timelineCohort(query: RankingMetricsQuery, viewer: string | null) {
  return Prisma.sql`
    WITH current_folded AS (${foldedActivity(currentRows(query))}),
    final_ranked AS (${rankedMembers(Prisma.sql`current_folded`)})
    SELECT github_id, login, rank, total
    FROM final_ranked
    WHERE total > 0
      AND (rank <= ${TIMELINE_LEADERS} OR lower(login) = lower(${viewer ?? ''}))
  `;
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const seoulDayStart = (instant: Date): Date =>
  new Date(
    Math.floor((instant.getTime() + SEOUL_OFFSET_MS) / DAY_MS) * DAY_MS -
      SEOUL_OFFSET_MS,
  );

@Injectable()
export class RankingRepository {
  private readonly contributors: ContributorReadRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly allTimeline: RankingAllTimelineRepository = new RankingAllTimelineRepository(
      prisma,
    ),
  ) {
    this.contributors = new ContributorReadRepository(prisma);
  }

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

  async findRankedPage(
    query: RankingMetricsQuery,
    window: { readonly offset: number; readonly limit: number },
    now: Date,
  ): Promise<RankedPage> {
    const previous = previousRows(query, seoulDayStart(now));
    const asOf = Prisma.sql`LEAST((${now} AT TIME ZONE 'Asia/Seoul')::date,
      make_date(${query.currentYear ?? null}::int, 12, 31))`;
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<RankedPageRow[]>`
        WITH current_folded AS (${foldedActivity(Prisma.sql`
          SELECT * FROM ranking_activity_snapshot WHERE current_row ${yearFilter(query)}
        `)}),
        previous_rows AS (${previous}),
        previous_folded AS (${foldedActivity(Prisma.sql`SELECT * FROM previous_rows`)}),
        current_ranked AS (${rankedMembers(Prisma.sql`current_folded`)}),
        previous_ranked AS (${rankedMembers(Prisma.sql`previous_folded`)})
        SELECT
          current_ranked.github_id AS "githubId",
          current_ranked.login AS "githubLogin",
          current_ranked.department,
          current_ranked.commit_count AS "commitCount",
          current_ranked.pull_request_count AS "pullRequestCount",
          current_ranked.issue_count AS "issueCount",
          current_ranked.repository_count AS "repositoryCount",
          current_ranked.star_count AS "starCount",
          current_ranked.total,
          current_ranked.rank,
          CASE WHEN EXISTS (SELECT 1 FROM previous_rows)
            THEN previous_ranked.rank
          END AS "previousRank",
          CASE WHEN current_ranked.rank <= 10 THEN
            CASE WHEN ranking_streaks.github_id IS NULL THEN NULL ELSE
              jsonb_build_object(
                'rankHeldSince', to_char(ranking_streaks.rank_held_since, 'YYYY-MM-DD'),
                'top10Since', to_char(ranking_streaks.top_ten_since, 'YYYY-MM-DD'),
                'rankHeldDays', ${asOf} - ranking_streaks.rank_held_since + 1,
                'top10Days', ${asOf} - ranking_streaks.top_ten_since + 1
              )
            END
          END AS streak
        FROM current_ranked
        LEFT JOIN previous_ranked USING (github_id)
        LEFT JOIN ranking_streak_snapshot AS ranking_streaks
          ON ranking_streaks.period = ${query.currentYear ?? 0}
          AND ranking_streaks.github_id = current_ranked.github_id
          AND ranking_streaks.rank = current_ranked.rank
        WHERE current_ranked.rank > ${window.offset}
          AND current_ranked.rank <= ${window.offset + window.limit}
        ORDER BY current_ranked.rank
        LIMIT ${window.limit}
      `,
      this.prisma.user.count({ where: RANKING_ELIGIBLE_MEMBER }),
    ]);
    return { rows, total };
  }

  async findTimelineSeries(
    year: number,
    lastMonth: number,
    viewerLogin: string | null,
  ): Promise<RankingTimelineRows> {
    const selected = await this.prisma.$queryRaw<RankingTimelineSelectedRow[]>`
      SELECT github_id AS "githubId", login AS "githubLogin", rank, total
      FROM (${timelineCohort({ currentYear: year }, viewerLogin)}) AS selected
      ORDER BY rank
      LIMIT ${TIMELINE_LEADERS + 1}
    `;
    const points = await this.prisma.$queryRaw<RankingTimelinePointRow[]>`
      WITH snapshots AS (${monthlySnapshotSql(year)}),
      months AS (SELECT DISTINCT month FROM snapshots WHERE month < ${lastMonth}),
      carried AS (
        SELECT months.month, latest.*
        FROM months
        CROSS JOIN LATERAL (
          SELECT DISTINCT ON (snapshots."githubId")
            snapshots."githubId" AS github_id,
            snapshots."commitCount" AS commit_count,
            snapshots."pullRequestCount" AS pull_request_count,
            snapshots."issueCount" AS issue_count,
            snapshots."repositoryCount" AS repository_count,
            snapshots."starCount" AS star_count
          FROM snapshots
          WHERE snapshots.month <= months.month
          ORDER BY snapshots."githubId", snapshots.month DESC
        ) AS latest
      ),
      ranked AS (
        SELECT
          scored.month,
          scored.github_id,
          scored.total,
          (ROW_NUMBER() OVER (PARTITION BY scored.month ${RANKING_ORDER}))::int AS rank
        FROM (
          SELECT
            carried.month,
            carried.github_id,
            member.login,
            carried.commit_count,
            carried.pull_request_count,
            carried.issue_count,
            carried.repository_count,
            carried.star_count,
            (carried.commit_count + carried.pull_request_count
              + carried.issue_count + carried.repository_count
              + carried.star_count)::int AS total
          FROM carried
          JOIN "User" AS member ON member."githubId" = carried.github_id
          WHERE ${RANKING_MEMBER}
        ) AS scored
      )
      SELECT months.month, ranked.github_id AS "githubId", ranked.rank, ranked.total
      FROM months
      LEFT JOIN ranked
        ON ranked.month = months.month
        AND ranked.github_id = ANY(${selected.map((row) => row.githubId.toString())}::bigint[])
      ORDER BY months.month
      LIMIT ${12 * (TIMELINE_LEADERS + 1)}
    `;
    return { selected, points };
  }

  findAllTimelineSeries(
    viewer: string | null,
  ): Promise<RankingAllTimelineRow[]> {
    return this.allTimeline.readRows({
      member: RANKING_MEMBER,
      cohort: timelineCohort({}, viewer),
      foldedHistory: foldedActivity(
        Prisma.sql`
          SELECT grid.from_month, changes.*
          FROM historical_grid AS grid
          JOIN changes ON changes.observed_at < grid.cutoff
            AND (changes.superseded_at IS NULL OR grid.cutoff <= changes.superseded_at)
        `,
        true,
      ),
      rankedHistory: rankedMembers(Prisma.sql`historical_folded`, true),
      cohortLimit: TIMELINE_LEADERS + 1,
    });
  }

  async findNamesByGithubIds(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string | null>> {
    const uniqueIds = [...new Set(githubIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      take: uniqueIds.length,
      where: { githubId: { in: uniqueIds } },
      select: {
        githubId: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return new Map(users.map((user) => [user.githubId, user.name ?? null]));
  }

  async listYears(): Promise<readonly number[]> {
    return this.contributors.readStandingYears({
      year: null,
      visibility: null,
    });
  }

  async findDataAsOf(): Promise<Date | null> {
    const [row] = await this.prisma.$queryRaw<{ observedAt: Date | null }[]>`
      SELECT MAX(GREATEST(observed_at, clock_at)) AS "observedAt"
      FROM ranking_activity_snapshot WHERE current_row LIMIT 1
    `;
    return row?.observedAt ?? null;
  }
}
