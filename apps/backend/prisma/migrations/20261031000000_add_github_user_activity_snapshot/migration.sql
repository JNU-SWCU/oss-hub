
CREATE TYPE "GithubUserActivitySnapshotSource" AS ENUM ('SWEEP', 'BACKFILL');

CREATE TABLE "GithubUserActivitySnapshot" (
    "githubId" BIGINT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "starEstimated" BOOLEAN NOT NULL DEFAULT false,
    "source" "GithubUserActivitySnapshotSource" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserActivitySnapshot_pkey" PRIMARY KEY ("githubId","snapshotDate")
);

CREATE INDEX "GithubUserActivitySnapshot_year_snapshotDate_idx" ON "GithubUserActivitySnapshot"("year", "snapshotDate");
