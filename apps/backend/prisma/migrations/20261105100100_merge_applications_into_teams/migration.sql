BEGIN;
SET LOCAL TIME ZONE 'UTC';

LOCK TABLE "Application", "ApplicationReviewHistory", "Team", "TeamMember",
  "TeamInvitation", "TeamHistory", "AuditLog", "GithubRepository",
  "RepositoryProvisionJob", "RepositoryIssuanceHistory",
  "GithubRepositoryOutsiderContribution", "MilestoneDocumentSubmission",
  "SubmissionFile", "OutboxEvent", "Notification" IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA IF NOT EXISTS program_team_backup;
REVOKE ALL ON SCHEMA program_team_backup FROM PUBLIC;
CREATE TABLE program_team_backup.application_team_map (
  "applicationId" TEXT PRIMARY KEY,
  "teamId" TEXT NOT NULL UNIQUE,
  "programId" TEXT NOT NULL
);
REVOKE ALL ON program_team_backup.application_team_map FROM PUBLIC;

ALTER TABLE "Team"
  ADD COLUMN "answers" JSONB,
  ADD COLUMN "applicationTemplateVersion" INTEGER,
  ADD COLUMN "applicantId" TEXT,
  ADD COLUMN "status" "ApplicationStatus",
  ADD COLUMN "isRepositoryPublicationPlanned" BOOLEAN,
  ADD COLUMN "repositoryConnectionMode" "RepositoryConnectionMode",
  ADD COLUMN "repositoryUrl" TEXT,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "revision" INTEGER,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "processedById" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3);

ALTER TABLE "RepositoryProvisionJob" ADD COLUMN "teamId" TEXT;
ALTER TABLE "RepositoryIssuanceHistory" ADD COLUMN "teamId" TEXT;
ALTER TABLE "GithubRepositoryOutsiderContribution" ADD COLUMN "teamId" TEXT;
ALTER TABLE "MilestoneDocumentSubmission" ADD COLUMN "teamId" TEXT;
ALTER TABLE "SubmissionFile" ADD COLUMN "teamId" TEXT;

ALTER TABLE "TeamHistory" DROP CONSTRAINT "TeamHistory_invitation_data_check";
ALTER TABLE "TeamHistory" ADD CONSTRAINT "TeamHistory_event_data_check" CHECK (
  ("data"->>'schemaVersion' = '1' AND CASE
    WHEN event::TEXT IN ('INVITATION_ACCEPTED', 'INVITATION_DECLINED', 'INVITATION_CANCELLED', 'INVITATION_ARCHIVED') THEN
      jsonb_typeof(data->'invitation') = 'object'
      AND jsonb_typeof(data->'invitation'->'id') = 'string'
      AND jsonb_typeof(data->'invitation'->'inviteeId') = 'string'
      AND jsonb_typeof(data->'invitation'->'invitedById') = 'string'
      AND jsonb_typeof(data->'invitation'->'createdAt') = 'string'
    WHEN event::TEXT IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'REVERTED', 'RESUBMITTED') THEN
      CASE WHEN "sourceTable" = 'AuditLog' THEN jsonb_typeof(data->'metadata') = 'object'
      ELSE jsonb_typeof(data->'revision') = 'number'
        AND (data->>'revision')::INTEGER >= 1
        AND jsonb_typeof(data->'rejectionReason') IN ('null', 'string')
      END
    WHEN event::TEXT = 'REPOSITORY_URL_CHANGED' THEN
      jsonb_typeof(data->'metadata') = 'object'
      AND jsonb_typeof(data->'metadata'->'before') = 'object'
      AND jsonb_typeof(data->'metadata'->'after') = 'object'
    WHEN event::TEXT = 'DELETED' THEN
      jsonb_typeof(data->'name') = 'string'
      AND jsonb_typeof(data->'members') = 'array'
      AND jsonb_typeof(data->'deletedCounts') = 'object'
    WHEN event::TEXT IN ('MEMBER_LEFT', 'MEMBER_REMOVED') THEN
      jsonb_typeof(data->'name') = 'string'
      AND jsonb_typeof(data->'removedUserId') = 'string'
    WHEN event::TEXT = 'LEADER_TRANSFERRED' THEN
      jsonb_typeof(data->'previousLeaderId') = 'string'
      AND jsonb_typeof(data->'nextLeaderId') = 'string'
    WHEN event::TEXT = 'RENAMED' THEN
      jsonb_typeof(data->'previousName') = 'string'
      AND jsonb_typeof(data->'name') = 'string'
    ELSE FALSE
  END) IS TRUE
);

DO $$
DECLARE
  n BIGINT;
  applications BIGINT;
  paired BIGINT;
  copied BIGINT;
  audit_lifecycle BIGINT;
  audit_urls BIGINT;
  orphan_issuance BIGINT;
  orphan_outsiders BIGINT;
  deleted_teams BIGINT;
  deleted_members BIGINT;
  ref RECORD;
BEGIN
  SELECT count(*) INTO applications FROM "Application";
  IF applications = 0 AND NOT EXISTS (SELECT 1 FROM "Team")
     AND NOT EXISTS (SELECT 1 FROM "ApplicationReviewHistory")
     AND NOT EXISTS (SELECT 1 FROM "TeamHistory")
     AND NOT EXISTS (SELECT 1 FROM "RepositoryProvisionJob")
     AND NOT EXISTS (SELECT 1 FROM "RepositoryIssuanceHistory")
     AND NOT EXISTS (SELECT 1 FROM "GithubRepositoryOutsiderContribution")
     AND NOT EXISTS (SELECT 1 FROM "GithubRepository")
     AND NOT EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission")
     AND NOT EXISTS (SELECT 1 FROM "SubmissionFile")
     AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "aggregateType" = 'Application' OR payload ? 'applicationId')
     AND NOT EXISTS (SELECT 1 FROM "Notification" WHERE payload ? 'applicationId') THEN
    RAISE NOTICE 'TEAM_CUTOVER fresh copied=0 repointed=0 deleted=0';
    RETURN;
  END IF;

  IF applications <> 33
     OR (SELECT count(*) FROM "Team") <> 40
     OR (SELECT count(*) FROM "TeamMember") <> 72
     OR (SELECT count(*) FROM "TeamInvitation") <> 3
     OR (SELECT count(*) FROM "ApplicationReviewHistory") <> 9
     OR (SELECT count(*) FROM "TeamHistory") <> 25 THEN
    RAISE EXCEPTION 'Team cutover baseline count mismatch; expected applications/teams/members/invitations/reviews/histories=33/40/72/3/9/25';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Application" a
    LEFT JOIN "Team" t ON t.id = a."teamId" AND t."programId" = a."programId"
    WHERE t.id IS NULL
  ) OR EXISTS (
    SELECT "teamId" FROM "Application" GROUP BY "teamId" HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'Application to Team mapping is not one-to-one';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "GithubRepository" r
    LEFT JOIN "Application" a ON a.id = r."applicationId"
    WHERE a.id IS NULL OR r."teamId" IS DISTINCT FROM a."teamId"
      OR r."programId" IS DISTINCT FROM a."programId"
  ) THEN
    RAISE EXCEPTION 'Existing repository ownership differs from the application/team mapping';
  END IF;

  INSERT INTO program_team_backup.application_team_map
    SELECT id, "teamId", "programId" FROM "Application";
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 33 THEN RAISE EXCEPTION 'Team mapping copy count mismatch: %', copied; END IF;

  CREATE TEMP TABLE team_cutover_pairs ON COMMIT DROP AS
    SELECT h.id AS "reviewId", l.id AS "auditId"
    FROM "ApplicationReviewHistory" h
    JOIN "Application" a ON a.id = h."applicationId"
    JOIN "AuditLog" l
      ON l."targetType" = 'APPLICATION'
      AND l."targetId" = h."applicationId"
      AND l.action = 'APPLICATION_' || h."eventKind"::TEXT
      AND l."actorId" = h."actorId"
      AND abs(extract(epoch FROM l."occurredAt" - h."occurredAt")) <= 1;
  SELECT count(*) INTO paired FROM team_cutover_pairs;
  IF paired <> 9
     OR EXISTS (SELECT "reviewId" FROM team_cutover_pairs GROUP BY "reviewId" HAVING count(*) <> 1)
     OR EXISTS (SELECT "auditId" FROM team_cutover_pairs GROUP BY "auditId" HAVING count(*) <> 1) THEN
    RAISE EXCEPTION 'Application history pairing must be exactly 9 one-to-one pairs; found %', paired;
  END IF;

  SELECT count(*) FILTER (WHERE l.action <> 'APPLICATION_REPOSITORY_URL_CHANGED'),
         count(*) FILTER (WHERE l.action = 'APPLICATION_REPOSITORY_URL_CHANGED')
    INTO audit_lifecycle, audit_urls
  FROM "AuditLog" l
  JOIN "Application" a ON a.id = l."targetId"
  WHERE l."targetType" = 'APPLICATION';
  IF audit_lifecycle <> 71 OR audit_urls <> 2 OR EXISTS (
    SELECT 1 FROM "AuditLog" l JOIN "Application" a ON a.id = l."targetId"
    WHERE l."targetType" = 'APPLICATION' AND l.action NOT IN (
      'APPLICATION_APPROVED', 'APPLICATION_REJECTED', 'APPLICATION_REVERTED',
      'APPLICATION_SUBMITTED', 'APPLICATION_RESUBMITTED', 'APPLICATION_REPOSITORY_URL_CHANGED'
    )
  ) THEN
    RAISE EXCEPTION 'Live application audit count mismatch: lifecycle=% urls=%; expected 71/2', audit_lifecycle, audit_urls;
  END IF;

  INSERT INTO "TeamHistory" (
    id, "teamId", "programId", "actorId", event, "occurredAt", source,
    "sourceTable", "sourceId", data
  )
  SELECT 'application-review:' || h.id, a."teamId", a."programId",
    h."actorId", h."eventKind"::TEXT::"TeamHistoryEvent", h."occurredAt",
    'MIGRATION', 'ApplicationReviewHistory', h.id,
    jsonb_build_object(
      'schemaVersion', 1, 'revision', h.revision, 'rejectionReason', h."rejectionReason",
      'applicationId', a.id, 'pairedAuditId', p."auditId",
      'pairedAuditOccurredAt', l."occurredAt", 'pairedAuditMetadata', l.metadata
    )
  FROM "ApplicationReviewHistory" h
  JOIN "Application" a ON a.id = h."applicationId"
  JOIN team_cutover_pairs p ON p."reviewId" = h.id
  JOIN "AuditLog" l ON l.id = p."auditId";
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 9 THEN RAISE EXCEPTION 'Review history copy count mismatch: %', copied; END IF;
  RAISE NOTICE 'TEAM_CUTOVER ApplicationReviewHistory copied=% paired=%', copied, paired;

  INSERT INTO "TeamHistory" (
    id, "teamId", "programId", "actorId", event, "occurredAt", source,
    "sourceTable", "sourceId", data
  )
  SELECT 'application-audit:' || l.id, a."teamId", a."programId", l."actorId",
    substring(l.action FROM 13)::"TeamHistoryEvent", l."occurredAt",
    'MIGRATION', 'AuditLog', l.id,
    jsonb_build_object('schemaVersion', 1, 'applicationId', a.id, 'metadata', l.metadata)
  FROM "AuditLog" l
  JOIN "Application" a ON a.id = l."targetId"
  WHERE l."targetType" = 'APPLICATION'
    AND NOT EXISTS (SELECT 1 FROM team_cutover_pairs p WHERE p."auditId" = l.id);
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 64 THEN RAISE EXCEPTION 'Audit history copy count mismatch: %; expected 62 lifecycle + 2 URL', copied; END IF;
  RAISE NOTICE 'TEAM_CUTOVER AuditLog lifecycle_copied=62 url_copied=2';

  IF (SELECT count(*) FROM "TeamHistory" WHERE "sourceTable" IN ('ApplicationReviewHistory','AuditLog')
      AND id LIKE 'application-%') <> 73 THEN
    RAISE EXCEPTION 'Application history total mismatch; expected 73';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ApplicationReviewHistory" h
    JOIN "Application" a ON a.id = h."applicationId"
    LEFT JOIN "TeamHistory" t ON t."sourceTable" = 'ApplicationReviewHistory' AND t."sourceId" = h.id
    WHERE t.id IS NULL OR t."teamId" IS DISTINCT FROM a."teamId"
      OR t."actorId" IS DISTINCT FROM h."actorId"
      OR t."occurredAt" IS DISTINCT FROM h."occurredAt"
      OR t.event::TEXT IS DISTINCT FROM h."eventKind"::TEXT
      OR (t.data->>'revision')::INTEGER IS DISTINCT FROM h.revision
      OR t.data->>'rejectionReason' IS DISTINCT FROM h."rejectionReason"
  ) OR EXISTS (
    SELECT 1 FROM "AuditLog" l
    JOIN "Application" a ON a.id = l."targetId"
    LEFT JOIN "TeamHistory" t ON
      (t."sourceTable" = 'AuditLog' AND t."sourceId" = l.id)
      OR (t."sourceTable" = 'ApplicationReviewHistory' AND t.data->>'pairedAuditId' = l.id)
    WHERE l."targetType" = 'APPLICATION' AND (
      t.id IS NULL OR t."teamId" IS DISTINCT FROM a."teamId"
      OR t."actorId" IS DISTINCT FROM l."actorId"
      OR t.event::TEXT IS DISTINCT FROM substring(l.action FROM 13)
      OR CASE WHEN t."sourceTable" = 'AuditLog' THEN
        t."occurredAt" IS DISTINCT FROM l."occurredAt" OR t.data->'metadata' IS DISTINCT FROM l.metadata
      ELSE t.data->'pairedAuditMetadata' IS DISTINCT FROM l.metadata END
    )
  ) THEN
    RAISE EXCEPTION 'Application history reconcile mismatch';
  END IF;

  UPDATE "Team" t SET
    answers = a.answers, "applicationTemplateVersion" = a."applicationTemplateVersion",
    "applicantId" = a."applicantId", status = a.status,
    "isRepositoryPublicationPlanned" = a."isRepositoryPublicationPlanned",
    "repositoryConnectionMode" = a."repositoryConnectionMode",
    "repositoryUrl" = a."repositoryUrl", "rejectionReason" = a."rejectionReason",
    revision = a.revision, "submittedAt" = a."submittedAt",
    "processedById" = a."processedById", "processedAt" = a."processedAt"
  FROM "Application" a WHERE a."teamId" = t.id;
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 33 THEN RAISE EXCEPTION 'Application fields copy count mismatch: %', copied; END IF;

  FOR ref IN SELECT * FROM (VALUES
    ('RepositoryProvisionJob', 7),
    ('RepositoryIssuanceHistory', 0),
    ('GithubRepositoryOutsiderContribution', 3),
    ('MilestoneDocumentSubmission', 55),
    ('SubmissionFile', 76),
    ('GithubRepository', 7)
  ) AS counts("tableName", expected) LOOP
    EXECUTE format('SELECT count(*) FROM %I r WHERE r."applicationId" IS NOT NULL', ref."tableName") INTO n;
    IF n <> ref.expected THEN
      RAISE EXCEPTION 'Team reference baseline mismatch for %: actual=% expected=%', ref."tableName", n, ref.expected;
    END IF;
    EXECUTE format(
      'UPDATE %I r SET "teamId" = m."teamId" FROM program_team_backup.application_team_map m WHERE r."applicationId" = m."applicationId"',
      ref."tableName"
    );
    GET DIAGNOSTICS copied = ROW_COUNT;
    IF copied <> ref.expected THEN
      RAISE EXCEPTION 'Team reference copy mismatch for %: actual=% expected=%', ref."tableName", copied, ref.expected;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM %I r JOIN program_team_backup.application_team_map m ON m."applicationId" = r."applicationId" WHERE r."teamId" IS DISTINCT FROM m."teamId"',
      ref."tableName"
    ) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'Team reference reconcile mismatch for %', ref."tableName"; END IF;
    RAISE NOTICE 'TEAM_CUTOVER % repointed=% reconcile=0', ref."tableName", copied;
  END LOOP;

  SELECT count(*) INTO orphan_issuance FROM "RepositoryIssuanceHistory" WHERE "teamId" IS NULL;
  SELECT count(*) INTO orphan_outsiders FROM "GithubRepositoryOutsiderContribution" WHERE "teamId" IS NULL;
  IF orphan_issuance <> 0 OR orphan_outsiders <> 0 THEN
    RAISE EXCEPTION 'Orphan deletion count mismatch: issuance=% outsider=%; approved 0/0', orphan_issuance, orphan_outsiders;
  END IF;

  IF (SELECT count(*) FROM "Notification" WHERE payload ? 'applicationId') <> 56
     OR (SELECT count(*) FROM "OutboxEvent" WHERE payload ? 'applicationId') <> 5 THEN
    RAISE EXCEPTION 'Notification/outbox baseline mismatch; expected 56/5';
  END IF;
  UPDATE "Notification" n
  SET payload = (n.payload - 'applicationId') || jsonb_build_object('teamId', m."teamId"),
      "idempotencyKey" = replace(n."idempotencyKey", m."applicationId", m."teamId")
  FROM program_team_backup.application_team_map m
  WHERE n.payload->>'applicationId' = m."applicationId";
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 56 THEN RAISE EXCEPTION 'Notification copy count mismatch: %', copied; END IF;
  RAISE NOTICE 'TEAM_CUTOVER Notification repointed=%', copied;

  UPDATE "OutboxEvent" e
  SET payload = (e.payload - 'applicationId') || jsonb_build_object('teamId', m."teamId"),
      "aggregateType" = 'Team', "aggregateId" = m."teamId",
      "idempotencyKey" = replace(e."idempotencyKey", m."applicationId", m."teamId")
  FROM program_team_backup.application_team_map m
  WHERE e.payload->>'applicationId' = m."applicationId"
    AND e."aggregateType" = 'Application' AND e."aggregateId" = m."applicationId"
    AND (NOT e.payload ? 'teamId' OR e.payload->>'teamId' = m."teamId");
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 5 THEN RAISE EXCEPTION 'Outbox copy count mismatch: %', copied; END IF;
  RAISE NOTICE 'TEAM_CUTOVER OutboxEvent repointed=%', copied;
  IF EXISTS (SELECT 1 FROM "Notification" WHERE payload ? 'applicationId')
     OR EXISTS (SELECT 1 FROM "OutboxEvent" WHERE payload ? 'applicationId' OR "aggregateType" = 'Application') THEN
    RAISE EXCEPTION 'Application JSON references remain after team cutover';
  END IF;

  CREATE TEMP TABLE team_cutover_deleted ON COMMIT DROP AS
    SELECT t.* FROM "Team" t WHERE NOT EXISTS (
      SELECT 1 FROM "Application" a WHERE a."teamId" = t.id
    );
  IF (SELECT count(*) FROM team_cutover_deleted) <> 7
     OR (SELECT count(*) FROM "TeamMember" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted)) <> 7
     OR EXISTS (SELECT 1 FROM "TeamInvitation" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted))
     OR EXISTS (SELECT 1 FROM "GithubRepository" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted))
     OR EXISTS (SELECT 1 FROM "MilestoneDocumentSubmission" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted))
     OR EXISTS (SELECT 1 FROM "SubmissionFile" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted)) THEN
    RAISE EXCEPTION 'Applicationless team deletion scope mismatch; expected 7 teams/7 members/no dependencies';
  END IF;
  INSERT INTO "TeamHistory" (
    id, "teamId", "programId", event, source, "sourceTable", "sourceId", data
  )
  SELECT 'applicationless-team:' || t.id, t.id, t."programId", 'DELETED',
    'MIGRATION', 'Team', t.id,
    jsonb_build_object(
      'schemaVersion', 1, 'reason', 'APPLICATIONLESS_TEAM', 'name', t.name,
      'leaderId', t."leaderId", 'createdAt', t."createdAt",
      'members', (
        SELECT jsonb_agg(jsonb_build_object('userId', m."userId", 'name', u.name, 'nickname', u.login) ORDER BY m."userId")
        FROM "TeamMember" m JOIN "User" u ON u.id = m."userId" WHERE m."teamId" = t.id
      ),
      'deletedCounts', jsonb_build_object('teams', 1, 'members', 1, 'invitations', 0, 'submissions', 0, 'repositories', 0)
    )
  FROM team_cutover_deleted t;
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> 7 THEN RAISE EXCEPTION 'Deleted team history count mismatch: %', copied; END IF;
  DELETE FROM "TeamMember" WHERE "teamId" IN (SELECT id FROM team_cutover_deleted);
  GET DIAGNOSTICS deleted_members = ROW_COUNT;
  DELETE FROM "Team" WHERE id IN (SELECT id FROM team_cutover_deleted);
  GET DIAGNOSTICS deleted_teams = ROW_COUNT;
  IF deleted_members <> 7 OR deleted_teams <> 7 THEN
    RAISE EXCEPTION 'Deleted team/member count mismatch: %/%', deleted_teams, deleted_members;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Application" a JOIN "Team" t ON t.id = a."teamId"
    WHERE ROW(t.answers, t."applicationTemplateVersion", t."applicantId", t.status,
      t."isRepositoryPublicationPlanned", t."repositoryConnectionMode", t."repositoryUrl",
      t."rejectionReason", t.revision, t."submittedAt", t."processedById", t."processedAt")
      IS DISTINCT FROM ROW(a.answers, a."applicationTemplateVersion", a."applicantId", a.status,
      a."isRepositoryPublicationPlanned", a."repositoryConnectionMode", a."repositoryUrl",
      a."rejectionReason", a.revision, a."submittedAt", a."processedById", a."processedAt")
  ) OR (SELECT count(*) FROM "Team") <> 33 THEN
    RAISE EXCEPTION 'Application to Team field reconciliation failed';
  END IF;
  IF (SELECT count(*) FROM "TeamHistory") <> 105 THEN
    RAISE EXCEPTION 'Team history final total mismatch; expected 105';
  END IF;
  RAISE NOTICE 'TEAM_CUTOVER Team copied=33 deleted=7 TeamMember deleted=7 TeamHistory inserted=80 application_history=73 reconcile=0';
END $$;

ALTER TABLE "Application" DROP CONSTRAINT "Application_teamId_fkey";
ALTER TABLE "RepositoryProvisionJob" ALTER COLUMN "applicationId" DROP NOT NULL;
ALTER TABLE "RepositoryIssuanceHistory" ALTER COLUMN "applicationId" DROP NOT NULL;
ALTER TABLE "GithubRepositoryOutsiderContribution" ALTER COLUMN "applicationId" DROP NOT NULL;
ALTER TABLE "MilestoneDocumentSubmission" ALTER COLUMN "applicationId" DROP NOT NULL;

ALTER TABLE "SubmissionFile" DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check";
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
  (lifecycle = 'PENDING' AND "teamId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND "milestoneDocumentSubmissionId" IS NULL AND "milestoneDocumentSubmissionHistoryId" IS NULL
    AND "pendingExpiresAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
  OR (lifecycle = 'ATTACHED' AND "teamId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND "milestoneDocumentSubmissionId" IS NOT NULL AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
    AND "pendingExpiresAt" IS NULL)
  OR lifecycle IN ('DELETE_PENDING', 'DELETED')
);

ALTER TABLE "Team"
  ALTER COLUMN status SET DEFAULT 'SUBMITTED',
  ALTER COLUMN revision SET DEFAULT 1,
  ALTER COLUMN "submittedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "isRepositoryPublicationPlanned" SET DEFAULT TRUE,
  ALTER COLUMN "repositoryConnectionMode" SET DEFAULT 'NEW',
  ADD CONSTRAINT "Team_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Team_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RepositoryProvisionJob"
  ADD CONSTRAINT "RepositoryProvisionJob_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneDocumentSubmission"
  ADD CONSTRAINT "MilestoneDocumentSubmission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "RepositoryProvisionJob_teamId_key" ON "RepositoryProvisionJob"("teamId");
CREATE UNIQUE INDEX "MilestoneDocumentSubmission_milestoneDocumentId_teamId_key" ON "MilestoneDocumentSubmission"("milestoneDocumentId", "teamId");
CREATE INDEX "MilestoneDocumentSubmission_teamId_idx" ON "MilestoneDocumentSubmission"("teamId");
CREATE INDEX "SubmissionFile_teamId_milestoneId_lifecycle_idx" ON "SubmissionFile"("teamId", "milestoneId", lifecycle);
CREATE INDEX "RepositoryIssuanceHistory_teamId_idx" ON "RepositoryIssuanceHistory"("teamId");
CREATE INDEX "Team_applicantId_idx" ON "Team"("applicantId");
CREATE INDEX "Team_programId_status_submittedAt_idx" ON "Team"("programId", status, "submittedAt");

COMMIT;
