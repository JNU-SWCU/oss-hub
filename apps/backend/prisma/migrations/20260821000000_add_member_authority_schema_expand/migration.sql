CREATE TYPE "MemberKind" AS ENUM ('STUDENT', 'STAFF');

CREATE TYPE "AffiliationKind" AS ENUM ('DEPARTMENT', 'PROGRAM_OFFICE');

ALTER TABLE "User"
  ADD COLUMN "selectedMemberKind" "MemberKind",
  ADD COLUMN "hasStaffAccess" BOOLEAN,
  ADD COLUMN "hasAdminAccess" BOOLEAN;

ALTER TABLE "UserProfile"
  ALTER COLUMN "studentId" DROP NOT NULL,
  ADD COLUMN "memberKind" "MemberKind",
  ADD COLUMN "affiliationKind" "AffiliationKind",
  ADD COLUMN "affiliationName" TEXT;
