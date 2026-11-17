export const STANDING_SQL = `(
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
      COALESCE(latest.clock_at, latest.observed_at)
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
) AS standing`;
