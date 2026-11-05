BEGIN;

LOCK TABLE "SubmissionFile", "ProgramAuthoringUpload",
  "MilestoneDocumentTemplateFile", "ProgramCover", "ProgramPurgeFileTombstone"
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  counts bigint[];
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
    RAISE EXCEPTION 'file source count mismatch: %', counts;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ProgramAuthoringUpload" upload
    JOIN "MilestoneDocumentTemplateFile" template USING ("storageKey")
    JOIN "MilestoneDocument" requirement ON requirement.id=template."milestoneDocumentId"
    JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId"
    WHERE upload.lifecycle::text <> 'ATTACHED'
       OR upload."programId" IS DISTINCT FROM milestone."programId"
       OR upload."actorId" IS DISTINCT FROM template."uploadedById"
       OR upload."originalFileName" IS DISTINCT FROM template."originalFileName"
       OR upload."mimeType" IS DISTINCT FROM template."mimeType"
       OR upload."sizeBytes" IS DISTINCT FROM template."sizeBytes"
  ) THEN
    RAISE EXCEPTION 'file upload/template metadata mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubmissionFile" file
    JOIN "MilestoneDocumentSubmissionHistory" history ON history.id=file."milestoneDocumentSubmissionHistoryId"
    JOIN "MilestoneDocumentSubmission" submission ON submission.id=history."milestoneDocumentSubmissionId"
    JOIN "MilestoneDocument" requirement ON requirement.id=submission."milestoneDocumentId"
    WHERE file."milestoneDocumentSubmissionId" IS DISTINCT FROM submission.id
       OR (file."teamId" IS NOT NULL AND file."teamId"<>submission."teamId")
       OR (file."milestoneId" IS NOT NULL AND file."milestoneId"<>requirement."milestoneId")
       OR (file."milestoneDocumentId" IS NOT NULL AND file."milestoneDocumentId"<>requirement.id)
  ) THEN
    RAISE EXCEPTION 'file submission owner mismatch';
  END IF;
END $$;

CREATE TYPE "FileKind" AS ENUM ('UPLOAD', 'TEMPLATE', 'COVER', 'SUBMISSION');
CREATE TYPE "FileLifecycle" AS ENUM ('PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED');

CREATE TABLE "File" (
  "id" text PRIMARY KEY,
  "kind" "FileKind" NOT NULL,
  "lifecycle" "FileLifecycle" NOT NULL,
  "storageKey" text NOT NULL UNIQUE,
  "originalFileName" text,
  "mimeType" text,
  "sizeBytes" integer,
  "sha256" varchar(64),
  "uploaderId" text REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "programId" text REFERENCES "Program"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "requirementId" text REFERENCES "MilestoneDocument"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "teamId" text REFERENCES "Team"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "submissionId" text REFERENCES "MilestoneDocumentSubmission"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "submissionHistoryId" text REFERENCES "MilestoneDocumentSubmissionHistory"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "pendingExpiresAt" timestamp(3),
  "expiresAt" timestamp(3),
  "attachedAt" timestamp(3),
  "deleteClaimedAt" timestamp(3),
  "deleteClaimExpiresAt" timestamp(3),
  "deleteClaimOwner" text,
  "deleteAttemptCount" integer NOT NULL DEFAULT 0,
  "nextDeleteAttemptAt" timestamp(3),
  "lastDeleteError" text,
  "deletedAt" timestamp(3),
  "createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "File_uploaderId_idx" ON "File"("uploaderId");
CREATE INDEX "File_teamId_requirementId_lifecycle_idx" ON "File"("teamId", "requirementId", "lifecycle");
CREATE INDEX "File_lifecycle_pendingExpiresAt_idx" ON "File"("lifecycle", "pendingExpiresAt");
CREATE INDEX "File_lifecycle_nextDeleteAttemptAt_deleteClaimExpiresAt_idx"
  ON "File"("lifecycle", "nextDeleteAttemptAt", "deleteClaimExpiresAt");
CREATE INDEX "File_programId_idx" ON "File"("programId");
CREATE INDEX "File_requirementId_idx" ON "File"("requirementId");
CREATE INDEX "File_submissionId_idx" ON "File"("submissionId");
CREATE INDEX "File_submissionHistoryId_idx" ON "File"("submissionHistoryId");
CREATE UNIQUE INDEX "File_attached_template_requirement_key" ON "File"("requirementId")
  WHERE "kind"='TEMPLATE' AND "lifecycle"='ATTACHED';
CREATE UNIQUE INDEX "File_attached_cover_program_key" ON "File"("programId")
  WHERE "kind"='COVER' AND "lifecycle"='ATTACHED';
ALTER TABLE "File" ADD CONSTRAINT "File_cover_metadata_check" CHECK (
  kind<>'COVER' OR (
    "storageKey" LIKE 'program-covers/%'
    AND "mimeType" IS NOT NULL AND "mimeType" IN ('image/jpeg','image/png')
    AND "sizeBytes" IS NOT NULL AND "sizeBytes" BETWEEN 1 AND 5242880
  )
);
ALTER TABLE "File" ADD CONSTRAINT "File_kind_owner_check" CHECK (
  (kind='SUBMISSION' AND (
    (lifecycle='PENDING' AND "teamId" IS NOT NULL AND "requirementId" IS NOT NULL
      AND "submissionId" IS NULL AND "submissionHistoryId" IS NULL
      AND "pendingExpiresAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
    OR (lifecycle='ATTACHED' AND "teamId" IS NOT NULL
      AND "submissionId" IS NOT NULL AND "submissionHistoryId" IS NOT NULL
      AND "pendingExpiresAt" IS NULL)
    OR lifecycle IN ('DELETE_PENDING','DELETED')
  ))
  OR (kind<>'SUBMISSION' AND "teamId" IS NULL AND "submissionId" IS NULL AND "submissionHistoryId" IS NULL)
);

CREATE TEMP TABLE file_copy_source ON COMMIT DROP AS
SELECT file.id, 'SUBMISSION'::"FileKind" AS kind,
       file.lifecycle::text::"FileLifecycle" AS lifecycle,
       file."storageKey", file."originalFileName", file."mimeType", file."sizeBytes",
       NULL::varchar(64) AS sha256, file."uploaderId",
       NULL::text AS "programId", file."milestoneDocumentId" AS "requirementId",
       file."teamId", file."milestoneDocumentSubmissionId" AS "submissionId",
       file."milestoneDocumentSubmissionHistoryId" AS "submissionHistoryId",
       file."pendingExpiresAt", file."expiresAt", NULL::timestamp(3) AS "attachedAt",
       file."deleteClaimedAt", file."deleteClaimExpiresAt", file."deleteClaimOwner",
       file."deleteAttemptCount", file."nextDeleteAttemptAt", file."lastDeleteError",
       file."deletedAt", file."createdAt", file."createdAt" AS "updatedAt"
FROM "SubmissionFile" file
UNION ALL
SELECT template.id, 'TEMPLATE'::"FileKind", 'ATTACHED'::"FileLifecycle",
       template."storageKey", template."originalFileName", template."mimeType", template."sizeBytes",
       upload.sha256, template."uploadedById", NULL, template."milestoneDocumentId", NULL,
       NULL, NULL, NULL, NULL, upload."attachedAt",
       upload."deleteClaimedAt", upload."deleteClaimExpiresAt", upload."deleteClaimOwner",
       COALESCE(upload."deleteAttemptCount",0), upload."nextDeleteAttemptAt", upload."lastDeleteError",
       upload."deletedAt", template."uploadedAt", COALESCE(upload."updatedAt",template."uploadedAt")
FROM "MilestoneDocumentTemplateFile" template
LEFT JOIN "ProgramAuthoringUpload" upload USING ("storageKey")
UNION ALL
SELECT upload.id, 'UPLOAD'::"FileKind", upload.lifecycle::text::"FileLifecycle",
       upload."storageKey", upload."originalFileName", upload."mimeType", upload."sizeBytes",
       upload.sha256, upload."actorId", upload."programId", NULL, NULL, NULL, NULL,
       upload."expiresAt", NULL, upload."attachedAt",
       upload."deleteClaimedAt", upload."deleteClaimExpiresAt", upload."deleteClaimOwner",
       upload."deleteAttemptCount", upload."nextDeleteAttemptAt", upload."lastDeleteError",
       upload."deletedAt", upload."createdAt", upload."updatedAt"
FROM "ProgramAuthoringUpload" upload
WHERE NOT EXISTS (
  SELECT 1 FROM "MilestoneDocumentTemplateFile" template WHERE template."storageKey"=upload."storageKey"
)
UNION ALL
SELECT cover.id, 'COVER'::"FileKind", 'ATTACHED'::"FileLifecycle",
       cover."storageKey", NULL, cover."mimeType", cover."sizeBytes",
       NULL, NULL, cover."programId", NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL
FROM "ProgramCover" cover WHERE cover.source::text='OWNED'
UNION ALL
SELECT tombstone.id, 'UPLOAD'::"FileKind", tombstone.lifecycle::text::"FileLifecycle",
       tombstone."storageKey", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, tombstone."deleteClaimedAt", tombstone."deleteClaimExpiresAt",
       tombstone."deleteClaimOwner", tombstone."deleteAttemptCount", tombstone."nextDeleteAttemptAt",
       tombstone."lastDeleteError", tombstone."deletedAt", tombstone."createdAt", tombstone."updatedAt"
FROM "ProgramPurgeFileTombstone" tombstone;

DO $$
DECLARE
  expected_count bigint;
BEGIN
  SELECT count(*) INTO expected_count FROM file_copy_source;
  IF expected_count NOT IN (0,92) THEN
    RAISE EXCEPTION 'canonical file count mismatch: %', expected_count;
  END IF;
  IF EXISTS (SELECT 1 FROM file_copy_source GROUP BY id HAVING count(*)<>1)
     OR EXISTS (SELECT 1 FROM file_copy_source GROUP BY "storageKey" HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'canonical file identity collision';
  END IF;
END $$;

INSERT INTO "File" SELECT * FROM file_copy_source;

ALTER TABLE "Program" ADD COLUMN "coverFileId" text;
ALTER TABLE "Program" ADD COLUMN "coverSourceUrl" varchar(2048);
ALTER TABLE "Program" ADD COLUMN "coverImageUrl" varchar(2048);
CREATE UNIQUE INDEX "Program_coverFileId_key" ON "Program"("coverFileId");
ALTER TABLE "Program" ADD CONSTRAINT "Program_coverFileId_fkey"
  FOREIGN KEY ("coverFileId") REFERENCES "File"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

UPDATE "Program" program
SET "coverFileId"=CASE WHEN cover.source::text='OWNED' THEN cover.id END,
    "coverSourceUrl"=cover."sourceUrl", "coverImageUrl"=cover."imageUrl"
FROM "ProgramCover" cover WHERE program.id=cover."programId";

DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM file_copy_source EXCEPT SELECT * FROM "File")
    UNION ALL
    (SELECT * FROM "File" EXCEPT SELECT * FROM file_copy_source)
  ) THEN
    RAISE EXCEPTION 'file copy reconciliation mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ProgramCover" cover
    JOIN "Program" program ON program.id=cover."programId"
    WHERE program."coverFileId" IS DISTINCT FROM CASE WHEN cover.source::text='OWNED' THEN cover.id END
       OR program."coverSourceUrl" IS DISTINCT FROM cover."sourceUrl"
       OR program."coverImageUrl" IS DISTINCT FROM cover."imageUrl"
  ) THEN
    RAISE EXCEPTION 'program cover reconciliation mismatch';
  END IF;
END $$;

DO $$
DECLARE
  reference record;
  expected_count integer := 12;
BEGIN
  -- Todo 9 keeps SubmissionFile.applicationId until its retirement migration drops it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='SubmissionFile' AND column_name='applicationId'
  ) THEN
    expected_count := 13;
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN (
    '"SubmissionFile"'::regclass, '"ProgramAuthoringUpload"'::regclass,
    '"MilestoneDocumentTemplateFile"'::regclass, '"ProgramCover"'::regclass,
    '"ProgramPurgeFileTombstone"'::regclass
  )) <> expected_count THEN
    RAISE EXCEPTION 'retired file outgoing foreign key count mismatch';
  END IF;
  FOR reference IN
    SELECT conrelid::regclass AS relation, conname FROM pg_constraint
    WHERE contype='f' AND conrelid IN (
      '"SubmissionFile"'::regclass, '"ProgramAuthoringUpload"'::regclass,
      '"MilestoneDocumentTemplateFile"'::regclass, '"ProgramCover"'::regclass,
      '"ProgramPurgeFileTombstone"'::regclass
    )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', reference.relation, reference.conname);
  END LOOP;
END $$;

CREATE FUNCTION reject_retired_file_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'retired file storage is read only after File cutover';
END $$;

CREATE TRIGGER retired_file_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON "SubmissionFile" FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_file_write();
CREATE TRIGGER retired_file_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON "ProgramAuthoringUpload" FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_file_write();
CREATE TRIGGER retired_file_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON "MilestoneDocumentTemplateFile" FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_file_write();
CREATE TRIGGER retired_file_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON "ProgramCover" FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_file_write();
CREATE TRIGGER retired_file_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON "ProgramPurgeFileTombstone" FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_file_write();

COMMIT;
