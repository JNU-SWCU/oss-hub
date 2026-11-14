BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "RepositoryInvitation" AS invitation
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = invitation."repositoryId"
  AND invitation."repo_id" IS NULL;

UPDATE "RepositoryProvisionJob" AS job
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = job."repositoryId"
  AND job."repo_id" IS NULL;

UPDATE "RepositoryIssuanceHistory" AS issuance
SET "repo_id" = repository."githubRepositoryId"
FROM "GithubRepository" AS repository
WHERE repository."id" = issuance."repositoryId"
  AND issuance."repo_id" IS NULL;

DROP TRIGGER "RepositoryInvitation_repo_id_from_repository" ON "RepositoryInvitation";
DROP TRIGGER "RepositoryProvisionJob_repo_id_from_repository" ON "RepositoryProvisionJob";
DROP TRIGGER "RepositoryIssuanceHistory_repo_id_from_repository"
ON "RepositoryIssuanceHistory";
DROP FUNCTION "issuance_repo_id_from_repository"();

ALTER TABLE "RepositoryInvitation" DROP CONSTRAINT "RepositoryInvitation_repositoryId_fkey";
ALTER TABLE "RepositoryProvisionJob" DROP CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey";
DROP INDEX "RepositoryInvitation_repositoryId_githubLogin_key";

ALTER TABLE "RepositoryInvitation" DROP COLUMN "repositoryId";
ALTER TABLE "RepositoryInvitation" ALTER COLUMN "repo_id" SET NOT NULL;
ALTER TABLE "RepositoryProvisionJob" DROP COLUMN "repositoryId";
ALTER TABLE "RepositoryIssuanceHistory" DROP COLUMN "repositoryId";

CREATE UNIQUE INDEX "RepositoryInvitation_repo_id_githubLogin_key"
ON "RepositoryInvitation"("repo_id", "githubLogin");

ALTER TABLE "RepositoryInvitation"
  ADD CONSTRAINT "RepositoryInvitation_repo_id_fkey"
  FOREIGN KEY ("repo_id") REFERENCES "repo"("github_repo_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepositoryProvisionJob"
  ADD CONSTRAINT "RepositoryProvisionJob_repo_id_fkey"
  FOREIGN KEY ("repo_id") REFERENCES "repo"("github_repo_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "GithubRepository";

COMMIT;
