-- #1034 contract: the target milestone-document ledger is the only submission ledger.
-- This migration deliberately has no compatibility path: reconciliation must be complete before
-- the source schema is removed.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE
  "Submission",
  "SubmissionRevision",
  "Review",
  "SubmissionFile",
  "MilestoneDocumentSubmission",
  "MilestoneDocumentSubmissionHistory",
  "MilestoneDocumentReviewHistory"
IN ACCESS EXCLUSIVE MODE;

-- All reconciliation gates precede every destructive schema change. A row is a disposable source
-- seed only when both its Submission id and its Application id use the reserved seed: prefix.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SubmissionRevision" AS revision
    LEFT JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    WHERE submission."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "Review" AS review
    LEFT JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
    WHERE revision."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "SubmissionFile" AS file
    LEFT JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
    WHERE file."submissionRevisionId" IS NOT NULL
      AND revision."id" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission source orphan requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Submission" AS submission
    LEFT JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE application."id" IS NULL
      OR NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
        AND NOT EXISTS (
          SELECT 1
          FROM "SubmissionRevision" AS revision
          WHERE revision."submissionId" = submission."id"
            AND revision."revision" = submission."currentRevision"
        )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission current revision requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Submission" AS submission
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
    GROUP BY CONCAT('legacy_submission_', MD5(submission."id"))
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "SubmissionRevision" AS revision
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
    GROUP BY CONCAT('legacy_submission_revision_', MD5(revision."id"))
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "Review" AS review
    JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
    GROUP BY CONCAT('legacy_review_', MD5(review."id"))
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "Review" AS review
    JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
    GROUP BY CONCAT('legacy_review_event_', MD5(review."id"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission deterministic target id collision requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "MilestoneDocumentSubmission" AS by_id
    JOIN "MilestoneDocumentSubmission" AS by_legacy_id
      ON by_legacy_id."legacySubmissionId" = by_id."id"
     AND by_legacy_id."id" <> by_id."id"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission public id collision requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Submission" AS submission
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    JOIN "SubmissionRevision" AS current_revision
      ON current_revision."submissionId" = submission."id"
     AND current_revision."revision" = submission."currentRevision"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
      AND 1 <> (
        SELECT COUNT(*)
        FROM "MilestoneDocumentSubmission" AS target
        JOIN "MilestoneDocument" AS document ON document."id" = target."milestoneDocumentId"
        WHERE target."legacySubmissionId" = submission."id"
          AND target."id" = CONCAT('legacy_submission_', MD5(submission."id"))
          AND target."applicationId" = submission."applicationId"
          AND target."milestoneDocumentId" = CONCAT('legacy_document_', MD5(submission."milestoneId"))
          AND document."milestoneId" = submission."milestoneId"
          AND document."kind" = 'LEGACY_MILESTONE_SUBMISSION'
          AND target."revision" = submission."currentRevision"
          AND target."status" = submission."status"
          AND target."content" IS NOT DISTINCT FROM current_revision."content"
          AND target."submittedById" = current_revision."submittedById"
          AND target."submittedAt" = current_revision."submittedAt"
          AND target."createdAt" = submission."createdAt"
          AND target."updatedAt" = submission."updatedAt"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "MilestoneDocumentSubmission" AS target
    LEFT JOIN "Submission" AS submission ON submission."id" = target."legacySubmissionId"
    LEFT JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE target."legacySubmissionId" IS NOT NULL
      AND (
        submission."id" IS NULL
        OR application."id" IS NULL
        OR submission."id" LIKE 'seed:%'
        OR application."id" LIKE 'seed:%'
        OR target."id" <> CONCAT('legacy_submission_', MD5(submission."id"))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission header mapping requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SubmissionRevision" AS revision
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
      AND 1 <> (
        SELECT COUNT(*)
        FROM "MilestoneDocumentSubmissionHistory" AS history
        WHERE history."id" = CONCAT('legacy_submission_revision_', MD5(revision."id"))
          AND history."milestoneDocumentSubmissionId" = CONCAT('legacy_submission_', MD5(submission."id"))
          AND history."event" = CASE WHEN revision."revision" = 1
            THEN 'SUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
            ELSE 'RESUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
          END
          AND history."revision" = revision."revision"
          AND history."content" IS NOT DISTINCT FROM revision."content"
          AND history."comment" IS NOT DISTINCT FROM revision."comment"
          AND history."actorId" = revision."submittedById"
          AND history."createdAt" = revision."submittedAt"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "MilestoneDocumentSubmissionHistory" AS history
    WHERE history."id" LIKE 'legacy_submission_revision_%'
      AND NOT EXISTS (
        SELECT 1
        FROM "SubmissionRevision" AS revision
        JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
        JOIN "Application" AS application ON application."id" = submission."applicationId"
        WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
          AND history."id" = CONCAT('legacy_submission_revision_', MD5(revision."id"))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission revision mapping requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Review" AS review
    JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
      AND (
        1 <> (
          SELECT COUNT(*)
          FROM "MilestoneDocumentReviewHistory" AS target_review
          WHERE target_review."id" = CONCAT('legacy_review_', MD5(review."id"))
            AND target_review."milestoneDocumentSubmissionId" = CONCAT('legacy_submission_', MD5(submission."id"))
            AND target_review."submissionHistoryId" = CONCAT('legacy_submission_revision_', MD5(revision."id"))
            AND target_review."reviewerId" = review."reviewerId"
            AND target_review."decision" = review."decision"
            AND target_review."comment" IS NOT DISTINCT FROM review."comment"
            AND target_review."reviewedAt" = review."reviewedAt"
        )
        OR 1 <> (
          SELECT COUNT(*)
          FROM "MilestoneDocumentSubmissionHistory" AS review_event
          WHERE review_event."id" = CONCAT('legacy_review_event_', MD5(review."id"))
            AND review_event."milestoneDocumentSubmissionId" = CONCAT('legacy_submission_', MD5(submission."id"))
            AND review_event."event" = review."decision"::TEXT::"MilestoneDocumentSubmissionHistoryEvent"
            AND review_event."revision" = revision."revision"
            AND review_event."content" IS NULL
            AND review_event."comment" IS NOT DISTINCT FROM review."comment"
            AND review_event."actorId" = review."reviewerId"
            AND review_event."createdAt" = review."reviewedAt"
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM "MilestoneDocumentReviewHistory" AS target_review
    WHERE target_review."id" LIKE 'legacy_review_%'
      AND target_review."id" NOT LIKE 'legacy_review_event_%'
      AND NOT EXISTS (
        SELECT 1
        FROM "Review" AS review
        JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
        JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
        JOIN "Application" AS application ON application."id" = submission."applicationId"
        WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
          AND target_review."id" = CONCAT('legacy_review_', MD5(review."id"))
      )
  ) OR EXISTS (
    SELECT 1
    FROM "MilestoneDocumentSubmissionHistory" AS review_event
    WHERE review_event."id" LIKE 'legacy_review_event_%'
      AND NOT EXISTS (
        SELECT 1
        FROM "Review" AS review
        JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
        JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
        JOIN "Application" AS application ON application."id" = submission."applicationId"
        WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
          AND review_event."id" = CONCAT('legacy_review_event_', MD5(review."id"))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy review mapping requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SubmissionFile" AS file
    JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%')
      AND (
        file."milestoneDocumentSubmissionId" IS DISTINCT FROM CONCAT('legacy_submission_', MD5(submission."id"))
        OR file."milestoneDocumentSubmissionHistoryId" IS DISTINCT FROM CONCAT('legacy_submission_revision_', MD5(revision."id"))
        OR file."applicationId" IS DISTINCT FROM submission."applicationId"
        OR file."milestoneId" IS DISTINCT FROM submission."milestoneId"
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission file provenance requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SubmissionFile" AS file
    JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE submission."id" LIKE 'seed:%'
      AND application."id" LIKE 'seed:%'
      AND (
        (file."milestoneDocumentSubmissionId" IS NULL)
          <> (file."milestoneDocumentSubmissionHistoryId" IS NULL)
        OR (
          file."milestoneDocumentSubmissionId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "MilestoneDocumentSubmission" AS target
            JOIN "MilestoneDocumentSubmissionHistory" AS history
              ON history."milestoneDocumentSubmissionId" = target."id"
            JOIN "MilestoneDocument" AS document
              ON document."id" = target."milestoneDocumentId"
            WHERE target."id" = file."milestoneDocumentSubmissionId"
              AND history."id" = file."milestoneDocumentSubmissionHistoryId"
              AND target."applicationId" = submission."applicationId"
              AND document."milestoneId" = submission."milestoneId"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy seed file target provenance requires reconciliation';
  END IF;
END
$preflight$;

-- The bridge fences would reject a source-linked seed file whose id is not itself a seed id.
-- Gates above prove that only fully reserved source seed graphs enter this cleanup path.
DROP TRIGGER "SubmissionFile_bridge_provenance_fence" ON "SubmissionFile";
DROP TRIGGER "Submission_bridge_write_fence" ON "Submission";
DROP TRIGGER "SubmissionRevision_bridge_write_fence" ON "SubmissionRevision";
DROP TRIGGER "Review_bridge_write_fence" ON "Review";
DROP FUNCTION "protect_legacy_submission_file_provenance"();
DROP FUNCTION "reject_legacy_submission_mutation"();

-- Source-only seed uploads are retained for the asynchronous object cleaner; no user data or
-- storage object is deleted in this contract migration.
-- A seed file already preserved by the target ledger keeps its lifecycle/object and only loses
-- obsolete source provenance.
UPDATE "SubmissionFile" AS file
SET "submissionRevisionId" = NULL
FROM "SubmissionRevision" AS revision
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE file."submissionRevisionId" = revision."id"
  AND submission."id" LIKE 'seed:%'
  AND application."id" LIKE 'seed:%'
  AND file."milestoneDocumentSubmissionId" IS NOT NULL
  AND file."milestoneDocumentSubmissionHistoryId" IS NOT NULL;

-- Targetless seed uploads are retained for the asynchronous object cleaner; no user data or
-- storage object is deleted in this contract migration.
UPDATE "SubmissionFile" AS file
SET
  "submissionRevisionId" = NULL,
  "lifecycle" = 'DELETE_PENDING',
  "pendingExpiresAt" = NULL,
  "deleteClaimedAt" = NULL,
  "deleteClaimExpiresAt" = NULL,
  "deleteClaimOwner" = NULL,
  "deleteAttemptCount" = 0,
  "nextDeleteAttemptAt" = CURRENT_TIMESTAMP,
  "lastDeleteError" = NULL,
  "deletedAt" = NULL
FROM "SubmissionRevision" AS revision
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE file."submissionRevisionId" = revision."id"
  AND submission."id" LIKE 'seed:%'
  AND application."id" LIKE 'seed:%'
  AND file."milestoneDocumentSubmissionId" IS NULL
  AND file."milestoneDocumentSubmissionHistoryId" IS NULL;

-- Target-only provenance: pending uploads have no attachment, attached files name both target
-- header and immutable history, and cleanup states retain the existing lifecycle flexibility.
ALTER TABLE "SubmissionFile"
  DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
    (
      "lifecycle" = 'PENDING'
      AND "applicationId" IS NOT NULL
      AND "milestoneId" IS NOT NULL
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
      AND "milestoneDocumentSubmissionId" IS NOT NULL
      AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
      AND "pendingExpiresAt" IS NULL
    )
    OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')
  ) NOT VALID;

ALTER TABLE "SubmissionFile"
  VALIDATE CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

-- Source provenance is now absent from every retained row and the target-only constraint is live.
ALTER TABLE "SubmissionFile"
  DROP CONSTRAINT "SubmissionFile_submissionRevisionId_fkey";
DROP INDEX "SubmissionFile_submissionRevisionId_idx";
ALTER TABLE "SubmissionFile"
  DROP COLUMN "submissionRevisionId";

DROP TABLE "Review";
DROP TABLE "SubmissionRevision";
DROP TABLE "Submission";

COMMIT;
