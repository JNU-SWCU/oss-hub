-- 회원 유형·소속·독립 접근 권한의 contract 단계.
-- legacy Role, selectedRole, User 프로필 mirror를 제거하고 canonical 컬럼을 NOT NULL로 잠근다.
-- RoleRequest는 행·id·상태·인덱스를 보존한 채 StaffAccessRequest로 개명한다.
--
-- 파괴적 DDL 앞에 preflight를 둔다. 하나라도 어긋나면 이 트랜잭션 전체가 롤백되어
-- 컬럼도 테이블도 손대지 않은 채로 배포가 멈춘다(Prisma는 마이그레이션 파일 하나를
-- 단일 트랜잭션으로 실행한다).

-- [preflight 1/7] 미해결 회원 유형이 없다.
-- canonical memberKind가 없는 프로필, 프로필 없이 남은 사용자는 NOT NULL을 통과할 수 없다.
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

-- [preflight 2/7] 이름·소속명이 공백이 아니고 1~100 코드 포인트다.
-- PostgreSQL의 length()는 코드 포인트를 세므로 애플리케이션의 Array.from(...).length와 일치한다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile"
  WHERE btrim("name") <> "name"
     OR btrim("name") = ''
     OR length("name") < 1 OR length("name") > 100
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

-- [preflight 3/7] department와 affiliationName은 같은 사실의 두 사본이다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "department" IS DISTINCT FROM "affiliationName";
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: department와 affiliationName 불일치 % 건', violations;
  END IF;
END $$;

-- [preflight 4/7] STAFF는 학번이 없고 STUDENT는 보존 형식(6~10자리) 학번을 갖는다.
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

-- [preflight 5/7] STUDENT는 DEPARTMENT 소속이다. PROGRAM_OFFICE는 교직원만 쓴다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "memberKind" = 'STUDENT' AND "affiliationKind" <> 'DEPARTMENT';
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: DEPARTMENT가 아닌 STUDENT 소속 % 건', violations;
  END IF;
END $$;

-- [preflight 6/7] legacy 역할이 canonical 사실과 어긋나지 않는다.
-- 여기서 걸리면 backfill이 덜 끝났거나 cutover 이후 legacy 쓰기가 되살아난 것이다.
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

-- [preflight 7/7] 요청 이력 상태가 모두 알려진 값이고 사용자당 PENDING은 한 건 이하다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations FROM (
    SELECT "userId" FROM "RoleRequest" WHERE "status" = 'PENDING'
    GROUP BY "userId" HAVING count(*) > 1
  ) AS duplicated;
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: PENDING 요청이 둘 이상인 사용자 % 명', violations;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- [1/5] RoleRequest → StaffAccessRequest 개명. 행·id·상태·FK·인덱스를 모두 보존한다.
--       ALTER ... RENAME은 데이터를 복사하지 않으므로 이력이 그대로 이어진다.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- [2/5] canonical 접근 권한을 NOT NULL + 기본값 false로 잠근다.
--       기본값이 있어야 새 계정이 "권한을 알 수 없는" 상태로 만들어지지 않는다.
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET NOT NULL,
  ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE,
  ALTER COLUMN "hasAdminAccess" SET NOT NULL,
  ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- [3/5] canonical 회원 유형·소속을 NOT NULL로 잠근다.
-- ---------------------------------------------------------------------------
ALTER TABLE "UserProfile"
  ALTER COLUMN "memberKind" SET NOT NULL,
  ALTER COLUMN "affiliationKind" SET NOT NULL,
  ALTER COLUMN "affiliationName" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- [4/5] 저장 불변식을 CHECK로 고정한다.
--       NFC 정규화와 "정확히 6자리" 신규 학번 규칙은 여기 두지 않는다 —
--       stock PostgreSQL에 정규화 함수가 없고, DB는 보존 값과 신규 값을 구분할
--       근거(형식 버전 컬럼)가 없기 때문이다. 둘 다 쓰기 경계 불변식으로 남는다.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- [5/5] legacy 역할과 User 프로필 mirror를 제거한다.
--       이 시점 이후로는 직전 contract-ready 이미지만 이 스키마 위에서 동작한다.
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  DROP COLUMN "role",
  DROP COLUMN "selectedRole",
  DROP COLUMN "name",
  DROP COLUMN "studentId",
  DROP COLUMN "department";

DROP TYPE "Role";
