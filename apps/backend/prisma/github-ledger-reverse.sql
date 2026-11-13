-- Copy the ledger back into the tables v0.24.78 reads.
-- Run this by hand while the current release is still live, in this order:
-- 1. Pause collection: insert a "CollectionCutoverLease" row whose "expiresAt" is in the
--    future, then wait until no running collection is left.
-- 2. Run this script.
-- 3. Redeploy v0.24.78 through Jenkins. Its copy and verify steps pass only after step 2.
-- 4. Delete the lease row once v0.24.78 is live.
-- Jenkins does not run this script.

BEGIN;
SET LOCAL TIME ZONE 'UTC';

INSERT INTO "CollectionCommitFact" (
  "id",
  "repositoryId",
  "sha",
  "committedAt",
  "authorGithubId",
  "authorGithubLogin",
  "observedAt"
)
SELECT
  gen_random_uuid()::text,
  repository.id,
  event.github_key,
  event.occurred_at AT TIME ZONE 'UTC',
  event.author_github_id,
  NULL,
  event.first_seen_at AT TIME ZONE 'UTC'
FROM "contribution" AS event
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event.repo_id
WHERE event.kind = 'commit'
ON CONFLICT ("repositoryId", "sha") DO NOTHING;

INSERT INTO "CollectionPullRequestFact" (
  "id",
  "repositoryId",
  "githubPullRequestId",
  "state",
  "createdAt",
  "authorGithubId",
  "authorGithubLogin",
  "observedAt"
)
SELECT
  gen_random_uuid()::text,
  repository.id,
  event.github_key::bigint,
  'unknown',
  event.occurred_at AT TIME ZONE 'UTC',
  event.author_github_id,
  NULL,
  event.first_seen_at AT TIME ZONE 'UTC'
FROM "contribution" AS event
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event.repo_id
WHERE event.kind = 'pull_request'
ON CONFLICT ("repositoryId", "githubPullRequestId") DO NOTHING;

INSERT INTO "CollectionReleaseFact" (
  "id",
  "repositoryId",
  "githubReleaseId",
  "publishedAt",
  "authorGithubId",
  "authorGithubLogin",
  "observedAt"
)
SELECT
  gen_random_uuid()::text,
  repository.id,
  event.github_key::bigint,
  event.occurred_at AT TIME ZONE 'UTC',
  event.author_github_id,
  NULL,
  event.first_seen_at AT TIME ZONE 'UTC'
FROM "contribution" AS event
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event.repo_id
WHERE event.kind = 'release'
ON CONFLICT ("repositoryId", "githubReleaseId") DO NOTHING;

INSERT INTO "GithubIssueHistory" (
  "id",
  "repositoryId",
  "githubIssueId",
  "state",
  "createdAt",
  "authorGithubId",
  "authorGithubLogin",
  "observedAt"
)
SELECT
  gen_random_uuid()::text,
  repository.id,
  event.github_key::bigint,
  'unknown',
  event.occurred_at AT TIME ZONE 'UTC',
  event.author_github_id,
  NULL,
  event.first_seen_at AT TIME ZONE 'UTC'
FROM "contribution" AS event
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event.repo_id
WHERE event.kind = 'issue'
ON CONFLICT ("repositoryId", "githubIssueId") DO NOTHING;

INSERT INTO "Contribution" (
  "repositoryId",
  "githubId",
  "date",
  "commitCount",
  "pullRequestCount",
  "releaseCount",
  "issueCount",
  "updatedAt"
)
SELECT
  repository.id,
  event.author_github_id,
  (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date,
  COUNT(*) FILTER (WHERE event.kind = 'commit')::int,
  COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int,
  COUNT(*) FILTER (WHERE event.kind = 'release')::int,
  COUNT(*) FILTER (WHERE event.kind = 'issue')::int,
  CURRENT_TIMESTAMP
FROM "contribution" AS event
JOIN "GithubRepository" AS repository
  ON repository."githubRepositoryId" = event.repo_id
WHERE event.author_github_id IS NOT NULL
GROUP BY
  repository.id,
  event.author_github_id,
  (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date
ON CONFLICT ("repositoryId", "githubId", "date") DO UPDATE
SET
  "commitCount" = EXCLUDED."commitCount",
  "pullRequestCount" = EXCLUDED."pullRequestCount",
  "releaseCount" = EXCLUDED."releaseCount",
  "issueCount" = EXCLUDED."issueCount",
  "updatedAt" = EXCLUDED."updatedAt";

INSERT INTO "GithubUserActivityHistory" (
  "githubId",
  "githubLogin",
  "year",
  "visibility",
  "commitCount",
  "pullRequestCount",
  "issueCount",
  "repositoryCount",
  "starCount",
  "observedAt"
)
SELECT
  latest.github_id,
  COALESCE(account.login, latest.github_id::text),
  latest.year,
  latest.visibility,
  latest.commit_count,
  latest.pull_request_count,
  latest.issue_count,
  latest.repository_count,
  latest.star_count,
  GREATEST(latest.observed_at, latest.clock_at) AT TIME ZONE 'UTC'
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
  FROM "github_user_activity_history" AS observation
  ORDER BY
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.observed_at DESC
) AS latest
LEFT JOIN "User" AS account ON account."githubId" = latest.github_id
ON CONFLICT ("githubId", "year", "visibility") DO UPDATE
SET
  "githubLogin" = EXCLUDED."githubLogin",
  "commitCount" = EXCLUDED."commitCount",
  "pullRequestCount" = EXCLUDED."pullRequestCount",
  "issueCount" = EXCLUDED."issueCount",
  "repositoryCount" = EXCLUDED."repositoryCount",
  "starCount" = EXCLUDED."starCount",
  "observedAt" = GREATEST(
    "GithubUserActivityHistory"."observedAt",
    EXCLUDED."observedAt"
  );

DELETE FROM "GithubUserActivityCycleSnapshot" AS snapshot
WHERE NOT EXISTS (
  SELECT 1
  FROM "github_user_activity_history" AS observation
  WHERE observation.github_id = snapshot."githubId"
    AND observation.year = snapshot.year
    AND observation.visibility = snapshot.visibility
    AND observation.observed_at < (
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
        AT TIME ZONE 'Asia/Seoul'
    )
);

INSERT INTO "GithubUserActivityCycleSnapshot" (
  "githubId",
  "githubLogin",
  "year",
  "visibility",
  "commitCount",
  "pullRequestCount",
  "issueCount",
  "repositoryCount",
  "starCount",
  "observedAt",
  "snapshotAt"
)
SELECT
  standing.github_id,
  COALESCE(account.login, standing.github_id::text),
  standing.year,
  standing.visibility,
  standing.commit_count,
  standing.pull_request_count,
  standing.issue_count,
  standing.repository_count,
  standing.star_count,
  standing.observed_at AT TIME ZONE 'UTC',
  CURRENT_TIMESTAMP
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
  FROM "github_user_activity_history" AS observation
  WHERE observation.observed_at < (
    date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
      AT TIME ZONE 'Asia/Seoul'
  )
  ORDER BY
    observation.github_id,
    observation.year,
    observation.visibility,
    observation.observed_at DESC
) AS standing
LEFT JOIN "User" AS account ON account."githubId" = standing.github_id
ON CONFLICT ("githubId", "year", "visibility") DO UPDATE
SET
  "githubLogin" = EXCLUDED."githubLogin",
  "commitCount" = EXCLUDED."commitCount",
  "pullRequestCount" = EXCLUDED."pullRequestCount",
  "issueCount" = EXCLUDED."issueCount",
  "repositoryCount" = EXCLUDED."repositoryCount",
  "starCount" = EXCLUDED."starCount",
  "observedAt" = EXCLUDED."observedAt",
  "snapshotAt" = EXCLUDED."snapshotAt";

COMMIT;
