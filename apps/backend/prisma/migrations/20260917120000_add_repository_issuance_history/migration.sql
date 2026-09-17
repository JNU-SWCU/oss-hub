-- 저장소 발급 요청의 종료 이력. 순수 추가 마이그레이션이며 기존 테이블·컬럼·제약을
-- 건드리지 않는다(docs/deploy/pre-deploy-verify.md ⓪의 리허설 트리거에 해당하지 않음).
--
-- `prisma migrate diff`는 이 저장소의 기존 drift(스키마에 없는 CollectionContributorYearAggregate ·
-- CollectionRepositoryYearAggregate 두 테이블의 DROP, 인덱스명 RenameIndex 2건)도 함께 내놓았으나
-- 이번 변경과 무관하므로 제외했다. 그 drift는 별건으로 다룬다.

-- CreateEnum
CREATE TYPE "RepositoryIssuanceOutcome" AS ENUM ('SUCCEEDED', 'FAILED_FINAL', 'DISCARDED', 'SUPERSEDED');

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryIssuanceHistory_requestId_key" ON "RepositoryIssuanceHistory"("requestId");

-- CreateIndex
CREATE INDEX "RepositoryIssuanceHistory_applicationId_idx" ON "RepositoryIssuanceHistory"("applicationId");
