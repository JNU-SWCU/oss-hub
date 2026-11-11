BEGIN;
SET LOCAL TIME ZONE 'UTC';

INSERT INTO "repo" ("github_repo_id", "owner_name", "source", "gone_at")
SELECT
  repository."githubRepositoryId",
  repository."nameWithOwner",
  repository."source",
  CASE
    WHEN repository."presence" = 'ABSENT' THEN repository."updatedAt"
    ELSE NULL
  END
FROM "GithubRepository" AS repository
ON CONFLICT ("github_repo_id") DO UPDATE
SET
  "owner_name" = EXCLUDED."owner_name",
  "source" = EXCLUDED."source",
  "gone_at" = EXCLUDED."gone_at";

UPDATE "team_repo" AS link
SET "valid_to" = repository."updatedAt"
FROM "GithubRepository" AS repository
WHERE link."repo_id" = repository."githubRepositoryId"
  AND link."valid_to" IS NULL
  AND repository."updatedAt" > link."valid_from"
  AND (
    repository."teamId" IS NULL
    OR repository."teamId" IS DISTINCT FROM link."team_id"
  );

INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
SELECT
  repository."teamId",
  repository."githubRepositoryId",
  COALESCE(closed."valid_to", repository."createdAt")
FROM "GithubRepository" AS repository
LEFT JOIN LATERAL (
  SELECT MAX(link."valid_to") AS "valid_to"
  FROM "team_repo" AS link
  WHERE link."repo_id" = repository."githubRepositoryId"
) AS closed ON TRUE
WHERE repository."teamId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "team_repo" AS link
    WHERE link."repo_id" = repository."githubRepositoryId"
      AND link."valid_to" IS NULL
  );

INSERT INTO "contribution" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'commit'::"contribution_kind",
  fact."sha",
  fact."authorGithubId",
  fact."committedAt",
  fact."observedAt"
FROM "CollectionCommitFact" AS fact
JOIN "GithubRepository" AS repository ON repository."id" = fact."repositoryId"
ON CONFLICT ("repo_id", "kind", "github_key") DO NOTHING;

INSERT INTO "contribution" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'pull_request'::"contribution_kind",
  fact."githubPullRequestId"::text,
  fact."authorGithubId",
  fact."createdAt",
  fact."observedAt"
FROM "CollectionPullRequestFact" AS fact
JOIN "GithubRepository" AS repository ON repository."id" = fact."repositoryId"
ON CONFLICT ("repo_id", "kind", "github_key") DO NOTHING;

INSERT INTO "contribution" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'issue'::"contribution_kind",
  fact."githubIssueId"::text,
  fact."authorGithubId",
  fact."createdAt",
  fact."observedAt"
FROM "GithubIssueHistory" AS fact
JOIN "GithubRepository" AS repository ON repository."id" = fact."repositoryId"
ON CONFLICT ("repo_id", "kind", "github_key") DO NOTHING;

INSERT INTO "contribution" (
  "repo_id", "kind", "github_key", "author_github_id", "occurred_at", "first_seen_at"
)
SELECT
  repository."githubRepositoryId",
  'release'::"contribution_kind",
  fact."githubReleaseId"::text,
  fact."authorGithubId",
  fact."publishedAt",
  fact."observedAt"
FROM "CollectionReleaseFact" AS fact
JOIN "GithubRepository" AS repository ON repository."id" = fact."repositoryId"
ON CONFLICT ("repo_id", "kind", "github_key") DO NOTHING;

INSERT INTO "github_user_activity_history" (
  "github_id",
  "year",
  "visibility",
  "commit_count",
  "pull_request_count",
  "issue_count",
  "repository_count",
  "star_count",
  "observed_at"
)
SELECT
  history."githubId",
  history."year",
  history."visibility",
  history."commitCount",
  history."pullRequestCount",
  history."issueCount",
  history."repositoryCount",
  history."starCount",
  history."observedAt"
FROM "GithubUserActivityHistory" AS history
ON CONFLICT ("github_id", "year", "visibility", "observed_at") DO NOTHING;

INSERT INTO "github_user_activity_history" (
  "github_id",
  "year",
  "visibility",
  "commit_count",
  "pull_request_count",
  "issue_count",
  "repository_count",
  "star_count",
  "observed_at"
)
SELECT
  snapshot."githubId",
  snapshot."year",
  snapshot."visibility",
  snapshot."commitCount",
  snapshot."pullRequestCount",
  snapshot."issueCount",
  snapshot."repositoryCount",
  snapshot."starCount",
  snapshot."observedAt"
FROM "GithubUserActivityCycleSnapshot" AS snapshot
WHERE NOT EXISTS (
  SELECT 1
  FROM "github_user_activity_history" AS observation
  WHERE observation."github_id" = snapshot."githubId"
    AND observation."year" = snapshot."year"
    AND observation."visibility" = snapshot."visibility"
    AND observation."commit_count" = snapshot."commitCount"
    AND observation."pull_request_count" = snapshot."pullRequestCount"
    AND observation."issue_count" = snapshot."issueCount"
    AND observation."repository_count" = snapshot."repositoryCount"
    AND observation."star_count" = snapshot."starCount"
)
ON CONFLICT ("github_id", "year", "visibility", "observed_at") DO NOTHING;

COMMIT;
