CREATE TYPE "CanonicalCollectionRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'INCOMPLETE', 'RATE_LIMITED', 'FAILED');

CREATE TABLE "CanonicalCollectionRun" (
  "id" TEXT NOT NULL,
  "appId" BIGINT NOT NULL,
  "organizationLogin" TEXT NOT NULL,
  "status" "CanonicalCollectionRunStatus" NOT NULL DEFAULT 'PENDING',
  "errorClass" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "CanonicalCollectionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalOrganizationState" (
  "appId" BIGINT NOT NULL,
  "organizationLogin" TEXT NOT NULL,
  "activeGenerationId" TEXT,
  "installationValid" BOOLEAN NOT NULL DEFAULT false,
  "permissionsValid" BOOLEAN NOT NULL DEFAULT false,
  "installationCheckedAt" TIMESTAMP(3),
  "permissionsCheckedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanonicalOrganizationState_pkey" PRIMARY KEY ("appId", "organizationLogin")
);

CREATE TABLE "CanonicalCollectionLease" (
  "appId" BIGINT NOT NULL,
  "organizationLogin" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL DEFAULT 1,
  "ownerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanonicalCollectionLease_pkey" PRIMARY KEY ("appId", "organizationLogin")
);

CREATE TABLE "CanonicalRepository" (
  "generationId" TEXT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "fullName" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  CONSTRAINT "CanonicalRepository_pkey" PRIMARY KEY ("generationId", "githubRepositoryId")
);

CREATE TABLE "CanonicalDefaultBranchCommit" (
  "generationId" TEXT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "sha" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  CONSTRAINT "CanonicalDefaultBranchCommit_pkey" PRIMARY KEY ("generationId", "githubRepositoryId", "sha")
);

CREATE TABLE "CanonicalPullRequest" (
  "generationId" TEXT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "githubPullRequestId" BIGINT NOT NULL,
  "state" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  CONSTRAINT "CanonicalPullRequest_pkey" PRIMARY KEY ("generationId", "githubRepositoryId", "githubPullRequestId")
);

CREATE TABLE "CanonicalRelease" (
  "generationId" TEXT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "githubReleaseId" BIGINT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "authorGithubId" BIGINT,
  "authorGithubLogin" TEXT,
  CONSTRAINT "CanonicalRelease_pkey" PRIMARY KEY ("generationId", "githubRepositoryId", "githubReleaseId")
);

CREATE TABLE "CanonicalContributorProjection" (
  "generationId" TEXT NOT NULL,
  "githubRepositoryId" BIGINT NOT NULL,
  "githubUserId" BIGINT NOT NULL,
  "githubLogin" TEXT NOT NULL,
  "commitCount" INTEGER NOT NULL DEFAULT 0,
  "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "releaseCount" INTEGER NOT NULL DEFAULT 0,
  "currentYear" INTEGER NOT NULL,
  "currentYearCommitCount" INTEGER NOT NULL DEFAULT 0,
  "currentYearPullRequestCount" INTEGER NOT NULL DEFAULT 0,
  "currentYearReleaseCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CanonicalContributorProjection_pkey" PRIMARY KEY ("generationId", "githubRepositoryId", "githubUserId")
);

CREATE INDEX "CanonicalCollectionRun_appId_organizationLogin_createdAt_idx" ON "CanonicalCollectionRun"("appId", "organizationLogin", "createdAt");
CREATE INDEX "CanonicalOrganizationState_activeGenerationId_idx" ON "CanonicalOrganizationState"("activeGenerationId");
CREATE INDEX "CanonicalCollectionLease_runId_idx" ON "CanonicalCollectionLease"("runId");
CREATE INDEX "CanonicalDefaultBranchCommit_generationId_committedAt_idx" ON "CanonicalDefaultBranchCommit"("generationId", "committedAt");
CREATE INDEX "CanonicalPullRequest_generationId_createdAt_idx" ON "CanonicalPullRequest"("generationId", "createdAt");
CREATE INDEX "CanonicalRelease_generationId_publishedAt_idx" ON "CanonicalRelease"("generationId", "publishedAt");
CREATE INDEX "CanonicalContributorProjection_generationId_githubUserId_idx" ON "CanonicalContributorProjection"("generationId", "githubUserId");

ALTER TABLE "CanonicalOrganizationState" ADD CONSTRAINT "CanonicalOrganizationState_activeGenerationId_fkey" FOREIGN KEY ("activeGenerationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CanonicalCollectionLease" ADD CONSTRAINT "CanonicalCollectionLease_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CanonicalRepository" ADD CONSTRAINT "CanonicalRepository_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalDefaultBranchCommit" ADD CONSTRAINT "CanonicalDefaultBranchCommit_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalDefaultBranchCommit" ADD CONSTRAINT "CanonicalDefaultBranchCommit_generationId_githubRepository_fkey" FOREIGN KEY ("generationId", "githubRepositoryId") REFERENCES "CanonicalRepository"("generationId", "githubRepositoryId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalPullRequest" ADD CONSTRAINT "CanonicalPullRequest_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalPullRequest" ADD CONSTRAINT "CanonicalPullRequest_generationId_githubRepositoryId_fkey" FOREIGN KEY ("generationId", "githubRepositoryId") REFERENCES "CanonicalRepository"("generationId", "githubRepositoryId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalRelease" ADD CONSTRAINT "CanonicalRelease_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalRelease" ADD CONSTRAINT "CanonicalRelease_generationId_githubRepositoryId_fkey" FOREIGN KEY ("generationId", "githubRepositoryId") REFERENCES "CanonicalRepository"("generationId", "githubRepositoryId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalContributorProjection" ADD CONSTRAINT "CanonicalContributorProjection_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "CanonicalCollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalContributorProjection" ADD CONSTRAINT "CanonicalContributorProjection_generationId_githubReposito_fkey" FOREIGN KEY ("generationId", "githubRepositoryId") REFERENCES "CanonicalRepository"("generationId", "githubRepositoryId") ON DELETE CASCADE ON UPDATE CASCADE;
