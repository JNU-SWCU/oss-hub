-- 서류 제출물 판정(승인 · 보완 요청 · 반려) 이력 테이블.
--
-- 옛 "Review"는 "submissionRevisionId"에 UNIQUE가 걸려 있어 revision 하나당 판정이 하나다.
-- 여기에는 UNIQUE를 걸지 않는다 — 서류 제출은 revision을 쌓지 않고
-- "MilestoneDocumentSubmission" 한 행을 덮어쓰는 upsert 모양이라, 판정에 UNIQUE를 걸면
-- 재판정이 지난 판정을 덮어쓴다. 담당 교직원이 바뀌어도 지난 지적이 남아야 한다는 것이
-- 이 기능의 요구라서 판정은 매번 새 행으로 append한다. "지금의 판정"은 최신 한 건이고
-- 그 결과를 "MilestoneDocumentSubmission"."status"가 반영한다.

-- CreateTable
CREATE TABLE "MilestoneDocumentReview" (
    "id" TEXT NOT NULL,
    "milestoneDocumentSubmissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneDocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 수합 표·학생 목록이 제출마다 "최신 판정 한 건"을 끌어오는 조회를 받친다.
CREATE INDEX "MilestoneDocumentReview_milestoneDocumentSubmissionId_revie_idx" ON "MilestoneDocumentReview"("milestoneDocumentSubmissionId", "reviewedAt");

-- CreateIndex
CREATE INDEX "MilestoneDocumentReview_reviewerId_idx" ON "MilestoneDocumentReview"("reviewerId");

-- AddForeignKey
ALTER TABLE "MilestoneDocumentReview" ADD CONSTRAINT "MilestoneDocumentReview_milestoneDocumentSubmissionId_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentReview" ADD CONSTRAINT "MilestoneDocumentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
