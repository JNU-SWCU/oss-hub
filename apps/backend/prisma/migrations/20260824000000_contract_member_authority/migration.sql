
DO $$
DECLARE unfinished BIGINT;
BEGIN
  SELECT count(*) INTO unfinished
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20260824000000_contract_member_authority'
    AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);
  IF unfinished <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 끝나지 않았거나 롤백된 마이그레이션 % 건', unfinished;
  END IF;
END $$;

DO $$
DECLARE applied BIGINT;
BEGIN
  SELECT count(*) INTO applied
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20260823000000_bridge_member_authority'
    AND "finished_at" IS NOT NULL
    AND "rolled_back_at" IS NULL;
  IF applied <> 1 THEN
    RAISE EXCEPTION 'contract preflight: bridge 마이그레이션이 적용되어 있지 않다(% 건)', applied;
  END IF;
END $$;

DO $$
DECLARE unresolved BIGINT;
BEGIN
  SELECT count(*) INTO unresolved FROM "UserProfile" WHERE "memberKind" IS NULL;
  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'contract preflight: UserProfile.memberKind가 비어 있는 행 % 건', unresolved;
  END IF;

  SELECT count(*) INTO unresolved
  FROM "UserProfile" WHERE "affiliationKind" IS NULL OR "affiliationName" IS NULL;
  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'contract preflight: UserProfile 소속이 비어 있는 행 % 건', unresolved;
  END IF;

  SELECT count(*) INTO unresolved
  FROM "User" WHERE "hasStaffAccess" IS NULL OR "hasAdminAccess" IS NULL;
  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'contract preflight: User 접근 권한이 비어 있는 행 % 건', unresolved;
  END IF;

  SELECT count(*) INTO unresolved
  FROM "User" WHERE "selectedMemberKind" IS NULL AND EXISTS (
    SELECT 1 FROM "UserProfile" WHERE "UserProfile"."userId" = "User"."id"
  );
  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 가입을 마쳤는데 selectedMemberKind가 비어 있는 행 % 건', unresolved;
  END IF;
END $$;

DO $$
DECLARE unresolved BIGINT;
BEGIN
  SELECT count(*) INTO unresolved
  FROM "User" u
  LEFT JOIN "UserProfile" p ON p."userId" = u."id"
  WHERE u."role" = 'ADMIN' AND (p."userId" IS NULL OR p."memberKind" IS NULL);
  IF unresolved <> 0 THEN
    RAISE EXCEPTION
      'contract preflight: 회원 유형이 분류되지 않은 legacy 관리자 % 명 — 운영에서 먼저 분류해야 한다',
      unresolved;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile"
  WHERE "name" IS NULL
     OR btrim("name") <> "name"
     OR btrim("name") = ''
     OR length("name") < 1 OR length("name") > 100
     OR "department" IS NULL
     OR btrim("department") <> "department"
     OR btrim("department") = ''
     OR length("department") < 1 OR length("department") > 100
     OR btrim("affiliationName") <> "affiliationName"
     OR btrim("affiliationName") = ''
     OR length("affiliationName") < 1 OR length("affiliationName") > 100;
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 이름·학과·소속명 길이/공백 위반 % 건', violations;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "department" IS DISTINCT FROM "affiliationName";
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: department와 affiliationName 불일치 % 건', violations;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "memberKind" = 'STAFF' AND "studentId" IS NOT NULL;
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 학번을 가진 STAFF % 건', violations;
  END IF;

  SELECT count(*) INTO violations
  FROM "UserProfile"
  WHERE "memberKind" = 'STUDENT'
    AND ("studentId" IS NULL OR "studentId" !~ '^[0-9]{6,10}$');
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 학번이 없거나 형식이 어긋난 STUDENT % 건', violations;
  END IF;
END $$;

DO $$
DECLARE duplicated BIGINT;
BEGIN
  SELECT count(*) INTO duplicated FROM (
    SELECT "studentId" FROM "UserProfile"
    WHERE "studentId" IS NOT NULL
    GROUP BY "studentId" HAVING count(*) > 1
  ) AS d;
  IF duplicated <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 중복된 학번 % 개', duplicated;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "memberKind" = 'STUDENT' AND "affiliationKind" <> 'DEPARTMENT';
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: DEPARTMENT가 아닌 STUDENT 소속 % 건', violations;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "User"
  JOIN "UserProfile" ON "UserProfile"."userId" = "User"."id"
  WHERE ("User"."role" = 'STUDENT' AND "UserProfile"."memberKind" <> 'STUDENT')
     OR ("User"."role" = 'STAFF' AND "UserProfile"."memberKind" <> 'STAFF')
     OR ("User"."role" = 'ADMIN' AND "User"."hasAdminAccess" IS DISTINCT FROM TRUE);
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: legacy role과 canonical 사실 불일치 % 건', violations;
  END IF;
END $$;

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "RoleRequest"
  WHERE "status" IS NULL
     OR "status"::text NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: 알 수 없는 요청 상태 % 건', violations;
  END IF;

  SELECT count(*) INTO violations FROM (
    SELECT "userId" FROM "RoleRequest" WHERE "status" = 'PENDING'
    GROUP BY "userId" HAVING count(*) > 1
  ) AS duplicated;
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: PENDING 요청이 둘 이상인 사용자 % 명', violations;
  END IF;
END $$;

ALTER TYPE "RoleRequestStatus" RENAME TO "StaffAccessRequestStatus";

ALTER TABLE "RoleRequest" RENAME TO "StaffAccessRequest";

ALTER TABLE "StaffAccessRequest" RENAME CONSTRAINT "RoleRequest_pkey" TO "StaffAccessRequest_pkey";
ALTER TABLE "StaffAccessRequest" RENAME CONSTRAINT "RoleRequest_userId_fkey" TO "StaffAccessRequest_userId_fkey";
ALTER TABLE "StaffAccessRequest" RENAME CONSTRAINT "RoleRequest_decidedById_fkey" TO "StaffAccessRequest_decidedById_fkey";

ALTER INDEX "RoleRequest_userId_idx" RENAME TO "StaffAccessRequest_userId_idx";
ALTER INDEX "RoleRequest_status_idx" RENAME TO "StaffAccessRequest_status_idx";
ALTER INDEX "RoleRequest_userId_status_createdAt_id_idx"
  RENAME TO "StaffAccessRequest_userId_status_createdAt_id_idx";
ALTER INDEX "RoleRequest_userId_createdAt_id_idx"
  RENAME TO "StaffAccessRequest_userId_createdAt_id_idx";
ALTER INDEX "RoleRequest_userId_pending_key"
  RENAME TO "StaffAccessRequest_userId_pending_key";

ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET NOT NULL,
  ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE,
  ALTER COLUMN "hasAdminAccess" SET NOT NULL,
  ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE;

ALTER TABLE "UserProfile"
  ALTER COLUMN "memberKind" SET NOT NULL,
  ALTER COLUMN "affiliationKind" SET NOT NULL,
  ALTER COLUMN "affiliationName" SET NOT NULL;

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_name_check"
    CHECK (btrim("name") = "name" AND length("name") BETWEEN 1 AND 100),
  ADD CONSTRAINT "UserProfile_department_check"
    CHECK (btrim("department") = "department" AND length("department") BETWEEN 1 AND 100),
  ADD CONSTRAINT "UserProfile_affiliationName_check"
    CHECK (btrim("affiliationName") = "affiliationName" AND length("affiliationName") BETWEEN 1 AND 100),
  ADD CONSTRAINT "UserProfile_department_affiliationName_check"
    CHECK ("department" = "affiliationName"),
  ADD CONSTRAINT "UserProfile_studentId_memberKind_check"
    CHECK (
      ("memberKind" = 'STAFF' AND "studentId" IS NULL)
      OR ("memberKind" = 'STUDENT' AND "studentId" ~ '^[0-9]{6,10}$')
    ),
  ADD CONSTRAINT "UserProfile_studentAffiliation_check"
    CHECK ("memberKind" <> 'STUDENT' OR "affiliationKind" = 'DEPARTMENT');

ALTER TABLE "User"
  DROP COLUMN "role",
  DROP COLUMN "selectedRole",
  DROP COLUMN "name",
  DROP COLUMN "studentId",
  DROP COLUMN "department";

DROP TYPE "Role";
