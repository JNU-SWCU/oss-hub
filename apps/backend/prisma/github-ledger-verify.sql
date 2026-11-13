SELECT "check", "expected", "actual"
FROM (
  SELECT 'repo_count' AS "check",
    (SELECT COUNT(*) FROM "GithubRepository") AS "expected",
    (SELECT COUNT(*) FROM "repo") AS "actual"
  UNION ALL
  SELECT 'open_team_link',
    (SELECT COUNT(*) FROM "GithubRepository" WHERE "teamId" IS NOT NULL),
    (SELECT COUNT(*) FROM "team_repo" WHERE "valid_to" IS NULL)
  UNION ALL
  SELECT 'commit_count', uncovered.commits, 0
  FROM (
    SELECT COUNT(*) AS commits
    FROM "CollectionCommitFact" AS fact
    JOIN "GithubRepository" AS repository ON repository.id = fact."repositoryId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "contribution" AS event
      WHERE event.repo_id = repository."githubRepositoryId"
        AND event.kind = 'commit'
        AND event.github_key = fact.sha
    )
  ) AS uncovered
  UNION ALL
  SELECT 'pull_request_count', uncovered.pull_requests, 0
  FROM (
    SELECT COUNT(*) AS pull_requests
    FROM "CollectionPullRequestFact" AS fact
    JOIN "GithubRepository" AS repository ON repository.id = fact."repositoryId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "contribution" AS event
      WHERE event.repo_id = repository."githubRepositoryId"
        AND event.kind = 'pull_request'
        AND event.github_key = fact."githubPullRequestId"::text
    )
  ) AS uncovered
  UNION ALL
  SELECT 'issue_count', uncovered.issues, 0
  FROM (
    SELECT COUNT(*) AS issues
    FROM "GithubIssueHistory" AS fact
    JOIN "GithubRepository" AS repository ON repository.id = fact."repositoryId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "contribution" AS event
      WHERE event.repo_id = repository."githubRepositoryId"
        AND event.kind = 'issue'
        AND event.github_key = fact."githubIssueId"::text
    )
  ) AS uncovered
  UNION ALL
  SELECT 'release_count', uncovered.releases, 0
  FROM (
    SELECT COUNT(*) AS releases
    FROM "CollectionReleaseFact" AS fact
    JOIN "GithubRepository" AS repository ON repository.id = fact."repositoryId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "contribution" AS event
      WHERE event.repo_id = repository."githubRepositoryId"
        AND event.kind = 'release'
        AND event.github_key = fact."githubReleaseId"::text
    )
  ) AS uncovered
  UNION ALL
  SELECT 'latest_commit_sum',
    COALESCE((
      SELECT SUM(standing.commit_count)
      FROM contributor_standing AS standing
      WHERE EXISTS (
        SELECT 1
        FROM github_user_activity_history AS observation
        WHERE observation.github_id = standing.github_id
          AND observation.year = standing.year
          AND observation.visibility = standing.visibility
      )
    ), 0),
    COALESCE((
      SELECT SUM(latest.commit_count)
      FROM (
        SELECT DISTINCT ON (github_id, year, visibility) commit_count
        FROM github_user_activity_history
        ORDER BY github_id, year, visibility, observed_at DESC
      ) AS latest
    ), 0)
  UNION ALL
  SELECT 'latest_pull_request_sum',
    COALESCE((
      SELECT SUM(standing.pull_request_count)
      FROM contributor_standing AS standing
      WHERE EXISTS (
        SELECT 1
        FROM github_user_activity_history AS observation
        WHERE observation.github_id = standing.github_id
          AND observation.year = standing.year
          AND observation.visibility = standing.visibility
      )
    ), 0),
    COALESCE((
      SELECT SUM(latest.pull_request_count)
      FROM (
        SELECT DISTINCT ON (github_id, year, visibility) pull_request_count
        FROM github_user_activity_history
        ORDER BY github_id, year, visibility, observed_at DESC
      ) AS latest
    ), 0)
  UNION ALL
  SELECT 'latest_issue_sum',
    COALESCE((
      SELECT SUM(standing.issue_count)
      FROM contributor_standing AS standing
      WHERE EXISTS (
        SELECT 1
        FROM github_user_activity_history AS observation
        WHERE observation.github_id = standing.github_id
          AND observation.year = standing.year
          AND observation.visibility = standing.visibility
      )
    ), 0),
    COALESCE((
      SELECT SUM(latest.issue_count)
      FROM (
        SELECT DISTINCT ON (github_id, year, visibility) issue_count
        FROM github_user_activity_history
        ORDER BY github_id, year, visibility, observed_at DESC
      ) AS latest
    ), 0)
  UNION ALL
  SELECT 'latest_star_sum',
    COALESCE((
      SELECT SUM(standing.star_count)
      FROM contributor_standing AS standing
      WHERE EXISTS (
        SELECT 1
        FROM github_user_activity_history AS observation
        WHERE observation.github_id = standing.github_id
          AND observation.year = standing.year
          AND observation.visibility = standing.visibility
      )
    ), 0),
    COALESCE((
      SELECT SUM(latest.star_count)
      FROM (
        SELECT DISTINCT ON (github_id, year, visibility) star_count
        FROM github_user_activity_history
        ORDER BY github_id, year, visibility, observed_at DESC
      ) AS latest
    ), 0)
  UNION ALL
  SELECT 'legacy_history_uncovered', uncovered.rows, 0
  FROM (
    SELECT COUNT(*) AS rows
    FROM "GithubUserActivityHistory" AS history
    WHERE NOT EXISTS (
      SELECT 1
      FROM github_user_activity_history AS observation
      WHERE observation.github_id = history."githubId"
        AND observation.year = history.year
        AND observation.visibility = history.visibility
    )
  ) AS uncovered
  UNION ALL
  SELECT 'history_consecutive_same_value', same_value.rows, same_value.rows
  FROM (
    WITH ordered AS (
      SELECT
        "commit_count",
        "pull_request_count",
        "issue_count",
        "repository_count",
        "star_count",
        lag("commit_count") OVER w AS prev_commit,
        lag("pull_request_count") OVER w AS prev_pull_request,
        lag("issue_count") OVER w AS prev_issue,
        lag("repository_count") OVER w AS prev_repository,
        lag("star_count") OVER w AS prev_star
      FROM "github_user_activity_history"
      WINDOW w AS (
        PARTITION BY "github_id", "year", "visibility"
        ORDER BY "observed_at"
      )
    )
    SELECT count(*) FILTER (
      WHERE prev_commit IS NOT NULL
        AND "commit_count" = prev_commit
        AND "pull_request_count" = prev_pull_request
        AND "issue_count" = prev_issue
        AND "repository_count" = prev_repository
        AND "star_count" = prev_star
    ) AS rows
    FROM ordered
  ) AS same_value
  UNION ALL
  SELECT 'open_link_repo_mismatch', identity.rows, identity.rows
  FROM (
    SELECT COUNT(*) AS rows
    FROM (
      SELECT repository."githubRepositoryId" AS repo_id
      FROM "GithubRepository" AS repository
      JOIN "Team" AS team
        ON team."id" = repository."teamId"
       AND team."archivedAt" IS NULL
      WHERE repository."teamId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "team_repo" AS link
          WHERE link."repo_id" = repository."githubRepositoryId"
            AND link."team_id" = repository."teamId"
            AND link."valid_to" IS NULL
        )
      UNION ALL
      SELECT link."repo_id"
      FROM "team_repo" AS link
      WHERE link."valid_to" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "GithubRepository" AS repository
          JOIN "Team" AS team
            ON team."id" = repository."teamId"
           AND team."archivedAt" IS NULL
          WHERE repository."githubRepositoryId" = link."repo_id"
            AND repository."teamId" = link."team_id"
        )
    ) AS mismatched
  ) AS identity
  UNION ALL
  SELECT 'open_period_created_at_floor', floor_hit.rows, floor_hit.rows
  FROM (
    SELECT COUNT(*) AS rows
    FROM "team_repo" AS link
    JOIN "GithubRepository" AS repository
      ON repository."githubRepositoryId" = link."repo_id"
     AND repository."teamId" = link."team_id"
    WHERE link."valid_to" IS NULL
      AND repository."updatedAt" > repository."createdAt"
      -- createdAt is timestamp without time zone. Compare its UTC wall clock
      -- so the session TimeZone cannot drop the hit.
      AND (link."valid_from" AT TIME ZONE 'UTC') = repository."createdAt"
      AND EXISTS (
        SELECT 1
        FROM "team_repo" AS earlier
        WHERE earlier."team_id" = link."team_id"
          AND earlier."repo_id" <> link."repo_id"
          AND (earlier."valid_from" AT TIME ZONE 'UTC') < repository."createdAt"
      )
  ) AS floor_hit
) AS report;
