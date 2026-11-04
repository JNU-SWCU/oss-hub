BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "Program", "ProgramCreateRequest", "ProgramAuthoringUpload" IN SHARE ROW EXCLUSIVE MODE;

ALTER TYPE "ProgramLifecycle" ADD VALUE 'DELETED';
CREATE TYPE "ProgramCreatedBy" AS ENUM ('USER', 'LEGACY_UNKNOWN');
ALTER TABLE "Program"
  ADD COLUMN "createdBy" "ProgramCreatedBy" NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "payloadHash" VARCHAR(64);

UPDATE "Program" AS program
SET "createdBy" = 'USER',
    "createdById" = request."actorId",
    "idempotencyKey" = request."idempotencyKey",
    "payloadHash" = request."payloadHash"
FROM "ProgramCreateRequest" AS request
WHERE request."programId" = program.id;

ALTER TABLE "Program"
  ADD CONSTRAINT "Program_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Program_creation_check" CHECK (
    (("createdBy" = 'LEGACY_UNKNOWN' AND "createdById" IS NULL)
      OR ("createdBy" = 'USER' AND "createdById" IS NOT NULL))
    AND
    (("idempotencyKey" IS NULL AND "payloadHash" IS NULL)
      OR ("idempotencyKey" IS NOT NULL AND "payloadHash" IS NOT NULL
        AND char_length(btrim("idempotencyKey")) BETWEEN 1 AND 128
        AND "payloadHash" ~ '^[0-9a-f]{64}$'))
  );
CREATE UNIQUE INDEX "Program_createdById_idempotencyKey_key" ON "Program"("createdById", "idempotencyKey");
CREATE UNIQUE INDEX "Program_createdById_id_key" ON "Program"("createdById", id);

ALTER TABLE "ProgramAuthoringUpload" ADD COLUMN "programId" TEXT;
UPDATE "ProgramAuthoringUpload" AS upload
SET "programId" = request."programId"
FROM "ProgramCreateRequest" AS request
WHERE request.id = upload."createRequestId"
  AND request."actorId" = upload."createRequestActorId";
ALTER TABLE "ProgramAuthoringUpload"
  ADD CONSTRAINT "ProgramAuthoringUpload_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProgramAuthoringUpload_program_actor_fkey"
    FOREIGN KEY ("actorId", "programId") REFERENCES "Program"("createdById", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP CONSTRAINT "ProgramAuthoringUpload_lifecycle_check",
  ADD CONSTRAINT "ProgramAuthoringUpload_lifecycle_check" CHECK (
    ("lifecycle" = 'PENDING' AND "attachedAt" IS NULL AND "programId" IS NULL
      AND "nextDeleteAttemptAt" IS NULL AND "deletedAt" IS NULL)
    OR
    ("lifecycle" = 'ATTACHED' AND "attachedAt" IS NOT NULL AND "programId" IS NOT NULL
      AND "deleteClaimedAt" IS NULL AND "deleteClaimExpiresAt" IS NULL AND "deleteClaimOwner" IS NULL
      AND "nextDeleteAttemptAt" IS NULL AND "deletedAt" IS NULL)
    OR
    ("lifecycle" = 'DELETE_PENDING' AND "attachedAt" IS NULL
      AND "nextDeleteAttemptAt" IS NOT NULL AND "deletedAt" IS NULL)
    OR
    ("lifecycle" = 'DELETED' AND "attachedAt" IS NULL
      AND "deleteClaimedAt" IS NULL AND "deleteClaimExpiresAt" IS NULL AND "deleteClaimOwner" IS NULL
      AND "nextDeleteAttemptAt" IS NULL AND "deletedAt" IS NOT NULL)
  );

-- The previous app is still running while this migration executes.
-- These two bridges are retired only after the new app stops using the old columns.
CREATE FUNCTION program_creation_prepare_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Program"
  SET "createdBy" = 'USER', "createdById" = NEW."actorId",
      "idempotencyKey" = NEW."idempotencyKey", "payloadHash" = NEW."payloadHash"
  WHERE id = NEW."programId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER program_creation_prepare_bridge
AFTER INSERT OR UPDATE ON "ProgramCreateRequest"
FOR EACH ROW EXECUTE FUNCTION program_creation_prepare_bridge();

CREATE FUNCTION program_upload_prepare_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."createRequestId" IS NOT NULL
      AND NEW."createRequestId" IS NULL THEN
    NEW."programId" := NULL;
  END IF;
  IF NEW."lifecycle" = 'ATTACHED' AND NEW."createRequestId" IS NOT NULL THEN
    SELECT "programId" INTO NEW."programId"
    FROM "ProgramCreateRequest"
    WHERE id = NEW."createRequestId" AND "actorId" = NEW."createRequestActorId";
  ELSIF NEW."lifecycle" <> 'ATTACHED' THEN
    NEW."createRequestId" := NULL;
    NEW."createRequestActorId" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER program_upload_prepare_bridge
BEFORE INSERT OR UPDATE ON "ProgramAuthoringUpload"
FOR EACH ROW EXECUTE FUNCTION program_upload_prepare_bridge();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProgramCreateRequest" AS request
    JOIN "Program" AS program ON program.id = request."programId"
    WHERE (program."createdById", program."idempotencyKey", program."payloadHash")
      IS DISTINCT FROM (request."actorId", request."idempotencyKey", request."payloadHash")
  ) THEN
    RAISE EXCEPTION 'program creation reconciliation failed';
  END IF;
END;
$$;
COMMIT;
