BEGIN;

-- D5 stage 3: shrink Application.teamId to NOT NULL after Node backfill.
-- Fail closed if any personal (null-team) application remains.

DO $$
DECLARE
  remaining_null_team_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO remaining_null_team_count
  FROM "Application"
  WHERE "teamId" IS NULL;

  IF remaining_null_team_count > 0 THEN
    RAISE EXCEPTION
      'Application.teamId NOT NULL blocked: % application row(s) still have teamId NULL',
      remaining_null_team_count
      USING ERRCODE = 'check_violation',
            HINT = 'Run `pnpm --filter backend db:backfill:application-teams` and confirm remaining null teamId count is 0, then retry this migration.';
  END IF;
END
$$;

ALTER TABLE "Application" ALTER COLUMN "teamId" SET NOT NULL;

COMMIT;
