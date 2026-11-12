SET LOCAL TIME ZONE 'UTC';

ALTER TABLE "github_user_activity_history"
  ADD COLUMN IF NOT EXISTS "clock_at" TIMESTAMPTZ(3);

CREATE OR REPLACE VIEW contributor_standing AS
SELECT
  latest.github_id,
  latest.year,
  latest.visibility,
  latest.commit_count,
  latest.pull_request_count,
  latest.issue_count,
  latest.repository_count,
  latest.star_count,
  GREATEST(
    latest.observed_at,
    COALESCE(latest.clock_at, latest.observed_at),
    COALESCE(legacy."observedAt" AT TIME ZONE 'UTC', latest.observed_at)
  ) AS observed_at
FROM (
  SELECT DISTINCT ON (
    observation.github_id,
    observation.year,
    observation.visibility
  )
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.commit_count,
    observation.pull_request_count,
    observation.issue_count,
    observation.repository_count,
    observation.star_count,
    observation.observed_at,
    observation.clock_at
  FROM github_user_activity_history AS observation
  ORDER BY
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.observed_at DESC
) AS latest
LEFT JOIN "GithubUserActivityHistory" AS legacy
  ON legacy."githubId" = latest.github_id
 AND legacy.year = latest.year
 AND legacy.visibility = latest.visibility
UNION ALL
SELECT
  history."githubId",
  history.year,
  history.visibility,
  history."commitCount",
  history."pullRequestCount",
  history."issueCount",
  history."repositoryCount",
  history."starCount",
  history."observedAt" AT TIME ZONE 'UTC'
FROM "GithubUserActivityHistory" AS history
WHERE NOT EXISTS (
  SELECT 1
  FROM github_user_activity_history AS observation
  WHERE observation.github_id = history."githubId"
    AND observation.year = history.year
    AND observation.visibility = history.visibility
);
