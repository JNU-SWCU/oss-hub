BEGIN;

-- D5: every Application must reference a Team (1-person team = personal participation).
-- This migration only restructures indexes/FK while teamId stays nullable so a Node
-- backfill can mint real joinCodeDigest values (HMAC secret is runtime-only).
-- NOT NULL is applied in 20260804201000_application_require_team_not_null after backfill.

-- Pre-flight: refuse when a null-team application would create a TeamMember that
-- collides with TeamMember_programId_userId_key (category flip INDIVIDUAL→TEAM cases).
DO $$
DECLARE
  conflicting_membership_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO conflicting_membership_count
  FROM "Application" AS application
  WHERE application."teamId" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "TeamMember" AS membership
      WHERE membership."programId" = application."programId"
        AND membership."userId" = application."applicantId"
    );

  IF conflicting_membership_count > 0 THEN
    RAISE EXCEPTION
      'Application team backfill blocked: % application row(s) have teamId NULL but the applicant is already a TeamMember in the same program',
      conflicting_membership_count
      USING ERRCODE = 'check_violation',
            HINT = 'Resolve the conflicting TeamMember or Application rows (same programId + applicantId) before retrying. One program membership per user is required before minting 1-person teams.';
  END IF;
END
$$;

-- Replace personal/team partial uniques with a full (programId, teamId) unique.
-- Duplicate-application prevention moves to TeamMember @@unique([programId, userId])
-- × one Application per team.
DROP INDEX "Application_programId_applicantId_personal_key";
DROP INDEX "Application_programId_teamId_team_key";

CREATE UNIQUE INDEX "Application_programId_teamId_key"
ON "Application"("programId", "teamId");

-- NOT NULL teamId cannot keep ON DELETE SET NULL — team delete must be refused.
ALTER TABLE "Application" DROP CONSTRAINT "Application_teamId_fkey";

ALTER TABLE "Application"
ADD CONSTRAINT "Application_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
