BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE "Milestone", "MilestoneDocument", "MilestoneDocumentSubmission",
  "MilestoneDocumentSubmissionHistory", "MilestoneDocumentReviewHistory",
  "SubmissionFile" IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
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
    SELECT 1 FROM "MilestoneDocument" requirement
    JOIN "Milestone" milestone ON milestone."id" = requirement."milestoneId"
    WHERE requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
      AND milestone."submissionType" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy requirement has no submission type';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubmissionFile" file
    JOIN "Milestone" milestone ON milestone."id" = file."milestoneId"
    WHERE file."lifecycle" = 'PENDING' AND milestone."submissionType" IS NOT NULL
      AND (
        milestone."submissionType" <> 'FILE'
        OR EXISTS (
          SELECT 1 FROM "MilestoneDocument" requirement
          WHERE requirement."milestoneId" = milestone."id" AND requirement."kind" = 'DOCUMENT'
        )
      )
  ) THEN
    RAISE EXCEPTION 'pending submission file ownership is ambiguous';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentReviewHistory" review
    WHERE 1 <> (
      SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" history
      WHERE history."milestoneDocumentSubmissionId" = review."milestoneDocumentSubmissionId"
        AND history."event"::text = review."decision"::text
        AND history."actorId" = review."reviewerId"
        AND history."createdAt" = review."reviewedAt"
        AND history."comment" IS NOT DISTINCT FROM review."comment"
    )
  ) THEN
    RAISE EXCEPTION 'submission review event reconciliation mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MilestoneDocumentReviewHistory" review
    JOIN "MilestoneDocumentSubmissionHistory" target ON target."id" = review."id"
    WHERE target."milestoneDocumentSubmissionId" <> review."milestoneDocumentSubmissionId"
      OR target."event"::text <> review."decision"::text
      OR target."actorId" <> review."reviewerId"
      OR target."createdAt" <> review."reviewedAt"
      OR target."comment" IS DISTINCT FROM review."comment"
  ) THEN
    RAISE EXCEPTION 'submission review public ID collision';
  END IF;
END
$preflight$;

CREATE TYPE "RequirementSubmissionType" AS ENUM ('FILE', 'TEXT', 'FILE_OR_TEXT');
ALTER TABLE "MilestoneDocument"
  ADD COLUMN "submissionType" "RequirementSubmissionType" NOT NULL DEFAULT 'FILE_OR_TEXT';
ALTER TABLE "SubmissionFile" ADD COLUMN "milestoneDocumentId" TEXT;
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_milestoneDocumentId_fkey"
  FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SubmissionFile_milestoneDocumentId_idx" ON "SubmissionFile"("milestoneDocumentId");

UPDATE "MilestoneDocumentSubmission"
SET "id" = "legacySubmissionId"
WHERE "legacySubmissionId" IS NOT NULL AND "id" <> "legacySubmissionId";

UPDATE "MilestoneDocument" requirement
SET "submissionType" = milestone."submissionType"::text::"RequirementSubmissionType"
FROM "Milestone" milestone
WHERE requirement."milestoneId" = milestone."id"
  AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION';

INSERT INTO "MilestoneDocument" (
  "id", "milestoneId", "name", "required", "sortOrder", "kind",
  "submissionType", "createdAt", "updatedAt"
)
SELECT 'legacy_document_' || md5(milestone."id"), milestone."id", milestone."name",
  true, -1, 'LEGACY_MILESTONE_SUBMISSION', milestone."submissionType"::text::"RequirementSubmissionType",
  milestone."createdAt", milestone."updatedAt"
FROM "Milestone" milestone
WHERE milestone."submissionType" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MilestoneDocument" requirement
    WHERE requirement."milestoneId" = milestone."id"
      AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
  );

UPDATE "SubmissionFile" file
SET "milestoneDocumentId" = requirement."id"
FROM "MilestoneDocument" requirement
WHERE file."milestoneId" = requirement."milestoneId"
  AND file."lifecycle" = 'PENDING'
  AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION';

UPDATE "MilestoneDocumentSubmissionHistory" history
SET "id" = review."id"
FROM "MilestoneDocumentReviewHistory" review
WHERE history."milestoneDocumentSubmissionId" = review."milestoneDocumentSubmissionId"
  AND history."event"::text = review."decision"::text
  AND history."actorId" = review."reviewerId"
  AND history."createdAt" = review."reviewedAt"
  AND history."comment" IS NOT DISTINCT FROM review."comment";

-- The previous backend remains active while this migration runs.
-- These two triggers preserve its public review ID in either insertion order.
CREATE FUNCTION "prepare_submission_review_identity"() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  UPDATE "MilestoneDocumentSubmissionHistory" history
  SET "id" = NEW."id"
  WHERE history."milestoneDocumentSubmissionId" = NEW."milestoneDocumentSubmissionId"
    AND history."event"::text = NEW."decision"::text
    AND history."actorId" = NEW."reviewerId"
    AND history."createdAt" = NEW."reviewedAt"
    AND history."comment" IS NOT DISTINCT FROM NEW."comment";
  RETURN NEW;
END
$function$;
CREATE TRIGGER "prepare_submission_review_identity"
AFTER INSERT OR UPDATE ON "MilestoneDocumentReviewHistory"
FOR EACH ROW EXECUTE FUNCTION "prepare_submission_review_identity"();

CREATE FUNCTION "prepare_submission_history_identity"() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  review_id TEXT;
BEGIN
  IF NEW."event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') THEN
    SELECT review."id" INTO review_id
    FROM "MilestoneDocumentReviewHistory" review
    WHERE review."milestoneDocumentSubmissionId" = NEW."milestoneDocumentSubmissionId"
      AND review."decision"::text = NEW."event"::text
      AND review."reviewerId" = NEW."actorId"
      AND review."reviewedAt" = NEW."createdAt"
      AND review."comment" IS NOT DISTINCT FROM NEW."comment";
    IF FOUND THEN
      NEW."id" := review_id;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER "prepare_submission_history_identity"
BEFORE INSERT ON "MilestoneDocumentSubmissionHistory"
FOR EACH ROW EXECUTE FUNCTION "prepare_submission_history_identity"();

CREATE FUNCTION "prepare_requirement_submission_type"() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW."kind" = 'LEGACY_MILESTONE_SUBMISSION' THEN
    SELECT "submissionType"::text::"RequirementSubmissionType" INTO NEW."submissionType"
    FROM "Milestone" WHERE "id" = NEW."milestoneId";
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER "prepare_requirement_submission_type"
BEFORE INSERT ON "MilestoneDocument"
FOR EACH ROW EXECUTE FUNCTION "prepare_requirement_submission_type"();

COMMIT;
