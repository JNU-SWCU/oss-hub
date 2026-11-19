import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';

const CALENDAR_MONTH_COUNT = 12;

export interface RankingAllTimelineRow {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly githubId: bigint | null;
  readonly githubLogin: string | null;
  readonly rank: number | null;
  readonly total: number | null;
}

@Injectable()
export class RankingAllTimelineRepository {
  constructor(private readonly prisma: PrismaService) {}

  readRows(input: {
    readonly member: Prisma.Sql;
    readonly cohort: Prisma.Sql;
    readonly foldedHistory: Prisma.Sql;
    readonly rankedHistory: Prisma.Sql;
    readonly cohortLimit: number;
  }): Promise<RankingAllTimelineRow[]> {
    return this.prisma.$queryRaw<RankingAllTimelineRow[]>`
    WITH activity_history AS MATERIALIZED (
      SELECT activity.github_id, activity.year, activity.visibility, activity.observed_at,
        activity.clock_at, activity.commit_count, activity.pull_request_count,
        activity.issue_count, activity.repository_count, activity.star_count
      FROM github_user_activity_history AS activity
      JOIN "User" AS member ON member."githubId" = activity.github_id
      WHERE ${input.member}
    ),
    observed_months AS (
      SELECT DISTINCT date_trunc('month', stamp.instant AT TIME ZONE 'Asia/Seoul') AS month
      FROM activity_history
      CROSS JOIN LATERAL (VALUES (observed_at), (clock_at)) AS stamp(instant)
      WHERE stamp.instant IS NOT NULL
    ),
    bounds AS (
      SELECT MIN(month) AS first_month, MAX(month) AS last_month
      FROM observed_months
      HAVING COUNT(*) > 0
    ),
    span AS (
      SELECT *,
        1 + (EXTRACT(YEAR FROM age(last_month, first_month)) * 12
          + EXTRACT(MONTH FROM age(last_month, first_month)))::int AS month_count
      FROM bounds
    ),
    resolution AS (
      SELECT *, CEIL(month_count / ${CALENDAR_MONTH_COUNT}::numeric)::int AS step
      FROM span
    ),
    windows AS (
      SELECT
        first_month + (slot.number * step * INTERVAL '1 month') AS from_month,
        LEAST(last_month, first_month + (((slot.number + 1) * step - 1)
          * INTERVAL '1 month')) AS to_month,
        last_month
      FROM resolution
      CROSS JOIN generate_series(0, ${CALENDAR_MONTH_COUNT - 1}::int) AS slot(number)
      WHERE slot.number * step < month_count
    ),
    grid AS (
      SELECT *,
        (to_month + INTERVAL '1 month') AT TIME ZONE 'Asia/Seoul' AS cutoff,
        to_month = last_month AS is_latest,
        EXISTS (
          SELECT 1 FROM observed_months
          WHERE month BETWEEN from_month AND to_month
        ) AS has_observation
      FROM windows
    ),
    historical_grid AS (
      SELECT from_month, cutoff FROM grid WHERE has_observation AND NOT is_latest
    ),
    changes AS (
      SELECT activity_history.*,
        LEAD(observed_at) OVER (
          PARTITION BY github_id, year, visibility ORDER BY observed_at
        ) AS superseded_at
      FROM activity_history
    ),
    historical_folded AS (${input.foldedHistory}),
    historical_ranked AS (${input.rankedHistory}),
    selected AS (${input.cohort} ORDER BY rank LIMIT ${input.cohortLimit}),
    points AS (
      SELECT ranked.from_month, selected.github_id, selected.login, selected.rank AS final_rank,
        ranked.rank, ranked.total
      FROM historical_ranked AS ranked
      JOIN selected USING (github_id)
      WHERE ranked.has_observation
      UNION ALL
      SELECT grid.from_month, selected.github_id, selected.login, selected.rank,
        selected.rank, selected.total
      FROM grid CROSS JOIN selected
      WHERE grid.is_latest
    )
    SELECT to_char(grid.from_month, 'YYYY-MM') AS "fromMonth",
      to_char(grid.to_month, 'YYYY-MM') AS "toMonth",
      points.github_id AS "githubId", points.login AS "githubLogin", points.rank, points.total
    FROM grid
    LEFT JOIN points USING (from_month)
    ORDER BY grid.from_month, points.final_rank
    LIMIT ${CALENDAR_MONTH_COUNT * input.cohortLimit}
  `;
  }
}
