SELECT
  CASE WHEN to_regclass('"MilestoneDocumentReviewHistory"') IS NULL THEN 0 ELSE 1 END
  +
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = current_schema() AND (
     (table_name = 'Milestone' AND column_name = 'submissionType')
     OR (table_name = 'MilestoneDocument' AND column_name = 'kind')
     OR (table_name = 'MilestoneDocumentSubmission' AND column_name = 'legacySubmissionId')
   ))
  +
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = '"MilestoneDocument"'::regclass
     AND conname = 'MilestoneDocument_retired_legacy_kind_check')
  +
  abs((SELECT count(*) FROM "MilestoneDocumentSubmissionHistory"
       WHERE "revision" IS NULL AND "event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
      - CASE WHEN EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission") THEN 1 ELSE 0 END)
  +
  abs((SELECT count(*)
       FROM "MilestoneDocumentSubmissionHistory" history
       JOIN "MilestoneDocumentSubmission" submission
         ON submission."id" = history."milestoneDocumentSubmissionId"
       WHERE history."revision" IS NULL AND history."event" = 'APPROVED'
         AND submission."status" = 'APPROVED')
      - CASE WHEN EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission") THEN 1 ELSE 0 END);
