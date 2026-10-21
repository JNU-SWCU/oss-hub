
ALTER TABLE "Team" ADD COLUMN "joinCodeDigest" TEXT;

UPDATE "Team"
SET "joinCodeDigest" =
  md5('join-code-invalidated:1:' || "id") ||
  md5('join-code-invalidated:2:' || "id");

ALTER TABLE "Team" ALTER COLUMN "joinCodeDigest" SET NOT NULL;

CREATE UNIQUE INDEX "Team_joinCodeDigest_key" ON "Team"("joinCodeDigest");

DROP INDEX "Team_joinCode_key";

ALTER TABLE "Team" DROP COLUMN "joinCode";

ALTER TABLE "TeamMember" ADD COLUMN "programId" TEXT;

UPDATE "TeamMember"
SET "programId" = "Team"."programId"
FROM "Team"
WHERE "TeamMember"."teamId" = "Team"."id";

ALTER TABLE "TeamMember" ALTER COLUMN "programId" SET NOT NULL;

CREATE UNIQUE INDEX "Team_id_programId_key" ON "Team"("id", "programId");

ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_programId_fkey"
FOREIGN KEY ("teamId", "programId") REFERENCES "Team"("id", "programId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TeamMember_programId_userId_key"
ON "TeamMember"("programId", "userId");

CREATE UNIQUE INDEX "Application_programId_applicantId_personal_key"
ON "Application"("programId", "applicantId") WHERE "teamId" IS NULL;

CREATE UNIQUE INDEX "Application_programId_teamId_team_key"
ON "Application"("programId", "teamId") WHERE "teamId" IS NOT NULL;

CREATE UNIQUE INDEX "RoleRequest_userId_pending_key"
ON "RoleRequest"("userId") WHERE "status" = 'PENDING';

ALTER TABLE "Program" ADD CONSTRAINT "Program_applicationWindow_check"
CHECK ("applicationStartAt" <= "applicationEndAt");

ALTER TABLE "Program" ADD CONSTRAINT "Program_teamMinSize_check"
CHECK ("teamMinSize" >= 1);

ALTER TABLE "Program" ADD CONSTRAINT "Program_teamSizeRange_check"
CHECK ("teamMinSize" <= "teamMaxSize");
