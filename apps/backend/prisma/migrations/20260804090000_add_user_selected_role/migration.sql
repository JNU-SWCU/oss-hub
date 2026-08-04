-- 가입 절차에서 고른 역할을 담을 자리(#569). 확정(User.role 배정 · RoleRequest 생성)은
-- 가입을 마칠 때 일어나므로, 그전까지 선택을 담아 둘 칸이 따로 필요하다.
ALTER TABLE "User" ADD COLUMN "selectedRole" "Role";

-- 이미 가입을 마친 사용자를 되돌리지 않기 위한 backfill.
--
-- 프로필 필수 항목 판정(`users/user-profile-policy.ts`의 `effectiveProfileRole`)이 이 칸까지
-- 보게 되므로, 기존 사용자에게 비워 두면 "아직 아무것도 고르지 않은 사람"으로 읽힌다. 그러면
-- 학번이 없는 교직원이 미완료로 판정돼 온보딩으로 되돌려진다.

-- 1) 역할이 확정된 사용자 — 그 역할이 곧 그가 고른 역할이다.
--    ADMIN은 역할 선택 화면에 없는 값이라 옮기지 않는다. 그쪽은 role이 채워져 있어
--    판정이 이 칸까지 내려오지 않는다.
UPDATE "User" SET "selectedRole" = "role" WHERE "role" IN ('STUDENT', 'STAFF');

-- 2) 역할은 아직 없지만 살아 있는 교직원 요청이 있는 사용자 — 교직원을 고른 사람이다.
--    승인 대기(PENDING)와 승인됨(APPROVED)만 인정한다. 반려·회수는 역할을 다시 고르는
--    자리로 돌아가는 상태라 기존 화면 로직(`_shell/onboarding-route.ts`)도 선택으로 세지 않는다.
UPDATE "User"
SET "selectedRole" = 'STAFF'
WHERE "selectedRole" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "RoleRequest"
    WHERE "RoleRequest"."userId" = "User"."id"
      AND "RoleRequest"."status" IN ('PENDING', 'APPROVED')
  );
