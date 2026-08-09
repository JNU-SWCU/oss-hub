-- 서류 제출물 판정(승인 · 보완 요청 · 반려) 이력 테이블.
--
-- 이름이 "History"로 끝나는 것은 시간 축("reviewedAt")이 전진할수록 행이 늘고 지난 행을
-- 지우지 않기 때문이다(docs/rules/data-modeling.md 4절). 같은 기능의
-- "MilestoneDocumentTemplateFile"이 "History"를 쓰지 않는 것과 짝을 이룬다 — 그쪽은 항목당
-- 한 행을 덮어쓰는 upsert 모양이다.
--
-- 옛 "Review"는 "submissionRevisionId"에 UNIQUE가 걸려 있어 revision 하나당 판정이 하나다.
-- 여기에는 UNIQUE를 걸지 않는다 — 서류 제출은 revision을 쌓지 않고
-- "MilestoneDocumentSubmission" 한 행을 덮어쓰는 upsert 모양이라, 판정에 UNIQUE를 걸면
-- 재판정이 지난 판정을 덮어쓴다. 담당 교직원이 바뀌어도 지난 지적이 남아야 한다는 것이
-- 이 기능의 요구라서 판정은 매번 새 행으로 append한다. "지금의 판정"은 최신 한 건이고
-- 그 결과를 "MilestoneDocumentSubmission"."status"가 반영한다.

-- CreateTable
CREATE TABLE "MilestoneDocumentReviewHistory" (
    "id" TEXT NOT NULL,
    "milestoneDocumentSubmissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneDocumentReviewHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 수합 표·학생 목록이 제출마다 "최신 판정 한 건"을 끌어오는 조회를 받친다.
CREATE INDEX "MilestoneDocumentReviewHistory_milestoneDocumentSubmissionI_idx" ON "MilestoneDocumentReviewHistory"("milestoneDocumentSubmissionId", "reviewedAt");

-- CreateIndex
CREATE INDEX "MilestoneDocumentReviewHistory_reviewerId_idx" ON "MilestoneDocumentReviewHistory"("reviewerId");

-- AddForeignKey
ALTER TABLE "MilestoneDocumentReviewHistory" ADD CONSTRAINT "MilestoneDocumentReviewHistory_milestoneDocumentSubmission_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneDocumentReviewHistory" ADD CONSTRAINT "MilestoneDocumentReviewHistory_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
