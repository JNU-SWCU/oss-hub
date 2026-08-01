ALTER TABLE "Application" ADD COLUMN     "isRepositoryPublicationPlanned" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "CollectionRepositoryPresence" AS ENUM ('PRESENT', 'ABSENT');

CREATE TYPE "CollectionStreamType" AS ENUM ('COMMIT', 'PULL_REQUEST', 'RELEASE');

CREATE TYPE "CollectionStreamStatus" AS ENUM ('PENDING', 'BACKFILLING', 'READY', 'VERIFYING');

CREATE TABLE "CollectionRepository" (
  "id" TEXT NOT NULL,
  "githubOrganizationId" BIGINT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "fullName" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "visibility" "RepositoryVisibility" NOT NULL DEFAULT 'PRIVATE',
  "presence" "CollectionRepositoryPresence" NOT NULL DEFAULT 'PRESENT',
  "lastCompleteInventoryObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionRepository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionRepositoryStream" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "streamType" "CollectionStreamType" NOT NULL,
  "status" "CollectionStreamStatus" NOT NULL DEFAULT 'PENDING',
  "frontierSha" TEXT,
  "frontierCreatedAt" TIMESTAMP(3),
  "frontierEntityId" BIGINT,
  "requestFingerprint" TEXT,
  "etag" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionRepositoryStream_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionCommitFact" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "sha" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionCommitFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionPullRequestFact" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "githubPullRequestId" BIGINT NOT NULL,
  "state" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionPullRequestFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionReleaseFact" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "githubReleaseId" BIGINT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionReleaseFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionRepositoryYearAggregate" (
  "repositoryId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "commitCount" INTEGER NOT NULL DEFAULT 0,
  "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "releaseCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionRepositoryYearAggregate_pkey" PRIMARY KEY ("repositoryId", "year")
);

CREATE TABLE "CollectionContributorYearAggregate" (
  "repositoryId" TEXT NOT NULL,
  "githubUserId" BIGINT NOT NULL,
  "githubLogin" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "commitCount" INTEGER NOT NULL DEFAULT 0,
  "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "releaseCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionContributorYearAggregate_pkey" PRIMARY KEY ("repositoryId", "githubUserId", "year")
);

CREATE TABLE "CollectionSyncCursor" (
  "appId" BIGINT NOT NULL,
  "organizationLogin" TEXT NOT NULL,
  "lastGithubRepositoryId" BIGINT,
  "cycleStartedAt" TIMESTAMP(3),
  "cycleCompletedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionSyncCursor_pkey" PRIMARY KEY ("appId", "organizationLogin")
);

CREATE UNIQUE INDEX "CollectionRepository_githubOrganizationId_githubRepositoryI_key" ON "CollectionRepository"("githubOrganizationId", "githubRepositoryId");
CREATE INDEX "CollectionRepository_visibility_presence_idx" ON "CollectionRepository"("visibility", "presence");
CREATE UNIQUE INDEX "CollectionRepositoryStream_repositoryId_streamType_key" ON "CollectionRepositoryStream"("repositoryId", "streamType");
CREATE INDEX "CollectionRepositoryStream_status_idx" ON "CollectionRepositoryStream"("status");
CREATE UNIQUE INDEX "CollectionCommitFact_repositoryId_sha_key" ON "CollectionCommitFact"("repositoryId", "sha");
CREATE INDEX "CollectionCommitFact_repositoryId_committedAt_idx" ON "CollectionCommitFact"("repositoryId", "committedAt");
CREATE INDEX "CollectionCommitFact_authorGithubId_idx" ON "CollectionCommitFact"("authorGithubId");
CREATE UNIQUE INDEX "CollectionPullRequestFact_repositoryId_githubPullRequestId_key" ON "CollectionPullRequestFact"("repositoryId", "githubPullRequestId");
CREATE INDEX "CollectionPullRequestFact_repositoryId_createdAt_idx" ON "CollectionPullRequestFact"("repositoryId", "createdAt");
CREATE INDEX "CollectionPullRequestFact_authorGithubId_idx" ON "CollectionPullRequestFact"("authorGithubId");
CREATE UNIQUE INDEX "CollectionReleaseFact_repositoryId_githubReleaseId_key" ON "CollectionReleaseFact"("repositoryId", "githubReleaseId");
CREATE INDEX "CollectionReleaseFact_repositoryId_publishedAt_idx" ON "CollectionReleaseFact"("repositoryId", "publishedAt");
CREATE INDEX "CollectionReleaseFact_authorGithubId_idx" ON "CollectionReleaseFact"("authorGithubId");
CREATE INDEX "CollectionRepositoryYearAggregate_year_idx" ON "CollectionRepositoryYearAggregate"("year");
CREATE INDEX "CollectionContributorYearAggregate_repositoryId_year_idx" ON "CollectionContributorYearAggregate"("repositoryId", "year");
CREATE INDEX "CollectionContributorYearAggregate_githubUserId_year_idx" ON "CollectionContributorYearAggregate"("githubUserId", "year");

ALTER TABLE "CollectionRepositoryStream" ADD CONSTRAINT "CollectionRepositoryStream_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionCommitFact" ADD CONSTRAINT "CollectionCommitFact_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionPullRequestFact" ADD CONSTRAINT "CollectionPullRequestFact_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionReleaseFact" ADD CONSTRAINT "CollectionReleaseFact_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionRepositoryYearAggregate" ADD CONSTRAINT "CollectionRepositoryYearAggregate_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionContributorYearAggregate" ADD CONSTRAINT "CollectionContributorYearAggregate_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CollectionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
