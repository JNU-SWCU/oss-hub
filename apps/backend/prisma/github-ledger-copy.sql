BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $guard$
DECLARE
  overlapping_teams bigint;
  overlapping_team_rows bigint;
  overlapping_repos bigint;
  overlapping_repo_rows bigint;
BEGIN
  SELECT teams, team_rows, repos, repo_rows
  INTO overlapping_teams, overlapping_team_rows, overlapping_repos, overlapping_repo_rows
  FROM (
    -- begin-overlap
    -- A period starts when the row is bound to the team. createdAt is that
    -- instant only when it is later than the team's open period. A reused row
    -- keeps its old createdAt, so the claim's updatedAt, then this transaction,
    -- is the later floor. The close uses that same instant.
    WITH new_link AS (
      SELECT
        repository."teamId" AS "team_id",
        repository."githubRepositoryId" AS "repo_id",
        CASE
          WHEN predecessor."valid_from" IS NULL
            OR COALESCE(prior."valid_to", repository."createdAt")
              > predecessor."valid_from"
          THEN COALESCE(prior."valid_to", repository."createdAt")
          WHEN repository."updatedAt" > predecessor."valid_from"
          THEN repository."updatedAt"
          WHEN transaction_timestamp() > predecessor."valid_from"
          THEN transaction_timestamp()
          ELSE predecessor."valid_from" + interval '1 millisecond'
        END AS "valid_from",
        NULL::timestamptz AS "valid_to"
      FROM "GithubRepository" AS repository
      LEFT JOIN LATERAL (
        SELECT MAX(closed_period."valid_to") AS "valid_to"
        FROM "team_repo" AS closed_period
        WHERE closed_period."repo_id" = repository."githubRepositoryId"
      ) AS prior ON TRUE
      LEFT JOIN LATERAL (
        SELECT open_period."valid_from"
        FROM "team_repo" AS open_period
        WHERE open_period."team_id" = repository."teamId"
          AND open_period."valid_to" IS NULL
          AND open_period."repo_id" <> repository."githubRepositoryId"
        ORDER BY open_period."valid_from" DESC
        LIMIT 1
      ) AS predecessor ON TRUE
      WHERE repository."teamId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "team_repo" AS open_period
          WHERE open_period."repo_id" = repository."githubRepositoryId"
            AND open_period."valid_to" IS NULL
        )
    ),
    closed_link AS (
      SELECT
        link."team_id",
        link."repo_id",
        link."valid_from",
        CASE
          WHEN link."valid_to" IS NOT NULL THEN link."valid_to"
          WHEN repository."githubRepositoryId" IS NOT NULL
            AND repository."teamId" IS NOT DISTINCT FROM link."team_id"
          THEN NULL
          WHEN repository."githubRepositoryId" IS NOT NULL
            AND repository."updatedAt" > link."valid_from"
          THEN repository."updatedAt"
          ELSE COALESCE(
            (
              SELECT opened."valid_from"
              FROM new_link AS opened
              WHERE opened."team_id" = link."team_id"
                AND opened."valid_from" > link."valid_from"
            ),
            GREATEST(
              transaction_timestamp(),
              link."valid_from" + interval '1 millisecond'
            )
          )
        END AS "valid_to"
      FROM "team_repo" AS link
      LEFT JOIN "GithubRepository" AS repository
        ON repository."githubRepositoryId" = link."repo_id"
    ),
    prospective AS (
      SELECT
        closed."team_id",
        closed."repo_id",
        tstzrange(closed."valid_from", closed."valid_to", '[)') AS period
      FROM closed_link AS closed
      UNION ALL
      SELECT
        opened."team_id",
        opened."repo_id",
        tstzrange(opened."valid_from", opened."valid_to", '[)') AS period
      FROM new_link AS opened
    ),
    team_hit AS (
      SELECT link."team_id", link."repo_id"
      FROM prospective AS link
      JOIN prospective AS other
        ON other."team_id" = link."team_id"
       AND other."repo_id" <> link."repo_id"
       AND other.period && link.period
    ),
    repo_hit AS (
      SELECT link."repo_id", link."team_id"
      FROM prospective AS link
      JOIN prospective AS other
        ON other."repo_id" = link."repo_id"
       AND other."team_id" <> link."team_id"
       AND other.period && link.period
    )
    SELECT
      (SELECT COUNT(DISTINCT hit."team_id") FROM team_hit AS hit) AS teams,
      (
        SELECT COUNT(*)
        FROM (SELECT DISTINCT hit."team_id", hit."repo_id" FROM team_hit AS hit) AS distinct_hit
      ) AS team_rows,
      (SELECT COUNT(DISTINCT hit."repo_id") FROM repo_hit AS hit) AS repos,
      (
        SELECT COUNT(*)
        FROM (SELECT DISTINCT hit."repo_id", hit."team_id" FROM repo_hit AS hit) AS distinct_hit
      ) AS repo_rows
    -- end-overlap
  ) AS overlap;

  IF overlapping_teams > 0
    OR overlapping_team_rows > 0
    OR overlapping_repos > 0
    OR overlapping_repo_rows > 0
  THEN
    RAISE EXCEPTION
      'ledger copy refused overlapping_teams=% overlapping_team_rows=% overlapping_repos=% overlapping_repo_rows=%',
      overlapping_teams,
      overlapping_team_rows,
      overlapping_repos,
      overlapping_repo_rows;
  END IF;
END
$guard$;

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

-- Snapshot the same attachment rule before any period is closed. The insert
-- runs after that close, so it can no longer see the predecessor it replaced.
CREATE TEMP TABLE ledger_attachment ON COMMIT DROP AS
SELECT
  repository."teamId" AS team_id,
  repository."githubRepositoryId" AS repo_id,
  CASE
    WHEN predecessor."valid_from" IS NULL
      OR COALESCE(prior."valid_to", repository."createdAt")
        > predecessor."valid_from"
    THEN COALESCE(prior."valid_to", repository."createdAt")
    WHEN repository."updatedAt" > predecessor."valid_from"
    THEN repository."updatedAt"
    WHEN transaction_timestamp() > predecessor."valid_from"
    THEN transaction_timestamp()
    ELSE predecessor."valid_from" + interval '1 millisecond'
  END AS attached_at
FROM "GithubRepository" AS repository
LEFT JOIN LATERAL (
  SELECT MAX(closed_period."valid_to") AS "valid_to"
  FROM "team_repo" AS closed_period
  WHERE closed_period."repo_id" = repository."githubRepositoryId"
) AS prior ON TRUE
LEFT JOIN LATERAL (
  SELECT open_period."valid_from"
  FROM "team_repo" AS open_period
  WHERE open_period."team_id" = repository."teamId"
    AND open_period."valid_to" IS NULL
    AND open_period."repo_id" <> repository."githubRepositoryId"
  ORDER BY open_period."valid_from" DESC
  LIMIT 1
) AS predecessor ON TRUE
WHERE repository."teamId" IS NOT NULL;

UPDATE "team_repo" AS link
SET "valid_to" = closed."valid_to"
FROM (
  SELECT
    open_link."team_id",
    open_link."repo_id",
    open_link."valid_from",
    CASE
      WHEN repository."githubRepositoryId" IS NOT NULL
        AND repository."teamId" IS NOT DISTINCT FROM open_link."team_id"
      THEN NULL
      WHEN repository."githubRepositoryId" IS NOT NULL
        AND repository."updatedAt" > open_link."valid_from"
      THEN repository."updatedAt"
      ELSE COALESCE(
        (
          SELECT attachment.attached_at
          FROM ledger_attachment AS attachment
          WHERE attachment.team_id = open_link."team_id"
            AND attachment.attached_at > open_link."valid_from"
        ),
        GREATEST(
          transaction_timestamp(),
          open_link."valid_from" + interval '1 millisecond'
        )
      )
    END AS "valid_to"
  FROM "team_repo" AS open_link
  LEFT JOIN "GithubRepository" AS repository
    ON repository."githubRepositoryId" = open_link."repo_id"
  WHERE open_link."valid_to" IS NULL
) AS closed
WHERE link."team_id" = closed."team_id"
  AND link."repo_id" = closed."repo_id"
  AND link."valid_from" = closed."valid_from"
  AND link."valid_to" IS NULL
  AND closed."valid_to" IS NOT NULL;

INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
SELECT attachment.team_id, attachment.repo_id, attachment.attached_at
FROM ledger_attachment AS attachment
WHERE NOT EXISTS (
  SELECT 1
  FROM "team_repo" AS open_period
  WHERE open_period."repo_id" = attachment.repo_id
    AND open_period."valid_to" IS NULL
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
