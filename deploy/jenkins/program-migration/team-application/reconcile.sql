WITH checks AS (
  SELECT (SELECT count(*) FROM "Team") <> 33 AS mismatch
  UNION ALL SELECT (SELECT count(*) FROM "Application") <> 33
  UNION ALL SELECT (SELECT count(*) FROM "TeamMember") <> 65
  UNION ALL SELECT (SELECT count(*) FROM "TeamInvitation") <> 3
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-review:%') <> 9
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-audit:%'
    AND event <> 'REPOSITORY_URL_CHANGED') <> 62
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-audit:%'
    AND event = 'REPOSITORY_URL_CHANGED') <> 2
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'applicationless-team:%') <> 7
  UNION ALL SELECT (SELECT count(DISTINCT data->>'pairedAuditId') FROM "TeamHistory"
    WHERE "sourceTable" = 'ApplicationReviewHistory') <> 9
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "Application" a
    LEFT JOIN "Team" t ON t.id = a."teamId"
    WHERE t.id IS NULL OR ROW(
      t.answers, t."applicationTemplateVersion", t."applicantId", t.status,
      t."isRepositoryPublicationPlanned", t."repositoryConnectionMode",
      t."repositoryUrl", t."rejectionReason", t.revision, t."submittedAt",
      t."processedById", t."processedAt"
    ) IS DISTINCT FROM ROW(
      a.answers, a."applicationTemplateVersion", a."applicantId", a.status,
      a."isRepositoryPublicationPlanned", a."repositoryConnectionMode",
      a."repositoryUrl", a."rejectionReason", a.revision, a."submittedAt",
      a."processedById", a."processedAt"
    )
  )
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "ApplicationReviewHistory" r
    LEFT JOIN "TeamHistory" h ON h."sourceTable" = 'ApplicationReviewHistory' AND h."sourceId" = r.id
    WHERE h.id IS NULL OR h."occurredAt" <> r."occurredAt" OR h."actorId" <> r."actorId"
  )
  UNION ALL SELECT EXISTS (SELECT 1 FROM "Notification" WHERE payload ? 'applicationId')
  UNION ALL SELECT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE payload ? 'applicationId' OR "aggregateType" = 'Application')
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "MilestoneDocumentSubmission" s JOIN "Application" a ON a.id = s."applicationId"
    WHERE s."teamId" IS DISTINCT FROM a."teamId"
  )
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "SubmissionFile" f JOIN "Application" a ON a.id = f."applicationId"
    WHERE f."teamId" IS DISTINCT FROM a."teamId"
  )
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "RepositoryProvisionJob" j JOIN "Application" a ON a.id = j."applicationId"
    WHERE j."teamId" IS DISTINCT FROM a."teamId"
  )
)
SELECT count(*) FROM checks WHERE mismatch;
