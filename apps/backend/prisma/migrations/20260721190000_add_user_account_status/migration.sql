CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

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
