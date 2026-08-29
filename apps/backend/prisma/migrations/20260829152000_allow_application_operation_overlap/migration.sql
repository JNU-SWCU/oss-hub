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

COMMIT;
