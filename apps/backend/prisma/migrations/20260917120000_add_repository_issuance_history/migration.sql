
CREATE TYPE "RepositoryIssuanceOutcome" AS ENUM ('SUCCEEDED', 'FAILED_FINAL', 'DISCARDED', 'SUPERSEDED');

CREATE TABLE "RepositoryIssuanceHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "connectionMode" "RepositoryConnectionMode" NOT NULL,
    "source" "RepositorySource",
    "outcome" "RepositoryIssuanceOutcome" NOT NULL,
    "lastErrorCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryIssuanceHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepositoryIssuanceHistory_requestId_key" ON "RepositoryIssuanceHistory"("requestId");

CREATE INDEX "RepositoryIssuanceHistory_applicationId_idx" ON "RepositoryIssuanceHistory"("applicationId");
