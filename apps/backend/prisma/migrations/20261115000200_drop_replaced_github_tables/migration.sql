BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';

DROP VIEW contributor_standing;
CREATE VIEW contributor_standing AS
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
) AS latest;

DROP VIEW repo_contribution;
CREATE VIEW repo_contribution AS
SELECT
  repository.id AS repository_id,
  repository."githubRepositoryId" AS github_repository_id,
  event_day.author_github_id AS github_id,
  event_day.activity_date,
  COUNT(*) FILTER (WHERE event_day.kind = 'commit')::int AS commit_count,
  COUNT(*) FILTER (WHERE event_day.kind = 'pull_request')::int AS pull_request_count,
  COUNT(*) FILTER (WHERE event_day.kind = 'release')::int AS release_count,
  COUNT(*) FILTER (WHERE event_day.kind = 'issue')::int AS issue_count,
  MAX(event_day.first_seen_at) AS updated_at
FROM (
  SELECT
    event.repo_id,
    event.author_github_id,
    event.kind,
    event.first_seen_at,
    (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS activity_date
  FROM contribution AS event
  WHERE event.author_github_id IS NOT NULL
) AS event_day
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event_day.repo_id
GROUP BY
  repository.id,
  repository."githubRepositoryId",
  event_day.author_github_id,
  event_day.activity_date;

DROP TABLE "CollectionCommitFact";
DROP TABLE "CollectionPullRequestFact";
DROP TABLE "CollectionReleaseFact";
DROP TABLE "GithubIssueHistory";
DROP TABLE "Contribution";
DROP TABLE "GithubUserActivityHistory";
DROP TABLE "GithubUserActivityCycleSnapshot";

COMMIT;
