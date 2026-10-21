
ALTER TABLE "GithubRepository"
  ADD COLUMN "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "GithubRepository_nextRunAt_idx" ON "GithubRepository"("nextRunAt");
