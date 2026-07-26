CREATE TYPE "SubmissionFileLifecycle" AS ENUM ('PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED');

-- Program."endAt"은 선행 마이그레이션 20260726120000_add_program_end_at(#265)이 추가한다.
ALTER TABLE "SubmissionFile"
ADD COLUMN "applicationId" TEXT,
ADD COLUMN "milestoneId" TEXT,
ADD COLUMN "lifecycle" "SubmissionFileLifecycle" NOT NULL DEFAULT 'ATTACHED',
ADD COLUMN "pendingExpiresAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "deleteClaimedAt" TIMESTAMP(3),
ADD COLUMN "deleteClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN "deleteClaimOwner" TEXT,
ADD COLUMN "deleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextDeleteAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastDeleteError" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_milestoneId_fkey"
FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy files were attached through their revision before explicit lifecycle
-- ownership existed. Backfill only a complete, internally consistent chain.
UPDATE "SubmissionFile" AS sf
SET
  "applicationId" = s."applicationId",
  "milestoneId" = s."milestoneId",
  "expiresAt" = p."endAt" + INTERVAL '1 year'
FROM "SubmissionRevision" AS sr
JOIN "Submission" AS s ON s."id" = sr."submissionId"
JOIN "Application" AS a ON a."id" = s."applicationId"
JOIN "Milestone" AS m ON m."id" = s."milestoneId"
JOIN "Program" AS p ON p."id" = a."programId"
WHERE sf."submissionRevisionId" = sr."id"
  AND m."programId" = a."programId"
  AND sf."lifecycle" = 'ATTACHED';

-- Do not silently delete historical attachments or manufacture ownership.
-- A missing Program.endAt is a supported legacy state: ownership is backfilled,
-- expiresAt remains NULL, and the Program editor assigns it when ADMIN sets endAt.
DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO orphan_count
  FROM "SubmissionFile"
  WHERE "lifecycle" = 'ATTACHED'
    AND (
      "applicationId" IS NULL
      OR "milestoneId" IS NULL
      OR "submissionRevisionId" IS NULL
    );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'SubmissionFile lifecycle backfill blocked: % legacy attached row(s) have orphaned ownership',
      orphan_count
      USING ERRCODE = 'check_violation',
            HINT = 'Repair the SubmissionRevision -> Submission -> Application/Milestone -> Program chain, then retry the migration.';
  END IF;
END
$$;

-- The backfill and fail-closed ownership gate above preserve historical records.
-- Legacy ATTACHED rows may retain NULL expiresAt only until Program.endAt is set.
ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
  ("lifecycle" = 'PENDING' AND "applicationId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND "submissionRevisionId" IS NULL AND "pendingExpiresAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
  OR
  ("lifecycle" = 'ATTACHED' AND "applicationId" IS NOT NULL AND "milestoneId" IS NOT NULL
    AND "submissionRevisionId" IS NOT NULL AND "pendingExpiresAt" IS NULL)
  OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')
) NOT VALID;

ALTER TABLE "SubmissionFile"
VALIDATE CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_delete_claim_check" CHECK (
  ("deleteClaimedAt" IS NULL AND "deleteClaimExpiresAt" IS NULL AND "deleteClaimOwner" IS NULL)
  OR
  ("deleteClaimedAt" IS NOT NULL AND "deleteClaimOwner" IS NOT NULL
    AND "deleteClaimExpiresAt" = "deleteClaimedAt" + INTERVAL '10 minutes')
) NOT VALID;

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_delete_attempt_count_check"
CHECK ("deleteAttemptCount" BETWEEN 0 AND 6) NOT VALID;

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_last_delete_error_check"
CHECK ("lastDeleteError" IS NULL OR "lastDeleteError" ~ '^[A-Z][A-Z0-9_]{0,63}$') NOT VALID;

ALTER TABLE "SubmissionFile"
ADD CONSTRAINT "SubmissionFile_deleted_at_check"
CHECK (("lifecycle" = 'DELETED') = ("deletedAt" IS NOT NULL)) NOT VALID;

CREATE INDEX "SubmissionFile_applicationId_milestoneId_lifecycle_idx"
ON "SubmissionFile"("applicationId", "milestoneId", "lifecycle");

CREATE INDEX "SubmissionFile_lifecycle_pendingExpiresAt_idx"
ON "SubmissionFile"("lifecycle", "pendingExpiresAt");

CREATE INDEX "SubmissionFile_lifecycle_nextDeleteAttemptAt_deleteClaimExp_idx"
ON "SubmissionFile"("lifecycle", "nextDeleteAttemptAt", "deleteClaimExpiresAt");
