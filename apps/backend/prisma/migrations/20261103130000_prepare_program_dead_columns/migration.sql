BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE "Program", "Milestone", "SubmissionFile", "MilestoneDocumentTemplateFile", "Team", "TeamMember", "TeamInvitation"
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SubmissionFile" GROUP BY "storageKey" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "MilestoneDocumentTemplateFile" GROUP BY "storageKey" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Program cleanup blocked: duplicate file storageKey'
      USING ERRCODE = 'unique_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Program"
    WHERE "startAt" = TIMESTAMP '0001-01-01'
  ) OR EXISTS (
    SELECT 1 FROM "Milestone" WHERE "startAt" = TIMESTAMP '0001-01-01'
  ) THEN
    RAISE EXCEPTION 'Program cleanup blocked: sentinel schedule requires an explicit date'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Milestone" m JOIN "Program" p ON p.id = m."programId"
    WHERE m."startAt" < p."startAt" OR m."dueAt" > p."endAt"
  ) THEN
    RAISE EXCEPTION 'Program cleanup blocked: milestone outside program schedule'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f' AND confrelid = '"TeamMember"'::regclass
  ) THEN
    RAISE EXCEPTION 'Program cleanup blocked: TeamMember has incoming foreign keys';
  END IF;
END
$preflight$;

-- Keep the old columns until the next release. Both old and new clients can
-- insert during the migration-before-app-swap window.
ALTER TABLE "Team" ALTER COLUMN "joinCodeDigest" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "TeamMember" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- TeamInvitation rows are recreated for a new invitation, never reissued in place.
-- Preserve the historical public invitation time before switching readers.
UPDATE "TeamInvitation" SET "createdAt" = "invitedAt"
WHERE "createdAt" IS DISTINCT FROM "invitedAt";

CREATE UNIQUE INDEX "SubmissionFile_storageKey_key" ON "SubmissionFile" ("storageKey");
CREATE UNIQUE INDEX "MilestoneDocumentTemplateFile_storageKey_key"
  ON "MilestoneDocumentTemplateFile" ("storageKey");

DROP TRIGGER "Program_legacy_write_compatibility" ON "Program";
DROP FUNCTION "Program_legacy_write_compatibility"();
DROP TRIGGER "Milestone_legacy_write_compatibility" ON "Milestone";
DROP FUNCTION "Milestone_legacy_write_compatibility"();

ALTER TABLE "Program" ALTER COLUMN "startAt" DROP DEFAULT;
ALTER TABLE "Program" ALTER COLUMN "endAt" DROP DEFAULT;
ALTER TABLE "Milestone" ALTER COLUMN "startAt" DROP DEFAULT;
ALTER TABLE "Program" ADD CONSTRAINT "Program_explicit_schedule_check"
  CHECK ("startAt" <> TIMESTAMP '0001-01-01');
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_explicit_schedule_check"
  CHECK ("startAt" <> TIMESTAMP '0001-01-01');

CREATE FUNCTION "Milestone_program_schedule_boundary"() RETURNS trigger
LANGUAGE plpgsql AS $boundary$
DECLARE
  program_start_at TIMESTAMP(3);
  program_end_at TIMESTAMP(3);
BEGIN
  SELECT "startAt", "endAt" INTO program_start_at, program_end_at
  FROM "Program" WHERE id = NEW."programId" FOR SHARE;
  IF NEW."startAt" < program_start_at OR NEW."dueAt" > program_end_at THEN
    RAISE EXCEPTION 'Milestone must be within its Program schedule'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$boundary$;

CREATE TRIGGER "Milestone_program_schedule_boundary"
BEFORE INSERT OR UPDATE OF "programId", "startAt", "dueAt" ON "Milestone"
FOR EACH ROW EXECUTE FUNCTION "Milestone_program_schedule_boundary"();

COMMIT;
