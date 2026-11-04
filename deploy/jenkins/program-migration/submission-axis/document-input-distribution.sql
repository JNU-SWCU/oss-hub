BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH inputs AS (
  SELECT
    jsonb_typeof(submission."content"->'text') = 'string'
      AND btrim(submission."content"->>'text') <> '' AS has_text,
    EXISTS (
      SELECT 1
      FROM "SubmissionFile" file
      JOIN "MilestoneDocumentSubmissionHistory" history
        ON history."id" = file."milestoneDocumentSubmissionHistoryId"
      WHERE history."milestoneDocumentSubmissionId" = submission."id"
        AND history."revision" = submission."revision"
        AND history."event" IN ('SUBMITTED', 'RESUBMITTED')
        AND file."lifecycle" = 'ATTACHED'
    ) AS has_file
  FROM "MilestoneDocumentSubmission" submission
  JOIN "MilestoneDocument" requirement
    ON requirement."id" = submission."milestoneDocumentId"
  WHERE requirement."kind" = 'DOCUMENT'
)
SELECT json_build_object(
  'document_submissions', count(*),
  'text_only', count(*) FILTER (WHERE coalesce(has_text, false) AND NOT has_file),
  'file_only', count(*) FILTER (WHERE NOT coalesce(has_text, false) AND has_file),
  'both', count(*) FILTER (WHERE coalesce(has_text, false) AND has_file),
  'neither', count(*) FILTER (WHERE NOT coalesce(has_text, false) AND NOT has_file)
)
FROM inputs;

COMMIT;
