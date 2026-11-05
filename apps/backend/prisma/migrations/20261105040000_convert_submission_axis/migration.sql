BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE "Milestone", "MilestoneDocument", "MilestoneDocumentSubmission",
  "MilestoneDocumentSubmissionHistory", "MilestoneDocumentReviewHistory",
  "SubmissionFile" IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  submission_count bigint;
  legacy_count bigint;
  unknown_revision_count bigint;
BEGIN
  SELECT count(*) INTO submission_count FROM "MilestoneDocumentSubmission";
  SELECT count(*) INTO legacy_count FROM "MilestoneDocumentSubmission"
    WHERE "legacySubmissionId" IS NOT NULL;
  IF submission_count > 0 AND legacy_count <> 20 THEN
    RAISE EXCEPTION 'submission axis expected exactly 20 public identities, found %', legacy_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentSubmission" source
    JOIN "MilestoneDocumentSubmission" target
      ON target."id" = source."legacySubmissionId" AND target."id" <> source."id"
  ) THEN
    RAISE EXCEPTION 'submission public ID collision';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = '"MilestoneDocumentSubmission"'::regclass
      AND confupdtype <> 'c'
  ) THEN
    RAISE EXCEPTION 'submission foreign key must use ON UPDATE CASCADE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentReviewHistory" review
    LEFT JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
    LEFT JOIN "MilestoneDocumentSubmissionHistory" revision ON revision."id" = review."submissionHistoryId"
    WHERE history."id" IS NULL
      OR history."milestoneDocumentSubmissionId" <> review."milestoneDocumentSubmissionId"
      OR history."event"::text <> review."decision"::text
      OR history."actorId" IS DISTINCT FROM review."reviewerId"
      OR history."createdAt" <> review."reviewedAt"
      OR history."comment" IS DISTINCT FROM review."comment"
      OR history."revision" IS DISTINCT FROM revision."revision"
      OR (revision."id" IS NOT NULL AND revision."event" NOT IN ('SUBMITTED', 'RESUBMITTED'))
      OR (revision."id" IS NOT NULL AND
          revision."milestoneDocumentSubmissionId" <> review."milestoneDocumentSubmissionId")
  ) THEN
    RAISE EXCEPTION 'submission review revision reconciliation mismatch';
  END IF;
  SELECT count(*) INTO unknown_revision_count
  FROM "MilestoneDocumentReviewHistory" review
  JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
  JOIN "MilestoneDocumentSubmission" submission ON submission."id" = review."milestoneDocumentSubmissionId"
  WHERE review."submissionHistoryId" IS NULL AND history."revision" IS NULL
    AND history."event" = 'APPROVED' AND submission."status" = 'APPROVED';
  IF unknown_revision_count <> (CASE WHEN submission_count = 0 THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'submission axis historical unknown revision count mismatch: %', unknown_revision_count;
  END IF;
  IF (SELECT count(*) FROM "MilestoneDocumentSubmissionHistory"
      WHERE "revision" IS NULL AND "event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
      <> unknown_revision_count THEN
    RAISE EXCEPTION 'unexpected unversioned submission review event count';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentReviewHistory" review
    JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
    JOIN "MilestoneDocumentSubmission" submission ON submission."id" = review."milestoneDocumentSubmissionId"
    WHERE history."revision" IS NULL
      AND (review."submissionHistoryId" IS NOT NULL
        OR history."event" <> 'APPROVED' OR submission."status" <> 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'unexpected unversioned submission review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocument" requirement
    JOIN "Milestone" milestone ON milestone."id" = requirement."milestoneId"
    WHERE requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
      AND requirement."submissionType"::text IS DISTINCT FROM milestone."submissionType"::text
  ) THEN
    RAISE EXCEPTION 'legacy requirement submission type mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission"
    WHERE "legacySubmissionId" IS NOT NULL AND "id" <> "legacySubmissionId") THEN
    RAISE EXCEPTION 'submission axis unexpected remaining public ID moves';
  END IF;
  IF EXISTS (SELECT 1 FROM "Milestone" milestone
    WHERE milestone."submissionType" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "MilestoneDocument" requirement WHERE requirement."milestoneId" = milestone."id"
        AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION')) THEN
    RAISE EXCEPTION 'submission axis missing prepared requirement';
  END IF;
END
$preflight$;

DROP TRIGGER "prepare_requirement_submission_type" ON "MilestoneDocument";
DROP FUNCTION "prepare_requirement_submission_type"();
DROP TRIGGER "prepare_submission_history_identity" ON "MilestoneDocumentSubmissionHistory";
DROP FUNCTION "prepare_submission_history_identity"();
DROP TRIGGER "prepare_submission_review_identity" ON "MilestoneDocumentReviewHistory";
DROP FUNCTION "prepare_submission_review_identity"();

DO $convert$
DECLARE
  converted bigint;
  expected bigint;
BEGIN
  SELECT count(*) INTO expected FROM "MilestoneDocument"
    WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION';
  IF expected <> (CASE WHEN EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission") THEN 8 ELSE 0 END) THEN
    RAISE EXCEPTION 'submission axis legacy requirement count mismatch: %', expected;
  END IF;
  UPDATE "MilestoneDocument" SET "kind" = 'DOCUMENT'
    WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION';
  GET DIAGNOSTICS converted = ROW_COUNT;
  IF converted <> expected THEN
    RAISE EXCEPTION 'submission axis conversion count mismatch';
  END IF;
END
$convert$;

ALTER TABLE "MilestoneDocument"
  ADD CONSTRAINT "MilestoneDocument_retired_legacy_kind_check"
  CHECK ("kind" = 'DOCUMENT');

COMMIT;
