BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "RepositoryInvitation" ADD COLUMN "repo_id" BIGINT;
ALTER TABLE "RepositoryProvisionJob" ADD COLUMN "repo_id" BIGINT;
ALTER TABLE "RepositoryIssuanceHistory" ADD COLUMN "repo_id" BIGINT;

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

UPDATE "RepositoryInvitation" AS invitation
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = invitation."repositoryId";

UPDATE "RepositoryProvisionJob" AS job
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = job."repositoryId";

UPDATE "RepositoryIssuanceHistory" AS issuance
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = issuance."repositoryId";

CREATE INDEX "repo_visibility_published_at_github_repo_id_idx"
ON "repo"("visibility", "published_at", "github_repo_id");

COMMIT;
