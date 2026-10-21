
CREATE TABLE "CollectionSweepHistory" (
    "id" TEXT NOT NULL,
    "appId" BIGINT NOT NULL,
    "scope" TEXT NOT NULL,
    "sweepFinishedAt" TIMESTAMP(3) NOT NULL,
    "cycleStartedAt" TIMESTAMP(3),
    "insertedCommitCount" INTEGER NOT NULL,
    "insertedPullRequestCount" INTEGER NOT NULL,
    "insertedReleaseCount" INTEGER NOT NULL,
    "attemptedRepositoryCount" INTEGER NOT NULL,
    "processedRepositoryCount" INTEGER NOT NULL,
    "failedRepositoryCount" INTEGER NOT NULL,
    "cycleCompleted" BOOLEAN NOT NULL,
    "stoppedForBudget" BOOLEAN NOT NULL,

    CONSTRAINT "CollectionSweepHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CollectionSweepHistory_sweepFinishedAt_idx" ON "CollectionSweepHistory"("sweepFinishedAt");
