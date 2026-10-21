ALTER TABLE "UserProfile"
  ADD COLUMN "staffNumber" TEXT;

ALTER TABLE "UserProfile"
  DROP CONSTRAINT "UserProfile_studentId_memberKind_check";

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_studentId_memberKind_check"
  CHECK (
    ("memberKind" = 'STAFF'
      AND ("studentId" IS NULL OR "studentId" ~ '^[0-9]{6,10}$'))
    OR
    ("memberKind" = 'STUDENT'
      AND "studentId" ~ '^[0-9]{6,10}$')
  );
