-- 회원 유형·소속·독립 접근 권한의 contract 단계.
-- legacy Role, selectedRole, User 프로필 mirror를 제거하고 canonical 컬럼을 NOT NULL로 잠근다.
-- RoleRequest는 행·id·상태·인덱스를 보존한 채 StaffAccessRequest로 개명한다.
--
-- **이 마이그레이션은 배포된 `20260823000000_bridge_member_authority`를 대체하지 않는다.**
-- bridge가 운영에 한 번 적용되면 `_prisma_migrations`에 그 이름으로 행이 남고, 소스에서
-- 파일을 지우거나 같은 타임스탬프로 내용을 갈아끼워도 그 행은 사라지지 않는다. 그래서
-- 파괴적 단계는 **엄격히 더 늦은 별도 마이그레이션**으로 온다.
-- `scripts/prisma-migration-ledger.test.mjs`가 그 규칙을 기계로 잠근다.
--
-- 파괴적 DDL 앞에 preflight를 둔다. 하나라도 어긋나면 이 트랜잭션 전체가 롤백되어
-- 컬럼도 테이블도 손대지 않은 채로 배포가 멈춘다(Prisma는 마이그레이션 파일 하나를
-- 단일 트랜잭션으로 실행한다). 그래야 거부당한 뒤에도 직전 이미지로 되돌아갈 수 있다.

-- [preflight 1/11] 마이그레이션 원장에 미완료·롤백된 행이 없다.
--
-- 앞선 마이그레이션이 중간에 끊겼다면(`finished_at IS NULL`) 물리 스키마는 그 파일이
-- 어디까지 갔는지 알 수 없는 상태다. 그 위에서 파괴적 DDL을 돌리면 무엇을 되돌려야
-- 하는지조차 특정할 수 없다. 여기서 멈춰 세운다.
--
-- **자기 자신은 제외한다.** Prisma는 마이그레이션 본문을 돌리기 **전에**
-- `finished_at`이 비어 있는 행을 먼저 넣고, 성공한 뒤에야 그 칸을 채운다.
-- 이름으로 걸러내지 않으면 이 게이트는 자기 행을 보고 항상 터진다.
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

-- [preflight 2/11] bridge 단계가 실제로 적용되어 있다.
--
-- contract는 bridge가 채워 둔 canonical 값 위에서만 성립한다. bridge를 건너뛴 DB에
-- 이 파일이 닿으면 preflight 3이 전부 걸리겠지만, 그 원인을 「데이터가 어긋났다」로
-- 오진하게 된다. 원인을 이름으로 말한다.
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

-- [preflight 3/11] 미해결 회원 유형이 없다.
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

-- [preflight 4/11] **배정된 legacy 관리자가 한 명도 미해소로 남아 있지 않다.**
--
-- bridge는 `role = 'ADMIN'`인 계정의 회원 유형을 **의도적으로 비워 둔다** — 권한과
-- 정체성은 독립이고, 「관리자가 교직원을 골랐더라」는 선택 기록일 뿐 확정된 정체성이
-- 아니기 때문이다. 그 분류는 사람이 명시적으로 해야 한다.
--
-- 그래서 이 게이트는 preflight 3과 별개로 선다. 3은 "지금 비어 있는가"를 세고, 여기는
-- **아직 사람이 분류하지 않은 관리자가 있는가**를 그 이름으로 말한다. 3만 있으면
-- 운영자가 원인을 「어딘가 데이터가 비었다」로 읽고 되는대로 채우게 된다.
--
-- 프로필 행이 아예 없는 관리자도 함께 센다 — 그쪽도 분류가 끝나지 않은 것이다.
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

-- [preflight 5/11] 이름·소속명이 공백이 아니고 1~100 코드 포인트다.
-- PostgreSQL의 length()는 코드 포인트를 세므로 애플리케이션의 Array.from(...).length와 일치한다.
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

-- [preflight 6/11] department와 affiliationName은 같은 사실의 두 사본이다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "department" IS DISTINCT FROM "affiliationName";
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: department와 affiliationName 불일치 % 건', violations;
  END IF;
END $$;

-- [preflight 7/11] STAFF는 학번이 없고 STUDENT는 보존 형식(6~10자리) 학번을 갖는다.
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

-- [preflight 8/11] **학번은 전역 유일하다.**
--
-- 스키마의 `@unique`가 이미 이것을 강제하지만, 그 인덱스는 이 마이그레이션이 만든 것이
-- 아니라 앞선 릴리스에서 왔다. 인덱스가 어떤 이유로든(수동 DROP, 복원 누락) 빠진 DB에서
-- 중복이 자라 있으면 계약 CHECK는 그것을 잡지 못한다 — CHECK는 행 단위 술어라 유일성을
-- 볼 수 없다. 그래서 여기서 집합으로 직접 센다.
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

-- [preflight 9/11] STUDENT는 DEPARTMENT 소속이다. PROGRAM_OFFICE는 교직원만 쓴다.
DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
  FROM "UserProfile" WHERE "memberKind" = 'STUDENT' AND "affiliationKind" <> 'DEPARTMENT';
  IF violations <> 0 THEN
    RAISE EXCEPTION 'contract preflight: DEPARTMENT가 아닌 STUDENT 소속 % 건', violations;
  END IF;
END $$;

-- [preflight 10/11] legacy 역할이 canonical 사실과 어긋나지 않는다.
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

-- [preflight 11/11] 요청 이력 상태가 모두 알려진 값이고 사용자당 PENDING은 한 건 이하다.
--
-- 개명은 값을 옮기지 않으므로, 알 수 없는 상태가 섞여 있으면 그것이 그대로 정본 이름
-- 아래로 넘어간다. enum 라벨 집합을 직접 대조해 그 유입을 막는다.
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
--       bridge가 이미 같은 모양으로 잠갔으므로 여기서는 멱등한 재확인이다 —
--       bridge를 건너뛴 경로(신규 DB)에서도 같은 결과에 닿게 한다.
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
