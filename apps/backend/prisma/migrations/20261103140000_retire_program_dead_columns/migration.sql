-- Release boundary: deploy 92f2bff15 (both apps) before this migration.
-- The immediately preceding app no longer selects or writes these columns.
-- Take the release backup before applying this destructive step.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE "Team", "TeamMember", "TeamInvitation" IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f' AND confrelid = '"TeamMember"'::regclass
  ) THEN
    RAISE EXCEPTION 'Program cleanup blocked: TeamMember has incoming foreign keys';
  END IF;
END
$preflight$;

ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_pkey";
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_pkey"
  PRIMARY KEY USING INDEX "TeamMember_teamId_userId_key";
ALTER TABLE "TeamMember"
  DROP COLUMN "id",
  DROP COLUMN "name",
  DROP COLUMN "email",
  DROP COLUMN "department";
ALTER TABLE "Team" DROP COLUMN "joinCodeDigest";
ALTER TABLE "TeamInvitation" DROP COLUMN "invitedAt";

COMMIT;
