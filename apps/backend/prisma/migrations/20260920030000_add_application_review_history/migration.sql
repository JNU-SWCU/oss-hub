-- 신청 판정 이력(`ApplicationReviewHistory`)과 신청서 회차(`Application.revision`)를 추가한다.
--
-- 전부 additive다 — 기존 컬럼을 지우거나 좁히지 않으므로 이 마이그레이션이 배포된 뒤에도
-- 직전 이미지가 그대로 동작한다(선행 PR 배포 ~ 후행 PR 배포 사이 중간 상태 안전성).
--
-- `Application.revision`은 `DEFAULT 1`로 들어간다. 이 컬럼이 생기기 전 신청은 전부 최초 제출
-- 1회분이므로 기본값이 곧 정확한 백필이고, 별도 backfill 문장을 두지 않는다.
--
-- `ApplicationReviewHistory`의 FK는 `applicationId → Application.id` 하나뿐이고 `ON DELETE CASCADE`다.
-- 팀 삭제 경로가 `where: { teamId }`로 Application을 지우면 그 신청의 이력만 정확히 따라 사라진다.
-- `programId`/`teamId`로 두 번째 cascade 경로를 만들지 않는다 — 그러면 삭제 대상 팀과 무관한
-- 이력까지 함께 지워진다.
--
-- 이 파일은 `prisma migrate dev`가 아니라 `prisma migrate diff`(직전 커밋 schema → 현재 schema)로
-- 생성했다. `20260824000000_contract_member_authority`의 `_prisma_migrations` preflight가 Prisma
-- shadow database에서 재생되지 않아 기준선에서도 P3006으로 멈추기 때문이다(기존 선례와 같은 처리).
-- 기존 마이그레이션 이력은 손대지 않았고, 정상 `prisma migrate deploy` 경로로 검증한다.

-- CreateEnum
CREATE TYPE "ApplicationReviewEventKind" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'REVERTED');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ApplicationReviewHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventKind" "ApplicationReviewEventKind" NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectionReason" TEXT,

    CONSTRAINT "ApplicationReviewHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationReviewHistory_applicationId_occurredAt_idx" ON "ApplicationReviewHistory"("applicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApplicationReviewHistory_actorId_idx" ON "ApplicationReviewHistory"("actorId");

-- AddForeignKey
ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
