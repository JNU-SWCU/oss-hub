BEGIN;


DO $$
DECLARE
  legacy_null_team_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO legacy_null_team_count
  FROM "Application"
  WHERE "teamId" IS NULL;

  IF legacy_null_team_count > 0 THEN
    RAISE EXCEPTION
      'Application.teamId NOT NULL blocked: % legacy application row(s) have teamId NULL',
      legacy_null_team_count
      USING ERRCODE = 'check_violation',
            HINT = 'This release assumes a schema created from scratch. Recreate the database (see docs/deploy/server-runbook.md M11) and redeploy.';
  END IF;
END
$$;

DROP INDEX "Application_programId_applicantId_personal_key";
DROP INDEX "Application_programId_teamId_team_key";

CREATE UNIQUE INDEX "Application_programId_teamId_key"
ON "Application"("programId", "teamId");

ALTER TABLE "Application" DROP CONSTRAINT "Application_teamId_fkey";

ALTER TABLE "Application"
ADD CONSTRAINT "Application_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Application" ALTER COLUMN "teamId" SET NOT NULL;

COMMIT;
