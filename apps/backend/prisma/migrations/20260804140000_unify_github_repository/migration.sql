
ALTER TABLE "CollectionRepository" RENAME TO "GithubRepository";
ALTER TABLE "GithubRepository" RENAME CONSTRAINT "CollectionRepository_pkey" TO "GithubRepository_pkey";

ALTER TABLE "GithubRepository" RENAME COLUMN "fullName" TO "nameWithOwner";

ALTER TABLE "GithubRepository" ALTER COLUMN "githubOrganizationId" DROP NOT NULL;
ALTER TABLE "GithubRepository" ALTER COLUMN "defaultBranch" DROP NOT NULL;

CREATE TYPE "RepositorySource" AS ENUM ('ORG_PROVISIONED', 'EXTERNAL_PUBLIC');
ALTER TABLE "GithubRepository" ADD COLUMN "source" "RepositorySource";
UPDATE "GithubRepository" SET "source" = 'ORG_PROVISIONED';
ALTER TABLE "GithubRepository" ALTER COLUMN "source" SET NOT NULL;

DROP INDEX "CollectionRepository_githubOrganizationId_githubRepositoryI_key";
CREATE UNIQUE INDEX "GithubRepository_githubRepositoryId_key" ON "GithubRepository"("githubRepositoryId");

ALTER INDEX "CollectionRepository_visibility_presence_idx" RENAME TO "GithubRepository_visibility_presence_idx";
CREATE INDEX "GithubRepository_source_visibility_idx" ON "GithubRepository"("source", "visibility");

ALTER TABLE "CollectionSyncCursor" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionSyncCursor" SET "scope" = 'org:' || "scope";

ALTER TABLE "CollectionSyncLease" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionSyncLease" SET "scope" = 'org:' || "scope";

ALTER TABLE "CollectionCutoverLease" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionCutoverLease" SET "scope" = 'org:' || "scope";
