-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BoardPostCategory" AS ENUM ('NOTICE', 'QNA');

-- AlterTable
ALTER TABLE "PublicShowcaseRepository" ALTER COLUMN "projectedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SubmissionFile" ADD COLUMN     "milestoneDocumentSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardPost" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" "BoardPostCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneDocument" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "submissionType" "MilestoneSubmissionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneDocumentTemplateFile" (
    "id" TEXT NOT NULL,
    "milestoneDocumentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneDocumentTemplateFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneDocumentSubmission" (
    "id" TEXT NOT NULL,
    "milestoneDocumentId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "content" JSONB,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneDocumentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");

-- CreateIndex
CREATE INDEX "TeamInvitation_programId_inviteeId_idx" ON "TeamInvitation"("programId", "inviteeId");

-- CreateIndex
CREATE INDEX "TeamInvitation_inviteeId_status_idx" ON "TeamInvitation"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "BoardPost_programId_pinned_createdAt_idx" ON "BoardPost"("programId", "pinned", "createdAt");

-- CreateIndex
CREATE INDEX "BoardComment_postId_createdAt_idx" ON "BoardComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardComment_authorId_idx" ON "BoardComment"("authorId");

-- CreateIndex
CREATE INDEX "MilestoneDocument_milestoneId_sortOrder_idx" ON "MilestoneDocument"("milestoneId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneDocumentTemplateFile_milestoneDocumentId_key" ON "MilestoneDocumentTemplateFile"("milestoneDocumentId");

-- CreateIndex
CREATE INDEX "MilestoneDocumentTemplateFile_uploadedById_idx" ON "MilestoneDocumentTemplateFile"("uploadedById");

-- CreateIndex
CREATE INDEX "MilestoneDocumentSubmission_applicationId_idx" ON "MilestoneDocumentSubmission"("applicationId");

-- CreateIndex
CREATE INDEX "MilestoneDocumentSubmission_submittedById_idx" ON "MilestoneDocumentSubmission"("submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneDocumentSubmission_milestoneDocumentId_application_key" ON "MilestoneDocumentSubmission"("milestoneDocumentId", "applicationId");

-- CreateIndex
CREATE INDEX "SubmissionFile_milestoneDocumentSubmissionId_idx" ON "SubmissionFile"("milestoneDocumentSubmissionId");

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_programId_fkey" FOREIGN KEY ("teamId", "programId") REFERENCES "Team"("id", "programId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardPost" ADD CONSTRAINT "BoardPost_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardPost" ADD CONSTRAINT "BoardPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardComment" ADD CONSTRAINT "BoardComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BoardPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardComment" ADD CONSTRAINT "BoardComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_milestoneDocumentSubmissionId_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocument" ADD CONSTRAINT "MilestoneDocument_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentTemplateFile" ADD CONSTRAINT "MilestoneDocumentTemplateFile_milestoneDocumentId_fkey" FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentTemplateFile" ADD CONSTRAINT "MilestoneDocumentTemplateFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentSubmission" ADD CONSTRAINT "MilestoneDocumentSubmission_milestoneDocumentId_fkey" FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentSubmission" ADD CONSTRAINT "MilestoneDocumentSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentSubmission" ADD CONSTRAINT "MilestoneDocumentSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- #164 패턴 — 동일 (teamId, inviteeId)에 PENDING 초대가 동시에 여럿 존재하는 것을 막는 partial
-- unique는 Prisma schema로 표현할 수 없어 여기 SQL로 둔다. ACCEPTED/DECLINED/EXPIRED로 상태가
-- 바뀐 이력 행은 이 제약 대상이 아니므로 재초대(새 PENDING 행 생성)를 막지 않는다.
CREATE UNIQUE INDEX "TeamInvitation_teamId_inviteeId_pending_key"
ON "TeamInvitation"("teamId", "inviteeId") WHERE "status" = 'PENDING';

-- #619 SubmissionFile.milestoneDocumentSubmissionId 확장 — 기존
-- SubmissionFile_lifecycle_attachment_check(#164, 20260726125000)는 ATTACHED 상태에
-- submissionRevisionId만 요구해, 새 경로(milestoneDocumentSubmissionId)로 첨부된 파일을
-- 전부 거부한다. "두 경로 중 정확히 하나"라는 상호배타 조건은 Prisma schema DSL로 표현할 수
-- 없어(여러 nullable FK 사이의 XOR) 여기 SQL로 다시 정의한다. 기존 ATTACHED 행은 전부
-- submissionRevisionId만 채워져 있어 새 제약을 그대로 만족하므로 NOT VALID 없이 즉시 검증한다.
ALTER TABLE "SubmissionFile"
DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
  ("lifecycle" = 'PENDING' AND "applicationId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND "submissionRevisionId" IS NULL AND "milestoneDocumentSubmissionId" IS NULL
    AND "pendingExpiresAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
  OR
  ("lifecycle" = 'ATTACHED' AND "applicationId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND (
      ("submissionRevisionId" IS NOT NULL AND "milestoneDocumentSubmissionId" IS NULL)
      OR
      ("submissionRevisionId" IS NULL AND "milestoneDocumentSubmissionId" IS NOT NULL)
    )
    AND "pendingExpiresAt" IS NULL)
  OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')
);
