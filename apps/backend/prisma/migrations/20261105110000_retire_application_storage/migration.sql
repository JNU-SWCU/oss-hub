BEGIN;
SET LOCAL TIME ZONE 'UTC';

LOCK TABLE "Application", "ApplicationReviewHistory", "Team", "TeamHistory",
  "GithubRepository", "RepositoryProvisionJob", "RepositoryIssuanceHistory",
  "GithubRepositoryOutsiderContribution", "MilestoneDocumentSubmission",
  "SubmissionFile", "Notification", "OutboxEvent" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  legacy_count BIGINT;
  review_count BIGINT;
  ref RECORD;
  mismatch BIGINT;
BEGIN
  SELECT count(*) INTO legacy_count FROM "Application";
  SELECT count(*) INTO review_count FROM "ApplicationReviewHistory";
  IF legacy_count NOT IN (0, 33)
     OR (legacy_count = 0 AND review_count <> 0)
     OR (legacy_count = 33 AND review_count <> 9)
     OR (SELECT count(*) FROM program_team_backup.application_team_map) <> legacy_count THEN
    RAISE EXCEPTION 'Team retirement legacy source count mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Application" a
    LEFT JOIN program_team_backup.application_team_map m ON m."applicationId" = a.id
    WHERE m."applicationId" IS NULL OR m."programId" <> a."programId"
  ) THEN
    RAISE EXCEPTION 'Team retirement mapping mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ApplicationReviewHistory" r
    JOIN program_team_backup.application_team_map m ON m."applicationId" = r."applicationId"
    LEFT JOIN "TeamHistory" h ON h."sourceTable" = 'ApplicationReviewHistory' AND h."sourceId" = r.id
    WHERE h.id IS NULL OR h."teamId" <> m."teamId"
      OR h."occurredAt" <> r."occurredAt" OR h."actorId" <> r."actorId"
      OR h.event::TEXT <> r."eventKind"::TEXT
      OR (h.data->>'revision')::INTEGER <> r.revision
      OR h.data->>'rejectionReason' IS DISTINCT FROM r."rejectionReason"
  ) THEN
    RAISE EXCEPTION 'Team retirement review history mismatch';
  END IF;
  IF legacy_count = 33 AND (
    (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-review:%') <> 9
    OR (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-audit:%') <> 64
    OR (SELECT count(DISTINCT data->>'pairedAuditId') FROM "TeamHistory"
      WHERE "sourceTable" = 'ApplicationReviewHistory') <> 9
  ) THEN
    RAISE EXCEPTION 'Team retirement lifecycle history mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Team"
    WHERE answers IS NULL OR "applicationTemplateVersion" IS NULL OR "applicantId" IS NULL
      OR status IS NULL OR "isRepositoryPublicationPlanned" IS NULL
      OR "repositoryConnectionMode" IS NULL OR revision IS NULL OR "submittedAt" IS NULL
      OR jsonb_typeof(answers) <> 'object' OR "applicationTemplateVersion" < 1 OR revision < 1
  ) THEN
    RAISE EXCEPTION 'Team retirement required field mismatch';
  END IF;
  FOR ref IN SELECT unnest(ARRAY[
    'RepositoryProvisionJob', 'RepositoryIssuanceHistory',
    'GithubRepositoryOutsiderContribution', 'MilestoneDocumentSubmission'
  ]) AS name LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "teamId" IS NULL', ref.name) INTO mismatch;
    IF mismatch <> 0 THEN RAISE EXCEPTION 'Team retirement missing teamId in %', ref.name; END IF;
  END LOOP;
  FOR ref IN SELECT unnest(ARRAY[
    'GithubRepository', 'RepositoryProvisionJob', 'RepositoryIssuanceHistory',
    'GithubRepositoryOutsiderContribution', 'MilestoneDocumentSubmission'
  ]) AS name LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I r LEFT JOIN program_team_backup.application_team_map m ON m."applicationId" = r."applicationId" WHERE r."applicationId" IS NOT NULL AND (m."applicationId" IS NULL OR r."teamId" IS DISTINCT FROM m."teamId")',
      ref.name
    ) INTO mismatch;
    IF mismatch <> 0 THEN RAISE EXCEPTION 'Team retirement legacy reference mismatch in %', ref.name; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM "SubmissionFile" f
    LEFT JOIN program_team_backup.application_team_map m ON m."applicationId" = f."applicationId"
    WHERE f."applicationId" IS NOT NULL AND f."teamId" IS NOT NULL
      AND (m."applicationId" IS NULL OR f."teamId" <> m."teamId")
  ) OR EXISTS (SELECT 1 FROM "Notification" WHERE payload ? 'applicationId')
     OR EXISTS (SELECT 1 FROM "OutboxEvent" WHERE payload ? 'applicationId' OR "aggregateType" = 'Application') THEN
    RAISE EXCEPTION 'Team retirement payload or file reference mismatch';
  END IF;
  RAISE NOTICE 'TEAM_RETIRE sources applications=% reviews=%', legacy_count, review_count;
END $$;

ALTER TABLE "Team"
  ALTER COLUMN answers SET NOT NULL,
  ALTER COLUMN "applicationTemplateVersion" SET NOT NULL,
  ALTER COLUMN "applicantId" SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN "isRepositoryPublicationPlanned" SET NOT NULL,
  ALTER COLUMN "repositoryConnectionMode" SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN "submittedAt" SET NOT NULL,
  ADD CONSTRAINT "Team_application_fields_check" CHECK (
    jsonb_typeof(answers) = 'object' AND "applicationTemplateVersion" >= 1 AND revision >= 1
  );
ALTER TABLE "RepositoryProvisionJob" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "RepositoryIssuanceHistory" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "GithubRepositoryOutsiderContribution" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "MilestoneDocumentSubmission" ALTER COLUMN "teamId" SET NOT NULL;

ALTER TABLE "GithubRepository" DROP COLUMN "applicationId", DROP COLUMN "programId";
ALTER TABLE "RepositoryProvisionJob" DROP COLUMN "applicationId";
ALTER TABLE "RepositoryIssuanceHistory" DROP COLUMN "applicationId";
ALTER TABLE "GithubRepositoryOutsiderContribution" DROP COLUMN "applicationId";
ALTER TABLE "MilestoneDocumentSubmission" DROP COLUMN "applicationId";
ALTER TABLE "SubmissionFile" DROP COLUMN "applicationId";
DROP TABLE "ApplicationReviewHistory";
DROP TABLE "Application";
DROP TYPE "ApplicationReviewEventKind";

COMMIT;
