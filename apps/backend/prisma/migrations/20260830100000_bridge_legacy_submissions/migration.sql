-- #1034 bridge: non-seed legacy submission history is copied into one internal target slot per
-- milestone. Source rows and source FKs remain intact until the separate contract migration.
-- Jenkins applies this transaction before rolling out the exact-SHA target-only backend image.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Stop source mutations while the final source snapshot is copied. Reads remain available to the
-- old image until the same release rolls out the target-only image.
LOCK TABLE "Submission", "SubmissionRevision", "Review", "SubmissionFile"
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Submission" AS submission
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::integer AS revision_count,
        COUNT(DISTINCT revision."revision")::integer AS distinct_revision_count,
        MIN(revision."revision") AS min_revision,
        MAX(revision."revision") AS max_revision
      FROM "SubmissionRevision" AS revision
      WHERE revision."submissionId" = submission."id"
    ) AS revisions ON TRUE
    WHERE submission."id" NOT LIKE 'seed:%'
      AND application."id" NOT LIKE 'seed:%'
      AND (
        revisions.revision_count = 0
        OR revisions.min_revision <> 1
        OR revisions.max_revision <> submission."currentRevision"
        OR revisions.revision_count <> revisions.distinct_revision_count
        OR revisions.revision_count <> submission."currentRevision"
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission revision sequence requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SubmissionRevision" AS revision
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE submission."id" NOT LIKE 'seed:%'
      AND application."id" NOT LIKE 'seed:%'
      AND (
        EXISTS (
          SELECT 1
          FROM "SubmissionRevision" AS next_revision
          WHERE next_revision."submissionId" = revision."submissionId"
            AND next_revision."revision" = revision."revision" + 1
            AND next_revision."submittedAt" <= revision."submittedAt"
        )
        OR EXISTS (
          SELECT 1
          FROM "Review" AS review
          WHERE review."submissionRevisionId" = revision."id"
            AND review."reviewedAt" < revision."submittedAt"
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission event order requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Review" AS review
    LEFT JOIN "SubmissionRevision" AS revision
      ON revision."id" = review."submissionRevisionId"
    WHERE revision."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "SubmissionFile" AS file
    LEFT JOIN "SubmissionRevision" AS revision
      ON revision."id" = file."submissionRevisionId"
    WHERE file."submissionRevisionId" IS NOT NULL
      AND revision."id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission orphan requires reconciliation';
  END IF;
END
$preflight$;

INSERT INTO "MilestoneDocument" (
  "id", "milestoneId", "name", "required", "sortOrder", "kind", "createdAt", "updatedAt"
)
SELECT DISTINCT
  CONCAT('legacy_document_', MD5(milestone."id")),
  milestone."id",
  milestone."name",
  TRUE,
  -1,
  'LEGACY_MILESTONE_SUBMISSION'::"MilestoneDocumentKind",
  milestone."createdAt",
  milestone."updatedAt"
FROM "Submission" AS submission
JOIN "Application" AS application ON application."id" = submission."applicationId"
JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId"
WHERE submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "MilestoneDocumentSubmission" (
  "id", "legacySubmissionId", "milestoneDocumentId", "applicationId", "status", "content",
  "revision", "submittedById", "submittedAt", "createdAt", "updatedAt"
)
SELECT
  CONCAT('legacy_submission_', MD5(submission."id")),
  submission."id",
  CONCAT('legacy_document_', MD5(submission."milestoneId")),
  submission."applicationId",
  submission."status",
  current_revision."content",
  submission."currentRevision",
  current_revision."submittedById",
  current_revision."submittedAt",
  submission."createdAt",
  submission."updatedAt"
FROM "Submission" AS submission
JOIN "Application" AS application ON application."id" = submission."applicationId"
JOIN "SubmissionRevision" AS current_revision
  ON current_revision."submissionId" = submission."id"
 AND current_revision."revision" = submission."currentRevision"
WHERE submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id", "milestoneDocumentSubmissionId", "event", "revision", "content", "comment",
  "actorId", "createdAt"
)
SELECT
  CONCAT('legacy_submission_revision_', MD5(revision."id")),
  CONCAT('legacy_submission_', MD5(submission."id")),
  CASE
    WHEN revision."revision" = 1 THEN 'SUBMITTED'
    ELSE 'RESUBMITTED'
  END::"MilestoneDocumentSubmissionHistoryEvent",
  revision."revision",
  revision."content",
  revision."comment",
  revision."submittedById",
  revision."submittedAt"
FROM "SubmissionRevision" AS revision
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "MilestoneDocumentReviewHistory" (
  "id", "milestoneDocumentSubmissionId", "submissionHistoryId", "reviewerId",
  "decision", "comment", "reviewedAt"
)
SELECT
  CONCAT('legacy_review_', MD5(review."id")),
  CONCAT('legacy_submission_', MD5(submission."id")),
  CONCAT('legacy_submission_revision_', MD5(revision."id")),
  review."reviewerId",
  review."decision",
  review."comment",
  review."reviewedAt"
FROM "Review" AS review
JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id", "milestoneDocumentSubmissionId", "event", "revision", "content", "comment",
  "actorId", "createdAt"
)
SELECT
  CONCAT('legacy_review_event_', MD5(review."id")),
  CONCAT('legacy_submission_', MD5(submission."id")),
  review."decision"::TEXT::"MilestoneDocumentSubmissionHistoryEvent",
  revision."revision",
  NULL,
  review."comment",
  review."reviewerId",
  review."reviewedAt"
FROM "Review" AS review
JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%'
ON CONFLICT ("id") DO NOTHING;

UPDATE "SubmissionFile" AS file
SET
  "milestoneDocumentSubmissionId" = CONCAT('legacy_submission_', MD5(submission."id")),
  "milestoneDocumentSubmissionHistoryId" = CONCAT(
    'legacy_submission_revision_', MD5(revision."id")
  )
FROM "SubmissionRevision" AS revision
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE file."submissionRevisionId" = revision."id"
  AND submission."id" NOT LIKE 'seed:%'
  AND application."id" NOT LIKE 'seed:%';

DO $postflight$
DECLARE
  source_submission_count bigint;
  source_revision_count bigint;
  source_review_count bigint;
  source_file_count bigint;
BEGIN
  SELECT COUNT(*) INTO source_submission_count
  FROM "Submission" AS submission
  JOIN "Application" AS application ON application."id" = submission."applicationId"
  WHERE submission."id" NOT LIKE 'seed:%' AND application."id" NOT LIKE 'seed:%';

  SELECT COUNT(*) INTO source_revision_count
  FROM "SubmissionRevision" AS revision
  JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
  JOIN "Application" AS application ON application."id" = submission."applicationId"
  WHERE submission."id" NOT LIKE 'seed:%' AND application."id" NOT LIKE 'seed:%';

  SELECT COUNT(*) INTO source_review_count
  FROM "Review" AS review
  JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
  JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
  JOIN "Application" AS application ON application."id" = submission."applicationId"
  WHERE submission."id" NOT LIKE 'seed:%' AND application."id" NOT LIKE 'seed:%';

  SELECT COUNT(*) INTO source_file_count
  FROM "SubmissionFile" AS file
  JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
  JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
  JOIN "Application" AS application ON application."id" = submission."applicationId"
  WHERE submission."id" NOT LIKE 'seed:%' AND application."id" NOT LIKE 'seed:%';

  IF (SELECT COUNT(*) FROM "MilestoneDocumentSubmission" WHERE "legacySubmissionId" IS NOT NULL)
       <> source_submission_count
    OR (SELECT COUNT(*) FROM "MilestoneDocumentSubmissionHistory"
        WHERE "id" LIKE 'legacy_submission_revision_%') <> source_revision_count
    OR (SELECT COUNT(*) FROM "MilestoneDocumentReviewHistory"
        WHERE "id" LIKE 'legacy_review_%') <> source_review_count
    OR (SELECT COUNT(*) FROM "MilestoneDocumentSubmissionHistory"
        WHERE "id" LIKE 'legacy_review_event_%') <> source_review_count
    OR (SELECT COUNT(*) FROM "SubmissionFile"
        WHERE "submissionRevisionId" IS NOT NULL
          AND "milestoneDocumentSubmissionId" IS NOT NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL) <> source_file_count
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission bridge count reconciliation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Submission" AS source
    JOIN "MilestoneDocumentSubmission" AS target
      ON target."legacySubmissionId" = source."id"
    WHERE target."id" <> CONCAT('legacy_submission_', MD5(source."id"))
      OR target."revision" <> source."currentRevision"
      OR target."status" <> source."status"
      OR target."applicationId" <> source."applicationId"
  ) OR EXISTS (
    SELECT 1
    FROM "SubmissionFile" AS file
    JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
    JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
    JOIN "Application" AS application ON application."id" = submission."applicationId"
    WHERE submission."id" NOT LIKE 'seed:%'
      AND application."id" NOT LIKE 'seed:%'
      AND (
        file."milestoneDocumentSubmissionId" <> CONCAT(
          'legacy_submission_', MD5(submission."id")
        )
        OR file."milestoneDocumentSubmissionHistoryId" <> CONCAT(
          'legacy_submission_revision_', MD5(revision."id")
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy submission bridge field reconciliation failed';
  END IF;
END
$postflight$;

CREATE FUNCTION "reject_legacy_submission_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Seed/synthetic fixture rows are isolated from production user data and remain writable so
  -- post-migration CI can construct and tear down its own graphs. Runtime-created ids never use
  -- these reserved markers.
  IF (TG_OP = 'DELETE' AND (OLD."id" LIKE 'seed:%' OR OLD."id" LIKE '%synthetic%'))
    OR (TG_OP <> 'DELETE' AND (NEW."id" LIKE 'seed:%' OR NEW."id" LIKE '%synthetic%'))
  THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'check_violation',
    MESSAGE = 'legacy submission source is read only after bridge';
END
$function$;

CREATE TRIGGER "Submission_bridge_write_fence"
BEFORE INSERT OR UPDATE OR DELETE ON "Submission"
FOR EACH ROW EXECUTE FUNCTION "reject_legacy_submission_mutation"();
CREATE TRIGGER "SubmissionRevision_bridge_write_fence"
BEFORE INSERT OR UPDATE OR DELETE ON "SubmissionRevision"
FOR EACH ROW EXECUTE FUNCTION "reject_legacy_submission_mutation"();
CREATE TRIGGER "Review_bridge_write_fence"
BEFORE INSERT OR UPDATE OR DELETE ON "Review"
FOR EACH ROW EXECUTE FUNCTION "reject_legacy_submission_mutation"();

CREATE FUNCTION "protect_legacy_submission_file_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'DELETE' AND (OLD."id" LIKE 'seed:%' OR OLD."id" LIKE '%synthetic%'))
    OR (TG_OP <> 'DELETE' AND (NEW."id" LIKE 'seed:%' OR NEW."id" LIKE '%synthetic%'))
  THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."submissionRevisionId" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'new legacy submission file linkage is forbidden';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."submissionRevisionId" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'migrated submission file provenance is immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."submissionRevisionId" IS NULL THEN
    IF NEW."submissionRevisionId" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'legacy submission file relink is forbidden';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."submissionRevisionId" IS DISTINCT FROM OLD."submissionRevisionId"
    OR NEW."milestoneDocumentSubmissionId" IS DISTINCT FROM OLD."milestoneDocumentSubmissionId"
    OR NEW."milestoneDocumentSubmissionHistoryId" IS DISTINCT FROM OLD."milestoneDocumentSubmissionHistoryId"
    OR NEW."milestoneDocumentSubmissionId" IS NULL
    OR NEW."milestoneDocumentSubmissionHistoryId" IS NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."uploaderId" IS DISTINCT FROM OLD."uploaderId"
    OR NEW."applicationId" IS DISTINCT FROM OLD."applicationId"
    OR NEW."milestoneId" IS DISTINCT FROM OLD."milestoneId"
    OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
    OR NEW."originalFileName" IS DISTINCT FROM OLD."originalFileName"
    OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
    OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'migrated submission file provenance is immutable';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER "SubmissionFile_bridge_provenance_fence"
BEFORE INSERT OR UPDATE OR DELETE ON "SubmissionFile"
FOR EACH ROW EXECUTE FUNCTION "protect_legacy_submission_file_provenance"();

COMMIT;
