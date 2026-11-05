SELECT
  (SELECT count(*)
   FROM "MilestoneDocumentReviewHistory" review
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
         revision."milestoneDocumentSubmissionId" <> review."milestoneDocumentSubmissionId"))
  +
  abs((SELECT count(*)
       FROM "MilestoneDocumentReviewHistory" review
       JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
       JOIN "MilestoneDocumentSubmission" submission ON submission."id" = review."milestoneDocumentSubmissionId"
       WHERE review."submissionHistoryId" IS NULL AND history."revision" IS NULL
         AND history."event" = 'APPROVED' AND submission."status" = 'APPROVED')
      - CASE WHEN EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission") THEN 1 ELSE 0 END)
  +
  abs((SELECT count(*) FROM "MilestoneDocumentSubmissionHistory"
       WHERE "revision" IS NULL AND "event" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
      - CASE WHEN EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission") THEN 1 ELSE 0 END)
  +
  (SELECT count(*) FROM "MilestoneDocumentSubmission"
   WHERE "legacySubmissionId" IS NOT NULL AND "id" <> "legacySubmissionId")
  +
  (SELECT count(*) FROM "MilestoneDocument" WHERE "kind" <> 'DOCUMENT')
  +
  abs((SELECT count(*) FROM pg_constraint
       WHERE conrelid = '"MilestoneDocument"'::regclass
         AND conname = 'MilestoneDocument_retired_legacy_kind_check'
         AND convalidated) - 1);
