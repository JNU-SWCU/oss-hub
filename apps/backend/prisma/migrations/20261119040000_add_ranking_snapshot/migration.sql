BEGIN;

-- Populated by migrate deploy, including when deploying over an existing ledger.
-- Keep the latest observation and the last one before its Seoul day: these
-- suffice for both today's ranking and previousRank across a midnight rollover.
CREATE MATERIALIZED VIEW ranking_activity_snapshot AS
WITH latest AS (
  SELECT DISTINCT ON (github_id, year, visibility) *
  FROM github_user_activity_history
  ORDER BY github_id, year, visibility, observed_at DESC
)
SELECT latest.*, true AS current_row FROM latest
UNION ALL
SELECT prior.*, false FROM latest
CROSS JOIN LATERAL (
  SELECT h.* FROM github_user_activity_history h
  WHERE (h.github_id, h.year, h.visibility) = (latest.github_id, latest.year, latest.visibility)
    AND h.observed_at < date_trunc('day', latest.observed_at, 'Asia/Seoul')
  ORDER BY h.observed_at DESC LIMIT 1
) prior;
CREATE UNIQUE INDEX ranking_activity_snapshot_key
  ON ranking_activity_snapshot (github_id, year, visibility, current_row);

CREATE MATERIALIZED VIEW ranking_streak_snapshot AS
WITH students AS (
  SELECT "githubId" AS github_id, login FROM "User" WHERE type = 'STUDENT' AND login <> ''
), changes AS (
  -- Only the final state of a stream on a Seoul day contributes to the
  -- global end-of-day snapshot. Period 0 folds all years and visibilities.
  SELECT DISTINCT ON (period, github_id, year, visibility, day)
    period, github_id, year, visibility, day, commit_count, pull_request_count,
    issue_count, repository_count, star_count
  FROM github_user_activity_history h JOIN students USING (github_id)
  CROSS JOIN LATERAL (SELECT (h.observed_at AT TIME ZONE 'Asia/Seoul')::date AS day) d
  CROSS JOIN LATERAL (VALUES (0), (h.year)) p(period)
  WHERE period = 0 OR EXTRACT(YEAR FROM day) = period
  ORDER BY period, github_id, year, visibility, day, observed_at DESC
), numbered AS (
  SELECT changes.*, dense_rank() OVER (PARTITION BY period ORDER BY day) AS n FROM changes
), intervals AS (
  SELECT numbered.*, coalesce(
    lead(n) OVER (PARTITION BY period, github_id, year, visibility ORDER BY n) - 1,
    max(n) OVER (PARTITION BY period)
  ) AS last_n FROM numbered
), folded AS (
  -- Expand only actual observed days within each stream's validity interval.
  SELECT period, event, github_id, sum(commit_count) AS commits, sum(pull_request_count) AS prs,
    sum(issue_count) AS issues, sum(repository_count) AS repos,
    (array_agg(star_count ORDER BY year DESC) FILTER (WHERE visibility = 'PUBLIC'))[1] AS stars
  FROM intervals CROSS JOIN LATERAL generate_series(n, last_n) event
  GROUP BY period, event, github_id
), scores AS (
  SELECT period, day, github_id, login, coalesce(commits, 0) AS commits,
    coalesce(prs, 0) AS prs, coalesce(issues, 0) AS issues,
    coalesce(repos, 0) AS repos, coalesce(stars, 0) AS stars
  FROM (SELECT DISTINCT period, n AS event, day FROM numbered) days
  CROSS JOIN students LEFT JOIN folded USING (period, event, github_id)
), ranked AS (
  -- Same tie order as RANKING_ORDER_BY_SQL (including numeric GitHub ID).
  SELECT period, day, github_id, row_number() OVER (PARTITION BY period, day ORDER BY
    commits + prs + issues + repos + stars DESC, commits DESC, prs DESC, issues DESC,
    repos DESC, stars DESC, lower(login) COLLATE "C", github_id) AS rank FROM scores
), runs AS (
  SELECT ranked.*, lag(rank) OVER (PARTITION BY period, github_id ORDER BY day) AS prior FROM ranked
), latest AS (
  SELECT DISTINCT ON (period, github_id) period, github_id, rank,
    max(day) FILTER (WHERE rank IS DISTINCT FROM prior) OVER student AS rank_held_since,
    max(day) FILTER (WHERE rank <= 10 AND (prior IS NULL OR prior > 10)) OVER student AS top_ten_since
  FROM runs WINDOW student AS (PARTITION BY period, github_id)
  ORDER BY period, github_id, day DESC
)
SELECT * FROM latest WHERE rank <= 10;
CREATE UNIQUE INDEX ranking_streak_snapshot_key ON ranking_streak_snapshot (period, github_id);

COMMIT;
