-- 저장소별 Issue 수집(#1133)을 위한 stream 종류·이력 테이블(`GithubIssueHistory`)·집계 칸을 추가한다.
--
-- 전부 additive다 — 기존 컬럼을 지우거나 좁히지 않으므로 이 마이그레이션이 배포된 뒤에도
-- 직전 이미지가 그대로 동작한다. `Contribution.issueCount`는 `DEFAULT 0`으로 들어가며,
-- 과거 Issue는 ISSUE stream 행이 없는 저장소를 다음 sweep이 처음부터 읽어 채운다(별도 backfill
-- 문장 없음).
--
-- `ALTER TYPE ... ADD VALUE`는 PostgreSQL 12+에서 트랜잭션 안에서도 실행된다. 같은 트랜잭션이
-- 새 값('ISSUE')을 쓰지 않으므로 아래 문장들과 한 마이그레이션에 둔다.
--
-- 이 파일은 `prisma migrate diff`(직전 커밋 schema → 현재 schema)로 생성했다.
-- `20260824000000_contract_member_authority`의 preflight가 shadow database에서 재생되지 않아
-- `prisma migrate dev`가 멈추기 때문이다(`20260920030000_add_application_review_history`와 같은 처리).

-- AlterEnum
ALTER TYPE "CollectionStreamType" ADD VALUE 'ISSUE';

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "issueCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GithubIssueHistory" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "githubIssueId" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "authorGithubId" BIGINT,
    "authorGithubLogin" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubIssueHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GithubIssueHistory_repositoryId_createdAt_idx" ON "GithubIssueHistory"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "GithubIssueHistory_authorGithubId_idx" ON "GithubIssueHistory"("authorGithubId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubIssueHistory_repositoryId_githubIssueId_key" ON "GithubIssueHistory"("repositoryId", "githubIssueId");

-- AddForeignKey
ALTER TABLE "GithubIssueHistory" ADD CONSTRAINT "GithubIssueHistory_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
