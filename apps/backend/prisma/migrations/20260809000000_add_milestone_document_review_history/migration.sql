
CREATE TABLE "MilestoneDocumentReviewHistory" (
    "id" TEXT NOT NULL,
    "milestoneDocumentSubmissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneDocumentReviewHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MilestoneDocumentReviewHistory_milestoneDocumentSubmissionI_idx" ON "MilestoneDocumentReviewHistory"("milestoneDocumentSubmissionId", "reviewedAt");

CREATE INDEX "MilestoneDocumentReviewHistory_reviewerId_idx" ON "MilestoneDocumentReviewHistory"("reviewerId");

ALTER TABLE "MilestoneDocumentReviewHistory" ADD CONSTRAINT "MilestoneDocumentReviewHistory_milestoneDocumentSubmission_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MilestoneDocumentReviewHistory" ADD CONSTRAINT "MilestoneDocumentReviewHistory_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
