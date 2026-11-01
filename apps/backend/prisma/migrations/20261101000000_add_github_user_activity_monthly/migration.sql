-- CreateTable
CREATE TABLE "GithubUserActivityMonthly" (
    "githubId" BIGINT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserActivityMonthly_pkey" PRIMARY KEY ("githubId","year","month")
);

-- CreateIndex
CREATE INDEX "GithubUserActivityMonthly_year_idx" ON "GithubUserActivityMonthly"("year");
