SELECT
  (SELECT count(*) FROM "MilestoneDocumentSubmission" source
   JOIN "MilestoneDocumentSubmission" target
     ON target."id" = source."legacySubmissionId" AND target."id" <> source."id")
  +
  (SELECT count(*) FROM "MilestoneDocument" requirement
   JOIN "Milestone" milestone ON milestone."id" = requirement."milestoneId"
   WHERE requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
     AND milestone."submissionType" IS NULL)
  +
  (SELECT count(*) FROM "MilestoneDocumentReviewHistory" review
   WHERE 1 <> (
     SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" history
     WHERE history."milestoneDocumentSubmissionId" = review."milestoneDocumentSubmissionId"
       AND history."event"::text = review."decision"::text
       AND history."actorId" = review."reviewerId"
       AND history."createdAt" = review."reviewedAt"
       AND history."comment" IS NOT DISTINCT FROM review."comment"
   ))
  +
  (SELECT count(*) FROM "SubmissionFile" file
   JOIN "Milestone" milestone ON milestone."id" = file."milestoneId"
   WHERE file."lifecycle" = 'PENDING' AND milestone."submissionType" IS NOT NULL
     AND (
       milestone."submissionType" <> 'FILE'
       OR EXISTS (
         SELECT 1 FROM "MilestoneDocument" requirement
         WHERE requirement."milestoneId" = milestone."id" AND requirement."kind" = 'DOCUMENT'
       )
     ));
