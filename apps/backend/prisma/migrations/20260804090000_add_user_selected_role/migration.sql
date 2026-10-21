ALTER TABLE "User" ADD COLUMN "selectedRole" "Role";


UPDATE "User" SET "selectedRole" = "role" WHERE "role" IN ('STUDENT', 'STAFF');

UPDATE "User"
SET "selectedRole" = 'STAFF'
WHERE "selectedRole" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "RoleRequest"
    WHERE "RoleRequest"."userId" = "User"."id"
      AND "RoleRequest"."status" IN ('PENDING', 'APPROVED')
  );
