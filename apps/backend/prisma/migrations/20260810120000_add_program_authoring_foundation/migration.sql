BEGIN;

-- Preflight와 DDL 사이에 legacy writer가 새 invalid row를 넣지 못하게 쓰기 잠금을
-- Program -> Milestone 순서로 잡는다. 1초 안에 잡지 못하면 배포를 중단하고 재시도한다.
SET LOCAL lock_timeout = '1s';
LOCK TABLE "Program" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Milestone" IN SHARE ROW EXCLUSIVE MODE;

-- 기존 행으로부터 계산될 값을 먼저 검증한다. 잠금 아래에서 이 블록을 통과한 뒤에만 DDL/백필한다.
DO $$
DECLARE
  invalid_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM "Program"
  WHERE "endAt" IS NOT NULL AND "applicationEndAt" >= "endAt";
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Program schedule migration blocked: % row(s) do not satisfy applicationEndAt < endAt', invalid_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO invalid_count
  FROM "Program"
  WHERE COALESCE("teamMinSize", 1) < 1
     OR COALESCE("teamMaxSize", 1) < 1
     OR COALESCE("teamMinSize", 1) > COALESCE("teamMaxSize", 1);
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Program team range migration blocked: % row(s) have an invalid range', invalid_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO invalid_count
  FROM "Milestone" AS milestone
  JOIN "Program" AS program ON program."id" = milestone."programId"
  WHERE milestone."dueAt" >= COALESCE(
       program."endAt",
       TIMESTAMP '9999-12-31 23:59:59.999'
     );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Milestone schedule migration blocked: % row(s) end after their Program', invalid_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

CREATE TYPE "ProgramAuthoringUploadLifecycle" AS ENUM ('PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED');

ALTER TABLE "Program" ADD COLUMN "startAt" TIMESTAMP(3)
DEFAULT TIMESTAMP '0001-01-01 00:00:00';
ALTER TABLE "Milestone" ADD COLUMN "startAt" TIMESTAMP(3)
DEFAULT TIMESTAMP '0001-01-01 00:00:00';

UPDATE "Program"
SET "startAt" = "applicationEndAt";

UPDATE "Milestone" AS milestone
SET "startAt" = program."startAt"
FROM "Program" AS program
WHERE milestone."programId" = program."id";

UPDATE "Program"
SET "teamMinSize" = 1
WHERE "teamMinSize" IS NULL;

UPDATE "Program"
SET "teamMaxSize" = 1
WHERE "teamMaxSize" IS NULL;

-- Legacy null endAt meant "not ended". Preserve that meaning with a finite
-- JavaScript-safe timestamp while the final schema remains non-null.
UPDATE "Program"
SET "endAt" = TIMESTAMP '9999-12-31 23:59:59.999'
WHERE "endAt" IS NULL;

ALTER TABLE "Program" ALTER COLUMN "startAt" SET NOT NULL;
ALTER TABLE "Program" ALTER COLUMN "endAt" SET DEFAULT TIMESTAMP '9999-12-31 23:59:59.999';
ALTER TABLE "Program" ALTER COLUMN "endAt" SET NOT NULL;
ALTER TABLE "Program" ALTER COLUMN "teamMinSize" SET DEFAULT 1;
ALTER TABLE "Program" ALTER COLUMN "teamMinSize" SET NOT NULL;
ALTER TABLE "Program" ALTER COLUMN "teamMaxSize" SET DEFAULT 1;
ALTER TABLE "Program" ALTER COLUMN "teamMaxSize" SET NOT NULL;
ALTER TABLE "Milestone" ALTER COLUMN "startAt" SET NOT NULL;

ALTER TABLE "Program" ADD CONSTRAINT "Program_applicationToOperatingWindow_check"
CHECK ("applicationEndAt" <= "startAt");

ALTER TABLE "Program" ADD CONSTRAINT "Program_operatingWindow_check"
CHECK ("startAt" < "endAt");

ALTER TABLE "Program" ADD CONSTRAINT "Program_teamSize_check"
CHECK (
  "teamMinSize" >= 1
  AND "teamMaxSize" >= 1
  AND "teamMinSize" <= "teamMaxSize"
);

ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_operatingWindow_check"
CHECK ("startAt" < "dueAt");

-- ADR-002 rolls the image back without reversing migrations. These triggers let
-- the previous image omit new startAt columns and keep writing nullable legacy
-- end/team values. Retire both triggers/default sentinels only after that image
-- is no longer a rollback candidate.
CREATE FUNCTION "Program_legacy_write_compatibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $program_compatibility$
BEGIN
  IF NEW."startAt" = TIMESTAMP '0001-01-01 00:00:00' THEN
    NEW."startAt" := NEW."applicationEndAt";
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."applicationEndAt" > OLD."applicationEndAt"
       AND NEW."startAt" IS NOT DISTINCT FROM OLD."startAt"
       AND NEW."startAt" < NEW."applicationEndAt" THEN
      NEW."startAt" := NEW."applicationEndAt";
    END IF;
  END IF;
  NEW."endAt" := COALESCE(
    NEW."endAt",
    TIMESTAMP '9999-12-31 23:59:59.999'
  );
  NEW."teamMinSize" := COALESCE(NEW."teamMinSize", 1);
  NEW."teamMaxSize" := COALESCE(NEW."teamMaxSize", 1);
  RETURN NEW;
END
$program_compatibility$;

CREATE TRIGGER "Program_legacy_write_compatibility"
BEFORE INSERT OR UPDATE OF "applicationEndAt", "startAt", "endAt", "teamMinSize", "teamMaxSize"
ON "Program"
FOR EACH ROW
EXECUTE FUNCTION "Program_legacy_write_compatibility"();

CREATE FUNCTION "Milestone_legacy_write_compatibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $milestone_compatibility$
DECLARE
  program_start_at TIMESTAMP(3);
  program_end_at TIMESTAMP(3);
  is_legacy_write BOOLEAN;
BEGIN
  SELECT "startAt", "endAt"
  INTO program_start_at, program_end_at
  FROM "Program"
  WHERE "id" = NEW."programId"
  FOR SHARE;

  is_legacy_write := NEW."startAt" = TIMESTAMP '0001-01-01 00:00:00';
  IF is_legacy_write THEN
    NEW."startAt" := LEAST(
      program_start_at,
      NEW."dueAt" - INTERVAL '1 millisecond'
    );
  END IF;
  IF NOT is_legacy_write AND NEW."startAt" < program_start_at THEN
    RAISE EXCEPTION 'Milestone startAt must be at or after its Program startAt'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."dueAt" >= program_end_at THEN
    RAISE EXCEPTION 'Milestone dueAt must be before its Program endAt'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$milestone_compatibility$;

CREATE TRIGGER "Milestone_legacy_write_compatibility"
BEFORE INSERT OR UPDATE OF "programId", "startAt", "dueAt"
ON "Milestone"
FOR EACH ROW
EXECUTE FUNCTION "Milestone_legacy_write_compatibility"();

CREATE TABLE "ProgramAuthoringUpload" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "storageKey" VARCHAR(512) NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(127) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "lifecycle" "ProgramAuthoringUploadLifecycle" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attachedAt" TIMESTAMP(3),
  "deleteClaimedAt" TIMESTAMP(3),
  "deleteClaimExpiresAt" TIMESTAMP(3),
  "deleteClaimOwner" VARCHAR(128),
  "deleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextDeleteAttemptAt" TIMESTAMP(3),
  "lastDeleteError" VARCHAR(64),
  "deletedAt" TIMESTAMP(3),
  "createRequestActorId" TEXT,
  "createRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgramAuthoringUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgramAuthoringUpload_storageKey_check" CHECK (btrim("storageKey") <> ''),
  CONSTRAINT "ProgramAuthoringUpload_originalFileName_check" CHECK (btrim("originalFileName") <> ''),
  CONSTRAINT "ProgramAuthoringUpload_mimeType_check" CHECK (btrim("mimeType") <> ''),
  CONSTRAINT "ProgramAuthoringUpload_sizeBytes_check" CHECK ("sizeBytes" BETWEEN 1 AND 5242880),
  CONSTRAINT "ProgramAuthoringUpload_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProgramAuthoringUpload_deleteAttemptCount_check" CHECK ("deleteAttemptCount" BETWEEN 0 AND 6),
  CONSTRAINT "ProgramAuthoringUpload_lastDeleteError_check" CHECK (
    "lastDeleteError" IS NULL OR "lastDeleteError" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT "ProgramAuthoringUpload_createRequest_actor_check" CHECK (
    "createRequestActorId" IS NULL OR "createRequestActorId" = "actorId"
  ),
  CONSTRAINT "ProgramAuthoringUpload_lifecycle_check" CHECK (
    (
      "lifecycle" = 'PENDING'
      AND "attachedAt" IS NULL
      AND "createRequestActorId" IS NULL
      AND "createRequestId" IS NULL
      AND "nextDeleteAttemptAt" IS NULL
      AND "deletedAt" IS NULL
    ) OR (
      "lifecycle" = 'ATTACHED'
      AND "attachedAt" IS NOT NULL
      AND "createRequestActorId" IS NOT NULL
      AND "createRequestId" IS NOT NULL
      AND "deleteClaimedAt" IS NULL
      AND "deleteClaimExpiresAt" IS NULL
      AND "deleteClaimOwner" IS NULL
      AND "nextDeleteAttemptAt" IS NULL
      AND "deletedAt" IS NULL
    ) OR (
      "lifecycle" = 'DELETE_PENDING'
      AND "attachedAt" IS NULL
      AND "createRequestActorId" IS NULL
      AND "createRequestId" IS NULL
      AND "nextDeleteAttemptAt" IS NOT NULL
      AND "deletedAt" IS NULL
    ) OR (
      "lifecycle" = 'DELETED'
      AND "attachedAt" IS NULL
      AND "createRequestActorId" IS NULL
      AND "createRequestId" IS NULL
      AND "deleteClaimedAt" IS NULL
      AND "deleteClaimExpiresAt" IS NULL
      AND "deleteClaimOwner" IS NULL
      AND "nextDeleteAttemptAt" IS NULL
      AND "deletedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "ProgramAuthoringUpload_delete_claim_check" CHECK (
    (
      "deleteClaimedAt" IS NULL
      AND "deleteClaimExpiresAt" IS NULL
      AND "deleteClaimOwner" IS NULL
    ) OR (
      "lifecycle" = 'DELETE_PENDING'
      AND "deleteClaimedAt" IS NOT NULL
      AND "deleteClaimExpiresAt" IS NOT NULL
      AND btrim("deleteClaimOwner") <> ''
      AND "deleteClaimExpiresAt" = "deleteClaimedAt" + INTERVAL '10 minutes'
    )
  )
);

CREATE TABLE "ProgramCreateRequest" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "programId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgramCreateRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgramCreateRequest_idempotencyKey_check" CHECK (
    char_length(btrim("idempotencyKey")) BETWEEN 1 AND 128
  ),
  CONSTRAINT "ProgramCreateRequest_payloadHash_check" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "ProgramAuthoringUpload_storageKey_key" ON "ProgramAuthoringUpload"("storageKey");
CREATE INDEX "ProgramAuthoringUpload_actorId_lifecycle_expiresAt_idx" ON "ProgramAuthoringUpload"("actorId", "lifecycle", "expiresAt");
CREATE INDEX "ProgramAuthoringUpload_lifecycle_nextDeleteAttemptAt_delete_idx" ON "ProgramAuthoringUpload"("lifecycle", "nextDeleteAttemptAt", "deleteClaimExpiresAt");
CREATE UNIQUE INDEX "ProgramCreateRequest_programId_key" ON "ProgramCreateRequest"("programId");
CREATE UNIQUE INDEX "ProgramCreateRequest_actorId_idempotencyKey_key" ON "ProgramCreateRequest"("actorId", "idempotencyKey");
CREATE UNIQUE INDEX "ProgramCreateRequest_actorId_id_key" ON "ProgramCreateRequest"("actorId", "id");
CREATE INDEX "ProgramCreateRequest_actorId_createdAt_idx" ON "ProgramCreateRequest"("actorId", "createdAt");

ALTER TABLE "ProgramAuthoringUpload" ADD CONSTRAINT "ProgramAuthoringUpload_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramCreateRequest" ADD CONSTRAINT "ProgramCreateRequest_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramCreateRequest" ADD CONSTRAINT "ProgramCreateRequest_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramAuthoringUpload" ADD CONSTRAINT "ProgramAuthoringUpload_createRequestActorId_createRequestI_fkey"
FOREIGN KEY ("createRequestActorId", "createRequestId")
REFERENCES "ProgramCreateRequest"("actorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
