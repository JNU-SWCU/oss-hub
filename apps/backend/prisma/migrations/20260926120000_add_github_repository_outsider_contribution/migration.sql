
CREATE TABLE "GithubRepositoryOutsiderContribution" (
    "repositoryId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "windowStartAt" TIMESTAMP(3) NOT NULL,
    "windowEndAt" TIMESTAMP(3) NOT NULL,
    "commitCount" INTEGER NOT NULL,
    "pullRequestCount" INTEGER NOT NULL,
    "issueCount" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubRepositoryOutsiderContribution_pkey" PRIMARY KEY ("repositoryId")
);

ALTER TABLE "GithubRepositoryOutsiderContribution" ADD CONSTRAINT "GithubRepositoryOutsiderContribution_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
