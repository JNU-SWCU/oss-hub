
UPDATE "User"
SET "hasStaffAccess" = COALESCE(("role" IN ('STAFF', 'ADMIN')), FALSE)
WHERE "hasStaffAccess" IS NULL;

UPDATE "User"
SET "hasAdminAccess" = COALESCE(("role" = 'ADMIN'), FALSE)
WHERE "hasAdminAccess" IS NULL;

ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE,
  ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE;

ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET NOT NULL,
  ALTER COLUMN "hasAdminAccess" SET NOT NULL;


UPDATE "UserProfile" AS p
SET "memberKind" = CASE
    WHEN u."role" = 'STUDENT' THEN 'STUDENT'::"MemberKind"
    WHEN u."role" = 'STAFF' THEN 'STAFF'::"MemberKind"
    WHEN u."role" = 'ADMIN' THEN NULL
    WHEN u."selectedMemberKind" IS NOT NULL THEN u."selectedMemberKind"
    WHEN u."selectedRole" = 'STUDENT' THEN 'STUDENT'::"MemberKind"
    WHEN u."selectedRole" = 'STAFF' THEN 'STAFF'::"MemberKind"
    ELSE NULL
  END
FROM "User" AS u
WHERE p."userId" = u."id" AND p."memberKind" IS NULL;

UPDATE "UserProfile"
SET "affiliationName" = "department"
WHERE "affiliationName" IS NULL AND "memberKind" IS NOT NULL;

UPDATE "UserProfile"
SET "affiliationKind" = 'DEPARTMENT'::"AffiliationKind"
WHERE "affiliationKind" IS NULL AND "memberKind" IS NOT NULL;
