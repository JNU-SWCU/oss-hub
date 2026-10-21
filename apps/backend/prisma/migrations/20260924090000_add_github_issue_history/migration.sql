
ALTER TYPE "CollectionStreamType" ADD VALUE 'ISSUE';

ALTER TABLE "Contribution" ADD COLUMN     "issueCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "GithubIssueHistory" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "githubIssueId" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "authorGithubId" BIGINT,
    "authorGithubLogin" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubIssueHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GithubIssueHistory_repositoryId_createdAt_idx" ON "GithubIssueHistory"("repositoryId", "createdAt");

CREATE INDEX "GithubIssueHistory_authorGithubId_idx" ON "GithubIssueHistory"("authorGithubId");

CREATE UNIQUE INDEX "GithubIssueHistory_repositoryId_githubIssueId_key" ON "GithubIssueHistory"("repositoryId", "githubIssueId");

ALTER TABLE "GithubIssueHistory" ADD CONSTRAINT "GithubIssueHistory_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
