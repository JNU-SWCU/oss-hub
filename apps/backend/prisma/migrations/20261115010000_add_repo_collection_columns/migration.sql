BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "repo"
  ADD COLUMN "default_branch" TEXT,
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "visibility" "RepositoryVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "presence" "CollectionRepositoryPresence" NOT NULL DEFAULT 'PRESENT',
  ADD COLUMN "published_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_success_at" TIMESTAMPTZ(3);

INSERT INTO "repo" (
  "github_repo_id",
  "owner_name",
  "source",
  "gone_at",
  "default_branch",
  "archived",
  "visibility",
  "presence",
  "published_at",
  "last_success_at"
)
SELECT
  repository."githubRepositoryId",
  repository."nameWithOwner",
  repository."source",
  CASE
    WHEN repository."presence" = 'ABSENT'
    THEN repository."updatedAt" AT TIME ZONE 'UTC'
    ELSE NULL
  END,
  repository."defaultBranch",
  repository."archived",
  repository."visibility",
  repository."presence",
  repository."publishedAt" AT TIME ZONE 'UTC',
  repository."lastSuccessAt" AT TIME ZONE 'UTC'
FROM "GithubRepository" AS repository
ON CONFLICT ("github_repo_id") DO UPDATE
SET
  "owner_name" = EXCLUDED."owner_name",
  "source" = EXCLUDED."source",
  "gone_at" = EXCLUDED."gone_at",
  "default_branch" = EXCLUDED."default_branch",
  "archived" = EXCLUDED."archived",
  "visibility" = EXCLUDED."visibility",
  "presence" = EXCLUDED."presence",
  "published_at" = EXCLUDED."published_at",
  "last_success_at" = EXCLUDED."last_success_at";

COMMIT;
