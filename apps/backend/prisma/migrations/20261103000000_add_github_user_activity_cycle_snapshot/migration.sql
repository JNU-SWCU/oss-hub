-- CreateTable
CREATE TABLE "GithubUserActivityCycleSnapshot" (
    "githubId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "visibility" "ActivityVisibility" NOT NULL DEFAULT 'PUBLIC',
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserActivityCycleSnapshot_pkey" PRIMARY KEY ("githubId","year","visibility")
);

-- CreateIndex
CREATE INDEX "GithubUserActivityCycleSnapshot_year_idx" ON "GithubUserActivityCycleSnapshot"("year");

INSERT INTO "GithubUserActivityCycleSnapshot" ("githubId", "githubLogin", "year", "visibility", "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount", "observedAt")
SELECT "githubId", "githubLogin", "year", "visibility", "commitCount", "pullRequestCount", "issueCount", "repositoryCount", "starCount", "observedAt" FROM "GithubUserActivityHistory";
