
CREATE TABLE "GithubUserActivityHistory" (
    "githubId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserActivityHistory_pkey" PRIMARY KEY ("githubId","year")
);

CREATE INDEX "GithubUserActivityHistory_year_idx" ON "GithubUserActivityHistory"("year");
