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
  SELECT 'commit_count',
    (SELECT COUNT(*) FROM "CollectionCommitFact"),
    (SELECT COUNT(*) FROM "contribution" WHERE "kind" = 'commit')
  UNION ALL
  SELECT 'pull_request_count',
    (SELECT COUNT(*) FROM "CollectionPullRequestFact"),
    (SELECT COUNT(*) FROM "contribution" WHERE "kind" = 'pull_request')
  UNION ALL
  SELECT 'issue_count',
    (SELECT COUNT(*) FROM "GithubIssueHistory"),
    (SELECT COUNT(*) FROM "contribution" WHERE "kind" = 'issue')
  UNION ALL
  SELECT 'release_count',
    (SELECT COUNT(*) FROM "CollectionReleaseFact"),
    (SELECT COUNT(*) FROM "contribution" WHERE "kind" = 'release')
  UNION ALL
  SELECT 'latest_commit_sum',
    (SELECT COALESCE(SUM("commitCount"), 0) FROM "GithubUserActivityHistory"),
    (
      SELECT COALESCE(SUM(observation."commit_count"), 0)
      FROM "GithubUserActivityHistory" AS history
      JOIN LATERAL (
        SELECT observation."commit_count"
        FROM "github_user_activity_history" AS observation
        WHERE observation."github_id" = history."githubId"
          AND observation."year" = history."year"
          AND observation."visibility" = history."visibility"
        ORDER BY observation."observed_at" DESC
        LIMIT 1
      ) AS observation ON TRUE
    )
  UNION ALL
  SELECT 'latest_pull_request_sum',
    (SELECT COALESCE(SUM("pullRequestCount"), 0) FROM "GithubUserActivityHistory"),
    (
      SELECT COALESCE(SUM(observation."pull_request_count"), 0)
      FROM "GithubUserActivityHistory" AS history
      JOIN LATERAL (
        SELECT observation."pull_request_count"
        FROM "github_user_activity_history" AS observation
        WHERE observation."github_id" = history."githubId"
          AND observation."year" = history."year"
          AND observation."visibility" = history."visibility"
        ORDER BY observation."observed_at" DESC
        LIMIT 1
      ) AS observation ON TRUE
    )
  UNION ALL
  SELECT 'latest_issue_sum',
    (SELECT COALESCE(SUM("issueCount"), 0) FROM "GithubUserActivityHistory"),
    (
      SELECT COALESCE(SUM(observation."issue_count"), 0)
      FROM "GithubUserActivityHistory" AS history
      JOIN LATERAL (
        SELECT observation."issue_count"
        FROM "github_user_activity_history" AS observation
        WHERE observation."github_id" = history."githubId"
          AND observation."year" = history."year"
          AND observation."visibility" = history."visibility"
        ORDER BY observation."observed_at" DESC
        LIMIT 1
      ) AS observation ON TRUE
    )
  UNION ALL
  SELECT 'latest_star_sum',
    (SELECT COALESCE(SUM("starCount"), 0) FROM "GithubUserActivityHistory"),
    (
      SELECT COALESCE(SUM(observation."star_count"), 0)
      FROM "GithubUserActivityHistory" AS history
      JOIN LATERAL (
        SELECT observation."star_count"
        FROM "github_user_activity_history" AS observation
        WHERE observation."github_id" = history."githubId"
          AND observation."year" = history."year"
          AND observation."visibility" = history."visibility"
        ORDER BY observation."observed_at" DESC
        LIMIT 1
      ) AS observation ON TRUE
    )
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
      AND link."valid_from" = repository."createdAt"
      AND EXISTS (
        SELECT 1
        FROM "team_repo" AS earlier
        WHERE earlier."team_id" = link."team_id"
          AND earlier."repo_id" <> link."repo_id"
          AND earlier."valid_from" < repository."createdAt"
      )
  ) AS floor_hit
) AS report;
