BEGIN;

-- Valid onboarding states before this expand migration are:
--   * expected incomplete: studentId and department are both NULL; name may be NULL or the legacy GitHub display name.
--   * complete: name, studentId, and department are all non-NULL and satisfy the onboarding profile policy.
-- The onboarding API writes all three fields on first completion and never writes
-- studentId or department independently, so every other NULL combination is anomalous.
DO $$
DECLARE
  impossible_partial_count BIGINT;
  invalid_complete_count BIGINT;
  duplicate_student_id_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO impossible_partial_count
  FROM "User"
  WHERE ("studentId" IS NOT NULL OR "department" IS NOT NULL)
    AND ("name" IS NULL OR "studentId" IS NULL OR "department" IS NULL);

  IF impossible_partial_count > 0 THEN
    RAISE EXCEPTION
      'UserProfile backfill blocked: % user row(s) have an impossible partial profile',
      impossible_partial_count
      USING ERRCODE = 'check_violation',
            HINT = 'Repair rows so studentId and department are both NULL, or make name, studentId, and department all non-NULL, then retry.';
  END IF;

  SELECT COUNT(*)
  INTO invalid_complete_count
  FROM "User"
  WHERE "name" IS NOT NULL
    AND "studentId" IS NOT NULL
    AND "department" IS NOT NULL
    AND (
      BTRIM("name") = ''
      OR CHAR_LENGTH("name") > 100
      OR "studentId" !~ '^[0-9]{6,10}$'
      OR BTRIM("department") = ''
      OR CHAR_LENGTH("department") > 100
    );

  IF invalid_complete_count > 0 THEN
    RAISE EXCEPTION
      'UserProfile backfill blocked: % user row(s) have a policy-invalid complete profile',
      invalid_complete_count
      USING ERRCODE = 'check_violation',
            HINT = 'Repair name, studentId, and department values to satisfy the onboarding profile policy, then retry.';
  END IF;

  SELECT COUNT(*)
  INTO duplicate_student_id_count
  FROM (
    SELECT "studentId"
    FROM "User"
    WHERE "name" IS NOT NULL
      AND "studentId" IS NOT NULL
      AND "department" IS NOT NULL
    GROUP BY "studentId"
    HAVING COUNT(*) > 1
  ) AS duplicate_student_ids;

  IF duplicate_student_id_count > 0 THEN
    RAISE EXCEPTION
      'UserProfile backfill blocked: % duplicate studentId value(s) exist',
      duplicate_student_id_count
      USING ERRCODE = 'unique_violation',
            HINT = 'Resolve duplicate legacy studentId values before retrying the migration.';
  END IF;
END
$$;

CREATE TABLE "UserProfile" (
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "UserProfile_studentId_key" ON "UserProfile"("studentId");

ALTER TABLE "UserProfile"
ADD CONSTRAINT "UserProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "UserProfile" (
  "userId",
  "name",
  "studentId",
  "department",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "name",
  "studentId",
  "department",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "name" IS NOT NULL
  AND "studentId" IS NOT NULL
  AND "department" IS NOT NULL;

COMMIT;
