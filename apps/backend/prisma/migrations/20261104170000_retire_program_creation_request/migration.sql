BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "Program", "ProgramCreateRequest", "ProgramAuthoringUpload" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProgramCreateRequest" r
    LEFT JOIN "Program" p ON p.id = r."programId"
    WHERE p.id IS NULL OR p."createdBy" <> 'USER'
      OR (p."createdById", p."idempotencyKey", p."payloadHash")
        IS DISTINCT FROM (r."actorId", r."idempotencyKey", r."payloadHash")
  ) OR EXISTS (
    SELECT 1 FROM "ProgramAuthoringUpload" u
    JOIN "ProgramCreateRequest" r ON r.id = u."createRequestId"
    WHERE u."programId" IS DISTINCT FROM r."programId"
  ) THEN
    RAISE EXCEPTION 'program absorption retirement reconciliation failed';
  END IF;
END;
$$;
DROP TRIGGER program_upload_prepare_bridge ON "ProgramAuthoringUpload";
DROP FUNCTION program_upload_prepare_bridge();
DROP TRIGGER program_creation_prepare_bridge ON "ProgramCreateRequest";
DROP FUNCTION program_creation_prepare_bridge();
ALTER TABLE "ProgramAuthoringUpload"
  DROP CONSTRAINT "ProgramAuthoringUpload_createRequestActorId_createRequestI_fkey",
  DROP CONSTRAINT "ProgramAuthoringUpload_createRequest_actor_check",
  DROP COLUMN "createRequestActorId",
  DROP COLUMN "createRequestId";
DROP TABLE "ProgramCreateRequest";
COMMIT;
