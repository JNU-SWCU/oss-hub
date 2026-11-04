BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH changes AS (
  SELECT review."milestoneDocumentSubmissionId" AS submission_id,
    revision."revision", review."resubmissionDueAt"
  FROM "MilestoneDocumentReviewHistory" review
  JOIN "MilestoneDocumentSubmission" submission
    ON submission."id" = review."milestoneDocumentSubmissionId"
  JOIN "MilestoneDocument" requirement
    ON requirement."id" = submission."milestoneDocumentId"
  LEFT JOIN "MilestoneDocumentSubmissionHistory" revision
    ON revision."id" = review."submissionHistoryId"
  WHERE requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
    AND review."decision" = 'CHANGES_REQUESTED'
)
SELECT json_build_object(
  'legacy_requirements', (
    SELECT count(*) FROM "MilestoneDocument"
    WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION'
  ),
  'changes_requested_reviews', count(*),
  'known_revisions', count(DISTINCT (submission_id, "revision"))
    FILTER (WHERE "revision" IS NOT NULL),
  'null_deadline_reviews', count(*) FILTER (WHERE "resubmissionDueAt" IS NULL),
  'null_deadline_revisions', count(DISTINCT (submission_id, "revision"))
    FILTER (WHERE "resubmissionDueAt" IS NULL AND "revision" IS NOT NULL),
  'unknown_revision_reviews', count(*) FILTER (WHERE "revision" IS NULL)
)
FROM changes;

COMMIT;
