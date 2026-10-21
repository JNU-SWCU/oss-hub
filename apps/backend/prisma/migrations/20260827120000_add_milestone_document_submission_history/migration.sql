BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Milestone"
  ALTER COLUMN "submissionType" DROP NOT NULL;

CREATE TYPE "MilestoneDocumentSubmissionHistoryEvent" AS ENUM (
  'SUBMITTED',
  'RESUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "MilestoneDocumentSubmissionHistory" (
  "id" TEXT NOT NULL,
  "milestoneDocumentSubmissionId" TEXT NOT NULL,
  "event" "MilestoneDocumentSubmissionHistoryEvent" NOT NULL,
  "revision" INTEGER,
  "content" JSONB,
  "comment" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MilestoneDocumentSubmissionHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SubmissionFile"
  ADD COLUMN "milestoneDocumentSubmissionHistoryId" TEXT;

ALTER TABLE "MilestoneDocumentReviewHistory"
  ADD COLUMN "submissionHistoryId" TEXT;

CREATE INDEX "MilestoneDocumentSubmissionHistory_milestoneDocumentSubmissionId_createdAt_idx"
  ON "MilestoneDocumentSubmissionHistory"("milestoneDocumentSubmissionId", "createdAt");
CREATE INDEX "MilestoneDocumentSubmissionHistory_actorId_idx"
  ON "MilestoneDocumentSubmissionHistory"("actorId");
CREATE INDEX "SubmissionFile_milestoneDocumentSubmissionHistoryId_idx"
  ON "SubmissionFile"("milestoneDocumentSubmissionHistoryId");
CREATE INDEX "MilestoneDocumentReviewHistory_submissionHistoryId_idx"
  ON "MilestoneDocumentReviewHistory"("submissionHistoryId");

ALTER TABLE "MilestoneDocumentSubmissionHistory"
  ADD CONSTRAINT "MilestoneDocumentSubmissionHistory_submissionId_fkey"
  FOREIGN KEY ("milestoneDocumentSubmissionId")
  REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneDocumentSubmissionHistory"
  ADD CONSTRAINT "MilestoneDocumentSubmissionHistory_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_submissionHistoryId_fkey"
  FOREIGN KEY ("milestoneDocumentSubmissionHistoryId")
  REFERENCES "MilestoneDocumentSubmissionHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneDocumentReviewHistory"
  ADD CONSTRAINT "MilestoneDocumentReviewHistory_submissionHistoryId_fkey"
  FOREIGN KEY ("submissionHistoryId")
  REFERENCES "MilestoneDocumentSubmissionHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SubmissionFile"
    WHERE "milestoneDocumentSubmissionId" IS NOT NULL
      AND "lifecycle" = 'ATTACHED'
    GROUP BY "milestoneDocumentSubmissionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ambiguous milestone document files require row-level reconciliation';
  END IF;
END
$migration$;

INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id",
  "milestoneDocumentSubmissionId",
  "event",
  "revision",
  "content",
  "actorId",
  "createdAt"
)
SELECT
  CONCAT('legacy_', MD5(submission."id")),
  submission."id",
  CASE
    WHEN submission."revision" = 1 THEN 'SUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
    ELSE 'RESUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
  END,
  submission."revision",
  submission."content",
  submission."submittedById",
  submission."submittedAt"
FROM "MilestoneDocumentSubmission" AS submission;

INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id",
  "milestoneDocumentSubmissionId",
  "event",
  "revision",
  "comment",
  "actorId",
  "createdAt"
)
SELECT
  CONCAT('legacy_review_', MD5(review."id")),
  review."milestoneDocumentSubmissionId",
  review."decision"::TEXT::"MilestoneDocumentSubmissionHistoryEvent",
  NULL,
  review."comment",
  review."reviewerId",
  review."reviewedAt"
FROM "MilestoneDocumentReviewHistory" AS review;

WITH "UnambiguousAttachedFile" AS (
  SELECT "milestoneDocumentSubmissionId"
  FROM "SubmissionFile"
  WHERE "milestoneDocumentSubmissionId" IS NOT NULL
    AND "lifecycle" = 'ATTACHED'
  GROUP BY "milestoneDocumentSubmissionId"
  HAVING COUNT(*) = 1
)
UPDATE "SubmissionFile" AS file
SET "milestoneDocumentSubmissionHistoryId" = CONCAT(
  'legacy_',
  MD5(file."milestoneDocumentSubmissionId")
)
FROM "UnambiguousAttachedFile" AS unambiguous
WHERE file."milestoneDocumentSubmissionId" = unambiguous."milestoneDocumentSubmissionId"
  AND file."lifecycle" = 'ATTACHED';

ALTER TABLE "MilestoneDocument"
  DROP COLUMN "submissionType";

COMMIT;
