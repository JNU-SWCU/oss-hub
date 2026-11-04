BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT json_build_object(
  'legacy_submission_ids', (
    SELECT count(*) FROM "MilestoneDocumentSubmission"
    WHERE "legacySubmissionId" IS NOT NULL
  ),
  'public_id_collisions', (
    SELECT count(*)
    FROM "MilestoneDocumentSubmission" source
    JOIN "MilestoneDocumentSubmission" target
      ON target."id" = source."legacySubmissionId"
      AND target."id" <> source."id"
  ),
  'legacy_requirements', (
    SELECT count(*) FROM "MilestoneDocument"
    WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION'
  ),
  'typed_milestones_without_legacy_requirement', (
    SELECT count(*) FROM "Milestone" milestone
    WHERE milestone."submissionType" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "MilestoneDocument" requirement
        WHERE requirement."milestoneId" = milestone."id"
          AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
      )
  ),
  'legacy_requirements_without_type', (
    SELECT count(*) FROM "MilestoneDocument" requirement
    JOIN "Milestone" milestone ON milestone."id" = requirement."milestoneId"
    WHERE requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
      AND milestone."submissionType" IS NULL
  ),
  'review_rows', (SELECT count(*) FROM "MilestoneDocumentReviewHistory"),
  'review_event_rows', (
    SELECT count(*) FROM "MilestoneDocumentSubmissionHistory"
    WHERE "event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
  ),
  'review_event_match_counts', (
    SELECT json_agg(row_to_json(summary))
    FROM (
      SELECT matches, count(*) AS reviews
      FROM (
        SELECT (
          SELECT count(*)
          FROM "MilestoneDocumentSubmissionHistory" history
          WHERE history."milestoneDocumentSubmissionId" = review."milestoneDocumentSubmissionId"
            AND history."event"::text = review."decision"::text
            AND history."actorId" = review."reviewerId"
            AND history."createdAt" = review."reviewedAt"
            AND history."comment" IS NOT DISTINCT FROM review."comment"
        ) AS matches
        FROM "MilestoneDocumentReviewHistory" review
      ) matched
      GROUP BY matches ORDER BY matches
    ) summary
  ),
  'pending_legacy_files', (
    SELECT count(*) FROM "SubmissionFile" file
    JOIN "Milestone" milestone ON milestone."id" = file."milestoneId"
    WHERE file."lifecycle" = 'PENDING'
      AND milestone."submissionType" IS NOT NULL
  ),
  'non_cascading_submission_foreign_keys', (
    SELECT count(*) FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = '"MilestoneDocumentSubmission"'::regclass
      AND confupdtype <> 'c'
  )
);

COMMIT;
