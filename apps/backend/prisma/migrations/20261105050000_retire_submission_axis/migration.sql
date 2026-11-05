BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE "Milestone", "MilestoneDocument", "MilestoneDocumentSubmission",
  "MilestoneDocumentSubmissionHistory", "MilestoneDocumentReviewHistory"
  IN ACCESS EXCLUSIVE MODE;

DO $retire$
DECLARE
  submissions_before bigint;
  histories_before bigint;
  requirements_before bigint;
  reviews_before bigint;
  unknown_revision_count bigint;
BEGIN
  SELECT count(*) INTO submissions_before FROM "MilestoneDocumentSubmission";
  SELECT count(*) INTO histories_before FROM "MilestoneDocumentSubmissionHistory";
  SELECT count(*) INTO requirements_before FROM "MilestoneDocument";
  SELECT count(*) INTO reviews_before FROM "MilestoneDocumentReviewHistory";
  IF reviews_before <> (CASE WHEN submissions_before = 0 THEN 0 ELSE 16 END) THEN
    RAISE EXCEPTION 'submission axis expected exactly 16 retired reviews, found %', reviews_before;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'MilestoneDocumentReviewHistory') <> 8 THEN
    RAISE EXCEPTION 'submission axis retired review column count mismatch';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = current_schema() AND (
        (table_name = 'Milestone' AND column_name = 'submissionType')
        OR (table_name = 'MilestoneDocument' AND column_name = 'kind')
        OR (table_name = 'MilestoneDocumentSubmission' AND column_name = 'legacySubmissionId')
      )) <> 3 THEN
    RAISE EXCEPTION 'submission axis retired column count mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE contype = 'f' AND conrelid = '"MilestoneDocumentReviewHistory"'::regclass) <> 3
    OR EXISTS (
      SELECT 1 FROM pg_constraint WHERE contype = 'f'
        AND confrelid = '"MilestoneDocumentReviewHistory"'::regclass
    ) THEN
    RAISE EXCEPTION 'submission axis retired review foreign key count mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"MilestoneDocument"'::regclass
      AND conname = 'MilestoneDocument_retired_legacy_kind_check'
      AND convalidated
  ) OR EXISTS (SELECT 1 FROM "MilestoneDocument" WHERE "kind" <> 'DOCUMENT') THEN
    RAISE EXCEPTION 'submission axis release A cutover is required';
  END IF;
  IF (SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "legacySubmissionId" IS NOT NULL)
      <> (CASE WHEN submissions_before = 0 THEN 0 ELSE 20 END)
    OR EXISTS (
      SELECT 1 FROM "MilestoneDocumentSubmission"
      WHERE "legacySubmissionId" IS NOT NULL AND "id" <> "legacySubmissionId"
    ) THEN
    RAISE EXCEPTION 'submission axis public identity reconciliation mismatch';
  END IF;
  IF (SELECT count(*) FROM "Milestone" WHERE "submissionType" IS NOT NULL)
      <> (CASE WHEN submissions_before = 0 THEN 0 ELSE 8 END)
    OR EXISTS (
      SELECT 1 FROM "Milestone" milestone
      WHERE milestone."submissionType" IS NOT NULL AND (
        SELECT count(*) FROM "MilestoneDocument" requirement
        WHERE requirement."milestoneId" = milestone."id"
          AND requirement."submissionType"::text = milestone."submissionType"::text
      ) <> 1
    ) THEN
    RAISE EXCEPTION 'submission axis requirement type reconciliation mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentReviewHistory" review
    LEFT JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
    LEFT JOIN "MilestoneDocumentSubmissionHistory" revision ON revision."id" = review."submissionHistoryId"
    WHERE history."id" IS NULL
      OR history."milestoneDocumentSubmissionId" IS DISTINCT FROM review."milestoneDocumentSubmissionId"
      OR history."event"::text IS DISTINCT FROM review."decision"::text
      OR history."actorId" IS DISTINCT FROM review."reviewerId"
      OR history."createdAt" IS DISTINCT FROM review."reviewedAt"
      OR history."comment" IS DISTINCT FROM review."comment"
      OR history."revision" IS DISTINCT FROM revision."revision"
      OR (revision."id" IS NOT NULL AND revision."event" NOT IN ('SUBMITTED', 'RESUBMITTED'))
      OR (revision."id" IS NOT NULL AND
          revision."milestoneDocumentSubmissionId" IS DISTINCT FROM review."milestoneDocumentSubmissionId")
      OR review."resubmissionDueAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'submission axis retired review reconciliation mismatch';
  END IF;
  SELECT count(*) INTO unknown_revision_count
  FROM "MilestoneDocumentReviewHistory" review
  JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
  JOIN "MilestoneDocumentSubmission" submission ON submission."id" = review."milestoneDocumentSubmissionId"
  WHERE review."submissionHistoryId" IS NULL AND history."revision" IS NULL
    AND history."event" = 'APPROVED' AND submission."status" = 'APPROVED';
  IF unknown_revision_count <> (CASE WHEN submissions_before = 0 THEN 0 ELSE 1 END)
    OR (SELECT count(*) FROM "MilestoneDocumentSubmissionHistory"
        WHERE "revision" IS NULL AND "event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
        <> unknown_revision_count THEN
    RAISE EXCEPTION 'submission axis historical unknown revision count mismatch';
  END IF;

  ALTER TABLE "MilestoneDocumentReviewHistory"
    DROP CONSTRAINT "MilestoneDocumentReviewHistory_submissionHistoryId_fkey";
  DROP TABLE "MilestoneDocumentReviewHistory";
  ALTER TABLE "Milestone" DROP COLUMN "submissionType";
  ALTER TABLE "MilestoneDocument" DROP COLUMN "kind";
  ALTER TABLE "MilestoneDocumentSubmission" DROP COLUMN "legacySubmissionId";

  IF (SELECT count(*) FROM "MilestoneDocumentSubmission") <> submissions_before
    OR (SELECT count(*) FROM "MilestoneDocumentSubmissionHistory") <> histories_before
    OR (SELECT count(*) FROM "MilestoneDocument") <> requirements_before THEN
    RAISE EXCEPTION 'submission axis canonical row count changed during physical retirement';
  END IF;
END
$retire$;

COMMIT;
