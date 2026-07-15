-- CreateEnum
CREATE TYPE "CollectionTrigger" AS ENUM ('SELF', 'BATCH');

-- CreateEnum
CREATE TYPE "CollectionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "ObservationSourceType" AS ENUM ('PROFILE', 'REPO', 'EVENT');

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" TEXT NOT NULL,
    "targetGithubId" BIGINT NOT NULL,
    "targetLogin" TEXT NOT NULL,
    "trigger" "CollectionTrigger" NOT NULL,
    "status" "CollectionRunStatus" NOT NULL,
    "profileCount" INTEGER NOT NULL DEFAULT 0,
    "repoCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "retryNotBeforeAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubRawObservation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceType" "ObservationSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubRawObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubRawObservation_runId_sourceType_sourceId_key" ON "GithubRawObservation"("runId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "GithubRawObservation" ADD CONSTRAINT "GithubRawObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollectionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
