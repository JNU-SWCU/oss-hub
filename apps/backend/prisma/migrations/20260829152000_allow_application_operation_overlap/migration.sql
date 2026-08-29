BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  invalid_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO invalid_count
  FROM "Program"
  WHERE "applicationEndAt" > "endAt";

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Program overlap migration blocked: % row(s) have applicationEndAt after endAt', invalid_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$migration$;

ALTER TABLE "Program"
  DROP CONSTRAINT "Program_applicationToOperatingWindow_check";

ALTER TABLE "Program"
  ADD CONSTRAINT "Program_applicationWithinProgramWindow_check"
  CHECK ("applicationEndAt" <= "endAt");

CREATE OR REPLACE FUNCTION "Program_legacy_write_compatibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $program_compatibility$
BEGIN
  IF NEW."startAt" = TIMESTAMP '0001-01-01 00:00:00' THEN
    NEW."startAt" := NEW."applicationEndAt";
  END IF;
  NEW."endAt" := COALESCE(
    NEW."endAt",
    TIMESTAMP '9999-12-31 23:59:59.999'
  );
  NEW."teamMinSize" := COALESCE(NEW."teamMinSize", 1);
  NEW."teamMaxSize" := COALESCE(NEW."teamMaxSize", 1);
  RETURN NEW;
END
$program_compatibility$;

CREATE OR REPLACE FUNCTION "Milestone_legacy_write_compatibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $milestone_compatibility$
DECLARE
  program_start_at TIMESTAMP(3);
  program_end_at TIMESTAMP(3);
  is_legacy_write BOOLEAN;
BEGIN
  SELECT "startAt", "endAt"
  INTO program_start_at, program_end_at
  FROM "Program"
  WHERE "id" = NEW."programId"
  FOR SHARE;

  is_legacy_write := NEW."startAt" = TIMESTAMP '0001-01-01 00:00:00';
  IF is_legacy_write THEN
    NEW."startAt" := LEAST(
      program_start_at,
      NEW."dueAt" - INTERVAL '1 millisecond'
    );
  END IF;
  IF NOT is_legacy_write AND NEW."startAt" < program_start_at THEN
    RAISE EXCEPTION 'Milestone startAt must be at or after its Program startAt'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."dueAt" > program_end_at THEN
    RAISE EXCEPTION 'Milestone dueAt must be on or before its Program endAt'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$milestone_compatibility$;

COMMIT;
