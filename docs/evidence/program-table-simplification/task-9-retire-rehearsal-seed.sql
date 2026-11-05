-- Synthetic pre-cutover shape of the production counts, seeded on the real migrated schema.
-- Every value is generated; no production data is copied here.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO "User" (id, "githubId", login, "updatedAt")
  SELECT 'user-' || n, n, 'synthetic-' || n, now() FROM generate_series(1,72) n;
INSERT INTO "Program" (id, name, description, organizer, category, "applicationTemplateKey",
    "applicationTemplateVersion", "applicationStartAt", "applicationEndAt", "startAt", "endAt", "updatedAt")
  VALUES ('program', 'Synthetic program', 'Synthetic', 'Synthetic', 'BASIC', 'synthetic', 2,
    '2026-07-01', '2026-07-31', '2026-08-01', '2026-12-31', now());
INSERT INTO "Team" (id, "programId", name, "leaderId", "updatedAt")
  SELECT 'team-' || n, 'program', 'Synthetic team ' || n, 'user-' || n, now() FROM generate_series(1,40) n;
INSERT INTO "TeamMember" ("programId", "teamId", "userId")
  SELECT 'program', 'team-' || CASE WHEN n <= 40 THEN n ELSE n - 40 END, 'user-' || n FROM generate_series(1,72) n;
INSERT INTO "TeamInvitation" (id, "programId", "teamId", "invitedById", "inviteeId", "updatedAt")
  SELECT 'invitation-' || n, 'program', 'team-1', 'user-1', 'user-' || (n + 10), now() FROM generate_series(1,3) n;
INSERT INTO "Application" (id, "programId", "teamId", "applicantId", answers, "applicationTemplateVersion",
    status, "isRepositoryPublicationPlanned", "repositoryConnectionMode", "repositoryUrl", "rejectionReason",
    revision, "submittedAt", "processedById", "processedAt", "updatedAt")
  SELECT 'application-' || n, 'program', 'team-' || n, 'user-' || n,
    jsonb_build_object('title', 'Synthetic answer ' || n), 2,
    (CASE WHEN n <= 30 THEN 'APPROVED' ELSE 'REJECTED' END)::"ApplicationStatus",
    TRUE, 'NEW', NULL, CASE WHEN n > 30 THEN 'Preserved reason' END,
    1, TIMESTAMP '2026-08-01' + n * INTERVAL '1 second', 'user-72', TIMESTAMP '2026-08-02', now()
  FROM generate_series(1,33) n;
INSERT INTO "ApplicationReviewHistory" (id, "applicationId", "eventKind", revision, "actorId", "occurredAt")
  SELECT 'review-approved-' || n, 'application-' || n, 'APPROVED', 1, 'user-72',
    TIMESTAMP '2026-08-02' + n * INTERVAL '1 second' FROM generate_series(1,5) n;
INSERT INTO "ApplicationReviewHistory" (id, "applicationId", "eventKind", revision, "actorId", "occurredAt")
  SELECT 'review-submitted-' || n, 'application-' || n, 'SUBMITTED', 1, 'user-72',
    TIMESTAMP '2026-08-01' + n * INTERVAL '1 second' FROM generate_series(1,4) n;
INSERT INTO "AuditLog" (id, "targetType", "targetId", action, "actorId", "occurredAt", metadata)
  SELECT 'audit-approved-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_APPROVED', 'user-72',
    TIMESTAMP '2026-08-02' + n * INTERVAL '1 second' + INTERVAL '4 milliseconds', '{}'::JSONB
  FROM generate_series(1,33) n;
INSERT INTO "AuditLog" (id, "targetType", "targetId", action, "actorId", "occurredAt", metadata)
  SELECT 'audit-submitted-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_SUBMITTED', 'user-72',
    TIMESTAMP '2026-08-01' + n * INTERVAL '1 second' + INTERVAL '4 milliseconds', '{}'::JSONB
  FROM generate_series(1,30) n;
INSERT INTO "AuditLog" (id, "targetType", "targetId", action, "actorId", "occurredAt", metadata)
  SELECT 'audit-' || kind || '-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_' || kind, 'user-72',
    TIMESTAMP '2026-08-03', '{}'::JSONB
  FROM generate_series(10,13) n CROSS JOIN (VALUES ('REJECTED'), ('REVERTED')) kinds(kind);
INSERT INTO "AuditLog" (id, "targetType", "targetId", action, "actorId", "occurredAt", metadata)
  SELECT 'audit-url-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_REPOSITORY_URL_CHANGED', 'user-72',
    TIMESTAMP '2026-08-04',
    '{"before":{"repositoryUrl":null},"after":{"repositoryUrl":"https://github.com/synthetic/repository"}}'::JSONB
  FROM generate_series(1,2) n;
INSERT INTO "TeamHistory" (id, "teamId", "programId", event, source, "sourceTable", "sourceId", data)
  SELECT 'prior-history-' || n, 'team-1', 'program', 'INVITATION_ARCHIVED', 'MIGRATION', 'TeamInvitation',
    'prior-invitation-' || n, jsonb_build_object('schemaVersion', 1, 'invitation', jsonb_build_object(
      'id', 'prior-invitation-' || n, 'inviteeId', 'user-1', 'invitedById', 'user-2',
      'createdAt', '2026-08-01T00:00:00.000Z'))
  FROM generate_series(1,25) n;
INSERT INTO "GithubRepository" (id, "githubRepositoryId", "nameWithOwner", source, "applicationId", "teamId", "programId", "updatedAt")
  SELECT 'repository-' || n, n, 'synthetic/repository-' || n, 'ORG_PROVISIONED', 'application-' || n, 'team-' || n, 'program', now()
  FROM generate_series(1,7) n;
INSERT INTO "RepositoryProvisionJob" (id, "applicationId", "updatedAt")
  SELECT 'job-' || n, 'application-' || n, now() FROM generate_series(1,7) n;
INSERT INTO "GithubRepositoryOutsiderContribution" ("repositoryId", "applicationId", "programId", "commitCount",
    "issueCount", "pullRequestCount", "observedAt", "windowStartAt", "windowEndAt")
  SELECT 'repository-' || n, 'application-' || n, 'program', 1, 0, 0, TIMESTAMP '2026-08-05', TIMESTAMP '2026-08-01', TIMESTAMP '2026-08-05'
  FROM generate_series(1,3) n;
INSERT INTO "Milestone" (id, name, "programId", "startAt", "dueAt", "updatedAt")
  VALUES ('milestone', 'Synthetic milestone', 'program', '2026-08-01', '2026-09-01', now());
INSERT INTO "MilestoneDocument" (id, "milestoneId", name, required, "sortOrder", "updatedAt")
  SELECT 'document-' || n, 'milestone', 'Synthetic document ' || n, FALSE, n, now() FROM generate_series(1,55) n;
INSERT INTO "MilestoneDocumentSubmission" (id, "applicationId", "milestoneDocumentId", "submittedById", "updatedAt")
  SELECT 'submission-' || n, 'application-' || (1 + (n % 33)), 'document-' || n, 'user-1', now() FROM generate_series(1,55) n;
INSERT INTO "SubmissionFile" (id, "applicationId", lifecycle, "mimeType", "originalFileName", "sizeBytes", "storageKey", "uploaderId")
  SELECT 'file-' || n, CASE WHEN n <= 76 THEN 'application-' || (1 + (n % 33)) END, 'DELETE_PENDING',
    'application/pdf', 'synthetic-' || n || '.pdf', 1024, 'synthetic/file-' || n, 'user-1'
  FROM generate_series(1,81) n;
INSERT INTO "Notification" (id, channel, payload, status, type, "userId", "idempotencyKey")
  SELECT 'notification-' || n, 'EMAIL', jsonb_build_object('applicationId', 'application-' || (1 + (n % 33))), 'PENDING',
    'APPLICATION_DECISION', 'user-1', 'application-decision:application-' || (1 + (n % 33)) || ':' || n
  FROM generate_series(1,56) n;
INSERT INTO "OutboxEvent" (id, "aggregateId", "aggregateType", "idempotencyKey", payload, type, "updatedAt")
  SELECT 'event-' || n, 'application-' || n, 'Application', 'repository-provision:application-' || n,
    jsonb_build_object('applicationId', 'application-' || n, 'teamId', 'team-' || n), 'REPOSITORY_PROVISION', now()
  FROM generate_series(1,5) n;
COMMIT;
