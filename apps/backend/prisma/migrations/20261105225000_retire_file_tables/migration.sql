BEGIN;

LOCK TABLE "File", "Program", "SubmissionFile", "ProgramAuthoringUpload",
  "MilestoneDocumentTemplateFile", "ProgramCover", "ProgramPurgeFileTombstone"
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  counts bigint[];
  missing_count bigint;
BEGIN
  SELECT ARRAY[
    (SELECT count(*) FROM "SubmissionFile"),
    (SELECT count(*) FROM "ProgramAuthoringUpload"),
    (SELECT count(*) FROM "MilestoneDocumentTemplateFile"),
    (SELECT count(*) FROM "ProgramCover"),
    (SELECT count(*) FROM "ProgramPurgeFileTombstone")
  ] INTO counts;
  IF counts <> ARRAY[81,3,5,3,2]::bigint[]
     AND counts <> ARRAY[0,0,0,0,0]::bigint[] THEN
    RAISE EXCEPTION 'file retire aborted: source count mismatch: %', counts;
  END IF;
  SELECT count(*) INTO missing_count FROM (
    SELECT "storageKey" FROM "SubmissionFile"
    UNION
    SELECT "storageKey" FROM "ProgramAuthoringUpload"
    UNION
    SELECT "storageKey" FROM "MilestoneDocumentTemplateFile"
    UNION
    SELECT "storageKey" FROM "ProgramCover" WHERE source='OWNED'
    UNION
    SELECT "storageKey" FROM "ProgramPurgeFileTombstone"
  ) source
  WHERE NOT EXISTS (SELECT 1 FROM "File" f WHERE f."storageKey"=source."storageKey");
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'file retire aborted: % source storage keys are missing from File', missing_count;
  END IF;
END $$;

UPDATE "File"
SET "createdAt"=COALESCE("createdAt", CURRENT_TIMESTAMP),
    "updatedAt"=COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "createdAt" IS NULL OR "updatedAt" IS NULL;

ALTER TABLE "File"
  ALTER COLUMN "createdAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "File" ADD CONSTRAINT "File_kind_lifecycle_check" CHECK (
  (kind='UPLOAD' AND lifecycle IN ('PENDING','DELETE_PENDING','DELETED'))
  OR (kind IN ('TEMPLATE','COVER') AND lifecycle IN ('ATTACHED','DELETE_PENDING','DELETED'))
  OR kind='SUBMISSION'
);

ALTER TABLE "Program" ADD CONSTRAINT "Program_cover_file_or_external_check" CHECK (
  ("coverFileId" IS NOT NULL AND "coverSourceUrl" IS NULL AND "coverImageUrl" IS NULL)
  OR ("coverFileId" IS NULL AND ("coverSourceUrl" IS NULL)=("coverImageUrl" IS NULL))
);

DROP TABLE "SubmissionFile";
DROP TABLE "ProgramAuthoringUpload";
DROP TABLE "MilestoneDocumentTemplateFile";
DROP TABLE "ProgramCover";
DROP TABLE "ProgramPurgeFileTombstone";

DROP FUNCTION reject_retired_file_write();

DROP TYPE "SubmissionFileLifecycle";
DROP TYPE "ProgramAuthoringUploadLifecycle";
DROP TYPE "ProgramPurgeFileTombstoneLifecycle";
DROP TYPE "ProgramCoverSource";

COMMIT;
