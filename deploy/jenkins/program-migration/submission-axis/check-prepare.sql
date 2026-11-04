SELECT
  (SELECT count(*) FROM "MilestoneDocumentSubmission"
   WHERE "legacySubmissionId" IS NOT NULL AND "id" <> "legacySubmissionId")
  +
  (SELECT count(*) FROM "Milestone" milestone
   WHERE milestone."submissionType" IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM "MilestoneDocument" requirement
     WHERE requirement."milestoneId" = milestone."id"
       AND requirement."kind" = 'LEGACY_MILESTONE_SUBMISSION'
       AND requirement."submissionType"::text = milestone."submissionType"::text
   ))
  +
  (SELECT count(*) FROM "MilestoneDocument"
   WHERE "kind" = 'DOCUMENT' AND "submissionType" <> 'FILE_OR_TEXT')
  +
  (SELECT count(*) FROM "MilestoneDocumentReviewHistory" review
   LEFT JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
   WHERE history."id" IS NULL
     OR history."milestoneDocumentSubmissionId" <> review."milestoneDocumentSubmissionId"
     OR history."event"::text <> review."decision"::text
     OR history."actorId" <> review."reviewerId"
     OR history."createdAt" <> review."reviewedAt"
     OR history."comment" IS DISTINCT FROM review."comment")
  +
  (SELECT count(*) FROM "SubmissionFile" file
   JOIN "Milestone" milestone ON milestone."id" = file."milestoneId"
   WHERE file."lifecycle" = 'PENDING' AND milestone."submissionType" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "MilestoneDocument" requirement
       WHERE requirement."id" = file."milestoneDocumentId"
         AND requirement."milestoneId" = milestone."id"
     ));
