-- 회원 유형·소속·독립 접근 권한의 nullable expand 단계.
-- legacy Role, selectedRole, 프로필 mirror와 모든 기존 값은 그대로 유지한다.
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
