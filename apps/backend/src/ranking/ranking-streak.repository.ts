import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

interface RankingStreakMetricsQuery {
  readonly currentYear?: number;
}

interface RankingStreakSqlInput {
  readonly member: Prisma.Sql;
  readonly order: Prisma.Sql;
  readonly query: RankingStreakMetricsQuery;
  readonly now: Date;
}

function periodBounds(
  query: RankingStreakMetricsQuery,
  now: Date,
): {
  readonly historyFilter: Prisma.Sql;
  readonly effectiveDay: Prisma.Sql;
} {
  if (query.currentYear === undefined) {
    return {
      historyFilter: Prisma.empty,
      effectiveDay: Prisma.sql`(${now} AT TIME ZONE 'Asia/Seoul')::date`,
    };
  }

  const year = query.currentYear;
  return {
    historyFilter: Prisma.sql`
      AND observation.observed_at >= make_timestamptz(${year}, 1, 1, 0, 0, 0, 'Asia/Seoul')
      AND observation.observed_at < make_timestamptz(${year + 1}, 1, 1, 0, 0, 0, 'Asia/Seoul')
    `,
    effectiveDay: Prisma.sql`LEAST(
      (${now} AT TIME ZONE 'Asia/Seoul')::date,
      make_date(${year}, 12, 31)
    )`,
  };
}

@Injectable()
export class RankingStreakRepository {
  ctes(input: RankingStreakSqlInput): Prisma.Sql {
    const { historyFilter, effectiveDay } = periodBounds(
      input.query,
      input.now,
    );
    const yearFilter =
      input.query.currentYear === undefined
        ? Prisma.empty
        : Prisma.sql`AND observation.year = ${input.query.currentYear}`;

    return Prisma.sql`
    streak_activity_history AS MATERIALIZED (
      SELECT observation.github_id, observation.year, observation.visibility,
        observation.commit_count, observation.pull_request_count,
        observation.issue_count, observation.repository_count,
        observation.star_count, observation.observed_at
      FROM github_user_activity_history AS observation
      JOIN "User" AS member ON member."githubId" = observation.github_id
      WHERE ${input.member} ${yearFilter} ${historyFilter}
    ),
    streak_events AS (
      SELECT DISTINCT observed_at AS event_at FROM streak_activity_history
    ),
    streak_changes AS (
      SELECT streak_activity_history.*,
        LEAD(observed_at) OVER (
          PARTITION BY github_id, year, visibility ORDER BY observed_at
        ) AS superseded_at
      FROM streak_activity_history
    ),
    streak_event_rows AS (
      SELECT event.event_at, change.*
      FROM streak_events AS event
      JOIN streak_changes AS change
        ON change.observed_at <= event.event_at
        AND (change.superseded_at IS NULL OR event.event_at < change.superseded_at)
    ),
    streak_folded AS (
      SELECT event_at, github_id,
        SUM(commit_count)::int AS commit_count,
        SUM(pull_request_count)::int AS pull_request_count,
        SUM(issue_count)::int AS issue_count,
        SUM(repository_count)::int AS repository_count,
        COALESCE(
          (ARRAY_AGG(star_count ORDER BY year DESC)
            FILTER (WHERE visibility = 'PUBLIC'::"ActivityVisibility"))[1],
          0
        )::int AS star_count
      FROM streak_event_rows
      GROUP BY event_at, github_id
    ),
    streak_ranked AS (
      SELECT scored.event_at, scored.github_id,
        (ROW_NUMBER() OVER (
          PARTITION BY scored.event_at ${input.order}
        ))::int AS rank
      FROM (
        SELECT event.event_at, member."githubId" AS github_id, member.login,
          COALESCE(folded.commit_count, 0) AS commit_count,
          COALESCE(folded.pull_request_count, 0) AS pull_request_count,
          COALESCE(folded.issue_count, 0) AS issue_count,
          COALESCE(folded.repository_count, 0) AS repository_count,
          COALESCE(folded.star_count, 0) AS star_count,
          (COALESCE(folded.commit_count, 0)
            + COALESCE(folded.pull_request_count, 0)
            + COALESCE(folded.issue_count, 0)
            + COALESCE(folded.repository_count, 0)
            + COALESCE(folded.star_count, 0))::int AS total
        FROM streak_events AS event
        CROSS JOIN "User" AS member
        LEFT JOIN streak_folded AS folded
          ON folded.event_at = event.event_at
          AND folded.github_id = member."githubId"
        WHERE ${input.member}
      ) AS scored
    ),
    streak_current_top_ten AS (
      SELECT github_id, rank FROM current_ranked WHERE rank <= 10
    ),
    streak_breaks AS (
      SELECT current.github_id, current.rank,
        MAX(history.event_at) FILTER (
          WHERE history.rank <> current.rank
        ) AS rank_break_at,
        MAX(history.event_at) FILTER (
          WHERE history.rank > 10
        ) AS top_ten_break_at
      FROM streak_current_top_ten AS current
      JOIN streak_ranked AS history USING (github_id)
      GROUP BY current.github_id, current.rank
    ),
    ranking_streaks AS (
      SELECT breaks.github_id,
        to_char(rank_run.started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
          AS rank_held_since,
        to_char(top_ten_run.started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
          AS top_ten_since,
        (${effectiveDay}
          - (rank_run.started_at AT TIME ZONE 'Asia/Seoul')::date + 1)::int
          AS rank_held_days,
        (${effectiveDay}
          - (top_ten_run.started_at AT TIME ZONE 'Asia/Seoul')::date + 1)::int
          AS top_ten_days
      FROM streak_breaks AS breaks
      CROSS JOIN LATERAL (
        SELECT MIN(event_at) AS started_at
        FROM streak_ranked
        WHERE github_id = breaks.github_id
          AND (breaks.rank_break_at IS NULL OR event_at > breaks.rank_break_at)
      ) AS rank_run
      CROSS JOIN LATERAL (
        SELECT MIN(event_at) AS started_at
        FROM streak_ranked
        WHERE github_id = breaks.github_id
          AND (breaks.top_ten_break_at IS NULL
            OR event_at > breaks.top_ten_break_at)
      ) AS top_ten_run
      WHERE rank_run.started_at IS NOT NULL AND top_ten_run.started_at IS NOT NULL
      LIMIT 10
    )
    `;
  }
}
