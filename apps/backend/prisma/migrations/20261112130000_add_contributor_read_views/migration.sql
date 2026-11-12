SET LOCAL TIME ZONE 'UTC';
-- Views only. CREATE VIEW takes AccessShareLock on the source tables,
-- which does not block reads or writes. No statement here locks "Team",
-- "User", or "Program".
--
-- A key that already has history contributes its latest observation once.
-- The old table fills that key only when history has no row, so the
-- verification scaffold and rows written before the copy stay visible.
-- The two sources are not added together.

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
  latest.observed_at
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
    observation.observed_at
  FROM github_user_activity_history AS observation
  ORDER BY
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.observed_at DESC
) AS latest
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

-- Group contribution events by repository, author, and the Asia/Seoul
-- calendar date. Null authors are left out, matching the daily rebuild.
-- A daily row is used only when that key has no event.

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
  event_day.activity_date
UNION ALL
SELECT
  daily."repositoryId",
  repository."githubRepositoryId",
  daily."githubId",
  daily.date,
  daily."commitCount",
  daily."pullRequestCount",
  daily."releaseCount",
  daily."issueCount",
  daily."updatedAt" AT TIME ZONE 'UTC'
FROM "Contribution" AS daily
JOIN "GithubRepository" AS repository
  ON repository.id = daily."repositoryId"
WHERE NOT EXISTS (
  SELECT 1
  FROM contribution AS event
  WHERE event.repo_id = repository."githubRepositoryId"
    AND event.author_github_id = daily."githubId"
    AND (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date = daily.date
);
