BEGIN;

CREATE TYPE "MilestoneDocumentKind" AS ENUM (
  'DOCUMENT',
  'LEGACY_MILESTONE_SUBMISSION'
);

ALTER TABLE "MilestoneDocument"
  ADD COLUMN "kind" "MilestoneDocumentKind" NOT NULL DEFAULT 'DOCUMENT';

ALTER TABLE "MilestoneDocumentSubmission"
  ADD COLUMN "legacySubmissionId" TEXT;

CREATE UNIQUE INDEX "MilestoneDocumentSubmission_legacySubmissionId_key"
  ON "MilestoneDocumentSubmission"("legacySubmissionId");

CREATE UNIQUE INDEX "MilestoneDocument_one_legacy_submission_slot_key"
  ON "MilestoneDocument"("milestoneId")
  WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION';

ALTER TABLE "SubmissionFile"
  DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
    (
      "lifecycle" = 'PENDING'
      AND "applicationId" IS NOT NULL
      AND "milestoneId" IS NOT NULL
      AND "submissionRevisionId" IS NULL
      AND "milestoneDocumentSubmissionId" IS NULL
      AND "milestoneDocumentSubmissionHistoryId" IS NULL
      AND "pendingExpiresAt" IS NOT NULL
      AND "expiresAt" IS NOT NULL
    )
    OR
    (
      "lifecycle" = 'ATTACHED'
      AND "applicationId" IS NOT NULL
      AND "milestoneId" IS NOT NULL
      AND "pendingExpiresAt" IS NULL
      AND (
        (
          "submissionRevisionId" IS NOT NULL
          AND "milestoneDocumentSubmissionId" IS NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NULL
        )
        OR
        (
          "submissionRevisionId" IS NOT NULL
          AND "milestoneDocumentSubmissionId" IS NOT NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
        )
        OR
        (
          "submissionRevisionId" IS NULL
          AND "milestoneDocumentSubmissionId" IS NOT NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
        )
      )
    )
    OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')
  );

COMMIT;
