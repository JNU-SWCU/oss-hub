BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "GithubRepository" SET "teamId" = NULL;

DELETE FROM "GithubRepository" AS repository
WHERE NOT EXISTS (
  SELECT 1 FROM "repo" WHERE "repo"."github_repo_id" = repository."githubRepositoryId"
);

INSERT INTO "GithubRepository" (
  "id",
  "githubRepositoryId",
  "nameWithOwner",
  "source",
  "updatedAt"
)
SELECT
  'g3r' || substr(md5("repo"."github_repo_id"::text), 1, 22),
  "repo"."github_repo_id",
  "repo"."owner_name",
  "repo"."source",
  CURRENT_TIMESTAMP
FROM "repo"
WHERE NOT EXISTS (
  SELECT 1
  FROM "GithubRepository" AS repository
  WHERE repository."githubRepositoryId" = "repo"."github_repo_id"
);

UPDATE "GithubRepository" AS repository
SET
  "nameWithOwner" = "repo"."owner_name",
  "source" = "repo"."source",
  "defaultBranch" = "repo"."default_branch",
  "archived" = "repo"."archived",
  "visibility" = "repo"."visibility",
  "presence" = "repo"."presence",
  "publishedAt" = "repo"."published_at" AT TIME ZONE 'UTC',
  "lastSuccessAt" = "repo"."last_success_at" AT TIME ZONE 'UTC',
  "updatedAt" = COALESCE("repo"."gone_at" AT TIME ZONE 'UTC', repository."updatedAt"),
  "teamId" = (
    SELECT link."team_id"
    FROM "team_repo" AS link
    WHERE link."repo_id" = "repo"."github_repo_id"
      AND link."valid_to" IS NULL
    ORDER BY link."valid_from" DESC
    LIMIT 1
  )
FROM "repo"
WHERE "repo"."github_repo_id" = repository."githubRepositoryId";

ALTER TABLE "RepositoryInvitation" DROP CONSTRAINT "RepositoryInvitation_repo_id_fkey";
ALTER TABLE "RepositoryProvisionJob" DROP CONSTRAINT "RepositoryProvisionJob_repo_id_fkey";
DROP INDEX "RepositoryInvitation_repo_id_githubLogin_key";
ALTER TABLE "RepositoryInvitation" ALTER COLUMN "repo_id" DROP NOT NULL;

ALTER TABLE "RepositoryInvitation" ADD COLUMN "repositoryId" TEXT;
ALTER TABLE "RepositoryProvisionJob" ADD COLUMN "repositoryId" TEXT;
ALTER TABLE "RepositoryIssuanceHistory" ADD COLUMN "repositoryId" TEXT;

UPDATE "RepositoryInvitation" AS invitation
SET "repositoryId" = repository."id"
FROM "GithubRepository" AS repository
WHERE repository."githubRepositoryId" = invitation."repo_id";

UPDATE "RepositoryProvisionJob" AS job
SET "repositoryId" = repository."id"
FROM "GithubRepository" AS repository
WHERE repository."githubRepositoryId" = job."repo_id";

UPDATE "RepositoryIssuanceHistory" AS issuance
SET "repositoryId" = repository."id"
FROM "GithubRepository" AS repository
WHERE repository."githubRepositoryId" = issuance."repo_id";

ALTER TABLE "RepositoryInvitation" ALTER COLUMN "repositoryId" SET NOT NULL;

CREATE UNIQUE INDEX "RepositoryInvitation_repositoryId_githubLogin_key"
ON "RepositoryInvitation"("repositoryId", "githubLogin");

ALTER TABLE "RepositoryInvitation"
  ADD CONSTRAINT "RepositoryInvitation_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepositoryProvisionJob"
  ADD CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "issuance_repo_id_from_repository"()
RETURNS trigger
LANGUAGE plpgsql
AS $issuance_repo_id$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."repositoryId" IS DISTINCT FROM OLD."repositoryId"
    AND NEW."repo_id" IS NOT DISTINCT FROM OLD."repo_id" THEN
    NEW."repo_id" := NULL;
  END IF;
  IF NEW."repo_id" IS NULL AND NEW."repositoryId" IS NOT NULL THEN
    SELECT repository."githubRepositoryId"
    INTO NEW."repo_id"
    FROM "GithubRepository" AS repository
    WHERE repository."id" = NEW."repositoryId";
  END IF;
  RETURN NEW;
END
$issuance_repo_id$;

CREATE TRIGGER "RepositoryInvitation_repo_id_from_repository"
BEFORE INSERT OR UPDATE OF "repositoryId"
ON "RepositoryInvitation"
FOR EACH ROW
EXECUTE FUNCTION "issuance_repo_id_from_repository"();

CREATE TRIGGER "RepositoryProvisionJob_repo_id_from_repository"
BEFORE INSERT OR UPDATE OF "repositoryId"
ON "RepositoryProvisionJob"
FOR EACH ROW
EXECUTE FUNCTION "issuance_repo_id_from_repository"();

CREATE TRIGGER "RepositoryIssuanceHistory_repo_id_from_repository"
BEFORE INSERT OR UPDATE OF "repositoryId"
ON "RepositoryIssuanceHistory"
FOR EACH ROW
EXECUTE FUNCTION "issuance_repo_id_from_repository"();

COMMIT;
