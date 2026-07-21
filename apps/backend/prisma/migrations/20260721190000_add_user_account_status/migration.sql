-- 계정 생명주기를 역할과 분리한다. 기존 사용자는 활성 상태를 기본으로 한다(#187, #188).
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- 이전 회수 계약의 role=null + 최신 REVOKED 상태를 새 canonical 상태로 이관한다.
WITH "LatestRoleRequest" AS (
  SELECT DISTINCT ON ("userId") "userId", "status"
  FROM "RoleRequest"
  ORDER BY "userId", "createdAt" DESC, "id" DESC
)
UPDATE "User" AS "user"
SET
  "role" = 'STAFF',
  "accountStatus" = 'DEACTIVATED'
FROM "LatestRoleRequest"
WHERE "LatestRoleRequest"."userId" = "user"."id"
  AND "LatestRoleRequest"."status" = 'REVOKED'
  AND "user"."role" IS NULL;
