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
) AS report;
