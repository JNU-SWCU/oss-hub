SELECT count(*)
FROM "MilestoneDocumentReviewHistory" review
JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = review."id"
JOIN "MilestoneDocumentSubmission" submission ON submission."id" = review."milestoneDocumentSubmissionId"
WHERE review."submissionHistoryId" IS NULL AND history."revision" IS NULL
  AND history."event" = 'APPROVED' AND submission."status" = 'APPROVED';
