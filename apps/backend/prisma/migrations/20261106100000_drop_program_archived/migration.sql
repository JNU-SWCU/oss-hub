BEGIN;
SET LOCAL lock_timeout = '5s';

-- ARCHIVED has no writer and no rows. Swap the enum type instead of
-- ALTER TYPE ... DROP VALUE, which PostgreSQL does not support.
-- The guard raises before any change, so a stray ARCHIVED row keeps the old type.
LOCK TABLE "Program" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  archived_count bigint;
BEGIN
  SELECT count(*) INTO archived_count FROM "Program" WHERE "lifecycle"::text = 'ARCHIVED';
  IF archived_count > 0 THEN
    RAISE EXCEPTION 'ProgramLifecycle ARCHIVED drop blocked: archived=%', archived_count;
  END IF;
END $$;

ALTER TABLE "Program" ALTER COLUMN "lifecycle" DROP DEFAULT;
ALTER TYPE "ProgramLifecycle" RENAME TO "ProgramLifecycle_old";
CREATE TYPE "ProgramLifecycle" AS ENUM ('PUBLISHED', 'DELETED');
ALTER TABLE "Program"
  ALTER COLUMN "lifecycle" TYPE "ProgramLifecycle"
  USING "lifecycle"::text::"ProgramLifecycle";
ALTER TABLE "Program" ALTER COLUMN "lifecycle" SET DEFAULT 'PUBLISHED';
DROP TYPE "ProgramLifecycle_old";

COMMIT;
