BEGIN;

SET LOCAL lock_timeout = '1s';
LOCK TABLE "Milestone" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Submission" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "SubmissionRevision" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Review" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "MilestoneDocument" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "MilestoneDocumentSubmission" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "MilestoneDocumentReviewHistory" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "MilestoneDocumentTemplateFile" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "SubmissionFile" IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  actual_labels TEXT[];
  dependent_column_count BIGINT;
  unexpected_count BIGINT;
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder)
  INTO actual_labels
  FROM pg_enum
  WHERE enumtypid = '"MilestoneSubmissionType"'::regtype;

  IF actual_labels IS DISTINCT FROM ARRAY['FILE', 'TEXT', 'REPOSITORY_RELEASE'] THEN
    RAISE EXCEPTION 'P3 release removal blocked: MilestoneSubmissionType labels are unexpected'
      USING ERRCODE = 'check_violation';
  END IF;

  IF to_regtype('"MilestoneSubmissionType_next"') IS NOT NULL THEN
    RAISE EXCEPTION 'P3 release removal blocked: replacement enum already exists'
      USING ERRCODE = 'duplicate_object';
  END IF;

  SELECT COUNT(*)
  INTO dependent_column_count
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  WHERE relation.relnamespace = current_schema()::regnamespace
    AND attribute.atttypid = '"MilestoneSubmissionType"'::regtype
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  WHERE relation.relnamespace = current_schema()::regnamespace
    AND attribute.atttypid = '"MilestoneSubmissionType"'::regtype
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND (relation.relname, attribute.attname) NOT IN (
      ('Milestone', 'submissionType'),
      ('SubmissionRevision', 'submissionType'),
      ('MilestoneDocument', 'submissionType')
    );

  IF dependent_column_count <> 3 OR unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % unexpected enum-dependent column(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM pg_constraint AS constraint_record
  JOIN pg_class AS source_relation ON source_relation.oid = constraint_record.conrelid
  JOIN pg_class AS target_relation ON target_relation.oid = constraint_record.confrelid
  WHERE constraint_record.contype = 'f'
    AND constraint_record.connamespace = current_schema()::regnamespace
    AND target_relation.relname IN (
      'Review',
      'SubmissionFile',
      'SubmissionRevision',
      'Submission',
      'MilestoneDocumentReviewHistory',
      'MilestoneDocumentSubmission',
      'MilestoneDocumentTemplateFile',
      'MilestoneDocument'
    )
    AND (source_relation.relname, target_relation.relname, constraint_record.conname) NOT IN (
      ('SubmissionRevision', 'Submission', 'SubmissionRevision_submissionId_fkey'),
      ('Review', 'SubmissionRevision', 'Review_submissionRevisionId_fkey'),
      ('SubmissionFile', 'SubmissionRevision', 'SubmissionFile_submissionRevisionId_fkey'),
      ('MilestoneDocumentTemplateFile', 'MilestoneDocument', 'MilestoneDocumentTemplateFile_milestoneDocumentId_fkey'),
      ('MilestoneDocumentSubmission', 'MilestoneDocument', 'MilestoneDocumentSubmission_milestoneDocumentId_fkey'),
      ('MilestoneDocumentReviewHistory', 'MilestoneDocumentSubmission', 'MilestoneDocumentReviewHistory_milestoneDocumentSubmission_fkey'),
      ('SubmissionFile', 'MilestoneDocumentSubmission', 'SubmissionFile_milestoneDocumentSubmissionId_fkey')
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: foreign key contract has % unexpected foreign key relation(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  WITH expected_foreign_key (
    source_table,
    target_table,
    constraint_name,
    source_column,
    target_column,
    update_action,
    delete_action
  ) AS (
    VALUES
      ('SubmissionRevision', 'Submission', 'SubmissionRevision_submissionId_fkey', 'submissionId', 'id', 'c', 'r'),
      ('Review', 'SubmissionRevision', 'Review_submissionRevisionId_fkey', 'submissionRevisionId', 'id', 'c', 'r'),
      ('SubmissionFile', 'SubmissionRevision', 'SubmissionFile_submissionRevisionId_fkey', 'submissionRevisionId', 'id', 'c', 'n'),
      ('MilestoneDocumentTemplateFile', 'MilestoneDocument', 'MilestoneDocumentTemplateFile_milestoneDocumentId_fkey', 'milestoneDocumentId', 'id', 'c', 'r'),
      ('MilestoneDocumentSubmission', 'MilestoneDocument', 'MilestoneDocumentSubmission_milestoneDocumentId_fkey', 'milestoneDocumentId', 'id', 'c', 'r'),
      ('MilestoneDocumentReviewHistory', 'MilestoneDocumentSubmission', 'MilestoneDocumentReviewHistory_milestoneDocumentSubmission_fkey', 'milestoneDocumentSubmissionId', 'id', 'c', 'r'),
      ('SubmissionFile', 'MilestoneDocumentSubmission', 'SubmissionFile_milestoneDocumentSubmissionId_fkey', 'milestoneDocumentSubmissionId', 'id', 'c', 'n')
  )
  SELECT COUNT(*)
  INTO unexpected_count
  FROM expected_foreign_key AS expected
  LEFT JOIN pg_class AS source_relation
    ON source_relation.relnamespace = current_schema()::regnamespace
    AND source_relation.relname = expected.source_table
  LEFT JOIN pg_attribute AS source_attribute
    ON source_attribute.attrelid = source_relation.oid
    AND source_attribute.attname = expected.source_column
    AND source_attribute.attnum > 0
    AND NOT source_attribute.attisdropped
  LEFT JOIN pg_constraint AS constraint_record
    ON constraint_record.conrelid = source_relation.oid
    AND constraint_record.conname = expected.constraint_name
    AND constraint_record.contype = 'f'
  LEFT JOIN pg_class AS target_relation
    ON target_relation.oid = constraint_record.confrelid
  LEFT JOIN pg_attribute AS target_attribute
    ON target_attribute.attrelid = target_relation.oid
    AND target_attribute.attname = expected.target_column
    AND target_attribute.attnum > 0
    AND NOT target_attribute.attisdropped
  WHERE constraint_record.oid IS NULL
    OR target_relation.relnamespace IS DISTINCT FROM current_schema()::regnamespace
    OR target_relation.relname IS DISTINCT FROM expected.target_table
    OR constraint_record.conkey IS DISTINCT FROM ARRAY[source_attribute.attnum]::SMALLINT[]
    OR constraint_record.confkey IS DISTINCT FROM ARRAY[target_attribute.attnum]::SMALLINT[]
    OR constraint_record.confupdtype IS DISTINCT FROM expected.update_action::"char"
    OR constraint_record.confdeltype IS DISTINCT FROM expected.delete_action::"char"
    OR NOT constraint_record.convalidated;

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: foreign key contract has % missing, malformed, or unvalidated constraint(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM "SubmissionRevision" AS revision
  JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
  JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId"
  WHERE (
      milestone."submissionType" = 'REPOSITORY_RELEASE'
      AND (
        revision."submissionType" <> 'REPOSITORY_RELEASE'
        OR revision."content"->>'type' IS DISTINCT FROM 'REPOSITORY_RELEASE'
      )
    ) OR (
      milestone."submissionType" <> 'REPOSITORY_RELEASE'
      AND (
        revision."submissionType" = 'REPOSITORY_RELEASE'
        OR revision."content"->>'type' = 'REPOSITORY_RELEASE'
      )
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % unexpected release marker(s) in legacy submissions', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM "MilestoneDocumentSubmission" AS submission
  JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId"
  WHERE (
      document."submissionType" = 'REPOSITORY_RELEASE'
      AND submission."content"->>'type' IS DISTINCT FROM 'REPOSITORY_RELEASE'
    ) OR (
      document."submissionType" <> 'REPOSITORY_RELEASE'
      AND submission."content"->>'type' = 'REPOSITORY_RELEASE'
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % unexpected release marker(s) in document submissions', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM "SubmissionFile" AS file
  LEFT JOIN "SubmissionRevision" AS revision
    ON revision."id" = file."submissionRevisionId"
  LEFT JOIN "Submission" AS legacy_submission
    ON legacy_submission."id" = revision."submissionId"
  LEFT JOIN "Milestone" AS revision_milestone
    ON revision_milestone."id" = legacy_submission."milestoneId"
  LEFT JOIN "MilestoneDocumentSubmission" AS document_submission
    ON document_submission."id" = file."milestoneDocumentSubmissionId"
  LEFT JOIN "MilestoneDocument" AS document
    ON document."id" = document_submission."milestoneDocumentId"
  LEFT JOIN "Milestone" AS direct_milestone
    ON direct_milestone."id" = file."milestoneId"
  WHERE file."submissionRevisionId" IS NOT NULL
    AND file."milestoneDocumentSubmissionId" IS NOT NULL
    AND (
      direct_milestone."submissionType" = 'REPOSITORY_RELEASE'
      OR revision_milestone."submissionType" = 'REPOSITORY_RELEASE'
      OR document."submissionType" = 'REPOSITORY_RELEASE'
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % dual-linked release file(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM "SubmissionFile" AS file
  LEFT JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId"
  LEFT JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
  LEFT JOIN "Milestone" AS direct_milestone ON direct_milestone."id" = file."milestoneId"
  LEFT JOIN "Milestone" AS revision_milestone ON revision_milestone."id" = submission."milestoneId"
  WHERE (
      direct_milestone."submissionType" = 'REPOSITORY_RELEASE'
      OR revision_milestone."submissionType" = 'REPOSITORY_RELEASE'
    )
    AND (
      revision."submissionType" IS DISTINCT FROM 'REPOSITORY_RELEASE'
      OR submission."milestoneId" IS DISTINCT FROM file."milestoneId"
      OR submission."applicationId" IS DISTINCT FROM file."applicationId"
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % unexpected release file relation(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM "SubmissionFile" AS file
  JOIN "MilestoneDocumentSubmission" AS submission
    ON submission."id" = file."milestoneDocumentSubmissionId"
  JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId"
  WHERE document."submissionType" = 'REPOSITORY_RELEASE'
    AND (
      document."milestoneId" IS DISTINCT FROM file."milestoneId"
      OR submission."applicationId" IS DISTINCT FROM file."applicationId"
    );

  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'P3 release removal blocked: % unexpected release document file relation(s)', unexpected_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$preflight$;

DO $evidence$
DECLARE
  legacy_milestone_count BIGINT;
  legacy_submission_count BIGINT;
  legacy_revision_count BIGINT;
  legacy_review_count BIGINT;
  legacy_file_count BIGINT;
  document_count BIGINT;
  document_template_count BIGINT;
  document_submission_count BIGINT;
  document_review_count BIGINT;
  document_file_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_milestone_count FROM "Milestone" WHERE "submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO legacy_submission_count FROM "Submission" AS submission JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId" WHERE milestone."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO legacy_revision_count FROM "SubmissionRevision" AS revision JOIN "Submission" AS submission ON submission."id" = revision."submissionId" JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId" WHERE milestone."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO legacy_review_count FROM "Review" AS review JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId" JOIN "Submission" AS submission ON submission."id" = revision."submissionId" JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId" WHERE milestone."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO legacy_file_count FROM "SubmissionFile" AS file JOIN "SubmissionRevision" AS revision ON revision."id" = file."submissionRevisionId" JOIN "Submission" AS submission ON submission."id" = revision."submissionId" JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId" WHERE milestone."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO document_count FROM "MilestoneDocument" WHERE "submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO document_template_count FROM "MilestoneDocumentTemplateFile" AS template JOIN "MilestoneDocument" AS document ON document."id" = template."milestoneDocumentId" WHERE document."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO document_submission_count FROM "MilestoneDocumentSubmission" AS submission JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId" WHERE document."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO document_review_count FROM "MilestoneDocumentReviewHistory" AS review JOIN "MilestoneDocumentSubmission" AS submission ON submission."id" = review."milestoneDocumentSubmissionId" JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId" WHERE document."submissionType" = 'REPOSITORY_RELEASE';
  SELECT COUNT(*) INTO document_file_count FROM "SubmissionFile" AS file JOIN "MilestoneDocumentSubmission" AS submission ON submission."id" = file."milestoneDocumentSubmissionId" JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId" WHERE document."submissionType" = 'REPOSITORY_RELEASE';

  RAISE NOTICE 'P3 release removal counts: legacy_milestones=%, legacy_submissions=%, legacy_revisions=%, legacy_reviews=%, legacy_files=%, documents=%, document_templates=%, document_submissions=%, document_reviews=%, document_files=%',
    legacy_milestone_count, legacy_submission_count, legacy_revision_count,
    legacy_review_count, legacy_file_count, document_count,
    document_template_count, document_submission_count,
    document_review_count, document_file_count;
END
$evidence$;

DELETE FROM "Review" AS review
USING "SubmissionRevision" AS revision, "Submission" AS submission, "Milestone" AS milestone
WHERE review."submissionRevisionId" = revision."id"
  AND revision."submissionId" = submission."id"
  AND submission."milestoneId" = milestone."id"
  AND milestone."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "MilestoneDocumentReviewHistory" AS review
USING "MilestoneDocumentSubmission" AS submission, "MilestoneDocument" AS document
WHERE review."milestoneDocumentSubmissionId" = submission."id"
  AND submission."milestoneDocumentId" = document."id"
  AND document."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "SubmissionFile" AS file
USING "SubmissionRevision" AS revision, "Submission" AS submission, "Milestone" AS milestone
WHERE file."submissionRevisionId" = revision."id"
  AND revision."submissionId" = submission."id"
  AND submission."milestoneId" = milestone."id"
  AND milestone."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "SubmissionFile" AS file
USING "MilestoneDocumentSubmission" AS submission, "MilestoneDocument" AS document
WHERE file."milestoneDocumentSubmissionId" = submission."id"
  AND submission."milestoneDocumentId" = document."id"
  AND document."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "SubmissionRevision" AS revision
USING "Submission" AS submission, "Milestone" AS milestone
WHERE revision."submissionId" = submission."id"
  AND submission."milestoneId" = milestone."id"
  AND milestone."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "Submission" AS submission
USING "Milestone" AS milestone
WHERE submission."milestoneId" = milestone."id"
  AND milestone."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "MilestoneDocumentSubmission" AS submission
USING "MilestoneDocument" AS document
WHERE submission."milestoneDocumentId" = document."id"
  AND document."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "MilestoneDocumentTemplateFile" AS template
USING "MilestoneDocument" AS document
WHERE template."milestoneDocumentId" = document."id"
  AND document."submissionType" = 'REPOSITORY_RELEASE';

DELETE FROM "MilestoneDocument"
WHERE "submissionType" = 'REPOSITORY_RELEASE';

UPDATE "Milestone"
SET "submissionType" = 'TEXT'
WHERE "submissionType" = 'REPOSITORY_RELEASE';

CREATE TYPE "MilestoneSubmissionType_next" AS ENUM ('FILE', 'TEXT');

ALTER TABLE "Milestone"
ALTER COLUMN "submissionType" TYPE "MilestoneSubmissionType_next"
USING "submissionType"::text::"MilestoneSubmissionType_next";

ALTER TABLE "SubmissionRevision"
ALTER COLUMN "submissionType" TYPE "MilestoneSubmissionType_next"
USING "submissionType"::text::"MilestoneSubmissionType_next";

ALTER TABLE "MilestoneDocument"
ALTER COLUMN "submissionType" TYPE "MilestoneSubmissionType_next"
USING "submissionType"::text::"MilestoneSubmissionType_next";

DROP TYPE "MilestoneSubmissionType";
ALTER TYPE "MilestoneSubmissionType_next" RENAME TO "MilestoneSubmissionType";

COMMIT;
